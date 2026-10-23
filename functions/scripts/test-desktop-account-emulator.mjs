// DECISIONS #53 amendment 1 + 2 Firestore-emulator tests: desktopAccountSnapshot desktop-account-3 through the real
// callable — normalised holobots with battleStats / displayStats, the starter grant still once, v1 / v2 untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Ajv = createRequire(new URL('../../rules-tests/package.json', import.meta.url))('ajv');
const validateDashboard = new Ajv().compile(require('../../Schemas/desktop-account-dashboard-fields.json'));
assert.equal(validateDashboard(require('../../Documentation/QA/2026-10-17-desktop-snapshot-identity-1/known-bad-before.json')),false);
assert.equal(validateDashboard(require('../../Documentation/QA/2026-10-17-desktop-snapshot-identity-1/desktop-account-3.json')),true);
assert.equal(validateDashboard(require('../../Documentation/QA/2026-10-17-desktop-snapshot-identity-1/desktop-account-3_holozones-arc-built.json')),true);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-desktop-tests';
const { db } = require('../lib/admin.js');
const { desktopAccountSnapshot } = require('../lib/desktop/desktopAccountSnapshot.js');
const E = require('../lib/lib/progressionEconomy.js');
const P = require('../lib/lib/progression.js');
let serial = 0;
const ace = () => ({ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3, health: 20 }, syncStats: { power: 10, guard: 20, tempo: 5, focus: 30, bond: 0 } });
const setup = async (fields = {}) => { const uid = `desk_${Date.now()}_${serial++}`; await db.doc(`users/${uid}`).set({ holobots: [ace(), { name: 'KUMA', level: 1 }], ...fields }); return uid; };

test('v3: normalised holobots + battleStats / displayStats; the starter Buddy Unit is granted once; the stored records are not rewritten', async () => {
  const uid = await setup();
  const r = await desktopAccountSnapshot.run({ auth: { uid }, data: { schemaVersion: 'desktop-account-3' } });
  assert.equal(r.schemaVersion, 'desktop-account-3'); assert.deepEqual(r.buddyUnits, { light: 1, medium: 0, heavy: 0 });
  assert.deepEqual(r.holobots[0].battleStats, { attack: 96, defense: 71, maxHP: 192, speed: 69, intelligence: 60 }, '#72.78: ACE base SPEED 7 -> 6 (LV4: floor(60 * 1.15))');
  assert.deepEqual(r.holobots[0].displayStats, P.getHolobotDisplayStats('ACE', 4, { attack: 3, health: 20 }));
  assert.deepEqual({ ...r.holobots[1], battleStats: undefined, battlefieldMovement: undefined, displayStats: undefined }, { name: 'KUMA', level: 1, attributePoints: 1, experience: 0, nextLevelExp: 400, rank: 'Rookie', boostedAttributes: {}, battleStats: undefined, battlefieldMovement: undefined, displayStats: undefined });
  const s = E.getPlayerBattleStats({ name: 'KUMA', level: 1 });
  assert.deepEqual(r.holobots[1].battleStats, { attack: s.attack, defense: s.defense, maxHP: s.maxHP, speed: s.speed, intelligence: s.intelligence });
  const stored = (await db.doc(`users/${uid}`).get()).data();
  assert.deepEqual(stored.holobots, [ace(), { name: 'KUMA', level: 1 }], 'v3 is a read view; nothing normalised is written back');
  assert.deepEqual(stored.buddyUnits, { light: 1, medium: 0, heavy: 0 });
  const again = await desktopAccountSnapshot.run({ auth: { uid }, data: { schemaVersion: 'desktop-account-3' } });
  assert.deepEqual(again.buddyUnits, { light: 1, medium: 0, heavy: 0 }, 'granted once');
});

test('v1 / v2 keep the stored records verbatim; an unknown version is invalid-argument', async () => {
  const uid = await setup({ buddyUnits: { light: 2, medium: 1, heavy: 0 } });
  const v1 = await desktopAccountSnapshot.run({ auth: { uid }, data: {} });
  const v2 = await desktopAccountSnapshot.run({ auth: { uid }, data: { schemaVersion: 'desktop-account-2' } });
  assert.equal(v1.schemaVersion, 'desktop-account-1'); assert.equal(v1.buddyUnits, 3);
  assert.deepEqual(v2.buddyUnits, { light: 2, medium: 1, heavy: 0 });
  for (const r of [v1, v2]) { assert.deepEqual(r.holobots, [ace(), { name: 'KUMA', level: 1 }]); assert.equal('battleStats' in r.holobots[0], false); }
  await assert.rejects(() => desktopAccountSnapshot.run({ auth: { uid }, data: { schemaVersion: 'desktop-account-9' } }), e => e.code === 'invalid-argument' && e.details.rejectionCode === 'invalid_request');
  await assert.rejects(() => desktopAccountSnapshot.run({ data: { schemaVersion: 'desktop-account-3' } }), e => e.code === 'unauthenticated');
});

test('dashboard projection ignores request overrides and preserves stored account fields', async () => {
  const uid=await setup({username:'Throwaway Pilot',syncPoints:37,privateSentinel:{keep:true}});
  for(const schemaVersion of ['desktop-account-1','desktop-account-2','desktop-account-3']) {
    const r=await desktopAccountSnapshot.run({auth:{uid},data:{schemaVersion,username:'Spoof',syncPoints:999,zones:[{zoneId:'sky_reach',isOpen:true}]}});
    assert.equal(validateDashboard(r),true,JSON.stringify(validateDashboard.errors));
    assert.equal(r.username,'Throwaway Pilot');assert.equal(r.syncPoints,37);
    assert.equal(r.pilotPortraitId,null);assert.equal(r.pilotColourwayId,null);
    // A request cannot open a zone, and a pilot without holoZonesArcBuilt sees Neon Forest closed (critic review 2026-10-17 #1).
    assert.deepEqual(r.zones.map(z=>z.isOpen),[true,false,false,false]);assert.equal(r.zones[1].sceneName,null);
  }
  const stored=(await db.doc(`users/${uid}`).get()).data();
  assert.equal(stored.username,'Throwaway Pilot');assert.equal(stored.syncPoints,37);
  assert.deepEqual(stored.privateSentinel,{keep:true});assert.equal(stored.zones,undefined);
});

test('HoloZones arc gate through the real callable: closed until storyFlags.holoZonesArcBuilt, then open with its scene; malformed flags refuse', async () => {
  const flags=built=>({arenaGatheringSeen:true,tournamentsWon:3,arenaArcBuilt:true,holoZonesArcBuilt:built});
  for(const [storyFlags,open] of [[flags(false),false],[flags(true),true]]){
    const uid=await setup({storyFlags});
    for(const schemaVersion of ['desktop-account-1','desktop-account-2','desktop-account-3']){
      const r=await desktopAccountSnapshot.run({auth:{uid},data:{schemaVersion}});
      assert.equal(validateDashboard(r),true,JSON.stringify(validateDashboard.errors));
      assert.deepEqual(r.zones[1],{zoneId:'neonforest',displayName:'Neon Forest',statusLabel:open?'OPEN':'NOT YET AVAILABLE',isOpen:open,cardImageId:'neonforest',sceneName:open?'HoloZone_NeonForest':null});
      assert.equal(r.storyFlags.holoZonesArcBuilt,open);
    }
  }
  const bad=await setup({storyFlags:{holoZonesArcBuilt:'true'}});
  await assert.rejects(()=>desktopAccountSnapshot.run({auth:{uid:bad},data:{schemaVersion:'desktop-account-3'}}),e=>e.code==='unavailable');
});
