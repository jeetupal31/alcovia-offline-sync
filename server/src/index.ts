import express from 'express';
import cors from 'cors';
import fs from 'fs';
import type { Op, SyncRequest } from './types';
import { computeStreak, rewardFor } from './rewards';

const PORT = 4000;
const DB_FILE = './register.json';
const STUDENT_ID = 'student-1'; // single hardcoded student (per the assignment)

// Where the n8n webhook lives. Override with the N8N_WEBHOOK_URL env var.
const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ??
  'http://localhost:5678/webhook/alcovia-session-success';

// ---------------- The master register ----------------
let register: Op[] = [];
const seenIds = new Set<string>();

// ---------------- Server-side reward state (derived from the register) ----
// The server is the single authority for CONFIRMED rewards. Everything here
// can be rebuilt by replaying the register, so it can never drift from it.
const rewardedSessions = new Set<string>(); // sessionIds counted exactly once
let totalCoins = 0;
const successDates = new Set<string>();
const minutesByDate = new Map<string, number>();

// ---------------- Outbox (exactly-once notification dispatch) -------------
// When a session is rewarded for the FIRST time, one outbox entry is created,
// keyed by sessionId. Replays can't create a second entry, so the webhook for
// a session can only ever be dispatched from one entry. (Transactional outbox.)
type OutboxEntry = {
  sessionId: string;
  payload: Record<string, any>;
  createdAt: string;
  sentAt: string | null;
  attempts: number;
};
let outbox: OutboxEntry[] = [];

// The mock WhatsApp sink - n8n posts here; we just store + log.
let notifications: Record<string, any>[] = [];

// ---------------- persistence ----------------
function save() {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({ register, outbox, notifications }, null, 2)
  );
}

function load() {
  if (!fs.existsSync(DB_FILE)) return;
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  // older format (step 1/2) stored a plain array of ops
  if (Array.isArray(raw)) {
    register = raw;
  } else {
    register = raw.register ?? [];
    outbox = raw.outbox ?? [];
    notifications = raw.notifications ?? [];
  }
  for (const op of register) seenIds.add(op.opId);
  // rebuild reward state by replaying the register (NO outbox writes here -
  // the outbox is persisted, so restarts never re-queue old notifications)
  for (const op of register) rebuildRewardState(op);
  console.log(
    `Loaded ${register.length} ops, ${outbox.length} outbox entries, ${notifications.length} notifications`
  );
}

function rebuildRewardState(op: Op) {
  if (op.type !== 'SESSION_COMPLETED') return;
  const { sessionId, targetMin, localDate } = op.payload;
  if (!sessionId || rewardedSessions.has(sessionId)) return;
  rewardedSessions.add(sessionId);
  totalCoins += rewardFor(targetMin ?? 0);
  if (localDate) {
    successDates.add(localDate);
    minutesByDate.set(localDate, (minutesByDate.get(localDate) ?? 0) + (targetMin ?? 0));
  }
}

// ---------------- the reward step (runs at ingestion) ----------------
// Called for every NEW op the register accepts. For a SESSION_COMPLETED it
// counts the reward exactly once (rewardedSessions guard) and queues exactly
// one notification (outbox keyed by sessionId).
function applyRewardIfNew(op: Op) {
  if (op.type !== 'SESSION_COMPLETED') return;
  const { sessionId, targetMin, localDate } = op.payload;
  if (!sessionId) return;
  if (rewardedSessions.has(sessionId)) {
    // same session arriving again (replay / second device) -> already counted
    console.log(`[reward] session=${sessionId} already counted - skipping`);
    return;
  }
  rewardedSessions.add(sessionId);

  const coins = rewardFor(targetMin ?? 0);
  totalCoins += coins;
  if (localDate) {
    successDates.add(localDate);
    minutesByDate.set(localDate, (minutesByDate.get(localDate) ?? 0) + (targetMin ?? 0));
  }
  const streak = computeStreak(successDates);
  const todayMin = localDate ? minutesByDate.get(localDate) ?? 0 : 0;

  outbox.push({
    sessionId,
    payload: {
      eventId: sessionId, // <- the stable id n8n dedupes on
      studentId: STUDENT_ID,
      streak,
      coinsAwarded: coins,
      totalCoins,
      message: `Streak now ${streak} day${streak === 1 ? '' : 's'}, +${coins} coins! Total ${totalCoins} coins, ${todayMin} focused min today.`,
    },
    createdAt: new Date().toISOString(),
    sentAt: null,
    attempts: 0,
  });
  console.log(
    `[reward] session=${sessionId} +${coins} coins (total=${totalCoins}, streak=${streak}) -> notification queued`
  );
}

