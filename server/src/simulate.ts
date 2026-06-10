// Two FAKE devices, no UI. Watch the entire sync story in your terminal.
// 1) Start the server first:  npm run dev
// 2) In a second terminal:    npm run simulate

import type { Op, SyncResponse } from './types';

const SERVER = 'http://localhost:4000';

// This class is a miniature of what the real app will do.
// The real Expo app will have the SAME three pieces:
//   pending (offline queue) + confirmed (server-acknowledged) + sync()
class FakeDevice {
  cursor = 0;            // last serverSeq this device has seen
  confirmed: Op[] = [];  // ops confirmed by the server, in serverSeq order
  pending: Op[] = [];    // ops created offline, waiting to be synced

  constructor(public deviceId: string) {}

  // The user changes a task's status (works offline - just queues an op).
  setTaskStatus(taskId: string, status: string) {
    this.pending.push({
      opId: crypto.randomUUID(),
      deviceId: this.deviceId,
      type: 'TASK_STATUS_SET',
      payload: { taskId, status },
    });
  }

  // What the screen would show RIGHT NOW:
  // replay confirmed ops first, then pending ops on top (optimistic preview).
  state() {
    const tasks: Record<string, string> = {};
    for (const op of [...this.confirmed, ...this.pending]) {
      if (op.type === 'TASK_STATUS_SET')
        tasks[op.payload.taskId] = op.payload.status;
      if (op.type === 'TASK_DELETED') delete tasks[op.payload.taskId];
    }
    return tasks;
  }

  // Push my pending ops, pull everything I haven't seen.
  async sync(): Promise<SyncResponse> {
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

    this.confirmed.push(...data.ops);
    this.cursor = data.newCursor;

    // Any pending op that is now confirmed can leave the pending queue.
    const confirmedIds = new Set(this.confirmed.map((o) => o.opId));
    this.pending = this.pending.filter((o) => !confirmedIds.has(o.opId));

    return data;
  }
}

const show = (label: string, d: FakeDevice) =>
  console.log(
    `${label} ka screen: ${JSON.stringify(d.state())}   (pending parchis: ${d.pending.length})`
  );

async function main() {
  const A = new FakeDevice('A');
  const B = new FakeDevice('B');

  console.log('\n=== SCENE 1: dono devices OFFLINE, alag-alag edits ===');
  A.setTaskStatus('task2', 'done');        // phone par: task2 -> Done
  B.setTaskStatus('task2', 'in_progress'); // laptop par: WAHI task2 -> In progress (CONFLICT!)
  B.setTaskStatus('task3', 'done');        // laptop par: task3 -> Done
  show('Device A', A);
  show('Device B', B);
  console.log('--> alag-alag dikh rahe hain. Offline mein yahi expected hai.');

  console.log('\n=== SCENE 2: net wapas aaya, sab sync karte hain ===');
  await A.sync(); // A apni parchi bhejta hai
  await B.sync(); // B apni bhejta hai, aur A ki parchi bhi mil jaati hai
  await A.sync(); // A ko B ki parchiyaan mil jaati hain
  show('Device A', A);
  show('Device B', B);
  const same = JSON.stringify(A.state()) === JSON.stringify(B.state());
  console.log(`--> DONO SAME? ${same ? 'YES - converge ho gaye.' : 'NO - bug hai!'}`);
  console.log('--> task2 ka winner: jo parchi register mein BAAD mein pahunchi (B wali).');

  console.log('\n=== SCENE 3: network retry - wahi purani parchi DOBARA bheji ===');
  const oldOp = A.confirmed.find((o) => o.deviceId === 'A')!;
  const res = await fetch(`${SERVER}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'A', cursor: A.cursor, ops: [oldOp] }),
  });
  const data = (await res.json()) as SyncResponse;
  console.log(`--> server bola: accepted=${data.accepted}, duplicates=${data.duplicates}`);
  console.log('--> register mein kuch bhi double nahi hua. YAHI idempotency hai.');

  console.log('\n=== SCENE 4: out-of-order / double sync message ===');
  const r1 = await A.sync();
  const r2 = await A.sync(); // turant dobara sync - kuch naya nahi tha
  console.log(`--> do back-to-back syncs: accepted=${r1.accepted + r2.accepted} naya kuch nahi juda.`);
  show('Device A', A);
  show('Device B', B);
  console.log('\nDONE. Browser mein http://localhost:4000/register kholo - poora register dikhega.\n');
}

main().catch((e) => {
  console.error('\nERROR: kya server chal raha hai? Pehle "npm run dev" chalao.\n', e.message);
});
