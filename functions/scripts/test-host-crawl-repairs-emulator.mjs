// host-crawl-fixes-1 Firestore-emulator tests for the four host items the 2026-10-24 lite button crawl handed over:
//  RC7  arena refusal of legacy-shaped holobots (self-heal + non-transient holobot_record_invalid),
//  story flags that blanked the Home snapshot (tolerant display read; writers still fail closed),
//  economyFieldsSane legacy fields that denied every client write (host sanitizer on refreshEnergy / snapshot).
// Loopback demo emulator only; production is forbidden.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) {
  throw new Error('Loopback demo Firestore emulator required; production is forbidden');
}
const { db } = require('../lib/admin.js');
const { transactArenaMatch, ARENA_MIN_SETTLE_MS_CPU, ARENA_HOLOBOT_RECORD_INVALID } = require('../lib/arena/arenaMatchStore.js');
const { arenaMatchHost } = require('../lib/arena/arenaMatchHost.js');
const { desktopAccountSnapshot } = require('../lib/desktop/desktopAccountSnapshot.js');
const { transactRefreshEnergy } = require('../lib/energy/refreshEnergy.js');
const { transactArenaGathering } = require('../lib/story/arenaGathering.js');
const { calculateExperience, applyHolobotExperience } = require('../lib/lib/progression.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');

const T0 = Date.UTC(2026, 9, 24, 18, 0, 0);
const FLAGS = { arenaGatheringSeen: false, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: true };
let serial = 0;
async function setup(extra = {}) {
  const uid = `hostcrawl_${Date.now()}_${serial++}`;
  await db.doc(`users/${uid}`).set({
    storyFlags: FLAGS,
    holobots: [{ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3 } }],
    travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] },
    buddyUnits: { light: 0, medium: 0, heavy: 0 }, arenaPassses: 3, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0,
    ...extra,
  });
  return uid;
}
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const repairs = async uid => (await db.collection(`accountRepairs/${uid}/entries`).get()).docs.map(d => d.data());
const call = (uid, data, now = T0) => transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', ...data }, now);
const issueData = (requestId, holobotId = 'ace') => ({ operation: 'issue', requestId, tierId: 'rookie', paymentMethod: 'tokens', holobotId, opponentName: 'HARE' });
async function playWin(uid, holobotId = 'ace') {
  const issued = await call(uid, issueData(`req_${serial++}_abcdefgh`, holobotId));
  await call(uid, { operation: 'start', matchId: issued.matchId }, T0 + 1);
  const settled = await call(uid, { operation: 'settle', matchId: issued.matchId, playerFinalHealth: 1, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0 }, T0 + 2 + ARENA_MIN_SETTLE_MS_CPU);
  return { issued, settled };
}

// ---- RC7: arena admission of legacy-shaped holobots --------------------------------------------------------------

const LEGACY = {
  // Web-era row: mobile config/holobots.ts wrote nextLevelExp 100 at LV1 (the server threshold is 400), no boosts.
  webEra: { name: 'KUMA', level: 1, experience: 150, nextLevelExp: 100, rank: 'Rookie', attributePoints: 1 },
  missingBoosts: { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1 },
  staleNextLevelExp: { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 1600, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3 } },
  nullFields: { name: 'ACE', level: 4, experience: 1700, nextLevelExp: null, rank: 'Starter', attributePoints: null, boostedAttributes: null },
  stringBoost: { name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: '2', boostedAttributes: { attack: '3', defense: null } },
};

for (const [label, bot] of Object.entries(LEGACY)) {
  test(`RC7 legacy holobot (${label}) is admitted, healed deterministically, and earns only real-rule XP`, async () => {
    const id = bot.name.toLowerCase();
    const uid = await setup({ holobots: [bot], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: [id] } });
    const { issued, settled } = await playWin(uid, id);
    assert.equal(issued.match.entrant.holobotId, id);
    assert.equal(settled.match.state, 'settled');
    const stored = (await user(uid)).holobots[0];
    // Expected = the server progression loop on the canonical record (threshold from level, nothing raised).
    const canonical = { ...bot, nextLevelExp: calculateExperience(bot.level + 1),
      ...(bot.attributePoints === null ? { attributePoints: 0 } : bot.attributePoints === '2' ? { attributePoints: 2 } : {}),
      ...(bot.boostedAttributes === null ? { boostedAttributes: {} } : label === 'stringBoost' ? { boostedAttributes: { attack: 3 } } : {}) };
    const expected = applyHolobotExperience(canonical, settled.match.settlementReceipt.settlement.awardedExp);
    assert.deepEqual(stored, expected);
    assert.ok(stored.level <= expected.level && stored.attributePoints === expected.attributePoints);
    // A stale lower threshold no longer levels the bot early: the web-era LV1 row stays LV1 under 400.
    if (label === 'webEra') { assert.equal(stored.level, 1); assert.equal(stored.nextLevelExp, 400); }
    const audit = await repairs(uid);
    if (label === 'missingBoosts') { assert.deepEqual(audit, [], 'an absent boostedAttributes is already canonical'); return; }
    assert.equal(audit.length, 1, 'the heal is persisted at issue and audited once (settle finds it canonical)');
    assert.equal(audit[0].schemaVersion, 'account-repair-1');
    assert.equal(audit[0].source, 'arenaMatchHost.issue');
  });
}

