import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
// acquisition-2 fixtures (DECISIONS #44). The acquisition-0 / acquisition-1 fixtures stay as history.
const fixtureDir = new URL('../../Documentation/QA/2026-10-01-buddy-unit-tiers/fixtures/', import.meta.url);
async function exportReply(name, reply) {
  // Reply DTOs contain no UID, credentials, roll secret or internal session policy. Export actual returned values only.
  const text = JSON.stringify(reply, null, 2) + '\n';
  if (/"(?:uid|token|secret|chanceByAffinity|returnRefusedUnit|rollSeed|affinityGain)"\s*:/.test(text) || text.includes(SEED)) throw new Error('Unexpected internal field in public reply');
  await mkdir(fixtureDir, { recursive: true });
  await writeFile(new URL(name + '.json', fixtureDir), text);
}
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { transactWildEncounter } = require('../lib/acquisition/wildEncounterStore.js');
const { grantBuddyUnitsAdmin } = require('../lib/acquisition/buddyUnitAdmin.js');
const B = require('../lib/lib/buddyUnits.js');
const app = initializeApp({ projectId: 'demo-holobots-wild-tests' }); const db = getFirestore(app);
const SEED = 'ab'.repeat(32);
const inv = (light = 0, medium = 0, heavy = 0) => ({ light, medium, heavy });
const seed = () => ({ enabled: true, rollSeed: SEED, revision: 1, rosterRevision: 1, entries: [], encounters: [{ encounterId: 'hare_001', holobotId: 'hare', affinityTier: 0, affinityMax: 1, captureOpen: true, chanceByAffinity: [.3, .65], ended: false, items: [{ itemId: 'carrot', kind: 'affinity_toy', displayName: 'Toy', modelKey: 'toy', remaining: 1, useAllowed: true, affinityGain: 1 }, { itemId: 'unit', kind: 'buddy_unit', displayName: 'Unit', modelKey: 'unit', remaining: 1, useAllowed: true, affinityGain: 0 }] }] });
const toy = id => ({ operation: 'offerToy', intent: { schemaVersion: 'capture-world-1', requestId: id, encounterId: 'hare_001', itemId: 'carrot' } });
const cap = (id, toyId = 'buddy_heavy', encounterId = 'hare_001') => ({ operation: 'capture', intent: { schemaVersion: 'acquisition-2', requestId: id, encounterId, toyId, observedHealth01: 0 } });
/** First `${prefix}_k` whose seeded roll satisfies `pred`. Light refuses on HIGH at affinity 0 and 1 (chance ≤ .70). */
const rid = (prefix, pred, encounterId = 'hare_001') => { for (let k = 0; ; k++) { const id = `${prefix}_${k}`; if (pred(B.captureRoll01(SEED, encounterId, id))) return id; } };
const LOW = r => r < 0.05, HIGH = r => r >= 0.95;
let serial = 0;
const setup = async (tag, units = inv(5, 5, 5)) => { const uid = `${tag}_${Date.now()}_${serial++}`; await db.doc(`wildEncounterSessions/${uid}`).set(seed()); await db.doc(`users/${uid}`).set({ holobots: [], blueprints: {}, holosTokens: 42, buddyUnits: units }); return uid; };
const readUser = async uid => (await db.doc(`users/${uid}`).get()).data();
const readSession = async uid => (await db.doc(`wildEncounterSessions/${uid}`).get()).data();
const userAndSession = async uid => ({ user: await readUser(uid), session: await readSession(uid) });
const squad = ids => ({ schemaVersion: 'travel-squad-1', revision: 4, holobotIds: ids });
const legacyBot = name => ({ name, level: 17, experience: 51, rank: 'Champion', attributePoints: 23, boostedAttributes: { speed: 2 }, customPreserved: 'yes' });
const twoEncounters = (second = { encounterId: 'wolf_001', holobotId: 'wolf' }) => { const s = seed(); s.encounters.push({ ...structuredClone(s.encounters[0]), ...second }); return s; };

