// DECISIONS #53 amendment 1 + 2 domain tests: desktopAccountSnapshot — desktop-account-3 normalised holobots with
// battleStats (combat scale) + displayStats (mobile display scale); v1 / v2 exactly the deployed shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../lib/desktop/desktopAccountReply.js');
const E = require('../lib/lib/progressionEconomy.js');
const P = require('../lib/lib/progression.js');
const { readTravelSquad } = require('../lib/acquisition/captureOwnership.js');
const { BLUEPRINT_TIERS } = require('../lib/lib/mintingEconomy.js');
const { readBuddyInventory, totalBuddyUnits } = require('../lib/lib/buddyUnits.js');

/** Verbatim copy of the deployed reply literal (desktopAccountSnapshot.ts at origin/main 490ba4b). */
const deployed = (profile, uid, version, inv) => ({
  schemaVersion: version,
  uid,
  holobots: Array.isArray(profile.holobots) ? profile.holobots : [],
  blueprints: profile.blueprints ?? {},
  travelSquad: readTravelSquad(profile),
  blueprintTiers: BLUEPRINT_TIERS,
  buddyUnits: version === 'desktop-account-2' ? inv.units : totalBuddyUnits(inv.units),
});

const ace = () => ({ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3, health: 20 }, syncStats: { power: 10, guard: 20, tempo: 5, focus: 30, bond: 0 }, career: { workouts: 2 } });
const profiles = () => [
  {},
  { holobots: [] },
  { holobots: [ace()], blueprints: { ace: 3 }, buddyUnits: { light: 1, medium: 2, heavy: 0 } },
  { holobots: [ace(), { name: 'KUMA', level: 1 }, { name: 'WOLF' }], travelSquad: { schemaVersion: 'travel-squad-1', revision: 2, holobotIds: ['ace', 'kuma'] }, buddyUnits: 4 },
  { holobots: [{ name: 'HARE', level: 7, attributePoints: 0, boostedAttributes: { speed: 4 } }, null, 7, { level: 2 }], blueprints: null },
];

test('version negotiation: missing / v1 → v1, v2, v3; anything else refused', () => {
  assert.equal(S.desktopAccountVersionOf(undefined), 'desktop-account-1'); assert.equal(S.desktopAccountVersionOf({}), 'desktop-account-1');
  assert.equal(S.desktopAccountVersionOf({ schemaVersion: 'desktop-account-1' }), 'desktop-account-1');
  assert.equal(S.desktopAccountVersionOf({ schemaVersion: 'desktop-account-2' }), 'desktop-account-2');
  assert.equal(S.desktopAccountVersionOf({ schemaVersion: 'desktop-account-3' }), 'desktop-account-3');
  for (const bad of ['desktop-account-4', 3, null, '']) assert.equal(S.desktopAccountVersionOf({ schemaVersion: bad }), null, String(bad));
});

test('v1 / v2 replies are the deployed literal byte for byte (key order included); holobots verbatim', () => {
  let n = 0;
  for (const profile of profiles()) {
    const inv = readBuddyInventory(profile);
    for (const version of ['desktop-account-1', 'desktop-account-2']) {
      const a = S.buildDesktopAccountReply(structuredClone(profile), 'uid-1', version, inv.units);
      const b = deployed(structuredClone(profile), 'uid-1', version, inv);
      assert.equal(JSON.stringify(a), JSON.stringify(b), `${version} ${JSON.stringify(profile)}`);
      n++;
    }
  }
  assert.equal(n, 10);
  // Known-bad control: the comparison sees a key-order-only difference.
  const p = profiles()[2], inv = readBuddyInventory(p);
  const reordered = Object.fromEntries(Object.entries(S.buildDesktopAccountReply(p, 'u', 'desktop-account-2', inv.units)).reverse());
  assert.notEqual(JSON.stringify(reordered), JSON.stringify(deployed(p, 'u', 'desktop-account-2', inv)));
});

test('v3: every holobot normalised (mobile defaults) with battleStats = getPlayerBattleStats and displayStats = getHolobotDisplayStats', () => {
  const profile = profiles()[3];
  const inv = readBuddyInventory(profile);
  const r = S.buildDesktopAccountReply(structuredClone(profile), 'uid-1', 'desktop-account-3', inv.units);
  assert.deepEqual(Object.keys(r), ['schemaVersion', 'uid', 'holobots', 'blueprints', 'travelSquad', 'blueprintTiers', 'buddyUnits']);
  assert.equal(r.schemaVersion, 'desktop-account-3'); assert.deepEqual(r.buddyUnits, { light: 4, medium: 0, heavy: 0 }, 'tier map like v2');
  assert.deepEqual(r.travelSquad, profile.travelSquad);
  const [a, k, w] = r.holobots;
  // ACE L4 (+3 atk / +20 HP, sync power 10 / guard 20 / tempo 5 / focus 30): the rival-battle-3 combatant numbers.
  assert.deepEqual(a.battleStats, { attack: 96, defense: 71, maxHP: 192, speed: 80, intelligence: 60 });
  assert.deepEqual(a.displayStats, { attack: 12, defense: 6, hp: 192, special: 5, speed: 8 });
  assert.deepEqual(a.career, { workouts: 2 }, 'extra keys kept'); assert.deepEqual(a.syncStats, ace().syncStats);
  assert.deepEqual(Object.keys(a).slice(-2), ['battleStats', 'displayStats']);
  // KUMA with only name + level: the mobile defaults.
  assert.deepEqual({ level: k.level, experience: k.experience, nextLevelExp: k.nextLevelExp, attributePoints: k.attributePoints, rank: k.rank, boostedAttributes: k.boostedAttributes }, { level: 1, experience: 0, nextLevelExp: 400, attributePoints: 1, rank: 'Rookie', boostedAttributes: {} });
  assert.deepEqual(k.battleStats, { attack: 70, defense: 50, maxHP: 200, speed: 30, intelligence: 40 });
  assert.deepEqual(k.displayStats, { attack: 7, defense: 5, hp: 200, special: 4, speed: 3 });
  assert.equal(w.level, 1); assert.equal(w.nextLevelExp, 400);
  for (const h of r.holobots) {
    const s = E.getPlayerBattleStats(h);
    assert.deepEqual(h.battleStats, { attack: s.attack, defense: s.defense, maxHP: s.maxHP, speed: s.speed, intelligence: s.intelligence });
    assert.deepEqual(h.displayStats, P.getHolobotDisplayStats(h.name, h.level, h.boostedAttributes));
  }
  // The stored profile is not mutated.
  assert.deepEqual(profile.holobots[1], { name: 'KUMA', level: 1 });
});

test('v3 drops entries that are not named records; v1 / v2 keep them verbatim', () => {
  const profile = profiles()[4];
  const inv = readBuddyInventory(profile);
  const v3 = S.buildDesktopAccountReply(structuredClone(profile), 'u', 'desktop-account-3', inv.units);
  assert.deepEqual(v3.holobots.map(h => h.name), ['HARE']); assert.deepEqual(v3.blueprints, {});
  assert.equal(v3.holobots[0].attributePoints, 0); assert.deepEqual(v3.holobots[0].displayStats, P.getHolobotDisplayStats('HARE', 7, { speed: 4 }));
  assert.deepEqual(S.buildDesktopAccountReply(structuredClone(profile), 'u', 'desktop-account-2', inv.units).holobots, profile.holobots);
});