test('RC7 a canonical holobot writes no repair entry', async () => {
  const uid = await setup();
  await playWin(uid);
  assert.deepEqual(await repairs(uid), []);
});

test('RC7 an unhealable record is refused as non-transient holobot_record_invalid with a reason, writing nothing', async () => {
  const cases = [
    [{ name: 'ACE', level: 1, experience: 450, nextLevelExp: 500 }, 'experience_over_level'], // XP past LV1's 400: a heal would be a level grant.
    [{ name: 'ACE', level: '4', experience: 1700 }, 'level_malformed'],
    [{ name: 'ACE', level: 4, experience: -1 }, 'experience_malformed'],
    [{ name: 'ACE', level: 4, experience: 1700, attributePoints: -2 }, 'attribute_points_malformed'],
    [{ name: 'ACE', level: 4, experience: 1700, boostedAttributes: { attack: -1 } }, 'boosted_attributes_malformed'],
    [{ name: 'ACE', level: 4, experience: 1700, boostedAttributes: [3] }, 'boosted_attributes_malformed'],
  ];
  for (const [bot, reason] of cases) {
    const uid = await setup({ holobots: [bot] });
    const before = await user(uid);
    await assert.rejects(() => call(uid, issueData(`bad_${serial++}_abcdefgh`)), e => e.code === ARENA_HOLOBOT_RECORD_INVALID && e.reason === reason, reason);
    // Through the deployed callable: failed-precondition (never 'unavailable'), rejectionCode + reason in details.
    await assert.rejects(() => arenaMatchHost.run({ auth: { uid }, data: { schemaVersion: 'arena-match-1', ...issueData(`bad_${serial++}_abcdefgh`) } }),
      e => e.code === 'failed-precondition' && e.details?.rejectionCode === 'holobot_record_invalid' && e.details?.reason === reason, reason);
    assert.deepEqual(await user(uid), before, `${reason}: no partial write`);
    assert.equal((await db.doc(`arenaMatches/${uid}`).get()).exists, false);
    assert.deepEqual(await repairs(uid), []);
  }
});

// ---- Story flags: tolerant Home snapshot, strict writers ---------------------------------------------------------

test('inconsistent / malformed story flags no longer blank the Home snapshot; nothing is persisted; writers still refuse', async () => {
  for (const storyFlags of [
    { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: true, holoZonesArcBuilt: true }, // the crawl's seed shape
    { tournamentsWon: 3, arenaArcBuilt: false }, null, [], { tournamentsWon: 4 }, { tournamentsWon: 1.5 }, { arenaGatheringSeen: 'yes' }, { holoZonesArcBuilt: null },
  ]) {
    const uid = await setup({ storyFlags });
    const r = await desktopAccountSnapshot.run({ auth: { uid }, data: { schemaVersion: 'desktop-account-3' } });
    const label = JSON.stringify(storyFlags);
    assert.equal(r.schemaVersion, 'desktop-account-3', label);
    assert.equal(r.syncPoints, 0, label); assert.equal(r.holobots[0].level, 4, label);
    assert.equal(typeof r.storyFlags.tournamentsWon, 'number', label);
    assert.equal(r.storyFlags.arenaArcBuilt, r.storyFlags.arenaArcBuilt && r.storyFlags.tournamentsWon === 3, `${label}: never shows the arc built against the invariant`);
    assert.deepEqual(r.tournamentUnlocks, [], `${label}: a fallback read announces no tournament`);
    assert.deepEqual((await user(uid)).storyFlags, storyFlags, `${label}: the fallback is never persisted`);
    await assert.rejects(() => transactArenaGathering(db, uid, { schemaVersion: 'arena-gathering-1' }), e => e.code === 'unavailable', `${label}: writer fails closed`);
  }
  // The display fallback for the crawl seed: the inconsistent arenaArcBuilt reads false; the zones fail closed
  // (the HoloZone gates refuse a non-exact record), while the snapshot still answers.
  const uid = await setup({ storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: true, holoZonesArcBuilt: true } });
  const r = await desktopAccountSnapshot.run({ auth: { uid }, data: { schemaVersion: 'desktop-account-3' } });
  assert.deepEqual(r.storyFlags, { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: true });
  assert.equal(r.zones[1].isOpen, false);
});