// ---------------- outbox dispatcher ----------------
// Every 2s: try to send unsent outbox entries to the n8n webhook. Failures
// are retried forever. NOTE: a timeout AFTER n8n received the request means
// we retry something n8n already processed - that is exactly why the n8n
// workflow dedupes on eventId as well. Exactly-once DELIVERY is impossible;
// exactly-once EFFECT via an idempotent consumer is the real-world answer.
let dispatching = false;
setInterval(async () => {
  if (dispatching) return;
  dispatching = true;
  for (const entry of outbox) {
    if (entry.sentAt) continue;
    entry.attempts++;
    try {
      const r = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload),
      });
      if (!r.ok) throw new Error(`status ${r.status}`);
      entry.sentAt = new Date().toISOString();
      save();
      console.log(`[outbox] sent session=${entry.sessionId} (attempt ${entry.attempts})`);
    } catch (e: any) {
      console.log(
        `[outbox] send failed session=${entry.sessionId} attempt=${entry.attempts}: ${e?.message ?? e} (will retry)`
      );
    }
  }
  dispatching = false;
}, 2000);

// ---------------- the server ----------------
const app = express();
app.use(cors());
app.use(express.json());

app.post('/sync', (req, res) => {
  const { deviceId, cursor = 0, ops = [] } = req.body as SyncRequest;

  let accepted = 0;
  let duplicates = 0;

  for (const op of ops) {
    if (seenIds.has(op.opId)) {
      duplicates++; // replayed parchi -> ignored. This line IS the idempotency.
      continue;
    }
    seenIds.add(op.opId);
    register.push({ ...op, serverSeq: register.length + 1 });
    accepted++;
    applyRewardIfNew(op); // rewards + outbox, exactly once per sessionId
  }
  if (accepted > 0) save();

  const opsForDevice = register.filter((op) => (op.serverSeq ?? 0) > cursor);

  console.log(
    `[sync] device=${deviceId} sent=${ops.length} accepted=${accepted} duplicates=${duplicates} -> returning ${opsForDevice.length} ops, register size=${register.length}`
  );

  res.json({ accepted, duplicates, newCursor: register.length, ops: opsForDevice });
});

// ---- mock WhatsApp sink: n8n's HTTP node posts here ----
app.post('/mock-whatsapp', (req, res) => {
  const n = { ...req.body, receivedAt: new Date().toISOString() };
  notifications.push(n);
  save();
  console.log(`[mock-whatsapp] ${n.message ?? JSON.stringify(n)}`);
  res.json({ ok: true });
});

// ---- debug endpoints (open these in a browser) ----
app.get('/register', (_req, res) => res.json(register));
app.get('/outbox', (_req, res) => res.json(outbox));
app.get('/notifications', (_req, res) => res.json(notifications));
app.get('/state', (_req, res) =>
  res.json({
    studentId: STUDENT_ID,
    totalCoins,
    streak: computeStreak(successDates),
    rewardedSessions: [...rewardedSessions],
    registerSize: register.length,
    outboxSize: outbox.length,
    notificationsDelivered: notifications.length,
  })
);

load();
app.listen(PORT, () => {
  console.log(`Sync server running on http://localhost:${PORT}`);
  console.log(`Webhook target: ${N8N_WEBHOOK_URL}`);
});
