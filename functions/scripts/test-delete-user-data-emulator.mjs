// Account deletion removes every uid-keyed Firestore tree (cloud review 2026-10-01 #2).
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Loopback demo emulator required; production forbidden');
const { db } = require('../lib/admin.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');

test('deleteUserData removes pilot trees including Arena leases, matches and receipts; other pilots untouched', async () => {
  const uid = `del_${Date.now()}`, other = `${uid}_other`;
  for (const u of [uid, other]) {
    await db.doc(`users/${u}`).set({ holobots: [], buddyUnits: 0 });
    await db.doc(`users/${u}/fitness_daily/2026-10-01`).set({ steps: 1 });
    await db.doc(`wildEncounterSessions/${u}`).set({ enabled: true });
    await db.doc(`wildEncounterSessions/${u}/receipts/r1`).set({ digest: 'x' });
    await transactRivalBattle(db, u, { operation: 'issue' }, Date.now(), () => 0, {issueLegacy:true}); // Historical empty-squad deletion fixture.
    await transactHoloZoneRun(db, u, { operation: 'issue', zoneId: 'neonforest' });
    await db.doc(`arenaMatches/${u}`).set({ schemaVersion: 'arena-healing-1', recordSchemaVersion: 'arena-match-1', matchId: 'am_delete_fixture', open: true });
    await db.doc(`arenaMatches/${u}/matches/am_delete_fixture`).set({ matchId: 'am_delete_fixture', ownerUid: u, entryReceipt: { amount: 50 }, settlementReceipt: { outcome: 'win' } });
    await db.doc(`arenaMatches/${u}/requests/entry_1`).set({ identity: 'delete_fixture', matchId: 'am_delete_fixture' });
    await db.doc(`arenaBrackets/${u}`).set({schemaVersion:'arena-bracket-1'});
    await db.doc(`arenaBrackets/${u}/brackets/am_delete_fixture`).set({round:2,playerAlive:true});
    await db.doc(`arenaBrackets/${u}/brackets/am_delete_fixture/receipts/round_1`).set({winnerId:'player'});
  }
  assert.equal((await db.doc(`holoZoneRuns/${uid}`).get()).exists, true, 'HoloZone runs doc exists');
  assert.equal((await db.collection(`rivalBattles/${uid}/battles`).get()).size, 1);
  assert.equal((await db.doc(`rivalBattles/${uid}`).get()).exists, true, 'open-battle ledger exists');
  await deleteUserData(db, uid);
  for (const path of [`users/${uid}`, `users/${uid}/fitness_daily/2026-10-01`, `wildEncounterSessions/${uid}`, `wildEncounterSessions/${uid}/receipts/r1`, `rivalBattles/${uid}`, `holoZoneRuns/${uid}`, `arenaMatches/${uid}`, `arenaMatches/${uid}/matches/am_delete_fixture`, `arenaMatches/${uid}/requests/entry_1`, `arenaBrackets/${uid}`, `arenaBrackets/${uid}/brackets/am_delete_fixture`, `arenaBrackets/${uid}/brackets/am_delete_fixture/receipts/round_1`]) {
    assert.equal((await db.doc(path).get()).exists, false, path);
  }
  assert.equal((await db.collection(`rivalBattles/${uid}/battles`).get()).size, 0);
  assert.equal((await db.doc(`users/${other}`).get()).exists, true);
  assert.equal((await db.doc(`wildEncounterSessions/${other}/receipts/r1`).get()).exists, true);
  assert.equal((await db.collection(`rivalBattles/${other}/battles`).get()).size, 1);
  assert.equal((await db.doc(`holoZoneRuns/${other}`).get()).exists, true);
  assert.equal((await db.doc(`arenaMatches/${other}`).get()).exists, true);
  assert.equal((await db.collection(`arenaMatches/${other}/matches`).get()).size, 1);
  assert.equal((await db.collection(`arenaMatches/${other}/requests`).get()).size, 1);
  assert.equal((await db.doc(`arenaBrackets/${other}`).get()).exists,true);
  assert.equal((await db.doc(`arenaBrackets/${other}/brackets/am_delete_fixture`).get()).exists,true);
  assert.equal((await db.doc(`arenaBrackets/${other}/brackets/am_delete_fixture/receipts/round_1`).get()).exists,true);
});

// Firestore does not cascade subcollections when a parent doc is already absent.
test('deleteUserData removes orphaned Arena receipt and match subcollections', async () => {
  const uid = `del_arena_orphan_${Date.now()}`;
  await db.doc(`arenaMatches/${uid}/matches/am_orphan`).set({ matchId: 'am_orphan' });
  await db.doc(`arenaMatches/${uid}/requests/entry_orphan`).set({ matchId: 'am_orphan' });
  await db.doc(`arenaBrackets/${uid}/brackets/am_orphan`).set({round:1});
  await db.doc(`arenaBrackets/${uid}/brackets/am_orphan/receipts/round_1`).set({winnerId:'player'});
  assert.equal((await db.doc(`arenaMatches/${uid}`).get()).exists, false);
  await deleteUserData(db, uid);
  assert.equal((await db.collection(`arenaMatches/${uid}/matches`).get()).size, 0);
  assert.equal((await db.collection(`arenaMatches/${uid}/requests`).get()).size, 0);
  assert.equal((await db.collection(`arenaBrackets/${uid}/brackets`).get()).size,0);
  assert.equal((await db.collection(`arenaBrackets/${uid}/brackets/am_orphan/receipts`).get()).size,0);
});

after(()=>db.terminate());