// ---- economyFieldsSane: host sanitizer, then client writes work ---------------------------------------------------

const rulesRequire = createRequire(new URL('../../rules-tests/package.json', import.meta.url));
const { initializeTestEnvironment, assertFails, assertSucceeds } = rulesRequire('@firebase/rules-unit-testing');
const { doc, updateDoc } = rulesRequire('firebase/firestore');
let env;
async function rulesEnv() {
  if (env) return env;
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  env = await initializeTestEnvironment({ projectId: process.env.GCLOUD_PROJECT, firestore: { host, port: Number(port), rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } });
  return env;
}
after(async () => { if (env) await env.cleanup(); });
const clientWrite = async (uid, unit) => updateDoc(doc((await rulesEnv()).authenticatedContext(uid).firestore(), `users/${uid}`), { syncDistanceUnit: unit });

const ISO = '2026-10-20T12:00:00.000Z';
for (const [path, run] of [
  ['refreshEnergy', uid => transactRefreshEnergy(db, uid, {}, T0)],
  ['desktopAccountSnapshot', uid => desktopAccountSnapshot.run({ auth: { uid }, data: { schemaVersion: 'desktop-account-3' } })],
]) {
  test(`economyFieldsSane: a string lastWildcardPackAt denies client writes until ${path} sanitizes it (audited, idempotent)`, async () => {
    const uid = await setup({ lastWildcardPackAt: ISO, dailyEnergy: 20, maxDailyEnergy: 100, syncDistanceUnit: 'km' });
    await assertFails(clientWrite(uid, 'mi'));
    await run(uid);
    const after1 = await user(uid);
    assert.equal(after1.lastWildcardPackAt, Date.parse(ISO), 'the ISO time keeps its cooldown meaning as epoch ms');
    assert.equal(after1.holosTokens, 1000);
    const audit = await repairs(uid);
    assert.equal(audit.length, 1); assert.equal(audit[0].source, path);
    assert.deepEqual(audit[0].changes, [{ path: 'lastWildcardPackAt', before: `string:${JSON.stringify(ISO)}`, after: `number:${Date.parse(ISO)}` }]);
    await assertSucceeds(clientWrite(uid, 'mi'));
    await run(uid);
    assert.equal((await repairs(uid)).length, 1, 'second pass is a no-op');
  });
}

test('economyFieldsSane sanitizer never raises a stored number and unblocks every crawl-probed legacy field', async () => {
  const uid = await setup({ wins: '12', holosTokens: 250_000_000, dailyEnergy: -5, maxDailyEnergy: 100, losses: 'many', syncPoints: NaN, lastWildcardPackAt: 'garbage', syncDistanceUnit: 'km' });
  await assertFails(clientWrite(uid, 'mi'));
  await transactRefreshEnergy(db, uid, {}, T0);
  const u = await user(uid);
  assert.equal(u.wins, 12);
  assert.equal(u.holosTokens, 100_000_000, 'over the cap clamps DOWN to the cap');
  assert.equal(u.losses, 0); assert.equal(u.syncPoints, 0);
  assert.ok(u.dailyEnergy >= 0 && u.dailyEnergy <= 100);
  assert.equal(u.lastWildcardPackAt, T0, 'an unparseable cooldown restarts now (never opens a pack early)');
  await assertSucceeds(clientWrite(uid, 'mi'));
});

test('deleteUserData removes the accountRepairs audit tree', async () => {
  const uid = await setup({ lastWildcardPackAt: ISO });
  await transactRefreshEnergy(db, uid, {}, T0);
  assert.equal((await repairs(uid)).length, 1);
  await deleteUserData(db, uid);
  assert.deepEqual(await repairs(uid), []);
});
