// DECISIONS #53 amendment 1 + 2 domain tests: desktopAccountSnapshot — desktop-account-3 normalised holobots with
// battleStats (combat scale) + displayStats (mobile display scale); v1 / v2 exactly the deployed shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pinFlags, withFlags } from './lib/flag-env.mjs';
// The pre-existing tests pin the flag-OFF shapes (no syncReadiness, pre-#72.78 stats); production (#72.86) has both ON,
// pinned in the ON tests at the end of this file.
pinFlags({ HOLOCITY_READINESS_ACCRUE: undefined, HOLOCITY_FIGHT_ATTRS: undefined });
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

test('v1 / v2 retain deployed fields byte for byte after additive storyFlags, pilotRank, tournamentUnlocks, dailyMissionLedger and onboarding fields are removed', () => {
  let n = 0;
  for (const profile of profiles()) {
    const inv = readBuddyInventory(profile);
    for (const version of ['desktop-account-1', 'desktop-account-2']) {
      const a = S.buildDesktopAccountReply(structuredClone(profile), 'uid-1', version, inv.units);
      assert.deepEqual(a.storyFlags, {arenaGatheringSeen:false,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false});
      delete a.storyFlags;
      assert.equal(a.pilotRank, 0);
      delete a.pilotRank;
      assert.ok(Array.isArray(a.tournamentUnlocks));
      delete a.tournamentUnlocks;
      assert.equal(a.dailyMissionLedger.schemaVersion, 'daily-mission-ledger-1');
      delete a.dailyMissionLedger;
      // onboarding-host-1: a profile with no stored field reads as returning (skipped, retired).
      assert.deepEqual(a.onboarding, { schemaVersion: 'onboarding-1', step: 7, stepId: 'done', skipped: true, stepAt: null });
      delete a.onboarding;
      for (const key of ["username", "pilotPortraitId", "pilotColourwayId", "syncPoints", "zones"]) delete a[key];
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
  assert.deepEqual(Object.keys(r), ['schemaVersion', 'battlefieldMovement', 'uid', 'username', 'pilotPortraitId', 'pilotColourwayId', 'syncPoints', 'zones', 'storyFlags', 'pilotRank', 'tournamentUnlocks', 'dailyMissionLedger', 'onboarding', 'holobots', 'blueprints', 'travelSquad', 'blueprintTiers', 'buddyUnits']);
  assert.equal(r.schemaVersion, 'desktop-account-3'); assert.deepEqual(r.buddyUnits, { light: 4, medium: 0, heavy: 0 }, 'tier map like v2');
  assert.deepEqual(r.travelSquad, profile.travelSquad);
  const [a, k, w] = r.holobots;
  // ACE L4 (+3 atk / +20 HP, sync power 10 / guard 20 / tempo 5 / focus 30): the rival-battle-3 combatant numbers.
  assert.deepEqual(a.battleStats, { attack: 96, defense: 71, maxHP: 192, speed: 80, intelligence: 60 });
  assert.deepEqual(a.displayStats, { attack: 12, defense: 6, hp: 192, special: 5, speed: 8 });
  assert.deepEqual(a.career, { workouts: 2 }, 'extra keys kept'); assert.deepEqual(a.syncStats, ace().syncStats);
  assert.deepEqual(Object.keys(a).slice(-3), ['battleStats', 'battlefieldMovement', 'displayStats']);
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

 test('dashboard identity is stored-only, nullable, and never accepts client-like appearance/catalog fields', () => {
  for (const version of ['desktop-account-1', 'desktop-account-2', 'desktop-account-3']) {
    const profile = {username:'Pilot Actual',syncPoints:0,pilotPortraitId:'forged',pilotColourwayId:'forged',zones:[{isOpen:true}],wardrobe:{preset:'Default_Boy'}};
    const before = structuredClone(profile);
    const r = S.buildDesktopAccountReply(profile,'not-a-name',version,{light:0,medium:0,heavy:0});
    assert.equal(r.username,'Pilot Actual'); assert.equal(r.syncPoints,0);
    assert.equal(r.pilotPortraitId,null); assert.equal(r.pilotColourwayId,null);
    assert.deepEqual(r.zones.map(z=>z.zoneId),['holocity','neonforest','tide_hollow','sky_reach']);
    // No storyFlags = defaults (holoZonesArcBuilt false): Neon Forest is closed, not travelable (critic review 2026-10-17 #1).
    assert.deepEqual(r.zones.map(z=>z.sceneName),['HoloCity_Main',null,null,null]);
    assert.deepEqual(r.zones.map(z=>z.isOpen),[true,false,false,false]);
    assert.deepEqual(r.zones.map(z=>z.statusLabel),['OPEN','NOT YET AVAILABLE','NOT YET AVAILABLE','NOT YET AVAILABLE']);
    assert.deepEqual(profile,before);
  }
  for (const invalid of [undefined,null,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'5']) {
    const r=S.buildDesktopAccountReply({username:42,syncPoints:invalid},'uid','desktop-account-3',{light:0,medium:0,heavy:0});
    assert.equal(r.username,null); assert.equal(r.syncPoints,null);
  }
});

test('HoloZones arc gate: Neon Forest is open (with its scene) only when storyFlags.holoZonesArcBuilt; the fixtures are the builder output', () => {
  const { desktopDashboardFields } = require('../lib/desktop/desktopDashboardFields.js');
  const flags = built => ({ arenaGatheringSeen: true, tournamentsWon: 3, arenaArcBuilt: true, holoZonesArcBuilt: built });
  for (const version of ['desktop-account-1', 'desktop-account-2', 'desktop-account-3']) {
    for (const [storyFlags, open] of [[undefined, false], [flags(false), false], [{ holoZonesArcBuilt: false }, false], [flags(true), true], [{ holoZonesArcBuilt: true }, true]]) {
      const r = S.buildDesktopAccountReply({ storyFlags, zones: [{ zoneId: 'neonforest', isOpen: !open }] }, 'u', version, { light: 0, medium: 0, heavy: 0 });
      assert.deepEqual(r.zones[1], { zoneId: 'neonforest', displayName: 'Neon Forest', statusLabel: open ? 'OPEN' : 'NOT YET AVAILABLE', isOpen: open, cardImageId: 'neonforest', sceneName: open ? 'HoloZone_NeonForest' : null });
      assert.deepEqual(r.zones.map(z => z.isOpen), [true, open, false, false], 'the flag never opens a zone without a configured tier');
    }
  }
  // Malformed flags fail closed in the projection (the callable itself refuses them as unavailable).
  for (const storyFlags of [null, [], 'yes', { holoZonesArcBuilt: 'true' }, { holoZonesArcBuilt: null }, { tournamentsWon: 3 }])
    assert.equal(desktopDashboardFields({ storyFlags }).zones[1].isOpen, false, JSON.stringify(storyFlags));
  const dir = '../../Documentation/QA/2026-10-17-desktop-snapshot-identity-1/';
  for (const [file, open] of [['desktop-account-3.json', false], ['desktop-account-3_holozones-arc-built.json', true]]) {
    const fixture = require(dir + file);
    assert.equal(fixture.storyFlags.holoZonesArcBuilt, open);
    const fields = desktopDashboardFields({ username: fixture.username, syncPoints: fixture.syncPoints, storyFlags: fixture.storyFlags });
    assert.deepEqual(Object.fromEntries(Object.keys(fields).map(k => [k, fixture[k]])), fields, file);
  }
});

test('production flags ON: READINESS_ACCRUE adds syncReadiness to every version after onboarding; FIGHT_ATTRS gives the rules-5 stats', () => {
  withFlags({ HOLOCITY_READINESS_ACCRUE: '1', HOLOCITY_FIGHT_ATTRS: '1' }, () => {
    const profile = profiles()[3], inv = readBuddyInventory(profile);
    for (const version of ['desktop-account-1', 'desktop-account-2', 'desktop-account-3']) {
      const r = S.buildDesktopAccountReply(structuredClone(profile), 'uid-1', version, inv.units);
      const keys = Object.keys(r);
      assert.equal(keys[keys.indexOf('onboarding') + 1], 'syncReadiness', version);
      assert.equal(keys[keys.indexOf('syncReadiness') + 1], 'holobots', version);
      assert.deepEqual(Object.keys(r.syncReadiness).sort(), profile.holobots.map(h => h.name).sort(), 'one view entry per owned bot');
      for (const e of Object.values(r.syncReadiness)) assert.deepEqual({ value: e.value, fadePerDay: e.fadePerDay }, { value: 0, fadePerDay: 20 }, 'no stored readiness = 0, base fade');
    }
    const r = S.buildDesktopAccountReply(structuredClone(profile), 'uid-1', 'desktop-account-3', inv.units);
    const [a, k] = r.holobots;
    assert.deepEqual(a.battleStats, { attack: 96, defense: 71, maxHP: 192, speed: 69, intelligence: 60 });
    assert.deepEqual(a.displayStats, { attack: 12, defense: 6, hp: 192, special: 5, speed: 6 });
    assert.deepEqual(k.battleStats, { attack: 70, defense: 50, maxHP: 200, speed: 40, intelligence: 40 });
    assert.deepEqual(k.displayStats, { attack: 7, defense: 5, hp: 200, special: 4, speed: 4 });
    for (const h of r.holobots) {
      const s = E.getPlayerBattleStats(h);
      assert.equal(h.battleStats.speed, s.speed);
      assert.deepEqual(h.displayStats, P.getHolobotDisplayStats(h.name, h.level, h.boostedAttributes));
    }
  });
});
