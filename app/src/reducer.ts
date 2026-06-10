import type { Op } from './types';

// ---------- state shapes ----------
export type TaskStatus = 'not_started' | 'in_progress' | 'done';
export type Task = { id: string; name: string; status: TaskStatus; deleted: boolean };
export type Chapter = { id: string; name: string; tasks: Task[] };
export type Subject = { id: string; name: string; chapters: Chapter[] };
export type SessionRecord = {
  sessionId: string;
  outcome: 'success' | 'give_up' | 'app_switch';
  targetMin: number;
  localDate?: string;
  deviceId: string;
};

export type AppState = {
  subjects: Subject[];
  coins: number;
  streak: number;
  todayMinutes: number;
  sessions: SessionRecord[]; // newest first, last few only
  notes: string[];           // conflict notes (e.g. edit ignored on a deleted task)
};

// Hardcoded seed data - the assignment allows this (no login, one studentId).
export const SEED: Subject[] = [
  {
    id: 'maths',
    name: 'Maths',
    chapters: [
      {
        id: 'm1',
        name: 'Chapter 1 - Algebra',
        tasks: [
          { id: 't1', name: 'Algebra basics', status: 'not_started', deleted: false },
          { id: 't2', name: 'Linear equations', status: 'not_started', deleted: false },
          { id: 't3', name: 'Word problems', status: 'not_started', deleted: false },
        ],
      },
      {
        id: 'm2',
        name: 'Chapter 2 - Geometry',
        tasks: [
          { id: 't4', name: 'Triangles', status: 'not_started', deleted: false },
          { id: 't5', name: 'Circles', status: 'not_started', deleted: false },
        ],
      },
    ],
  },
  {
    id: 'sci',
    name: 'Science',
    chapters: [
      {
        id: 's1',
        name: 'Chapter 1 - Motion',
        tasks: [
          { id: 't6', name: 'Speed and velocity', status: 'not_started', deleted: false },
          { id: 't7', name: 'Acceleration', status: 'not_started', deleted: false },
          { id: 't8', name: 'Graphs of motion', status: 'not_started', deleted: false },
        ],
      },
    ],
  },
];

export function todayStr(): string {
  return fmtDate(new Date());
}
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

// ---------- THE core idea of the whole assignment ----------
// fold(ops): replay the op log from the start and build the screen state.
// It is a PURE function: same ops in the same order => same state, always.
// Both devices fold the same server-ordered log => both screens identical.
export function fold(ops: Op[]): AppState {
  // fresh copy of the seed every time (fold must not mutate shared data)
  const subjects: Subject[] = JSON.parse(JSON.stringify(SEED));
  const taskById = new Map<string, Task>();
  for (const s of subjects) for (const c of s.chapters) for (const t of c.tasks) taskById.set(t.id, t);

  let coins = 0;
  let todayMinutes = 0;
  const today = todayStr();
  const successDates = new Set<string>();
  const counted = new Set<string>(); // sessionIds already counted -> idempotent rewards
  const sessions: SessionRecord[] = [];
  const notes: string[] = [];

  for (const op of ops) {
    if (op.type === 'TASK_STATUS_SET') {
      const t = taskById.get(op.payload.taskId);
      if (!t) continue;
      if (t.deleted) {
        // conflict rule: delete wins. A late edit to a deleted task is ignored.
        notes.push(`edit to "${t.name}" ignored - task was deleted`);
        continue;
      }
      t.status = op.payload.status as TaskStatus;
    } else if (op.type === 'TASK_DELETED') {
      const t = taskById.get(op.payload.taskId);
      if (t) t.deleted = true; // tombstone: stays in data, hidden from UI
    } else if (op.type === 'SESSION_COMPLETED') {
      const { sessionId, targetMin, localDate } = op.payload;
      if (counted.has(sessionId)) continue; // count each session exactly once
      counted.add(sessionId);
      coins += rewardFor(targetMin);
      if (localDate) successDates.add(localDate);
      if (localDate === today) todayMinutes += targetMin;
      sessions.unshift({ sessionId, outcome: 'success', targetMin, localDate, deviceId: op.deviceId });
    } else if (op.type === 'SESSION_FAILED') {
      const { sessionId, targetMin, reason } = op.payload;
      if (counted.has(sessionId)) continue;
      counted.add(sessionId);
      sessions.unshift({
        sessionId,
        outcome: reason === 'app_switch' ? 'app_switch' : 'give_up',
        targetMin: targetMin ?? 0,
        deviceId: op.deviceId,
      });
    }
  }

  // streak = consecutive days (ending at the most recent success day)
  // that have at least one successful session
  let streak = 0;
  if (successDates.size > 0) {
    const sorted = [...successDates].sort();
    const d = new Date(`${sorted[sorted.length - 1]}T00:00:00`);
    while (successDates.has(fmtDate(d))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
  }

  return {
    subjects,
    coins,
    streak,
    todayMinutes,
    sessions: sessions.slice(0, 6),
    notes: notes.slice(-4),
  };
}

export function rewardFor(targetMin: number): number {
  // simple rule: 2 coins per target minute, minimum 1 (noted in README)
  return Math.max(1, Math.round(targetMin * 2));
}
