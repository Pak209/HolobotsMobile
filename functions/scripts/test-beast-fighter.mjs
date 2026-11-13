// beast-fighter-1 (Pak 2026-11-11, ~/HolobotsVault/QA/2026-11-11-lite-ui-critic/BEAST_FIGHTER_SPEC.md): the Error Beast fighter slot,
// server copy. Pins the spec's literal rows, the lookup rules, the issue gate (a beast is only ever an opponent; only the live Guild
// Court passes one), and the spec 5.6 cross-check vector the phone pins (plus the same vector with the live-tuning-1 values).
import test from 'node:test';
import assert from 'node:assert/strict';
import { F, buildFightReplayIssue, verifyFightReplay, recordFightLog, combatant } from './lib/fight-replay-helpers.mjs';

const ACE = { id: 'ace', side: 0, maxHp: 178, hp: 178, attack: 87, defense: 72, startStaminaPm: 1000, startSync: 0, startXMm: -3500, startZMm: 0, radiusMm: 300,
  primaryReachMm: 4000, reachLightMm: 1500, reachHeavyMm: 4000, reachSpecialMm: 8000, runMmPerSec: 3200, strafeMmPerSec: 600, backMmPerSec: 600,
  backstepMm: 750, backstepTicks: 17, sidestepMm: 750, sidestepTicks: 17, forwardJumpMm: 900, forwardJumpTicks: 31, hitLightTicks: 14, hitHeavyTicks: 29, speed: 87, special: 72 };
const BEAST = { id: 'cpu-cacheback', side: 1, maxHp: 240, hp: 240, attack: 62, defense: 48, startStaminaPm: 1000, startSync: 0, startXMm: 3500, startZMm: 0, radiusMm: 300,
  primaryReachMm: 4000, reachLightMm: 1500, reachHeavyMm: 4500, reachSpecialMm: 6000, runMmPerSec: 1700, strafeMmPerSec: 420, backMmPerSec: 400,
  backstepMm: 450, backstepTicks: 28, sidestepMm: 450, sidestepTicks: 28, forwardJumpMm: 1500, forwardJumpTicks: 36, hitLightTicks: 11, hitHeavyTicks: 22, speed: 40, special: 0 };

function vector({ startSync = 0, specialOpenPm } = {}) {
  const rules = { ...F.defaultRulesValues(), hpScaleLights: 17, fighters: [{ ...ACE, startSync }, { ...BEAST, startSync }] };
  const chase = F.defaultChaseRules(), attrs = { ...F.defaultAttrRules(), ...(specialOpenPm ? { specialOpenPm } : {}) }, tempo = F.defaultTempoRules();
  const rulesHash = F.rulesHash(rules, chase, attrs, tempo);
  const r = F.runFight(rules, 'b'.repeat(64),
    { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile('wolf')), skill: F.issuedSkill('Rookie') },
    { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile('beast_bruiser')), skill: F.issuedSkill('Rookie') },
    { recordEvents: false, chase, attrs, tempo });
  return { rulesHash, initialHash: r.initialHash, finalHash: r.finalHash, winner: r.winner, endTick: r.endTick, reason: r.reason };
}

test('spec 3: kitFighter(cacheback) is the beast_bruiser row with def id = the beast id; ids and lookups per the spec', () => {
  assert.deepEqual(F.kitFighter('cacheback'), { id: 'cacheback', side: 0, maxHp: 1000, hp: 1000, attack: 100, defense: 50, startStaminaPm: 1000, startSync: 0,
    startXMm: 0, startZMm: 0, radiusMm: 300, primaryReachMm: 4000, reachLightMm: 1500, reachHeavyMm: 4500, reachSpecialMm: 6000,
    runMmPerSec: 1700, strafeMmPerSec: 420, backMmPerSec: 400, backstepMm: 450, backstepTicks: 28, sidestepMm: 450,
    sidestepTicks: 28, forwardJumpMm: 1500, forwardJumpTicks: 36, hitLightTicks: 11, hitHeavyTicks: 22 });
  assert.throws(() => F.kitFighter('beast_bruiser'), /unknown_bot/, 'an archetype id is not a fighter');
  assert.throws(() => F.kitFighter('scrapling'), /unknown_bot/);
  assert.deepEqual(F.BEAST_ARCHETYPES, { cacheback: 'beast_bruiser' });
  assert.deepEqual([...F.BEAST_IDS], ['cacheback']); assert.deepEqual([...F.BEAST_ARCHETYPE_IDS], ['beast_bruiser']);
  assert.equal(F.isBeastId('cacheback'), true); assert.equal(F.isBeastId('beast_bruiser'), false); assert.equal(F.isBeastId('wolf'), false);
  assert.equal(F.beastArchetype('cacheback'), 'beast_bruiser'); assert.equal(F.beastArchetype('wolf'), null); assert.equal(F.beastArchetype('beast_bruiser'), null);
  assert.equal(F.KIT_IDS.length, 13); assert.equal(F.KIT_IDS.includes('cacheback'), false);
  assert.deepEqual([...F.FIGHT_KIT_IDS], [...F.KIT_IDS, 'cacheback']);
  assert.equal(F.kitFighter('wolf').reachLightMm, 4000, 'Holobot rows unchanged');
});