// ---- unchanged acquisition behaviour (toys, receipts, ownership, squad) ----
test('parallel same request spends one Toy and replays one revision', async () => { const uid = await setup('same'); const replies = await Promise.all(Array.from({ length: 12 }, () => transactWildEncounter(db, uid, toy('one')))); for (const r of replies) assert.deepEqual(r, replies[0]); assert.equal(replies[0].revision, 2); const s = await readSession(uid); assert.equal(s.encounters[0].items[0].remaining, 0); assert.equal(s.revision, 2); });
test('parallel distinct requests cannot overspend last Toy', async () => { const uid = await setup('distinct'); const results = await Promise.allSettled([transactWildEncounter(db, uid, toy('one')), transactWildEncounter(db, uid, toy('two'))]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected')[0].reason.code, 'not_allowed'); });
test('another authenticated user cannot address provisioned session by payload UID', async () => { await setup('owner'); await assert.rejects(() => transactWildEncounter(db, 'unprovisioned', { ...toy('one'), uid: 'x' }), /unavailable/); });
test('replayed refusal retains outcome but carries newer Toy odds and revision', async () => {
  const uid = await setup('replay_newer'); const no = rid('refusal', HIGH);
  const first = await transactWildEncounter(db, uid, cap(no, 'buddy_light')); assert.equal(first.captureResult.outcome, 'refused');
  const newer = await transactWildEncounter(db, uid, toy('toy_after'));
  const replay = await transactWildEncounter(db, uid, cap(no, 'buddy_light'));
  assert.deepEqual(replay.captureResult, first.captureResult); assert.equal(replay.revision, newer.revision);
  assert.equal(replay.worldStates[0].captureChance01, .7); assert.equal(replay.worldStates[0].items[0].remaining, 0);
  assert.deepEqual(replay.buddyUnits, inv(4, 5, 5)); assert.deepEqual((await readUser(uid)).buddyUnits, inv(4, 5, 5));
});
test('replayed Toy correlates current state without spending or restoring expired encounters', async () => {
  const uid = await setup('replay_toy'); await transactWildEncounter(db, uid, toy('toy_once'));
  const refused = await transactWildEncounter(db, uid, cap(rid('refused', HIGH), 'buddy_light'));
  const replay = await transactWildEncounter(db, uid, toy('toy_once'));
  assert.equal(replay.revision, refused.revision); assert.equal(replay.worldStates[0].requestId, 'toy_once'); assert.equal(replay.worldStates[0].reaction, 'toy_accepted');
  const success = await transactWildEncounter(db, uid, cap('success'));
  const endedReplay = await transactWildEncounter(db, uid, toy('toy_once'));
  assert.equal(endedReplay.revision, success.revision); assert.equal(endedReplay.encounters.length, 0); assert.equal(endedReplay.worldStates.length, 0); assert.deepEqual(endedReplay.withdrawnEncounterIds, ['hare_001']);
});
test('approved standard record appends and auto-fills vacant squad atomically', async () => {
  const uid = await setup('standard'); const r = await transactWildEncounter(db, uid, cap('win')); const p = await readUser(uid);
  const { calculateExperience, getHolobotRank } = require('../lib/lib/progression.js');
  assert.deepEqual(p.holobots, [{ name: 'HARE', level: 1, experience: 0, nextLevelExp: calculateExperience(2), rank: getHolobotRank(1), attributePoints: 10, boostedAttributes: {} }]);
  assert.deepEqual(p.travelSquad, { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['hare'] }); assert.deepEqual(r.travelSquad, p.travelSquad);
  assert.equal(r.captureResult.ownershipOutcome, 'added_to_squad'); assert.equal(r.captureResult.blueprintDelta, 0); assert.equal(p.holosTokens, 42); assert.deepEqual(p.blueprints, {});
  assert.deepEqual(p.buddyUnits, inv(5, 5, 4));
  await transactWildEncounter(db, uid, cap('win')); assert.deepEqual(await readUser(uid), p);
  await exportReply('added_to_squad', r);
});
test('full squad never replaced; new capture becomes roster-only', async () => { const uid = await setup('full'); const old = [legacyBot('ACE'), legacyBot('KUMA'), legacyBot('SHADOW')]; await db.doc(`users/${uid}`).update({ holobots: old, travelSquad: squad(['ace', 'kuma', 'shadow']) }); const r = await transactWildEncounter(db, uid, cap('full_win')); const p = await readUser(uid); assert.deepEqual(p.holobots.slice(0, 3), old); assert.equal(p.holobots.length, 4); assert.deepEqual(p.travelSquad, squad(['ace', 'kuma', 'shadow'])); assert.equal(r.captureResult.ownershipOutcome, 'new_bot'); await exportReply('new_bot', r); });
test('parallel duplicate receipt grants exactly five normalized blueprints, spends one Unit, preserves bot and squad', async () => { const uid = await setup('duplicate'); const old = legacyBot(' hArE '); await db.doc(`users/${uid}`).update({ holobots: [old], blueprints: { hare: 7, kuma: 9 }, travelSquad: squad([]) }); const rs = await Promise.all(Array.from({ length: 8 }, () => transactWildEncounter(db, uid, cap('dup')))); for (const r of rs) { assert.equal(r.captureResult.ownershipOutcome, 'blueprints'); assert.equal(r.captureResult.blueprintDelta, 5); } const p = await readUser(uid); assert.deepEqual(p.holobots, [old]); assert.deepEqual(p.blueprints, { hare: 12, kuma: 9 }); assert.deepEqual(p.travelSquad, squad([])); assert.deepEqual(p.buddyUnits, inv(5, 5, 4)); await exportReply('blueprints', rs[0]); });
test('refusal spends the tier and changes no other account field; no ownership reward', async () => {
  const uid = await setup('refused_account'); const before = await readUser(uid);
  const r = await transactWildEncounter(db, uid, cap(rid('no', HIGH), 'buddy_medium'));
  assert.equal(r.captureResult.outcome, 'refused'); assert.deepEqual(await readUser(uid), { ...before, buddyUnits: inv(5, 4, 5) });
  assert.equal(r.captureResult.ownershipOutcome, ''); assert.equal(r.captureResult.blueprintDelta, 0); assert.equal(r.captureResult.retryGuaranteed, false);
  await exportReply('refused', r);
});
test('two successful encounters for same new species create one bot plus five blueprints', async () => { const uid = await setup('two_same'); await db.doc(`wildEncounterSessions/${uid}`).set(twoEncounters({ encounterId: 'hare_002' })); const rs = await Promise.all([transactWildEncounter(db, uid, cap('first')), transactWildEncounter(db, uid, cap('second', 'buddy_heavy', 'hare_002'))]); assert.deepEqual(rs.map(r => r.captureResult.ownershipOutcome).sort(), ['added_to_squad', 'blueprints']); const p = await readUser(uid); assert.equal(p.holobots.length, 1); assert.equal(p.blueprints.hare, 5); assert.deepEqual(p.travelSquad.holobotIds, ['hare']); assert.deepEqual(p.buddyUnits, inv(5, 5, 3)); });
test('two new species competing for last squad slot never replace each other', async () => { const uid = await setup('last_slot'); await db.doc(`users/${uid}`).update({ holobots: [legacyBot('ACE'), legacyBot('KUMA')], travelSquad: squad(['ace', 'kuma']) }); await db.doc(`wildEncounterSessions/${uid}`).set(twoEncounters()); const rs = await Promise.all([transactWildEncounter(db, uid, cap('hare')), transactWildEncounter(db, uid, cap('wolf', 'buddy_heavy', 'wolf_001'))]); assert.deepEqual(rs.map(r => r.captureResult.ownershipOutcome).sort(), ['added_to_squad', 'new_bot']); const p = await readUser(uid); assert.equal(p.holobots.length, 4); assert.deepEqual(p.travelSquad.holobotIds.slice(0, 2), ['ace', 'kuma']); assert.equal(p.travelSquad.holobotIds.length, 3); assert.equal(p.travelSquad.revision, 5); });
test('malformed squad or unowned reference aborts before receipt or inventory write', async () => { for (const bad of [squad(['wolf']), squad(['ace', 'ace']), { schemaVersion: 'bad', revision: 0, holobotIds: [] }, squad(['ace', 'kuma', 'shadow', 'tora'])]) { const uid = await setup('bad_squad'); await db.doc(`users/${uid}`).update({ travelSquad: bad }); await assert.rejects(() => transactWildEncounter(db, uid, cap('bad')), /unavailable/); assert.equal((await db.doc(`wildEncounterSessions/${uid}/receipts/bad`).get()).exists, false); assert.equal((await readSession(uid)).revision, 1); assert.deepEqual((await readUser(uid)).buddyUnits, inv(5, 5, 5)); } });
test('old outcome replay presents current squad without another account grant', async () => { const uid = await setup('squad_replay'); const first = await transactWildEncounter(db, uid, cap('first')); await db.doc(`users/${uid}`).update({ travelSquad: { schemaVersion: 'travel-squad-1', revision: 2, holobotIds: [] } }); const before = await readUser(uid); const replay = await transactWildEncounter(db, uid, cap('first')); assert.deepEqual(replay.captureResult, first.captureResult); assert.deepEqual(replay.travelSquad, before.travelSquad); assert.deepEqual(await readUser(uid), before); });

test('new pilot without encounter data: refresh is an empty state with the starter Light Unit, creates no session', async () => { const uid = `fresh_${Date.now()}`; await db.doc(`users/${uid}`).set({ holobots: [{ name: 'ACE' }], travelSquad: squad(['ace']) }); const r = await transactWildEncounter(db, uid, { operation: 'refresh' }); assert.deepEqual(r, { travelSquad: squad(['ace']), buddyUnits: inv(1), revision: 0, encounters: [], worldStates: [], withdrawnEncounterIds: [], roster: { schemaVersion: 'acquisition-2', revision: 0, entries: [] } }); assert.equal((await db.doc(`wildEncounterSessions/${uid}`).get()).exists, false); assert.deepEqual((await readUser(uid)).buddyUnits, inv(1)); });
test('new pilot without encounter data: every non-refresh operation still fails closed', async () => { const uid = `fresh_ops_${Date.now()}`; await db.doc(`users/${uid}`).set({ holobots: [] }); for (const c of [toy('t'), cap('c'), { operation: 'worldState', encounterId: 'hare_001' }]) await assert.rejects(() => transactWildEncounter(db, uid, c), /unavailable/); assert.equal((await db.doc(`wildEncounterSessions/${uid}`).get()).exists, false); });
test('refresh stays unavailable with no user profile, a disabled session, or a malformed squad', async () => { await assert.rejects(() => transactWildEncounter(db, `nouser_${Date.now()}`, { operation: 'refresh' }), /unavailable/); const off = await setup('disabled'); await db.doc(`wildEncounterSessions/${off}`).update({ enabled: false }); await assert.rejects(() => transactWildEncounter(db, off, { operation: 'refresh' }), /unavailable/); const bad = `fresh_bad_${Date.now()}`; await db.doc(`users/${bad}`).set({ holobots: [], travelSquad: squad(['wolf']) }); await assert.rejects(() => transactWildEncounter(db, bad, { operation: 'refresh' }), /unavailable/); });

// ---- DECISIONS #44: tiers, refusal consumes, seeded roll ----
test('per-tier spend: capture and refusal each spend exactly one of the named tier', async () => {
  for (const [tierId, key] of [['buddy_light', 'light'], ['buddy_medium', 'medium'], ['buddy_heavy', 'heavy']]) {
    const uid = await setup(`spend_${key}`, inv(2, 2, 2));
    if (key !== 'heavy') {
      const no = await transactWildEncounter(db, uid, cap(rid(`no_${key}`, HIGH), tierId));
      assert.equal(no.captureResult.outcome, 'refused'); assert.equal(no.captureResult.buddyUnitsSpent, 1); assert.equal(no.captureResult.toyConsumedId, tierId);
      assert.deepEqual(no.buddyUnits, { ...inv(2, 2, 2), [key]: 1 }); assert.deepEqual((await readUser(uid)).buddyUnits, { ...inv(2, 2, 2), [key]: 1 });
    }
    const yes = await transactWildEncounter(db, uid, cap(rid(`yes_${key}`, LOW), tierId));
    assert.equal(yes.captureResult.outcome, 'captured'); assert.equal(yes.captureResult.buddyUnitTier, tierId);
    const expected = { ...inv(2, 2, 2), [key]: key === 'heavy' ? 1 : 0 };
    assert.deepEqual(yes.buddyUnits, expected); assert.deepEqual((await readUser(uid)).buddyUnits, expected);
    assert.equal((await readUser(uid)).holobots.length, 1);
  }
});

test('no_buddy_units per tier: names the tier; user, session and receipts untouched; the same request succeeds after a grant', async () => {
  for (const [tierId, key] of [['buddy_light', 'light'], ['buddy_medium', 'medium'], ['buddy_heavy', 'heavy']]) {
    const uid = await setup(`empty_${key}`, { ...inv(3, 3, 3), [key]: 0 });
    const before = await userAndSession(uid);
    const r = await transactWildEncounter(db, uid, cap('try', tierId));
    assert.equal(r.captureResult.outcome, 'no_buddy_units'); assert.equal(r.captureResult.buddyUnitTier, tierId); assert.equal(r.captureResult.rolled, false); assert.equal(r.captureResult.roll, 0);
    assert.deepEqual(r.buddyUnits, before.user.buddyUnits); assert.deepEqual(await userAndSession(uid), before);
    assert.equal((await db.doc(`wildEncounterSessions/${uid}/receipts/try`).get()).exists, false);
    if (key === 'light') await exportReply('no_buddy_units', r);
    await grantBuddyUnitsAdmin(db, uid, tierId, 1);
    const ok = await transactWildEncounter(db, uid, cap('try', tierId));
    assert.equal(ok.captureResult.rolled, true); assert.equal(ok.captureResult.buddyUnitsSpent, 1); assert.equal((await readUser(uid)).buddyUnits[key], 0);
  }
});

test('Heavy is always captured', async () => {
  const uid = await setup('heavy', inv(0, 0, 3));
  await db.doc(`wildEncounterSessions/${uid}`).set(twoEncounters());
  for (const [id, enc] of [['h1', 'hare_001'], ['h2', 'wolf_001']]) assert.equal((await transactWildEncounter(db, uid, cap(id, 'buddy_heavy', enc))).captureResult.outcome, 'captured');
  assert.deepEqual((await readUser(uid)).buddyUnits, inv(0, 0, 1));
});

test('requestId idempotency: parallel and later retries of one capture roll once and spend once', async () => {
  const uid = await setup('idem', inv(3));
  const id = rid('idem', HIGH);
  const rs = await Promise.all(Array.from({ length: 8 }, () => transactWildEncounter(db, uid, cap(id, 'buddy_light'))));
  for (const r of rs) assert.deepEqual(r.captureResult, rs[0].captureResult);
  assert.equal(rs[0].captureResult.outcome, 'refused'); assert.equal(rs[0].captureResult.roll, B.captureRoll01(SEED, 'hare_001', id));
  assert.deepEqual((await readUser(uid)).buddyUnits, inv(2)); assert.equal((await readSession(uid)).revision, 2);
  // Later retry (even after a toy raised the odds): same stored ruling, no re-roll, no spend.
  await transactWildEncounter(db, uid, toy('raise'));
  const later = await transactWildEncounter(db, uid, cap(id, 'buddy_light'));
  assert.deepEqual(later.captureResult, rs[0].captureResult); assert.deepEqual((await readUser(uid)).buddyUnits, inv(2));
  // Same requestId with a different tier is a different body: sequence_conflict, nothing spent.
  await assert.rejects(() => transactWildEncounter(db, uid, cap(id, 'buddy_medium')), /sequence_conflict/);
  assert.deepEqual((await readUser(uid)).buddyUnits, inv(2));
});

test('concurrent captures racing for the last Unit of a tier: exactly one spends it, the rest are no_buddy_units', async () => {
  const uid = await setup('last_medium', inv(4, 1, 4));
  // One encounter per racer, so only the Medium inventory is contended (a captured encounter would answer not_allowed).
  const species = ['hare', 'wolf', 'kuma', 'tora'];
  const s = seed(); s.encounters = species.map(h => ({ ...structuredClone(seed().encounters[0]), encounterId: `${h}_001`, holobotId: h }));
  await db.doc(`wildEncounterSessions/${uid}`).set(s);
  const rs = await Promise.all(species.map(h => transactWildEncounter(db, uid, cap(`race_${h}`, 'buddy_medium', `${h}_001`))));
  const spent = rs.filter(r => r.captureResult.buddyUnitsSpent === 1);
  assert.equal(spent.length, 1); assert.equal(rs.filter(r => r.captureResult.outcome === 'no_buddy_units').length, 3);
  for (const r of rs.filter(r => r.captureResult.outcome === 'no_buddy_units')) assert.equal(r.captureResult.buddyUnitTier, 'buddy_medium');
  const p = await readUser(uid); assert.deepEqual(p.buddyUnits, inv(4, 0, 4));
  assert.equal(p.holobots.length, spent[0].captureResult.captured ? 1 : 0);
});

test('migration from the #43 integer: first read writes {light: N, medium: 0, heavy: 0} once; capture spends from it; 0 never gets a starter', async () => {
  const uid = await setup('migrate', 3);
  const r = await transactWildEncounter(db, uid, { operation: 'refresh' }); assert.deepEqual(r.buddyUnits, inv(3)); assert.deepEqual((await readUser(uid)).buddyUnits, inv(3));
  const again = await transactWildEncounter(db, uid, { operation: 'refresh' }); assert.deepEqual(again.buddyUnits, inv(3));
  const uid2 = await setup('migrate_cap', 2);
  const c = await transactWildEncounter(db, uid2, cap(rid('m', LOW), 'buddy_light')); assert.equal(c.captureResult.outcome, 'captured'); assert.deepEqual((await readUser(uid2)).buddyUnits, inv(1));
  const zero = await setup('migrate_zero', 0);
  const z = await transactWildEncounter(db, zero, cap('z', 'buddy_light')); assert.equal(z.captureResult.outcome, 'no_buddy_units');
  assert.deepEqual((await readUser(zero)).buddyUnits, inv(0), 'migrated, no starter');
});

test('starter Light Unit exactly once under parallel first reads, and never again after migration or spending', async () => {
  const uid = `starter_${Date.now()}`; await db.doc(`users/${uid}`).set({ holobots: [] });
  const rs = await Promise.all(Array.from({ length: 6 }, () => transactWildEncounter(db, uid, { operation: 'refresh' })));
  for (const r of rs) assert.deepEqual(r.buddyUnits, inv(1));
  assert.deepEqual((await readUser(uid)).buddyUnits, inv(1));
  await db.doc(`wildEncounterSessions/${uid}`).set(seed());
  await transactWildEncounter(db, uid, cap(rid('s', HIGH), 'buddy_light'));
  assert.deepEqual((await readUser(uid)).buddyUnits, inv(0));
  await transactWildEncounter(db, uid, { operation: 'refresh' }); assert.deepEqual((await readUser(uid)).buddyUnits, inv(0));
  // Malformed stored inventories fail closed instead of reading as "missing" (no starter farm).
  for (const bad of [null, {}, { light: 1 }, { light: 0, medium: 0, heavy: 0, bonus: 9 }, -1]) {
    const b = `bad_inv_${Date.now()}_${serial++}`; await db.doc(`users/${b}`).set({ holobots: [], buddyUnits: bad });
    await assert.rejects(() => transactWildEncounter(db, b, { operation: 'refresh' }), /unavailable/);
    assert.deepEqual((await readUser(b)).buddyUnits, bad);
  }
});

test('roll seed: created once on the first rolled capture, persisted server-side, never sent to the client', async () => {
  const uid = await setup('seedless', inv(3));
  const s = seed(); delete s.rollSeed; await db.doc(`wildEncounterSessions/${uid}`).set(s);
  await transactWildEncounter(db, uid, { operation: 'refresh' }); assert.equal((await readSession(uid)).rollSeed, undefined, 'refresh writes nothing');
  const r = await transactWildEncounter(db, uid, cap('first', 'buddy_light'));
  const stored = (await readSession(uid)).rollSeed; assert.match(stored, /^[0-9a-f]{64}$/);
  assert.equal(r.captureResult.roll, B.captureRoll01(stored, 'hare_001', 'first'));
  assert.equal(JSON.stringify(r).includes(stored), false);
  if (r.captureResult.outcome === 'refused') await transactWildEncounter(db, uid, cap('second', 'buddy_light'));
  assert.equal((await readSession(uid)).rollSeed, stored, 'never rotated');
});

test('admin seam grants any tier (migrating first) and rejects bad input; it is not a callable export', async () => {
  const uid = await setup('admin', 2);
  assert.deepEqual(await grantBuddyUnitsAdmin(db, uid, 'buddy_medium', 3), inv(2, 3, 0));
  assert.deepEqual(await grantBuddyUnitsAdmin(db, uid, 'buddy_heavy', 1), inv(2, 3, 1));
  assert.deepEqual((await readUser(uid)).buddyUnits, inv(2, 3, 1));
  for (const [t, n] of [['buddy_ultra', 1], ['light', 1], ['buddy_light', 0], ['buddy_light', -1], ['buddy_light', 1.5], ['buddy_light', B.MAX_ADMIN_GRANT + 1]]) await assert.rejects(() => grantBuddyUnitsAdmin(db, uid, t, n), RangeError);
  const fresh = `admin_fresh_${Date.now()}`; await db.doc(`users/${fresh}`).set({ holobots: [] });
  assert.deepEqual(await grantBuddyUnitsAdmin(db, fresh, 'buddy_heavy', 1), inv(1, 0, 1), 'starter applied first, exactly once');
  const index = require('node:fs').readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.equal(/buddyUnitAdmin|grantBuddyUnitsAdmin/.test(index), false);
});
