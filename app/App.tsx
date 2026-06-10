import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  DimensionValue,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SyncEngine } from './src/engine';
import {
  fold,
  rewardFor,
  todayStr,
  type AppState,
  type Task,
  type TaskStatus,
} from './src/reducer';
import { makeUUID, webDoc, webLocation, webStorage } from './src/web';

// ---- one engine per browser tab; ?device=A / ?device=B picks the identity ----
function getDeviceId(): string {
  try {
    const p = new URLSearchParams(webLocation?.search ?? '');
    return (p.get('device') || 'A').toUpperCase();
  } catch {
    return 'A';
  }
}
const DEVICE_ID = getDeviceId();
const engine = new SyncEngine(DEVICE_ID);
const ACTIVE_KEY = `alcovia:${DEVICE_ID}:activeSession`;

type ActiveSession = {
  sessionId: string;
  startedAt: number;
  targetMin: number;
  targetSec: number;
};

const PRESETS = [
  { label: '30 sec (demo)', targetMin: 0.5, targetSec: 30 },
  { label: '25 min', targetMin: 25, targetSec: 25 * 60 },
  { label: '50 min', targetMin: 50, targetSec: 50 * 60 },
];

const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  not_started: 'in_progress',
  in_progress: 'done',
  done: 'not_started',
};
const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};

export default function App() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => engine.subscribe(force), []);

  // re-fold whenever the engine changes (version bumps on every change)
  const state = useMemo(() => fold(engine.getOps()), [engine.version]);

  // auto-sync every 3s; sync() itself does nothing while offline
  useEffect(() => {
    const id = setInterval(() => engine.sync(), 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <ScrollView style={st.page} contentContainerStyle={st.content}>
      <Header state={state} />
      <FocusCard state={state} />
      <Syllabus state={state} />
      <DevPanel state={state} />
    </ScrollView>
  );
}

// ---------------- header: identity + derived totals ----------------
function Header({ state }: { state: AppState }) {
  const other = DEVICE_ID === 'A' ? 'B' : 'A';
  return (
    <View style={st.header}>
      <View style={st.rowBetween}>
        <Text style={st.deviceBadge}>Device {DEVICE_ID}</Text>
        <Text style={st.hint}>second device: open ?device={other} in another tab</Text>
      </View>
      <View style={st.statsRow}>
        <Stat label="Coins" value={String(state.coins)} />
        <Stat label="Streak" value={`${state.streak} day${state.streak === 1 ? '' : 's'}`} />
        <Stat label="Today" value={`${fmtMin(state.todayMinutes)} min`} />
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.stat}>
      <Text style={st.statLabel}>{label}</Text>
      <Text style={st.statValue}>{value}</Text>
    </View>
  );
}

