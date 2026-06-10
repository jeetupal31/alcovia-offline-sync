import type { Op, OpType, SyncResponse } from './types';
import { makeUUID, webStorage } from './web';

const SERVER = 'http://localhost:4000';

// The same three pieces as server/src/simulate.ts, now powering the real UI:
//   pending   - ops created locally (possibly offline), not yet acknowledged
//   confirmed - ops the server has ordered, in serverSeq order
//   sync()    - push pending, pull everything newer than our cursor
//
// The screen is always rendered from fold([...confirmed, ...pending]),
// so every action shows up instantly, with or without network.
export class SyncEngine {
  deviceId: string;
  cursor = 0;            // highest serverSeq we have seen
  confirmed: Op[] = [];
  pending: Op[] = [];
  online = false;        // the dev-panel toggle gates ALL network calls
  syncing = false;
  log: string[] = [];
  version = 0;           // bumps on every change; UI re-renders off this

  private listeners = new Set<() => void>();
  private storageKey: string;

  constructor(deviceId: string) {
    this.deviceId = deviceId;
    this.storageKey = `alcovia:${deviceId}:engine`;
    this.load();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  private notify() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  private load() {
    try {
      const raw = webStorage?.getItem(this.storageKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.cursor = d.cursor ?? 0;
      this.confirmed = d.confirmed ?? [];
      this.pending = d.pending ?? [];
    } catch {}
  }

  // Every change is written to storage immediately -> survives refresh/crash.
  private persist() {
    try {
      webStorage?.setItem(
        this.storageKey,
        JSON.stringify({
          cursor: this.cursor,
          confirmed: this.confirmed,
          pending: this.pending,
        })
      );
    } catch {}
  }

  private addLog(msg: string) {
    this.log = [`${new Date().toLocaleTimeString()}  ${msg}`, ...this.log].slice(0, 8);
  }

  getOps(): Op[] {
    return [...this.confirmed, ...this.pending];
  }

  // The ONLY way the app changes data: append an op. Works fully offline.
  addOp(type: OpType, payload: Record<string, any>) {
    const op: Op = { opId: makeUUID(), deviceId: this.deviceId, type, payload };
    this.pending.push(op);
    this.persist();
    this.addLog(`queued ${type}`);
    this.notify();
    if (this.online) this.sync();
  }

  setOnline(v: boolean) {
    this.online = v;
    this.addLog(v ? 'went ONLINE' : 'went OFFLINE');
    this.notify();
    if (v) this.sync();
  }

  async sync() {
    if (!this.online || this.syncing) return;
    this.syncing = true;
    try {
      const res = await fetch(`${SERVER}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.deviceId,
          cursor: this.cursor,
          ops: this.pending,
        }),
      });
      const data = (await res.json()) as SyncResponse;
      if (data.ops.length) this.confirmed.push(...data.ops);
      this.cursor = data.newCursor;

      // anything now confirmed can leave the pending queue
      const ids = new Set(this.confirmed.map((o) => o.opId));
      this.pending = this.pending.filter((o) => !ids.has(o.opId));

      this.persist();
      this.addLog(`sync: sent=${data.accepted} dup=${data.duplicates} got=${data.ops.length}`);
    } catch (e: any) {
      this.addLog(`sync failed: ${e?.message ?? 'network error'}`);
    } finally {
      this.syncing = false;
      this.notify();
    }
  }
}