test('spec 4: the beast_bruiser profile row, issued per-mille row, lookups; the 13-row parity table is untouched', () => {
  assert.deepEqual(F.issuedProfile(F.brainProfile('beast_bruiser')), { id: 'beast_bruiser', aggressionPmPerSec: 500, engageMinStaminaPm: 600, preferredBand: 3, preferredBandOffsetMm: 0,
    chainMeanMilli: 2000, heavyRatioPm: 550, feintRatePm: 30, guardRatePm: 300, counterRatePm: 200, breakAtStaminaPm: 350,
    circleBiasPm: 150, shoveRatePm: 300, specialPolicy: 2, beatSharePm: 100, burstInPm: 400, lowHpRiskPm: 1300,
    escapeRatePm: 0, chargeSharePm: 500 });
  assert.equal(F.brainProfile('beast_bruiser').style, 'error beast bruiser');
  assert.equal(F.profileIsValid(F.brainProfile('beast_bruiser')), null);
  assert.throws(() => F.brainProfile('cacheback'), /unknown_profile:cacheback/, 'a beast id is not a profile id');
  assert.equal(F.allBrainProfiles().length, 13); assert.equal(F.PROFILE_ROSTER_IDS.length, 13); assert.equal(F.PROFILES_VERSION, 2);
  assert.deepEqual([...F.BEAST_PROFILE_IDS], ['beast_bruiser']);
  assert.equal(F.allBrainProfiles().some(p => p.id === 'beast_bruiser'), false);
  assert.equal(F.brainFromIssued(F.issuedProfile(F.brainProfile('beast_bruiser'))).style, 'error beast bruiser');
});

test('spec 5.6: the cross-check vector reproduces on the server (exact spec inputs)', () => {
  assert.deepEqual(vector(), {
    rulesHash: '047c6e620db164589c5eab6bc856ca5311923209f6eb82dd1a2779792e12492a',
    initialHash: '35a86516039b5f9dd0d8ff34ba30e14994003a6fe1b2cee1471a8fabf5e6d53b',
    finalHash: '0fc0e0e72e31d4414ff0ec4e92c6c26b1a5695159bd325fdff84572c8ce7b729',
    winner: 0, endTick: 820, reason: 'ko',
  });
});

test('spec 5.6 + live-tuning-1: the same vector with the newly issued live value (specialOpenPm 2000; start SYNC stays 0)', () => {
  const v = vector({ specialOpenPm: 2000 });
  console.log('# live vector ' + JSON.stringify(v));
  assert.deepEqual(v, LIVE_VECTOR);
});

const court = (extra = {}) => buildFightReplayIssue({ battleId: 'hz_court', seed: 'c'.repeat(64), tier: 0, mentor: false, chase: true, attrs: true, tempo: true, live: true,
  player: [{ ...combatant('ace', 178, 87, 72), level: 21, speed: 87, intelligence: 72 }],
  opponent: [{ holobotId: 'cacheback', level: 22, maxHealth: 240, currentHealth: 240, attack: 62, defense: 48, speed: 40 }], ...extra });

