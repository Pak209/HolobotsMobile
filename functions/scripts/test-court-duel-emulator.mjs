// Guild Court plan-and-send through the real store and callable (Firestore emulator).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-court-duel';
const { db } = require('../lib/admin.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const { holoZoneHost } = require('../lib/holozone/holoZoneHost.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const D = require('../lib/lib/duelResolver.js');
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0), LATE = T0 + Z.HOLOZONE_MIN_XP_MS, V = 'holozone-run-2', FAIR = ['strike', 'strike', 'heavy', 'defend'];
let serial = 0, runSerial = 0;
const bot = name => ({ name, level: 1, experience: 0, nextLevelExp: 400, attributePoints: 0 });
const setup = async (fields = {}) => { const uid = `court_${Date.now()}_${serial++}`; await db.doc(`users/${uid}`).set({ holosTokens: 0, holobots: [bot('ACE'), bot('KUMA')], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace', 'kuma'] }, ...fields }); return uid; };
const newRun = () => `${String(++runSerial).padStart(8, '0')}-1111-4111-8111-111111111111`;
const call = (uid, data, now = T0) => transactHoloZoneRun(db, uid, { schemaVersion: V, ...data }, now, newRun);
const issue = (uid, now) => call(uid, { operation: 'issue', zoneId: 'guild_court', duelSchema: 'duel-receipt-1', holobotId: 'ace' }, now);
const send = (uid, runId, playerIntents, now = LATE) => call(uid, { operation: 'settle', runId, playerIntents }, now);
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const ledger = async uid => (await db.doc(`holoZoneRuns/${uid}`).get()).data();
const receiptDoc = (uid, runId) => db.doc(`holoZoneRuns/${uid}/receipts/${runId}`);

test('issue serves the pinned fight and hides the seed; settle pays through the run contract and stores the receipt in the subcollection', async () => {
  const uid = await setup();
  const i = await issue(uid);
  assert.equal(i.duel.mode, 'resolver'); assert.equal(i.duel.beastId, 'cacheback'); assert.equal(i.duel.opponent[0].maxHealth, 285);
  assert.equal(JSON.stringify(i).includes('"seed"'), false); assert.ok(i.playerCombatants.length >= 1);
  const stored = (await ledger(uid)).runs[0];
  assert.deepEqual((await call(uid, { operation: 'status' })).duel, i.duel);
  const expected = D.resolveDuel({ ...stored.duel.input, playerIntents: FAIR });
  const s = await send(uid, i.runId, FAIR);
  assert.deepEqual(s.duelReceipt, expected); assert.equal(s.alreadyProcessed, false);
  const won = expected.winner === 'player';
  assert.equal(s.settlement.didWin, won); assert.equal(s.settlement.kills, won ? 1 : 0); assert.deepEqual(s.settlement.fielded, ['ace']); assert.equal(s.settlement.expWithheld, false);
  assert.equal(s.holosGranted, won ? 100 : 25); assert.equal(s.blueprintFragmentsGranted, won ? 1 : 0);
  const p = await user(uid);
  assert.equal(p.holosTokens, s.holosGranted); assert.equal(p.holobotVitals.ace.currentHealth, expected.playerFinal[0].currentHealth);
  assert.deepEqual((await receiptDoc(uid, i.runId).get()).data().duelReceipt, expected);
  assert.equal((await ledger(uid)).runs[0].duelReceipt, undefined, 'the bounded run doc never carries the receipt');
});

test('the beast is pinned at issue: a level gained before the settle does not shift it', async () => {
  const uid = await setup({ holobots: [{ ...bot('ACE'), level: 20 }, bot('KUMA')] });
  const i = await issue(uid), stored = (await ledger(uid)).runs[0];
  assert.equal(i.duel.opponent[0].level, 20); assert.equal(i.duel.opponent[0].maxHealth, 556);
  await db.doc(`users/${uid}`).update({ holobots: [{ ...bot('ACE'), level: 40 }, bot('KUMA')] });
  const s = await send(uid, i.runId, FAIR);
  assert.deepEqual(s.duelReceipt, D.resolveDuel({ ...stored.duel.input, playerIntents: FAIR }));
  assert.equal(s.duelReceipt.opponentFinal[0].maxHealth, 556);
});

test('a replay returns the stored receipt and pays nothing; a parallel burst pays once', async () => {
  const uid = await setup();
  const { runId } = await issue(uid);
  const all = await Promise.allSettled(Array.from({ length: 5 }, () => send(uid, runId, FAIR)));
  const ok = all.filter(x => x.status === 'fulfilled').map(x => x.value);
  assert.ok(ok.length >= 1); assert.equal(ok.filter(x => !x.alreadyProcessed).length, 1, JSON.stringify(all.filter(x => x.status === 'rejected').map(x => String(x.reason))));
  const before = await user(uid);
  const replay = await send(uid, runId, ['defend'], LATE + 5000);
  assert.equal(replay.alreadyProcessed, true); assert.deepEqual(replay.duelReceipt, ok[0].duelReceipt);
  assert.deepEqual(await user(uid), before);
});

test('too_fast through the callable: typed, carries retryAfterMs, writes nothing; a client-reported settle on a pinned run is refused', async () => {
  const uid = await setup();
  const issued = await holoZoneHost.run({ auth: { uid }, data: { schemaVersion: V, operation: 'issue', zoneId: 'guild_court', duelSchema: 'duel-receipt-1', holobotId: 'ace' } });
  const before = await user(uid), runs = await ledger(uid);
  await assert.rejects(() => holoZoneHost.run({ auth: { uid }, data: { schemaVersion: V, operation: 'settle', runId: issued.runId, playerIntents: FAIR } }),
    e => e.code === 'failed-precondition' && e.details.rejectionCode === 'too_fast' && e.details.retryAfterMs > 0 && e.details.retryAfterMs <= Z.HOLOZONE_MIN_XP_MS);
  await assert.rejects(() => holoZoneHost.run({ auth: { uid }, data: { schemaVersion: V, operation: 'settle', runId: issued.runId, kills: 1, bossDefeated: false, fielded: ['ace'] } }), e => e.code === 'invalid-argument');
  assert.deepEqual(await user(uid), before); assert.deepEqual(await ledger(uid), runs);
  assert.equal((await receiptDoc(uid, issued.runId).get()).exists, false);
});

test('without the opt-in the Guild Court run is the deployed client-reported run, and a plan is refused on it', async () => {
  const uid = await setup();
  const i = await call(uid, { operation: 'issue', zoneId: 'guild_court' });
  assert.equal(i.duel, undefined); assert.equal(i.playerCombatants, undefined);
  await assert.rejects(() => send(uid, i.runId, FAIR), /invalid_request/);
  const s = await call(uid, { operation: 'settle', runId: i.runId, kills: 1, bossDefeated: false, fielded: ['ace'] }, LATE);
  assert.equal(s.holosGranted, 100); assert.equal(s.blueprintFragmentsGranted, 1); assert.equal(s.duelReceipt, undefined);
});

test('a Holobot outside the squad and a knocked-out fighter are refused with nothing written', async () => {
  const uid = await setup();
  await assert.rejects(() => call(uid, { operation: 'issue', zoneId: 'guild_court', duelSchema: 'duel-receipt-1', holobotId: 'wolf' }), /invalid_request/);
  assert.equal(await ledger(uid), undefined);
  const ko = await setup({ holobotVitals: { ace: { currentHealth: 0, maxHealth: 150 } } });
  await assert.rejects(() => issue(ko), /holobot_ko/);
});

test('receipts are pruned with the bounded run history and removed with the account', async () => {
  const uid = await setup();
  let at = T0, ids = [];
  for (let n = 0; n < Z.HOLOZONE_MAX_STORED_RUNS; n++) {
    const { runId } = await issue(uid, at); ids.push(runId);
    await send(uid, runId, ['defend'], at + Z.HOLOZONE_MIN_XP_MS);
    await db.doc(`users/${uid}`).update({ holobotVitals: {} });
    at += Z.HOLOZONE_COOLDOWN_MS + Z.HOLOZONE_MIN_XP_MS + 1;
  }
  assert.equal((await receiptDoc(uid, ids[0]).get()).exists, true, 'still present until the issue that drops its run');
  await issue(uid, at);
  assert.equal((await receiptDoc(uid, ids[0]).get()).exists, false);
  assert.equal((await receiptDoc(uid, ids[1]).get()).exists, true, 'only the run that left the history loses its receipt');
  assert.equal((await receiptDoc(uid, ids[ids.length - 1]).get()).exists, true);
  await deleteUserData(db, uid);
  assert.equal((await db.collection(`holoZoneRuns/${uid}/receipts`).get()).size, 0);
});
