// stamina-wind-1 (owner 2026-11-12: "winded", chosen over a plain refill bump): duel-rules-8 = duel-rules-7 + the `stamina` block.
// A fighter whose stamina reaches 0 (any spend, the guard hold drain, a block drain) is winded: regen = max(range rate,
// windRegenPmPerSec) after the unchanged 12-tick delay, until stamina >= windExitPm. No regen while chased (duel-rules-4) is kept;
// tired-light damage is unchanged. Issued only on the `fightRules: 'duel-rules-8'` ask, on a live issue that carries the guard block.
// Also pins the server-generated golden log the phone replays (ringduelRules8Parity.test.ts):
//   WRITE_GOLDEN=1 node --test scripts/test-stamina-wind.mjs   rewrites scripts/fixtures/stamina-wind-golden-rules8.json
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, buildFightReplayIssue, recordFightLog, smartPlayer, verifyFightReplay, combatant } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const A = require('../lib/arena/arenaMatchStore.js');
const P = require('../lib/lib/progression.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { courtLiveIssue } = require('../lib/lib/holoZoneCourtLive.js');
const { buildPlayerCombatants } = require('../lib/lib/rivalLadder.js');
const { cpuIssueProfile } = require('../lib/rival/fightReplayIssue.js');

const SEED = '3e'.repeat(32), T0 = Date.UTC(2026, 10, 12, 9);
const tempo7 = () => ({ ...F.defaultTempoRules(), guard: F.defaultGuardRules() });
const tempo8 = () => ({ ...tempo7(), stamina: F.defaultStaminaRules() });
const blocks = () => ({ chase: F.defaultChaseRules(), attrs: F.defaultAttrRules() });
const rules17 = (gap = 7000) => ({ ...F.defaultRules('ace', 'wolf', gap), hpScaleLights: 17 });

test('rules: defaults, strict JSON, validation; the duel-rules-8 document round-trips; stamina absent = duel-rules-7 bytes', () => {
  assert.deepEqual(F.STAMINA_DEFAULTS, { windRegenPmPerSec: 240, windExitPm: 300 });
  assert.deepEqual([...F.STAMINA_KEYS], ['windRegenPmPerSec', 'windExitPm']);
  assert.equal(F.RULES_SCHEMA_8, 'duel-rules-8'); assert.equal(F.SIM_VERSION_7, 'duel-sim-7');
  assert.throws(() => F.staminaFromJson({ windRegenPmPerSec: 240 }), /invalid_fields|missing_windExitPm/);
  assert.throws(() => F.staminaFromJson({ windRegenPmPerSec: 240, windExitPm: 300, x: 1 }), /invalid_fields/);
  assert.throws(() => F.staminaFromJson({ windRegenPmPerSec: 1001, windExitPm: 300 }), /invalid_stamina_rules/);
  assert.throws(() => F.staminaFromJson({ windRegenPmPerSec: -1, windExitPm: 300 }), /invalid_stamina_windRegenPmPerSec/);
  assert.throws(() => F.staminaFromJson({ windRegenPmPerSec: 2.5, windExitPm: 300 }), /invalid_windRegenPmPerSec/);
  const r = rules17(), { chase, attrs } = blocks();
  const doc = F.rulesDocToJson6(r, chase, attrs, tempo8());
  assert.equal(doc.schemaVersion, 'duel-rules-8'); assert.equal(doc.simVersion, 'duel-sim-7');
  assert.deepEqual(Object.keys(doc), ['schemaVersion', 'simVersion', 'tickHz', 'rules', 'fighters', 'chase', 'attrs', 'tempo', 'guard', 'stamina']);
  assert.deepEqual(doc.stamina, F.STAMINA_DEFAULTS); assert.equal('stamina' in doc.tempo, false); assert.equal('stamina' in doc.guard, false);
  const back = F.rulesDocFromJson(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(back.tempo.stamina, F.STAMINA_DEFAULTS); assert.deepEqual(back.tempo.guard, F.GUARD_DEFAULTS);
  assert.equal(F.rulesHash(back.rules, back.chase, back.attrs, back.tempo), F.rulesHash(r, chase, attrs, tempo8()));
  assert.equal(F.rulesCanonicalBytes6(r, chase, attrs, tempo8()).toString('ascii', 0, 12), 'duel-rules-8');
  assert.throws(() => F.rulesDocFromJson({ ...doc, simVersion: 'duel-sim-6' }), /invalid_version/);
  assert.throws(() => F.rulesDocFromJson({ ...doc, schemaVersion: 'duel-rules-7' }), /invalid_fields/, 'a rules-7 reader refuses the stamina block');
  const { guard: _g, ...noGuard } = doc;
  assert.throws(() => F.rulesDocFromJson(noGuard), /invalid_fields/);
  // stamina without guard is not a document
  assert.throws(() => F.rulesDocToJson6(r, chase, attrs, { ...F.defaultTempoRules(), stamina: F.defaultStaminaRules() }), /invalid_stamina_without_guard/);
  assert.throws(() => F.rulesHash(r, chase, attrs, { ...F.defaultTempoRules(), stamina: F.defaultStaminaRules() }), /invalid_stamina_without_guard/);
  assert.throws(() => new F.FightCore(r, SEED, chase, attrs, { ...F.defaultTempoRules(), stamina: F.defaultStaminaRules() }), /invalid_stamina_without_guard/);
  // no stamina = duel-rules-7 exactly (the rules-7 vector in test-guard-hold.mjs pins the same hash)
  const seven = F.rulesDocToJson6(r, chase, attrs, tempo7());
  assert.equal(seven.schemaVersion, 'duel-rules-7'); assert.equal('stamina' in seven, false);
  assert.equal(F.rulesHash(r, chase, attrs, tempo7()), 'dd5596fabffd25fe6d1b42e775d5dc5e335e09e11708ebd1dbd6a969b7f3ef08');
});

// side 0 holds Guard for ticks 0..holdTo (drains 8/tick: a full bar is gone at tick 124), side 1 idle; `gap` sets the range
function windRun(tempo, { gap = 1200, ticks = 260, holdTo = 124 } = {}) {
  const r = rules17(gap), { chase, attrs } = blocks();
  const trace = [];
  const res = F.runFight(r, SEED, { inputs: { read: t => ({ ...F.idleInput(), guard: t <= holdTo }) } }, { inputs: { read: () => F.idleInput() } },
    { maxTicks: ticks, chase, attrs, tempo, recordEvents: true,
      onTick: (t, _i, core) => trace.push({ t, sta: core.F[0].sta, guard: core.F[0].guard, locked: core.guardLocked(0), winded: core.winded(0), state: core.F[0].state }) });
  return { res, trace, at: t => trace.find(x => x.t === t) };
}

test('core: standing still up close from 0, the guard is back at 1.2 s and winded ends at 300 at 1.6 s (rules-7: 20 s)', () => {
  const { trace, at } = windRun(tempo8());
  assert.equal(at(124).sta, 0); assert.equal(at(124).winded, true, 'the guard drain to 0 winds'); assert.equal(at(123).winded, false);
  assert.equal(at(130).state, F.State.CloseRange, 'up close: the range rate is regenClosePmPerSec (10)');
  assert.equal(at(135).sta, 0, 'the 12-tick regen delay is unchanged (ticks 125..135)');
  assert.equal(at(136).sta, 8, '240 per second = 8 per tick');
  const back200 = trace.find(x => x.t > 124 && x.sta >= 200), unlock = trace.find(x => x.t > 124 && !x.locked), exit = trace.find(x => x.t > 124 && !x.winded);
  assert.equal(back200.t, 160);
  assert.equal(unlock.t, 161, 'the guard unlocks at the start of the next tick');
  assert.equal(unlock.t - 124, 37, `guard back after ${unlock.t - 124} ticks = ${((unlock.t - 124) / 30).toFixed(2)} s`);
  assert.equal(exit.t, 173); assert.equal(at(173).sta, 304); assert.equal(at(172).sta, 296);
  assert.equal(exit.t - 124, 49, `winded ends after ${exit.t - 124} ticks = ${((exit.t - 124) / 30).toFixed(2)} s`);
  assert.ok(at(180).sta - at(174).sta <= 3, 'after winded ends the close range rate is back (10/s)');
  // rules-7, same scenario: still locked 20 s later at 10 per second
  const seven = windRun(tempo7(), { ticks: 600 });
  assert.equal(seven.at(599).locked, true); assert.ok(seven.at(599).sta < 200);
  assert.equal(seven.trace.every(x => x.winded === false), true, 'no winded state without the stamina block');
  // out of range (rate 200 < 240): the floor still applies
  const far = windRun(tempo8(), { gap: 11000 });
  assert.equal(far.at(124).sta, 0); assert.equal(far.trace.find(x => x.t > 124 && !x.locked).t, 161);
});

test('core: light spam while winded still drains (about 8 ticks of regen per ~20-tick light cycle: +64 against 80)', () => {
  const r = rules17(1200), { chase, attrs } = blocks();
  r.fighters[0].startStaminaPm = 80;   // the first light spends to exactly 0
  const sta = [], winded = [];
  let lights8 = 0;
  const res = F.runFight(r, SEED, { inputs: { read: () => ({ ...F.idleInput(), press: F.Press.Light }) } }, { inputs: { read: () => F.idleInput() } },
    { maxTicks: 400, chase, attrs, tempo: tempo8(), recordEvents: true, onTick: (t, _i, core) => { sta.push(core.F[0].sta); winded.push(core.winded(0)); } });
  lights8 = res.events.filter(e => e.side === 0 && e.kind === F.EventKind.Telegraph).length;
  assert.equal(sta[0], 0); assert.equal(winded[0], true);
  assert.ok(lights8 >= 15, `${lights8} lights in 400 ticks`);
  assert.ok(Math.max(...sta) < 100, `stamina never climbs: max ${Math.max(...sta)}`);
  assert.ok(winded.every(Boolean), 'winded the whole time: spam never reaches 300');
  // the cycle: the telegraphs are ~20 ticks apart, regen runs only after the 12-tick delay
  const tel = res.events.filter(e => e.side === 0 && e.kind === F.EventKind.Telegraph).map(e => e.tick);
  const cycle = tel[tel.length - 1] - tel[tel.length - 2];
  assert.ok(cycle >= 18 && cycle <= 24, `cycle ${cycle} ticks`);
  // tired-light damage is unchanged: the same inputs on rules-7 deal the same first-hit damage (emptyDamagePm)
  const dmg = tempo => {
    const rr = rules17(1200); rr.fighters[0].startStaminaPm = 80;
    const out = F.runFight(rr, SEED, { inputs: { read: () => ({ ...F.idleInput(), press: F.Press.Light }) } }, { inputs: { read: () => F.idleInput() } },
      { maxTicks: 40, chase, attrs, tempo, recordEvents: true });
    return out.events.find(e => e.side === 0 && e.kind === F.EventKind.Contact).value;
  };
  assert.equal(dmg(tempo8()), dmg(tempo7()));
});

test('core: no regen while chased, winded or not (duel-rules-4 rule kept); the block drain and a strike spend also wind', () => {
  const r = rules17(4000), { chase, attrs } = blocks();
  const core = new F.FightCore(r, SEED, chase, attrs, tempo8());
  core.F[0].sta = 0; core.F[0].winded = true;
  for (let k = 0; k < 90; k++) { core.chaseState[0].tagged = true; core.step(F.idleInput(), F.idleInput()); }
  assert.equal(core.F[0].sta, 0, 'tagged: no regen');
  // a block drain to 0 winds the blocker
  const r2 = rules17(1200), c2 = new F.FightCore(r2, SEED, chase, attrs, tempo8());
  c2.F[1].sta = 30;
  let blocked = false;
  for (let k = 0; k < 40 && !blocked; k++) {
    c2.step({ ...F.idleInput(), press: k === 8 ? F.Press.Light : F.Press.None }, { ...F.idleInput(), guard: true });
    blocked = c2.events.some(e => e.side === 0 && e.kind === F.EventKind.Contact);
  }
  assert.ok(blocked); assert.equal(c2.F[1].sta, 0); assert.equal(c2.winded(1), true);
});

test('state hash: duel-sim-7 prefix + fight-stamina-1 tail with every member\'s winded; decodeState names them', () => {
  const r = rules17(), { chase, attrs } = blocks();
  const core = new F.FightCore(r, SEED, chase, attrs, tempo8());
  const b = core.stateBytes();
  assert.equal(b.toString('ascii', 0, 10), 'duel-sim-7');
  const dec = F.decodeState(b, r);
  assert.equal(dec['stamina.windRegenPmPerSec'], 240); assert.equal(dec['stamina.windExitPm'], 300);
  assert.equal(dec['ace.winded'], 0); assert.equal(dec['wolf.winded'], 0); assert.equal(dec['ace.guardLocked'], 0);
  assert.equal(dec.trailingBytes, undefined);
  core.F[0].winded = true;
  assert.equal(F.decodeState(core.stateBytes(), r)['ace.winded'], 1);
  const seven = new F.FightCore(r, SEED, chase, attrs, tempo7());
  assert.equal(seven.stateBytes().toString('ascii', 0, 10), 'duel-sim-6');
  assert.equal(F.decodeState(seven.stateBytes(), r).trailingBytes, undefined);
});

// ------------------------------------------------------------------ issue + hosts
const issueArgs = extra => ({ battleId: 'rb_w', seed: SEED, tier: 4, mentor: false, player: [combatant('ace')], opponent: [combatant('wolf', 450, 85, 40)], chase: true, attrs: true, tempo: true, ...extra });

test('issue: the stamina block only on live + tempo + guard + the rules-8 ask; otherwise the issue it would have made, byte for byte', () => {
  const g = buildFightReplayIssue(issueArgs({ live: true, guardHold: true, staminaWind: true }));
  assert.match(g.rulesId, /^duel-rules-8:/); assert.deepEqual(g.rules.stamina, F.STAMINA_DEFAULTS); assert.deepEqual(g.rules.guard, F.GUARD_DEFAULTS);
  assert.equal(g.rules.simVersion, 'duel-sim-7');
  const seven = buildFightReplayIssue(issueArgs({ live: true, guardHold: true }));
  assert.match(seven.rulesId, /^duel-rules-7:/);
  assert.deepEqual(buildFightReplayIssue(issueArgs({ live: true, guardHold: true, staminaWind: false })), seven);
  assert.deepEqual(buildFightReplayIssue(issueArgs({ live: true, staminaWind: true })), buildFightReplayIssue(issueArgs({ live: true })), 'no guard: ignored');
  assert.deepEqual(buildFightReplayIssue(issueArgs({ staminaWind: true, guardHold: true })), buildFightReplayIssue(issueArgs({})), 'not live: ignored');
  assert.deepEqual(buildFightReplayIssue(issueArgs({ live: true, guardHold: true, staminaWind: true, tempo: false })), buildFightReplayIssue(issueArgs({ live: true, tempo: false })), 'no tempo: ignored');
  // everything but the rules document, its id and hash is the rules-7 issue (a WOLF lead: the CPU profile is the table row)
  const strip = i => { const { rules: _r, rulesId: _i, rulesHash: _h, ...rest } = i; return rest; };
  assert.deepEqual(strip(g), strip(seven));
  const v = verifyFightReplay(g, recordFightLog(g, smartPlayer(g, 'ace', 'Champion')).wire, { battleId: 'rb_w' });
  assert.equal(v.receipt.verified, true, 'a rules-8 fight replays and verifies');
  assert.equal(v.receipt.rulesId, g.rulesId);
});

const bot = (name, level) => ({ name, level, experience: 0, nextLevelExp: P.calculateExperience(level + 1), attributePoints: 0, boostedAttributes: {} });
test('hosts: rival, Arena and Guild Court issue duel-rules-8 on the ask; the duel-rules-7 / -6 asks are unchanged', async () => {
  for (const [ask, want] of [['duel-rules-8', /^duel-rules-8:/], ['duel-rules-7', /^duel-rules-7:/], ['duel-rules-6', /^duel-rules-6:/]]) {
    const rdb = fakeDb({ now: T0 }), uid = 'w_rival';
    rdb.put(`users/${uid}`, { holobots: [bot('ACE', 20)], holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
    const r = await transactRivalBattle(rdb, uid, { schemaVersion: 'rival-battle-3', operation: 'issue', duelInputs: 'duel-inputs-2', fightRules: ask }, T0, () => 0.4,
      { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, fightChase: true, fightAttrs: true, fightSeed: () => SEED });
    assert.match(r.duel.rulesId, want, 'rival ' + ask);
    const adb = fakeDb({ now: T0 }), au = 'w_arena';
    await adb.doc(`users/${au}`).set({ holobots: [bot('ACE', 4)], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false } });
    const a = await A.transactArenaMatch(adb, au, { schemaVersion: 'arena-match-1', operation: 'issue', requestId: 'req_w_' + ask, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', duelInputs: 'duel-inputs-2', fightRules: ask }, T0,
      { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED });
    assert.match(a.duel.rulesId, want, 'arena ' + ask);
  }
  // rules-8 ask with the attrs flag off: the duel-rules-4 issue it gets today (no tempo, no guard, no stamina)
  const rdb = fakeDb({ now: T0 });
  rdb.put('users/w2', { holobots: [bot('ACE', 20)], holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
  const r4 = await transactRivalBattle(rdb, 'w2', { schemaVersion: 'rival-battle-3', operation: 'issue', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-8' }, T0, () => 0.4,
    { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, fightChase: true, fightAttrs: false, fightSeed: () => SEED });
  assert.match(r4.duel.rulesId, /^duel-rules-4:/);
  const ace = buildPlayerCombatants({ holobots: [bot('ACE', 21)] }, ['ace'])[0];
  const court = extra => courtLiveIssue({ fighter: { ...ace, currentHealth: ace.maxHealth }, gear: { attack: 0, defense: 0, health: 0, speed: 0, special: 0 }, zoneId: 'guild_court', tier: 0, runId: 'run1', seed: SEED, chase: true, attrs: true, tempo: true, ...extra });
  assert.match(court({ guardHold: true, staminaWind: true }).rulesId, /^duel-rules-8:/); assert.match(court({ guardHold: true }).rulesId, /^duel-rules-7:/);
});

// ------------------------------------------------------------------ CPU
test('CPU: CPU-vs-CPU rules-8 fights finish (no stall) about as often as rules-7', () => {
  const ids = ['ace', 'wolf', 'kuma', 'hare', 'gama', 'ken', 'shadow', 'tora'];
  const stats = { 7: { timeouts: 0, ticks: [] }, 8: { timeouts: 0, ticks: [] } };
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
    if (i === j) continue;
    for (const ver of [7, 8]) {
      const r = { ...F.defaultRules(ids[i], ids[j]), hpScaleLights: 17 }, { chase, attrs } = blocks();
      const seed = ((i * 8 + j) % 256).toString(16).padStart(2, '0').repeat(32);
      const res = F.runFight(r, seed,
        { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(ids[i])), skill: F.issuedSkill('Champion') },
        { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(ids[j])), skill: F.issuedSkill('Champion') },
        { recordEvents: false, chase, attrs, tempo: ver === 8 ? tempo8() : tempo7() });
      if (res.reason === 'timeout') stats[ver].timeouts++;
      stats[ver].ticks.push(res.endTick);
    }
  }
  const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(`# stamina-wind CPU bench (56 pairs, Champion): rules-7 timeouts ${stats[7].timeouts}, median ${med(stats[7].ticks)} ticks; rules-8 timeouts ${stats[8].timeouts}, median ${med(stats[8].ticks)} ticks`);
  assert.ok(stats[8].timeouts <= stats[7].timeouts + 2);
});

// ------------------------------------------------------------------ cross-check vectors (the phone pins them)
test('cross-check vectors: CPU vs CPU and the scripted wind run under duel-rules-8', () => {
  const r = rules17(), { chase, attrs } = blocks();
  const res = F.runFight(r, '9'.repeat(64),
    { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile('ace')), skill: F.issuedSkill('Rookie') },
    { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile('wolf')), skill: F.issuedSkill('Rookie') },
    { recordEvents: true, chase, attrs, tempo: tempo8() });
  const v = { rulesHash: res.rulesHash, initialHash: res.initialHash, finalHash: res.finalHash, winner: res.winner, endTick: res.endTick, reason: res.reason };
  console.log('# stamina vector ' + JSON.stringify(v));
  assert.deepEqual(v, STAMINA_VECTOR);
  const { res: w } = windRun(tempo8());
  const wv = { rulesHash: w.rulesHash, finalHash: w.finalHash, endTick: w.endTick };
  console.log('# stamina wind vector ' + JSON.stringify(wv));
  assert.deepEqual(wv, WIND_VECTOR);
});
const STAMINA_VECTOR = {
  rulesHash: 'e35f62ae38f3dbc99629914f4770ca9e3b12a5547fd52a367d4f737ed1120166',
  initialHash: '7b4c47f4470d20297c94edc39df03d6c1d94bc265f4dc2145e349944bbc2a7fd',
  // cpu-stamina-8 (2026-11-12): re-pinned for the rules-8 brain economy + incoming-strike follow-up (was 2e9702c1... / endTick 1242)
  finalHash: '762dc5050881295b3f6deac4a54c6d837ddf2872a84516c66bad53dabe7affe8',
  winner: 0, endTick: 1272, reason: 'ko',
};
const WIND_VECTOR = {
  rulesHash: 'd7138d13c4c6d3167c99e9a130aae852a65044ce4abc0a0a5792625f75de1c14',
  finalHash: '6b1adda989860b6c1b20fd691e85d0accff38e6942361ef0a1d2800100ea51de',
  endTick: 259,
};

// ------------------------------------------------------------------ the phone's golden log (a GAMA-led rules-8 issue: the tuned CPU row)
const GOLDEN = new URL('./fixtures/stamina-wind-golden-rules8.json', import.meta.url);
function goldenCase() {
  const input = { battleId: 'rb_stamina_wind_golden', seed: '5d'.repeat(32), tier: 4, mentor: false, chase: true, attrs: true, tempo: true, live: true, guardHold: true, staminaWind: true,
    player: [combatant('ace', 480, 90, 45)], opponent: [combatant('gama', 450, 85, 40)] };
  const issue = buildFightReplayIssue(input);
  const log = recordFightLog(issue, smartPlayer(issue, 'ace', 'Champion')).wire;
  const receipt = verifyFightReplay(issue, log, { battleId: input.battleId }).receipt;
  return { note: 'stamina-wind-1: duel-rules-8 golden (ACE smartPlayer Champion vs a GAMA-led CPU on the tuned issue profile), generated by functions/scripts/test-stamina-wind.mjs', input, issue, log, receipt };
}
test('golden log: a GAMA-led duel-rules-8 fight; winded happens; the fixture the phone replays is reproduced byte for byte', () => {
  const c = goldenCase();
  assert.match(c.issue.rulesId, /^duel-rules-8:/);
  assert.deepEqual(c.issue.cpu.profile, cpuIssueProfile('gama'));
  assert.equal(c.issue.cpu.profile.engageMinStaminaPm, 450); assert.equal(c.issue.cpu.profile.breakAtStaminaPm, 250);
  assert.equal(c.receipt.verified, true);
  // the fight exercises the rule: some fighter is winded on some tick
  const d = F.rulesDocFromJson(c.issue.rules), mine = F.parseInputLog(c.log).sides[0].ticks; let windedTicks = 0;
  F.runFight(d.rules, c.issue.seed, { inputs: { read: t => (t < mine.length ? F.toInput(mine[t]) : F.idleInput()) } },
    { brain: new F.FightCoreBrain(), profile: c.issue.cpu.profile, skill: c.issue.cpu.rank },
    { recordEvents: false, chase: d.chase, attrs: d.attrs, tempo: d.tempo, onTick: (_t, _i, core) => { if (core.winded(0) || core.winded(1)) windedTicks++; } });
  console.log(`# golden: ${c.receipt.reason} at ${c.receipt.endTick}, winner ${c.receipt.winner}, winded fighter-ticks ${windedTicks}`);
  assert.ok(windedTicks > 0, 'winded happens in the golden fight');
  if (process.env.WRITE_GOLDEN === '1') writeFileSync(GOLDEN, JSON.stringify(c, null, 1) + '\n');
  const pinned = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  assert.equal(JSON.stringify(pinned.issue), JSON.stringify(c.issue));
  assert.equal(JSON.stringify(pinned.log), JSON.stringify(c.log));
  assert.equal(JSON.stringify(pinned.receipt), JSON.stringify(c.receipt));
});

// ------------------------------------------------------------------ Guild Court through the holoZoneHost store (issue + settle)
test('Guild Court live: the holoZoneHost store issues duel-rules-8 on the ask, the run settles from a verified rules-8 log; rules-7 / -6 asks unchanged', async () => {
  const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
  const Z = require('../lib/lib/holoZoneRuns.js');
  const ON = { courtFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
  const strong = { name: 'ACE', level: 21, experience: 0, nextLevelExp: P.calculateExperience(22), attributePoints: 0, boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } };
  let n = 0;
  const world = () => {
    const db = fakeDb({ now: T0 }), uid = `court_w_${n++}`;
    db.put(`users/${uid}`, { holosTokens: 0, holobots: [strong], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
    const call = (body, now = T0) => transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-2', ...body }, now, () => `0000000${n}-1111-4111-8111-111111111111`, ON);
    return { call };
  };
  for (const [ask, want] of [['duel-rules-8', /^duel-rules-8:/], ['duel-rules-7', /^duel-rules-7:/], ['duel-rules-6', /^duel-rules-6:/]]) {
    const w = world();
    const r = await w.call({ operation: 'issue', zoneId: 'guild_court', holobotId: 'ace', duelInputs: 'duel-inputs-2', fightRules: ask });
    assert.match(r.duel.rulesId, want, 'court ' + ask);
    if (ask !== 'duel-rules-8') continue;
    assert.deepEqual(r.duel.rules.stamina, F.STAMINA_DEFAULTS); assert.equal(r.duel.rules.simVersion, 'duel-sim-7');
    const log = recordFightLog(r.duel, smartPlayer(r.duel, 'ace', 'Legendary')).wire;
    const s = await w.call({ operation: 'settle', runId: r.runId, inputLog: log }, T0 + Z.COURT_LIVE_MIN_WIN_MS + 5_000);
    assert.equal(s.fightReceipt.verified, true); assert.equal(s.fightReceipt.rulesId, r.duel.rulesId);
  }
});