test('spec 5.1 / 5.7: a court-shaped beast issue: fighter cpu-cacheback, roster + cpu profile beast_bruiser, kit = archetype row; it verifies', () => {
  const issue = court();
  assert.ok(issue);
  assert.deepEqual(issue.cpu.roster, [{ fighterId: 'cpu-cacheback', holobotId: 'cacheback', profile: 'beast_bruiser' }]);
  assert.deepEqual(issue.cpu.profile, F.issuedProfile(F.brainProfile('beast_bruiser')));
  const cpu = issue.rules.fighters.find(f => f.side === 1);
  assert.equal(cpu.id, 'cpu-cacheback');
  for (const k of ['reachLightMm', 'reachHeavyMm', 'reachSpecialMm', 'primaryReachMm', 'runMmPerSec', 'backstepTicks', 'forwardJumpMm', 'hitLightTicks', 'hitHeavyTicks'])
    assert.equal(cpu[k], F.kitFighter('cacheback')[k], k);
  assert.deepEqual([cpu.maxHp, cpu.hp, cpu.attack, cpu.defense, cpu.speed, cpu.special], [240, 240, 62, 48, 40, 0], 'stats from the run, no fight-row delta, special 0');
  const v = verifyFightReplay(issue, recordFightLog(issue, { read: () => F.toInput(F.idleRecord()) }).wire, { battleId: 'hz_court' });
  assert.equal(v.receipt.winner, 'opponent', 'an idle player loses to the beast brain (the archetype profile drives it)');
  // Holobot opponents are byte-identical to the pre-slot issue shape (profileOf(id) === id)
  const wolf = court({ opponent: [{ holobotId: 'wolf', level: 22, maxHealth: 240, currentHealth: 240, attack: 62, defense: 48, speed: 40 }] });
  assert.deepEqual(wolf.cpu.roster, [{ fighterId: 'cpu-wolf', holobotId: 'wolf', profile: 'wolf' }]);
});

test('spec 5.1 / 5.4: a beast is never a player fighter; an archetype id is never accepted as a fighter', () => {
  const base = { battleId: 'rb_x', seed: '0'.repeat(64), tier: 0, mentor: false };
  assert.equal(buildFightReplayIssue({ ...base, player: [combatant('cacheback')], opponent: [combatant('wolf')] }), null, 'beast as player');
  assert.equal(buildFightReplayIssue({ ...base, player: [combatant('ace')], opponent: [combatant('beast_bruiser')] }), null, 'archetype id as opponent');
  assert.ok(buildFightReplayIssue({ ...base, player: [combatant('ace')], opponent: [combatant('cacheback')] }), 'the builder itself accepts a beast opponent; callers gate it');
});

test('spec 5.4 gating: only the live Guild Court passes a beast id; rival, Arena and expedition sources never do', async () => {
  const fs = await import('node:fs');
  const src = p => fs.readFileSync(new URL('../src/' + p, import.meta.url), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.match(src('lib/holoZoneCourtLive.ts'), /holobotId: COURT_BEAST_ID/);
  const L = (await import('node:module')).createRequire(import.meta.url)('../lib/lib/holoZoneCourtLive.js');
  assert.equal(L.COURT_LIVE_BODY, 'cacheback');
  for (const p of ['arena/arenaMatchStore.ts', 'rival/rivalBattleStore.ts', 'holozone/expedition.ts'])
    assert.doesNotMatch(src(p), /cacheback|COURT_BEAST_ID|BEAST_ARCHETYPES/, p);
});

// The live-tuning-1 values the phone pins next to the spec vector (BEAST_FIGHTER_SPEC 5.6 inputs + specialOpenPm 2000, startSync 0).
// REPLACES the earlier startSync-50 vector (2a213691... / c3cf26a2... / de64d1e5..., tick 969), withdrawn with item 1.
const LIVE_VECTOR = {
  rulesHash: '9870c94732568a86c27e6eae70e688843898fb10e1d72b065cc2a42de5f0b1cc',
  initialHash: '274aa346e44906d8bf400e2232b3d7195281fa1ebef6c71503d8b9624d8520cd',
  finalHash: '2f8512cfa993162aadd7814347eb5aaf4dc92ce9e885de2630262a9e1af6501b',
  winner: 0, endTick: 1324, reason: 'ko',
};
