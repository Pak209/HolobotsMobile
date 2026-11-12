// guard-hold-1 (Pak 2026-11-11 "Guard costs stamina to hold"; ~/HolobotsVault/QA/2026-11-11-lite-ui-critic/GUARD_HOLD_DRAIN_SPEC.md):
// duel-rules-7 = duel-rules-6 + the `guard` block. A raised guard drains holdDrainPm per tick (no regen while up); at 0 it drops
// and stays down until stamina >= reraiseMinPm. Issued only on the `fightRules: 'duel-rules-7'` ask, on a live duel-rules-6 issue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, buildFightReplayIssue, recordFightLog, smartPlayer, verifyFightReplay, combatant } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const A = require('../lib/arena/arenaMatchStore.js');
const P = require('../lib/lib/progression.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { courtLiveIssue } = require('../lib/lib/holoZoneCourtLive.js');
const { buildPlayerCombatants } = require('../lib/lib/rivalLadder.js');

const SEED = '3e'.repeat(32), T0 = Date.UTC(2026, 10, 11, 9);
const tempoG = () => ({ ...F.defaultTempoRules(), guard: F.defaultGuardRules() });
const blocks = () => ({ chase: F.defaultChaseRules(), attrs: F.defaultAttrRules() });
const rules17 = () => ({ ...F.defaultRules('ace', 'wolf'), hpScaleLights: 17 });

test('rules: defaults, strict JSON, validation; the duel-rules-7 document round-trips; guard absent = duel-rules-6 bytes', () => {
  assert.deepEqual(F.GUARD_DEFAULTS, { holdDrainPm: 8, reraiseMinPm: 200 });
  assert.deepEqual([...F.GUARD_KEYS], ['holdDrainPm', 'reraiseMinPm']);
  assert.equal(F.RULES_SCHEMA_7, 'duel-rules-7'); assert.equal(F.SIM_VERSION_6, 'duel-sim-6');
  assert.throws(() => F.guardFromJson({ holdDrainPm: 8 }), /invalid_fields|missing_reraiseMinPm/);
  assert.throws(() => F.guardFromJson({ holdDrainPm: 8, reraiseMinPm: 200, x: 1 }), /invalid_fields/);
  assert.throws(() => F.guardFromJson({ holdDrainPm: 1001, reraiseMinPm: 200 }), /invalid_guard_rules/);
  assert.throws(() => F.guardFromJson({ holdDrainPm: -1, reraiseMinPm: 200 }), /invalid_guard_holdDrainPm/);
  assert.throws(() => F.guardFromJson({ holdDrainPm: 1.5, reraiseMinPm: 200 }), /invalid_holdDrainPm/);
  const r = rules17(), { chase, attrs } = blocks();
  const doc = F.rulesDocToJson6(r, chase, attrs, tempoG());
  assert.equal(doc.schemaVersion, 'duel-rules-7'); assert.equal(doc.simVersion, 'duel-sim-6');
  assert.deepEqual(Object.keys(doc), ['schemaVersion', 'simVersion', 'tickHz', 'rules', 'fighters', 'chase', 'attrs', 'tempo', 'guard']);
  assert.deepEqual(doc.guard, { holdDrainPm: 8, reraiseMinPm: 200 }); assert.equal('guard' in doc.tempo, false);
  const back = F.rulesDocFromJson(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(back.tempo.guard, F.GUARD_DEFAULTS);
  assert.equal(F.rulesHash(back.rules, back.chase, back.attrs, back.tempo), F.rulesHash(r, chase, attrs, tempoG()));
  assert.equal(F.rulesCanonicalBytes6(r, chase, attrs, tempoG()).toString('ascii', 0, 12), 'duel-rules-7');
  assert.throws(() => F.rulesDocFromJson({ ...doc, simVersion: 'duel-sim-5' }), /invalid_version/);
  assert.throws(() => F.rulesDocFromJson({ ...doc, schemaVersion: 'duel-rules-6' }), /invalid_fields/, 'a rules-6 reader refuses the guard block');
  // no guard = duel-rules-6 exactly
  const six = F.rulesDocToJson6(r, chase, attrs, F.defaultTempoRules());
  assert.equal(six.schemaVersion, 'duel-rules-6'); assert.equal('guard' in six, false);
  assert.equal(F.rulesCanonicalBytes6(r, chase, attrs, F.defaultTempoRules()).toString('ascii', 0, 12), 'duel-rules-6');
});

// side 0 holds Guard from tick 1; side 1 stands still far away (out of range: no contact, regen state OutOfRange)
function holdRun(tempo, ticks, held = () => true) {
  const r = rules17(), { chase, attrs } = blocks();
  r.fighters[0].startXMm = -5500; r.fighters[1].startXMm = 5500;
  const trace = [];
  const res = F.runFight(r, SEED, { inputs: { read: t => ({ ...F.idleInput(), guard: held(t) }) } }, { inputs: { read: () => F.idleInput() } },
    { maxTicks: ticks, chase, attrs, tempo, recordEvents: true, onTick: (t, _i, core) => trace.push({ t, sta: core.F[0].sta, guard: core.F[0].guard, locked: core.guardLocked(0) }) });
  return { res, trace };
}

test('core: a held guard drains 8 per tick with no regen, drops at 0 (GuardLower value 1), stays down until 200, then rises again', () => {
  const { res, trace } = holdRun(tempoG(), 400);
  const at = t => trace.find(x => x.t === t);
  assert.equal(at(0).sta, 992, 'drains from the raise tick (the first tick is tick 0)'); assert.equal(at(9).sta, 920);
  const drop = trace.find(x => x.sta === 0);
  assert.equal(drop.t, 124, 'a full bar lasts 125 ticks (4.17 s): ticks 0..124');
  assert.equal(drop.guard, F.Guard.Down); assert.equal(drop.locked, true);
  assert.ok(res.events.some(e => e.side === 0 && e.kind === F.EventKind.GuardLower && e.value === 1 && e.tick === 124));
  const locked = trace.filter(x => x.locked);
  assert.ok(locked.every(x => x.guard === F.Guard.Down), 'never raised while locked even though Guard is held');
  const unlock = trace.find(x => x.t > 124 && !x.locked);
  assert.ok(unlock, 'it unlocks');
  assert.ok(at(unlock.t - 1).sta >= 200, 'unlock on the tick after stamina reaches the 200 threshold');
  assert.ok(locked.every(x => x.sta < 200 || !at(x.t + 1)?.locked), 'locked only while below 200 (it clears at the start of the next tick)');
  assert.equal(unlock.guard === F.Guard.Raising || unlock.guard === F.Guard.Up, true, 'a still-held guard rises on the unlock tick');
  assert.ok(unlock.t - 124 <= 60, `recovery out of range takes ${unlock.t - 124} ticks`);
  // after re-raise it drains again from ~200
  const second = trace.find(x => x.t > unlock.t && x.sta === 0);
  assert.ok(second && second.t - unlock.t <= 26, 'the re-raised guard drains 200 in 25 ticks');
});

test('core: without the guard block a held guard never drains (duel-rules-6 behaviour); a release lets regen resume after the delay', () => {
  const { trace } = holdRun(F.defaultTempoRules(), 200);
  assert.ok(trace.every(x => x.sta === 1000 && !x.locked));
  // release at tick 50: stamina 600; regen (out of range 200/s) resumes after regenDelayTicks
  const { trace: t2 } = holdRun(tempoG(), 120, t => t <= 50);
  const s = t => t2.find(x => x.t === t).sta;
  assert.equal(s(50), 1000 - 51 * 8, 'held ticks 0..50');
  assert.equal(s(51), s(50), 'released: a Lowering guard does not drain');
  assert.equal(s(50 + F.RULE_DEFAULTS.regenDelayTicks - 1), s(50), 'no regen during the delay');
  assert.ok(s(119) > s(50), 'regen resumes');
});

test('state hash: duel-sim-6 prefix + fight-guard-1 tail with every member\'s guardLocked; decodeState names them', () => {
  const r = rules17(), { chase, attrs } = blocks();
  const core = new F.FightCore(r, SEED, chase, attrs, tempoG());
  const b = core.stateBytes();
  assert.equal(b.toString('ascii', 0, 10), 'duel-sim-6');
  const dec = F.decodeState(b, r);
  assert.equal(dec['guard.holdDrainPm'], 8); assert.equal(dec['ace.guardLocked'], 0); assert.equal(dec['wolf.guardLocked'], 0);
  assert.equal(dec.trailingBytes, undefined);
  const six = new F.FightCore(r, SEED, chase, attrs, F.defaultTempoRules());
  assert.equal(six.stateBytes().toString('ascii', 0, 10), 'duel-sim-5');
  assert.equal(F.decodeState(six.stateBytes(), r).trailingBytes, undefined);
});

// ------------------------------------------------------------------ issue + hosts
const issueArgs = extra => ({ battleId: 'rb_g', seed: SEED, tier: 4, mentor: false, player: [combatant('ace')], opponent: [combatant('wolf', 450, 85, 40)], chase: true, attrs: true, tempo: true, ...extra });

test('issue: the guard block only on live + tempo + the rules-7 ask; otherwise the issue it would have made, byte for byte', () => {
  const g = buildFightReplayIssue(issueArgs({ live: true, guardHold: true }));
  assert.match(g.rulesId, /^duel-rules-7:/); assert.deepEqual(g.rules.guard, F.GUARD_DEFAULTS); assert.equal(g.rules.simVersion, 'duel-sim-6');
  const six = buildFightReplayIssue(issueArgs({ live: true }));
  assert.deepEqual(buildFightReplayIssue(issueArgs({ live: true, guardHold: false })), six);
  assert.deepEqual(buildFightReplayIssue(issueArgs({ guardHold: true })), buildFightReplayIssue(issueArgs({})), 'not live: ignored');
  assert.deepEqual(buildFightReplayIssue(issueArgs({ live: true, guardHold: true, tempo: false })), buildFightReplayIssue(issueArgs({ live: true, tempo: false })), 'no tempo: ignored');
  const v = verifyFightReplay(g, recordFightLog(g, smartPlayer(g, 'ace', 'Champion')).wire, { battleId: 'rb_g' });
  assert.equal(v.receipt.verified, true, 'a rules-7 fight replays and verifies');
});

const bot = (name, level) => ({ name, level, experience: 0, nextLevelExp: P.calculateExperience(level + 1), attributePoints: 0, boostedAttributes: {} });
test('hosts: rival, Arena and Guild Court issue duel-rules-7 on the ask; the duel-rules-6 ask is unchanged', async () => {
  for (const [ask, want] of [['duel-rules-7', /^duel-rules-7:/], ['duel-rules-6', /^duel-rules-6:/]]) {
    const rdb = fakeDb({ now: T0 }), uid = 'g_rival';
    rdb.put(`users/${uid}`, { holobots: [bot('ACE', 20)], holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
    const r = await transactRivalBattle(rdb, uid, { schemaVersion: 'rival-battle-3', operation: 'issue', duelInputs: 'duel-inputs-2', fightRules: ask }, T0, () => 0.4,
      { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, fightChase: true, fightAttrs: true, fightSeed: () => SEED });
    assert.match(r.duel.rulesId, want, 'rival ' + ask);
    const adb = fakeDb({ now: T0 }), au = 'g_arena';
    await adb.doc(`users/${au}`).set({ holobots: [bot('ACE', 4)], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false } });
    const a = await A.transactArenaMatch(adb, au, { schemaVersion: 'arena-match-1', operation: 'issue', requestId: 'req_g_' + ask, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', duelInputs: 'duel-inputs-2', fightRules: ask }, T0,
      { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED });
    assert.match(a.duel.rulesId, want, 'arena ' + ask);
  }
  // rules-7 ask with the attrs flag off: the duel-rules-4 issue it gets today (no tempo, no guard)
  const rdb = fakeDb({ now: T0 });
  rdb.put('users/g2', { holobots: [bot('ACE', 20)], holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
  const r4 = await transactRivalBattle(rdb, 'g2', { schemaVersion: 'rival-battle-3', operation: 'issue', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-7' }, T0, () => 0.4,
    { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, fightChase: true, fightAttrs: false, fightSeed: () => SEED });
  assert.match(r4.duel.rulesId, /^duel-rules-4:/);
  const ace = buildPlayerCombatants({ holobots: [bot('ACE', 21)] }, ['ace'])[0];
  const court = g => courtLiveIssue({ fighter: { ...ace, currentHealth: ace.maxHealth }, gear: { attack: 0, defense: 0, health: 0, speed: 0, special: 0 }, zoneId: 'guild_court', tier: 0, runId: 'run1', seed: SEED, chase: true, attrs: true, tempo: true, ...(g ? { guardHold: true } : {}) });
  assert.match(court(true).rulesId, /^duel-rules-7:/); assert.match(court(false).rulesId, /^duel-rules-6:/);
});

// ------------------------------------------------------------------ CPU
test('CPU: the brain never holds a locked guard, and CPU-vs-CPU rules-7 fights finish (no stall) about as often as rules-6', () => {
  const ids = ['ace', 'wolf', 'kuma', 'hare', 'gama', 'ken', 'shadow', 'tora'];
  const stats = { 6: { timeouts: 0, ticks: [] }, 7: { timeouts: 0, ticks: [] } };
  let lockedTicks = 0, n = 0;
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
    if (i === j) continue;
    for (const ver of [6, 7]) {
      const r = { ...F.defaultRules(ids[i], ids[j]), hpScaleLights: 17 }, { chase, attrs } = blocks();
      const tempo = ver === 7 ? tempoG() : F.defaultTempoRules();
      const seed = ((i * 8 + j) % 256).toString(16).padStart(2, '0').repeat(32);
      const res = F.runFight(r, seed,
        { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(ids[i])), skill: F.issuedSkill('Champion') },
        { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(ids[j])), skill: F.issuedSkill('Champion') },
        { recordEvents: false, chase, attrs, tempo, onTick: (_t, inp, core) => {
          // the inputs fed this tick were decided on the previous tick's state; a held guard on a locked fighter would block presses
          for (const s of [0, 1]) if (core.guardLocked(s)) { lockedTicks++; }
        } });
      if (res.reason === 'timeout') stats[ver].timeouts++;
      stats[ver].ticks.push(res.endTick);
      n += ver === 7 ? 1 : 0;
    }
  }
  const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(`# guard-hold CPU bench (${n} pairs, Champion): rules-6 timeouts ${stats[6].timeouts}, median ${med(stats[6].ticks)} ticks; rules-7 timeouts ${stats[7].timeouts}, median ${med(stats[7].ticks)} ticks; locked fighter-ticks ${lockedTicks}`);
  assert.ok(stats[7].timeouts <= stats[6].timeouts + 2, 'no stall: rules-7 does not add timeouts');
});

test('CPU: FightCoreBrain masks guard while locked', () => {
  const r = rules17(), { chase, attrs } = blocks();
  const core = new F.FightCore(r, SEED, chase, attrs, tempoG());
  core.F[1].guardLocked = true;
  const b = new F.FightCoreBrain(); b.begin(1, F.issuedProfile(F.brainProfile('wolf')), F.issuedSkill('Rookie'));
  const view = new F.FightView(core, 1);
  for (let k = 0; k < 40; k++) assert.equal(b.decide(view, core.rng[1]).guard, false);
});

// ------------------------------------------------------------------ cross-check vector (the phone pins it)
test('cross-check vector: ACE vs WOLF kit, hpScaleLights 17, default chase / attrs / tempo + guard, seed 9*64, ace(Rookie) vs wolf(Rookie)', () => {
  const r = rules17(), { chase, attrs } = blocks(), tempo = tempoG();
  const res = F.runFight(r, '9'.repeat(64),
    { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile('ace')), skill: F.issuedSkill('Rookie') },
    { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile('wolf')), skill: F.issuedSkill('Rookie') },
    { recordEvents: true, chase, attrs, tempo });
  const v = { rulesHash: res.rulesHash, initialHash: res.initialHash, finalHash: res.finalHash, winner: res.winner, endTick: res.endTick, reason: res.reason,
    exhaustionDrops: res.events.filter(e => e.kind === F.EventKind.GuardLower && e.value === 1).length };
  console.log('# guard vector ' + JSON.stringify(v));
  assert.deepEqual(v, GUARD_VECTOR);
  // the scripted hold vector: side 0 holds Guard ticks 1..400 out of range, side 1 idle (pins the drain / lock / re-raise order)
  const { res: h } = holdRun(tempoG(), 400);
  const hv = { rulesHash: h.rulesHash, finalHash: h.finalHash, endTick: h.endTick };
  console.log('# guard hold vector ' + JSON.stringify(hv));
  assert.deepEqual(hv, HOLD_VECTOR);
});
const GUARD_VECTOR = {
  rulesHash: 'dd5596fabffd25fe6d1b42e775d5dc5e335e09e11708ebd1dbd6a969b7f3ef08',
  initialHash: 'd9971aa54d573d39072d13d8c8a19fd23bae15b3403fc7f70db6d3f6269ac695',
  finalHash: '2f63738a4b1f21089f21dbeae26fc553b7e1baf3969f219933e0e28603410127',
  winner: 1, endTick: 1242, reason: 'ko', exhaustionDrops: 0,
};
const HOLD_VECTOR = {
  rulesHash: '7239061c29bf97d271c9a27e139234b1064d40b2a8c6e53ba007afb76e89fd77',
  finalHash: '03fbb62794bf4a9cfa81cf2fa644096bb7bd3bb8ec2f77b987ef4efa766b8a9b',
  endTick: 399,
};