// ---------------- feature A: focus sessions ----------------
function FocusCard({ state }: { state: AppState }) {
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [now, setNow] = useState(Date.now());
  const [flash, setFlash] = useState<string | null>(null);
  const hiddenAt = useRef<number | null>(null);

  // crash recovery: a session that was running when the tab closed/refreshed
  useEffect(() => {
    try {
      const raw = webStorage?.getItem(ACTIVE_KEY);
      if (!raw) return;
      const saved: ActiveSession = JSON.parse(raw);
      const elapsedSec = (Date.now() - saved.startedAt) / 1000;
      if (elapsedSec >= saved.targetSec) {
        // tab was gone past the deadline -> counts as leaving the session
        webStorage?.removeItem(ACTIVE_KEY);
        engine.addOp('SESSION_FAILED', {
          sessionId: saved.sessionId,
          reason: 'app_switch',
          targetMin: saved.targetMin,
        });
        setFlash('Last session failed: app was closed mid-session');
      } else {
        setActive(saved); // resume the running timer
      }
    } catch {}
  }, []);

  // persist the active session so refresh/crash can recover it
  useEffect(() => {
    try {
      if (active) webStorage?.setItem(ACTIVE_KEY, JSON.stringify(active));
      else webStorage?.removeItem(ACTIVE_KEY);
    } catch {}
  }, [active]);

  // display tick only - real timing is computed from startedAt, never counted
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [active]);

  // completion check
  useEffect(() => {
    if (!active) return;
    if ((now - active.startedAt) / 1000 >= active.targetSec) {
      engine.addOp('SESSION_COMPLETED', {
        sessionId: active.sessionId,
        targetMin: active.targetMin,
        localDate: todayStr(),
      });
      setFlash(`Success! +${rewardFor(active.targetMin)} coins`);
      setActive(null);
    }
  }, [now, active]);

  // app-switch rule: hidden for more than 5s while a session runs -> fail
  useEffect(() => {
    if (!webDoc?.addEventListener) return;
    const onVis = () => {
      if (webDoc.visibilityState === 'hidden') {
        if (active) hiddenAt.current = Date.now();
      } else {
        const h = hiddenAt.current;
        hiddenAt.current = null;
        if (active && h && Date.now() - h > 5000) {
          engine.addOp('SESSION_FAILED', {
            sessionId: active.sessionId,
            reason: 'app_switch',
            targetMin: active.targetMin,
          });
          setFlash('Session failed: you left for more than 5 seconds');
          setActive(null);
        }
      }
    };
    webDoc.addEventListener('visibilitychange', onVis);
    return () => webDoc.removeEventListener('visibilitychange', onVis);
  }, [active]);

  const start = (targetMin: number, targetSec: number) => {
    setFlash(null);
    setActive({ sessionId: makeUUID(), startedAt: Date.now(), targetMin, targetSec });
  };

  const giveUp = () => {
    if (!active) return;
    engine.addOp('SESSION_FAILED', {
      sessionId: active.sessionId,
      reason: 'give_up',
      targetMin: active.targetMin,
    });
    setFlash('Session failed: gave up');
    setActive(null);
  };

  const remainingSec = active
    ? Math.max(0, active.targetSec - (now - active.startedAt) / 1000)
    : 0;

  return (
    <View style={st.card}>
      <Text style={st.cardTitle}>Focus session</Text>

      {active ? (
        <View style={st.center}>
          <Text style={st.timer}>{fmtClock(remainingSec)}</Text>
          <Text style={st.sub}>target: {fmtMin(active.targetMin)} min</Text>
          <Pressable style={[st.btn, st.btnDanger]} onPress={giveUp}>
            <Text style={st.btnDangerText}>Give up</Text>
          </Pressable>
          <Text style={st.subSmall}>switching away for more than 5s fails the session</Text>
        </View>
      ) : (
        <View>
          {flash ? <Text style={st.flash}>{flash}</Text> : null}
          <View style={st.row}>
            {PRESETS.map((p) => (
              <Pressable key={p.label} style={st.btn} onPress={() => start(p.targetMin, p.targetSec)}>
                <Text style={st.btnText}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {state.sessions.length > 0 && (
        <View style={st.history}>
          <Text style={st.subSmall}>recent attempts (synced across devices):</Text>
          {state.sessions.map((s) => (
            <Text key={s.sessionId} style={st.historyLine}>
              {s.outcome === 'success' ? 'success' : `failed (${s.outcome})`} · {fmtMin(s.targetMin)} min · device {s.deviceId}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------- feature B: syllabus progress ----------------
function Syllabus({ state }: { state: AppState }) {
  return (
    <View style={st.card}>
      <Text style={st.cardTitle}>Syllabus</Text>
      {state.subjects.map((sub) => {
        const allTasks = sub.chapters.flatMap((c) => c.tasks.filter((t) => !t.deleted));
        const pct = percent(allTasks);
        return (
          <View key={sub.id} style={st.subject}>
            <View style={st.rowBetween}>
              <Text style={st.subjectName}>{sub.name}</Text>
              <Text style={st.pct}>{pct}%</Text>
            </View>
            <Bar pct={pct} />
            {sub.chapters.map((ch) => {
              const tasks = ch.tasks.filter((t) => !t.deleted);
              const cpct = percent(tasks);
              return (
                <View key={ch.id} style={st.chapter}>
                  <View style={st.rowBetween}>
                    <Text style={st.chapterName}>{ch.name}</Text>
                    <Text style={st.pctSmall}>{cpct}%</Text>
                  </View>
                  <Bar pct={cpct} small />
                  {tasks.map((t) => (
                    <TaskRow key={t.id} task={t} />
                  ))}
                  {tasks.length === 0 && <Text style={st.subSmall}>all tasks deleted</Text>}
                </View>
              );
            })}
          </View>
        );
      })}
      <Text style={st.subSmall}>tap a task to change its status · ✕ deletes it</Text>
    </View>
  );
}

function percent(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100);
}

function Bar({ pct, small }: { pct: number; small?: boolean }) {
  const width = `${pct}%` as DimensionValue;
  return (
    <View style={[st.barTrack, small && st.barTrackSmall]}>
      <View style={[st.barFill, { width }]} />
    </View>
  );
}

function TaskRow({ task }: { task: Task }) {
  return (
    <View style={st.taskRow}>
      <Pressable
        style={st.taskMain}
        onPress={() =>
          engine.addOp('TASK_STATUS_SET', { taskId: task.id, status: NEXT_STATUS[task.status] })
        }
      >
        <Text style={st.taskName}>{task.name}</Text>
        <Text style={[st.badge, badgeStyle(task.status)]}>{STATUS_LABEL[task.status]}</Text>
      </Pressable>
      <Pressable style={st.del} onPress={() => engine.addOp('TASK_DELETED', { taskId: task.id })}>
        <Text style={st.delText}>✕</Text>
      </Pressable>
    </View>
  );
}

function badgeStyle(s: TaskStatus) {
  if (s === 'done') return st.badgeDone;
  if (s === 'in_progress') return st.badgeProgress;
  return st.badgeNot;
}

// ---------------- dev panel ----------------
function resetDevice() {
  // wipe this device's local data and reload - handy while demoing
  try {
    webStorage?.removeItem(`alcovia:${DEVICE_ID}:engine`);
    webStorage?.removeItem(ACTIVE_KEY);
    webLocation?.reload?.();
  } catch {}
}

function DevPanel({ state }: { state: AppState }) {
  return (
    <View style={[st.card, st.devCard]}>
      <Text style={[st.cardTitle, st.devTitle]}>Dev panel</Text>
      <View style={st.rowBetween}>
        <View style={st.row}>
          <Switch value={engine.online} onValueChange={(v) => engine.setOnline(v)} />
          <Text style={[st.devText, st.devStatus]}>{engine.online ? 'ONLINE' : 'OFFLINE'}</Text>
        </View>
        <View style={st.row}>
          <Pressable style={st.btn} onPress={() => engine.sync()}>
            <Text style={st.btnText}>Sync now</Text>
          </Pressable>
          <Pressable style={[st.btn, st.btnGhost]} onPress={resetDevice}>
            <Text style={st.btnText}>Reset device</Text>
          </Pressable>
        </View>
      </View>
      <Text style={st.devText}>
        device: {DEVICE_ID} · cursor: {engine.cursor} · pending ops: {engine.pending.length}
      </Text>
      {state.notes.map((n, i) => (
        <Text key={i} style={st.note}>
          conflict: {n}
        </Text>
      ))}
      <View style={st.logBox}>
        {engine.log.length === 0 ? (
          <Text style={st.logLine}>logs will appear here…</Text>
        ) : (
          engine.log.map((l, i) => (
            <Text key={i} style={st.logLine}>
              {l}
            </Text>
          ))
        )}
      </View>
      <Text style={st.subSmall}>server register: http://localhost:4000/register</Text>
    </View>
  );
}

// ---------------- helpers + styles ----------------
function fmtMin(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}
function fmtClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const st = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#eef2f7' },
  content: { padding: 16, paddingBottom: 48, maxWidth: 560, width: '100%', alignSelf: 'center' },
  header: { marginBottom: 12 },
  deviceBadge: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1d4ed8',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  hint: { fontSize: 12, color: '#64748b', flexShrink: 1, textAlign: 'right' },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 10 },
  statLabel: { fontSize: 12, color: '#64748b' },
  statValue: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginTop: 2 },

  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 10 },

  center: { alignItems: 'center' },
  timer: { fontSize: 48, fontWeight: '700', color: '#0f172a', fontVariant: ['tabular-nums'] },
  sub: { fontSize: 13, color: '#475569', marginTop: 2, marginBottom: 10 },
  subSmall: { fontSize: 11, color: '#94a3b8', marginTop: 8 },
  flash: { fontSize: 13, color: '#1d4ed8', marginBottom: 8, fontWeight: '600' },

  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  btn: {
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnGhost: { backgroundColor: '#475569' },
  btnDanger: { backgroundColor: '#fee2e2', marginTop: 4 },
  btnDangerText: { color: '#b91c1c', fontSize: 13, fontWeight: '700' },

  history: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 8 },
  historyLine: { fontSize: 12, color: '#475569', marginTop: 2 },

  subject: { marginBottom: 14 },
  subjectName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  chapter: { marginTop: 10, paddingLeft: 8 },
  chapterName: { fontSize: 13, fontWeight: '600', color: '#334155' },
  pct: { fontSize: 13, fontWeight: '700', color: '#1d4ed8' },
  pctSmall: { fontSize: 12, fontWeight: '600', color: '#64748b' },

  barTrack: { height: 8, backgroundColor: '#e2e8f0', borderRadius: 99, marginVertical: 6 },
  barTrackSmall: { height: 5 },
  barFill: { height: '100%', backgroundColor: '#22c55e', borderRadius: 99 },

  taskRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  taskMain: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  taskName: { fontSize: 13, color: '#0f172a', flexShrink: 1 },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, overflow: 'hidden' },
  badgeDone: { backgroundColor: '#dcfce7', color: '#15803d' },
  badgeProgress: { backgroundColor: '#fef9c3', color: '#a16207' },
  badgeNot: { backgroundColor: '#e2e8f0', color: '#475569' },
  del: { marginLeft: 8, padding: 6 },
  delText: { color: '#94a3b8', fontSize: 14 },

  devCard: { backgroundColor: '#0f172a' },
  devTitle: { color: '#e2e8f0' },
  devText: { color: '#cbd5e1', fontSize: 12, marginTop: 8 },
  devStatus: { marginLeft: 8, fontWeight: '700' },
  note: { color: '#fbbf24', fontSize: 12, marginTop: 6 },
  logBox: { backgroundColor: '#1e293b', borderRadius: 8, padding: 8, marginTop: 8 },
  logLine: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' },
});
