// Local callable-handler smoke. Never loads Admin until the emulator guard passes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const project = process.env.GCLOUD_PROJECT;
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^demo-[a-z0-9-]+$/.test(project ?? '') ||
    !/^(127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/.test(emulator ?? '') ||
    Number(emulator.split(':')[1]) > 65535) {
  throw Error('Refusing: require demo-* GCLOUD_PROJECT and loopback FIRESTORE_EMULATOR_HOST before Admin loads');
}
for (const name of ['GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID']) {
  if (process.env[name] && process.env[name] !== project) throw Error(`Conflicting ${name}`);
}
// Override any inherited Firebase project configuration; no credential file is read.
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: project });
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
const root = process.env.DUEL_FLIP_HOST_ROOT
  ? resolve(process.env.DUEL_FLIP_HOST_ROOT)
  : resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(resolve(root, 'package.json'));
const { db } = require(resolve(root, 'lib/admin.js'));
const { rivalBattleHost } = require(resolve(root, 'lib/rival/rivalBattleHost.js'));
const { resolveDuel } = require(resolve(root, 'lib/lib/duelResolver.js'));
const { RIVAL_MIN_WIN_MS } = require(resolve(root, 'lib/lib/rivalLadder.js'));
const original = Object.fromEntries(['HOLOCITY_RIVAL_ISSUE_RESOLVER', 'HOLOCITY_RIVAL_ALLOW_LEGACY_DIDWIN'].map(k => [k, process.env[k]]));
const pilots = [];
const call = (uid, data) => rivalBattleHost.run({ auth: { uid }, data: { schemaVersion: 'rival-battle-3', ...data } });
const battle = (uid, id) => db.doc(`rivalBattles/${uid}/battles/${id}`);
async function pilot() {
  const uid = `flip_smoke_${randomUUID()}`;
  pilots.push(uid);
  await db.doc(`users/${uid}`).set({ holobots: [{ name: 'ACE', level: 99, experience: 0, nextLevelExp: 400, attributePoints: 0 }],
    holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 },
    travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
  return uid;
}
async function agedIssue(uid) {
  const issued = await call(uid, { operation: 'issue' });
  // Emulator fixture only: exercise the real callable without a 20-second wait.
  await battle(uid, issued.battleId).update({ issuedAtMs: Date.now() - RIVAL_MIN_WIN_MS - 1000 });
  return issued;
}
const profile = async uid => (await db.doc(`users/${uid}`).get()).data();
test.after(async () => {
  try {
    for (const uid of pilots) {
      await db.recursiveDelete(db.doc(`rivalBattles/${uid}`));
      await db.recursiveDelete(db.doc(`users/${uid}`));
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await db.terminate();
  }
});
test('unset, 0 and true issue legacy; legacy remains settleable after flip', async () => {
  delete process.env.HOLOCITY_RIVAL_ALLOW_LEGACY_DIDWIN;
  for (const flag of [undefined, '0', 'true']) {
    if (flag === undefined) delete process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER;
    else process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER = flag;
    const uid = await pilot(), issued = await agedIssue(uid);
    assert.equal(issued.duel.mode, 'legacy');
    process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER = '1';
    const settled = await call(uid, { operation: 'settle', battleId: issued.battleId, didWin: true });
    assert.equal(settled.duelReceipt, undefined);
    assert.equal(settled.holosGranted, 100);
  }
});
test('explicit 1 settles from receipt; forged damage/didWin ignored; replay pays once', async () => {
  process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER = '1';
  const uid = await pilot(), issued = await agedIssue(uid);
  assert.equal(issued.duel.mode, 'resolver');
  const stored = (await battle(uid, issued.battleId).get()).data();
  const expected = resolveDuel({ ...stored.duel.input, playerIntents: ['strike'] });
  const settled = await call(uid, { operation: 'settle', battleId: issued.battleId, playerIntents: ['strike'],
    didWin: expected.winner !== 'player', damage: 999999999, seed: -1 });
  assert.deepEqual(settled.duelReceipt, expected);
  assert.equal(settled.didWin, expected.winner === 'player');
  assert.equal(settled.holosGranted, expected.winner === 'player' ? 100 : 25);
  const before = await profile(uid);
  const replay = await call(uid, { operation: 'settle', battleId: issued.battleId });
  assert.equal(replay.alreadyProcessed, true);
  assert.deepEqual(replay.duelReceipt, expected);
  assert.deepEqual(await profile(uid), before);
});
test('rollback keeps open resolver pinned and receipt replayable; new issue is legacy', async () => {
  process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER = '1';
  const uid = await pilot(), issued = await agedIssue(uid);
  assert.equal(issued.duel.mode, 'resolver');
  delete process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER;
  await assert.rejects(() => call(uid, { operation: 'settle', battleId: issued.battleId, didWin: true }),
    e => e.details?.rejectionCode === 'invalid_request');
  const settled = await call(uid, { operation: 'settle', battleId: issued.battleId, playerIntents: ['strike'] });
  assert.equal(settled.duelReceipt.schemaVersion, 'duel-receipt-1');
  const before = await profile(uid);
  const replay = await call(uid, { operation: 'settle', battleId: issued.battleId });
  assert.equal(replay.alreadyProcessed, true);
  assert.deepEqual(replay.duelReceipt, settled.duelReceipt);
  assert.deepEqual(await profile(uid), before);
  const fresh = await pilot();
  assert.equal((await call(fresh, { operation: 'issue' })).duel.mode, 'legacy');
});
