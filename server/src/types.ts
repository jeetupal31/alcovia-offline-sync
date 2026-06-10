// One "Op" = one action the user performed. (The "parchi".)
// It is immutable: once created, it never changes. Devices and the server
// only ever exchange these objects.

export type OpType =
  | 'TASK_STATUS_SET'   // payload: { taskId, status }
  | 'TASK_DELETED'      // payload: { taskId }
  | 'SESSION_COMPLETED' // payload: { sessionId, targetMin, localDate }
  | 'SESSION_FAILED';   // payload: { sessionId, reason }

export type Op = {
  opId: string;       // unique id of this op (UUID) -> used for de-duplication
  deviceId: string;   // which device created it: 'A' or 'B'
  type: OpType;
  payload: Record<string, any>;
  serverSeq?: number; // assigned by the server: position in the master register
};

// What a device sends to POST /sync
export type SyncRequest = {
  deviceId: string;
  cursor: number; // highest serverSeq this device has already seen
  ops: Op[];      // its pending (not yet confirmed) ops
};

// What the server answers with
export type SyncResponse = {
  accepted: number;   // how many ops were new and stored
  duplicates: number; // how many were replays and ignored
  newCursor: number;  // device should remember this for next time
  ops: Op[];          // every op in the register newer than the device's cursor
};
