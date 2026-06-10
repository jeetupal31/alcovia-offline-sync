import express from 'express';
import cors from 'cors';
import fs from 'fs';
import type { Op, SyncRequest } from './types';

const PORT = 4000;
const DB_FILE = './register.json';

// ---------------- The master register ----------------
// Every change from every device lands here, in arrival order.
// This array IS the single source of truth for the whole system.
let register: Op[] = [];

// Fast lookup: which opIds are already in the register.
const seenIds = new Set<string>();

// Load the register from disk so a server restart loses nothing.
if (fs.existsSync(DB_FILE)) {
  register = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  for (const op of register) seenIds.add(op.opId);
  console.log(`Loaded ${register.length} ops from ${DB_FILE}`);
}

const save = () =>
  fs.writeFileSync(DB_FILE, JSON.stringify(register, null, 2));

// ---------------- The server ----------------
const app = express();
app.use(cors());
app.use(express.json());

// One endpoint does all the syncing.
// The device sends: its pending ops + the last serverSeq it has seen (cursor).
// The server: stores the new ops (silently skipping duplicates), then returns
// every op newer than the device's cursor - including ops from OTHER devices.
app.post('/sync', (req, res) => {
  const { deviceId, cursor = 0, ops = [] } = req.body as SyncRequest;

  let accepted = 0;
  let duplicates = 0;

  for (const op of ops) {
    if (seenIds.has(op.opId)) {
      // Same op arriving again (network retry / replay) -> ignore it.
      // This single line is what makes the whole system idempotent.
      duplicates++;
      continue;
    }
    seenIds.add(op.opId);
    register.push({ ...op, serverSeq: register.length + 1 });
    accepted++;
  }
  if (accepted > 0) save();

  const opsForDevice = register.filter((op) => (op.serverSeq ?? 0) > cursor);

  console.log(
    `[sync] device=${deviceId} sent=${ops.length} accepted=${accepted} ` +
      `duplicates=${duplicates} -> returning ${opsForDevice.length} ops, ` +
      `register size=${register.length}`
  );

  res.json({
    accepted,
    duplicates,
    newCursor: register.length,
    ops: opsForDevice,
  });
});

// Debug: open http://localhost:4000/register in a browser
// to see every op that has ever been stored.
app.get('/register', (_req, res) => res.json(register));

app.listen(PORT, () =>
  console.log(`Sync server running on http://localhost:${PORT}`)
);
