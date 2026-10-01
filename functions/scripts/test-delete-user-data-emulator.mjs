// Account deletion removes every uid-keyed Firestore tree (cloud review 2026-10-01 #2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-delete-tests';
const { db } = require('../lib/admin.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');

test('deleteUserData removes users/{uid}, rivalBattles/{uid} and wildEncounterSessions/{uid} with subcollections; other pilots untouched', async () => {
  const uid = `del_${Date.now()}`, other = `${uid}_other`;
  for (const u of [uid, other]) {
    await db.doc(`users/${u}`).set({ holobots: [], buddyUnits: 0 });
    await db.doc(`users/${u}/fitness_daily/2026-10-01`).set({ steps: 1 });
    await db.doc(`wildEncounterSessions/${u}`).set({ enabled: true });
    await db.doc(`wildEncounterSessions/${u}/receipts/r1`).set({ digest: 'x' });
    await transactRivalBattle(db, u, { operation: 'issue' });
  }
  assert.equal((await db.collection(`rivalBattles/${uid}/battles`).get()).size, 1);
  assert.equal((await db.doc(`rivalBattles/${uid}`).get()).exists, true, 'open-battle ledger exists');
  await deleteUserData(db, uid);
  for (const path of [`users/${uid}`, `users/${uid}/fitness_daily/2026-10-01`, `wildEncounterSessions/${uid}`, `wildEncounterSessions/${uid}/receipts/r1`, `rivalBattles/${uid}`]) {
    assert.equal((await db.doc(path).get()).exists, false, path);
  }
  assert.equal((await db.collection(`rivalBattles/${uid}/battles`).get()).size, 0);
  assert.equal((await db.doc(`users/${other}`).get()).exists, true);
  assert.equal((await db.doc(`wildEncounterSessions/${other}/receipts/r1`).get()).exists, true);
  assert.equal((await db.collection(`rivalBattles/${other}/battles`).get()).size, 1);
});
