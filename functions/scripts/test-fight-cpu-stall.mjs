// Independent rules4 CPU regressions. The established core/brain fixtures remain immutable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const doc = JSON.parse(readFileSync(new URL('./fixtures/fight-cpu-stall-regressions.json', import.meta.url)));

// Small observable-state scenarios: guard only when it can recover from a tagged retreat,
// hold for the issued animation window, and leave ordinary recovery / attacks untouched.
const aiRules = {
  lightCost: 8000, heavyCost: 18000, specialCost: 20000, feintCost: 3000, stepCost: 6000, burstCost: 10000, shoveCost: 8000,
  openerTelegraphTicks: 15, chainTelegraphTicks: 9, feintWindowTicks: 10, guardRaiseTicks: 3, perfectGuardTicks: 5,
  breakLine: 30000, closeRangeMm: 1300, edgeBandMm: 1500, minGapMm: 1000, stepMm: 1000, burstMm: 2400,
  escapeCost: 10000, chargeCost: 18000, chargeMaxStartMm: 3500, shoveOnHeavyInClose: true,
};
const noRoll = { below: bound => bound - 1 };
const fighter = () => ({ x: 0, z: 0, hp: 1000, maxHp: 1000, stamina: 20000, sync: 0, act: 0, strike: 0,
  actStartTick: 0, contactTick: -1, actEndTick: 0, guardHeld: false, guardUp: false, punishable: false, punishableUntilTick: 0,
  breaking: false, counterUntilTick: -1 });
const kit = () => ({ runMmPerTick: 100, primaryReachMm: 1500, contactReachMm: 1500, lightLungeMm: 0, heavyLungeMm: 0,
  specialLungeMm: 1000, chargeReachMm: 0, chargeLungeMm: 0 });
const observation = () => ({ tick: 1, side: 0, self: fighter(), opponent: { ...fighter(), x: 8000, stamina: 100000 },
  selfKit: kit(), opponentKit: kit(), phase: 0, exchangeTicks: 0, pairReachMm: 1500, ringRadiusMm: 12000, selfTagged: false });
const makeBrain = () => new F.FightBrain(F.brainProfile('kuma'), { ...F.skillFromIssued(F.issuedSkill('Champion')), reactionTicks: 0 }, aiRules);
function retreatBrain() {
  const brain = makeBrain(), obs = observation(); obs.self.breaking = true;
  brain.think(obs, noRoll); return brain;
}

for (const state of ['tagged-free', 'untagged', 'breaking', 'recovery', 'attack']) {
  test(`CPU recovery intent: ${state}`, () => {
    const brain = retreatBrain(), obs = observation(); obs.tick = 30; obs.selfTagged = state !== 'untagged';
    if (state === 'breaking') obs.self.breaking = true;
    if (state === 'recovery') { obs.self.act = 2; obs.self.actEndTick = 60; }
    if (state === 'attack') { obs.self.sync = 100; obs.opponent.breaking = true; obs.opponent.x = 2000; }
    const intent = brain.think(obs, noRoll);
    assert.equal(intent.guard, state === 'tagged-free');
    if (state === 'attack') assert.equal(intent.press, 3, 'existing finisher wins over guard');
    if (state === 'tagged-free') {
      assert.deepEqual([intent.moveX, intent.moveZ], [0, 0]); obs.selfTagged = false;
      for (let t = 31; t <= 38; t++) { obs.tick = t; assert.equal(brain.think(obs, noRoll).guard, true, 'held tick ' + t); }
      obs.tick = 39; assert.equal(brain.think(obs, noRoll).guard, false, 'guard releases');
    }
  });
}
test('tag alone does not interrupt a healthy approach', () => {
  const obs = observation(); obs.selfTagged = true; obs.self.stamina = 100000;
  assert.equal(makeBrain().think(obs, noRoll).guard, false);
});
test('an interrupted recovery guard expires while the body is busy', () => {
  const brain = retreatBrain(), obs = observation(); obs.tick = 30; obs.selfTagged = true;
  assert.equal(brain.think(obs, noRoll).guard, true);
  obs.selfTagged = false; obs.self.act = 6; obs.self.actEndTick = 100;
  for (let t = 31; t < 100; t++) { obs.tick = t; brain.think(obs, noRoll); }
  obs.tick = 100; obs.self.act = 0;
  assert.equal(brain.think(obs, noRoll).guard, false, 'no guard remains after interruption');
});

function run(v, chase) {
  const rules = F.defaultRules(...v.botIds, 7000);
  v.issuedStats.forEach((s, side) => Object.assign(rules.fighters[side], {
    id: (side === 0 ? 'a-' : 'b-') + v.botIds[side], attack: s.attack, defense: s.defense, hp: s.hp, maxHp: s.hp,
  }));
  const driver = side => ({ brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(v.botIds[side])), skill: F.issuedSkill(v.rank) });
  return F.runFight(rules, v.seed, driver(0), driver(1), { tickHashes: true, chase: chase ? F.defaultChaseRules() : null });
}

const summary = r => ({
  rulesHash: r.rulesHash, initialHash: r.initialHash, finalHash: r.finalHash,
  endTick: r.endTick, reason: r.reason, winner: r.winner,
  turnEnds: r.events.filter(e => e.kind === F.EventKind.ChaseEnd && e.value === F.ChaseEnd.Turned).length,
  tickHashes: [...r.tickHashes.values()],
});

for (const v of doc.vectors) {
  test(`${v.name}: known-bad policy reproduces the recorded timeout`, () => {
    // Test-only negative control: the old brain did not observe the existing chase tag.
    // No core or rule mutation; restore before the next synchronous test.
    const think = F.FightBrain.prototype.think;
    try {
      F.FightBrain.prototype.think = function (obs, rng) { return think.call(this, { ...obs, selfTagged: false }, rng); };
      const got = run(v, true);
      for (const key of ['reason', 'endTick', 'finalHash']) assert.equal(got[key], v.knownBad[key], key);
    } finally { F.FightBrain.prototype.think = think; }
  });

  test(`${v.name}: chase-off bytes stay unchanged`, () => {
    const got = run(v, false);
    for (const key of ['reason', 'endTick', 'finalHash']) assert.equal(got[key], v.chaseOff[key], key);
  });

  test(`${v.name}: a legal guard ends retreat; every tick matches the C# regression`, () => {
    const got = summary(run(v, true));
    assert.equal(got.reason, 'ko');
    assert.ok(got.turnEnds > 0, 'core turn-to-fight event');
    assert.deepEqual(got, v.expected);
  });
}
