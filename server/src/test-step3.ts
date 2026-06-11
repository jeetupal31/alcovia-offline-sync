// Step 3 verification - no UI, no n8n needed.
// 1) Start the server with the webhook pointed at its own mock sink:
//      PowerShell:  $env:N8N_WEBHOOK_URL="http://localhost:4000/mock-whatsapp"; npm run dev
//      bash:        N8N_WEBHOOK_URL=http://localhost:4000/mock-whatsapp npm run dev
// 2) In a second terminal:  npm run test:step3

import { fmtDate } from './rewards';

const SERVER = 'http://localhost:4000';

async function sync(deviceId: string, ops: any[]) {
  const res = await fetch(`${SERVER}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, cursor: 0, ops }),
  });
  return res.json();
}
const get = async (path: string) => (await fetch(`${SERVER}${path}`)).json();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const today = fmtDate(new Date());
  const S1 = 'session-test-1';

  console.log('\n=== SCENE 1: device A completes a 25-min session, syncs it ===');
  const op1 = {
    opId: 'op-test-1',
    deviceId: 'A',
    type: 'SESSION_COMPLETED',
    payload: { sessionId: S1, targetMin: 25, localDate: today },
  };
  let r = await sync('A', [op1]);
  console.log(`--> accepted=${r.accepted} duplicates=${r.duplicates}`);

  console.log('\n=== SCENE 2: network retry - WAHI parchi dobara bheji ===');
  r = await sync('A', [op1]);
  console.log(`--> accepted=${r.accepted} duplicates=${r.duplicates} (register ne phenk di)`);

  console.log('\n=== SCENE 3: same session, ALAG parchi (device B se replay) ===');
  const op2 = {
    opId: 'op-test-2',
    deviceId: 'B',
    type: 'SESSION_COMPLETED',
    payload: { sessionId: S1, targetMin: 25, localDate: today },
  };
  r = await sync('B', [op2]);
  console.log(`--> accepted=${r.accepted} (parchi store hui, par reward duplicate NAHI hua)`);

  console.log('\n... outbox dispatcher ko 3 second dete hain ...');
  await sleep(3000);

  const state = await get('/state');
  const notifications = await get('/notifications');

  console.log('\n=== RESULT ===');
  console.log(`totalCoins              = ${state.totalCoins}   (expected: 50)`);
  console.log(`streak                  = ${state.streak}    (expected: 1)`);
  console.log(`notifications delivered = ${notifications.length}    (expected: 1)`);
  if (notifications[0]) console.log(`message: "${notifications[0].message}"`);

  const pass = state.totalCoins === 50 && state.streak === 1 && notifications.length === 1;
  console.log(
    pass
      ? '\nPASS - reward exactly once, notification exactly once.'
      : '\nFAIL - output upar dekho, kuch gadbad hai.'
  );
}

main().catch((e) =>
  console.error('\nERROR: kya server chal raha hai? Pehle "npm run dev" chalao.\n', e.message)
);
