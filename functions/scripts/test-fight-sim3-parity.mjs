// fight-host-1 parity gate (fight-flow brief C0 / lane H1): the TS duel-sim-3 twin must reproduce, byte for byte,
// (a) the 14 frozen vectors HolobotsUnity fight-core-1 ships (Schemas/fixtures/duel-sim-3, copied verbatim to
//     scripts/fixtures/duel-sim-3): every per-tick state hash, the initial/final/rules hashes, outcome, witness and events;
// (b) the supplemental brain vectors the C# oracle emitted (scripts/fixtures/duel-sim-3-brain/brain-vectors.json): the SHIPPED
//     FightCoreBrain + 13-profile table driving one or both sides, every tick's 16-hex hash prefix + the final full hash.
// A mismatch names the first divergent tick and the differing state fields (lib/sim/fight/diff.js). No parity, no issue mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ajv2020 } from './lib/ajv2020.mjs';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const { firstDivergence } = require('../lib/sim/fight/diff.js');
const dir = new URL('./fixtures/duel-sim-3/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir)));
const brainDoc = JSON.parse(readFileSync(new URL('./fixtures/duel-sim-3-brain/brain-vectors.json', import.meta.url)));

function runScripted(doc) {
  const rules = F.rulesFromJson(doc.rules);
  const cpu = doc.drivers[0] === 'stub-brain';
  const script = F.FightScript.fromJson(doc.script);
  const drv = () => (cpu ? { brain: new F.FightStubBrain(), profile: null, skill: null } : { inputs: script });
  return F.runFight(rules, doc.seed, drv(), drv(), { tickHashes: true });
}

test('21 frozen vectors are listed', () => {
  assert.equal(index.vectorVersion, 'duel-sim-3-vectors-1');
  assert.equal(index.vectors.length, 21);   // fight-tune-2 r3: 14 regenerated + 7 new
});

for (const name of index.vectors) {
  test(`frozen vector ${name}: every tick hash, outcome, witness, events`, () => {
    const doc = JSON.parse(readFileSync(new URL(name + '.json', dir)));
    const ex = doc.expected;
    const r = runScripted(doc);
    assert.equal(r.rulesHash, ex.rulesHash, 'rules hash');
    assert.equal(r.initialHash, ex.initialHash, 'initial hash');
    if (ex.tickHashes) {
      const div = firstDivergence(ex.tickHashes, r.tickHashes);
      assert.equal(div, null, div && `${name}: first divergent tick ${div.tick}`);
      assert.equal(r.tickHashes.size, ex.tickHashes.length);
    } else {
      ex.tickHashesEvery60.forEach((h, i) => assert.equal(r.tickHashes.get(i * 60), h, `${name} tick ${i * 60}`));
    }
    assert.equal(r.finalHash, ex.finalHash, 'final hash');
    assert.equal(r.winner, ex.winner); assert.equal(r.reason, ex.reason); assert.equal(r.endTick, ex.endTick);
    assert.deepEqual([r.core.F[0].hp, r.core.F[1].hp], ex.finalHp);
    assert.deepEqual([r.core.F[0].sta, r.core.F[1].sta], ex.finalStaminaPm);
    assert.deepEqual(r.witness, ex.witness, 'witness');
    if (ex.events) assert.deepEqual(r.events.map(F.eventText), ex.events, 'events');
  });
}

test('the issued 13-profile + rank table equals the C# FightProfiles.ToIssued / FightRankSkill dump', () => {
  const ours = F.allBrainProfiles().map(p => ({ ...F.issuedProfile(p), style: p.style }));
  assert.deepEqual(ours, brainDoc.profiles.profiles);
  assert.deepEqual(F.RANKS.map(r => F.issuedSkill(r)), brainDoc.profiles.ranks);
  assert.equal(F.PROFILES_VERSION, brainDoc.profiles.profilesVersion);
});

for (const v of brainDoc.vectors) {
  test(`brain vector ${v.name}: ${v.note}`, () => {
    const rules = F.rulesFromJson(v.rules), ex = v.expected;
    let d0;
    if (v.drivers[0].kind === 'log') {
      const log = F.parseInputLog(v.log);
      d0 = { inputs: F.logInputs(log, 0) };
    } else d0 = { brain: new F.FightCoreBrain(), profile: v.drivers[0].profile, skill: v.drivers[0].skill };
    const d1 = { brain: new F.FightCoreBrain(), profile: v.drivers[1].profile, skill: v.drivers[1].skill };
    const r = F.runFight(rules, v.seed, d0, d1, { tickHashes: true });
    assert.equal(r.rulesHash, ex.rulesHash); assert.equal(r.initialHash, ex.initialHash);
    const prefixes = [];
    for (let i = 0; i * 16 < ex.tickHashPrefixes.length; i++) prefixes.push(ex.tickHashPrefixes.slice(i * 16, i * 16 + 16));
    const div = firstDivergence(prefixes, r.tickHashes);
    assert.equal(div, null, div && `${v.name}: first divergent tick ${div.tick}`);
    assert.equal(r.finalHash, ex.finalHash);
    assert.equal(r.winner, ex.winner); assert.equal(r.reason, ex.reason); assert.equal(r.endTick, ex.endTick);
    assert.deepEqual(r.core.roster.map(side => side.map(m => ({ id: m.def.id, hp: m.hp, sta: m.sta, sync: m.sync, ko: m.ko }))), ex.roster);
    assert.deepEqual([r.core.rng[0].draws, r.core.rng[1].draws], ex.rngDraws, 'brain draw counts');
    assert.deepEqual(r.witness, ex.witness);
    assert.deepEqual(r.events.map(F.eventText), ex.events);
  });
}

test('tamper controls: one rules number, one seed nibble or one press changes the hashes', () => {
  const doc = JSON.parse(readFileSync(new URL('perfect-guard-counter.json', dir)));
  const base = runScripted(doc);
  const rules = structuredClone(doc); rules.rules.rules.counterPm = 1499;
  assert.notEqual(runScripted(rules).rulesHash, base.rulesHash);
  const seed = structuredClone(doc); seed.seed = 'e' + doc.seed.slice(1);
  assert.notEqual(runScripted(seed).initialHash, base.initialHash);
  const press = structuredClone(doc); press.script[3].press = 'heavy';
  assert.notEqual(runScripted(press).finalHash, base.finalHash);
});

test('diff tool: state bytes decode to named fields; a one-tick step names exactly the fields it changed', () => {
  const doc = JSON.parse(readFileSync(new URL('bench-swap-ko.json', dir)));
  const rules = F.rulesFromJson(doc.rules), script = F.FightScript.fromJson(doc.script);
  const core = new F.FightCore(rules, doc.seed);
  const before = core.stateBytes();
  const f0 = F.decodeState(before, rules);
  assert.equal(f0.tick, -1); assert.equal(f0['ace.hp'], core.F[0].hp); assert.equal(f0['side1.rngState'], core.rng[1].state | 0);
  assert.equal(f0.trailingBytes, undefined, 'the decoder consumes exactly StateBytes');
  core.step(script.read(0, 0), script.read(0, 1));
  const diff = F.diffState(before, core.stateBytes(), rules).map(d => d.field);
  assert.ok(diff.includes('tick') && diff.includes('ace.action') && diff.includes('ace.atkMove') && diff.includes('exchangeActive'), diff.join(','));
  assert.ok(!diff.includes('wolf.hp') && !diff.includes('hare.x'), 'untouched fields are not reported');
});

test('duel-rules-3: defaults equal rules-default.json; the schema accepts every vector snapshot; the parser is strict', () => {
  const validate = ajv2020().compile(JSON.parse(readFileSync(new URL('../../Schemas/duel-rules-3.json', import.meta.url))));
  const def = JSON.parse(readFileSync(new URL('rules-default.json', dir)));
  assert.deepEqual(F.rulesToJson(F.defaultRules()), def);
  for (const name of index.vectors) assert.equal(validate(JSON.parse(readFileSync(new URL(name + '.json', dir))).rules), true, name);
  for (const v of brainDoc.vectors) assert.equal(validate(v.rules), true, v.name);
  const bad = (f, code) => { const d = structuredClone(def); f(d); assert.throws(() => F.rulesFromJson(d), e => e.message === code, code); };
  bad(d => { delete d.rules.counterPm; }, 'invalid_fields');
  bad(d => { d.rules.extra = 1; }, 'invalid_fields');
  bad(d => { d.rules.counterPm = 1.5; }, 'invalid_counterPm');
  bad(d => { d.simVersion = 'duel-sim-2'; }, 'invalid_version');
  bad(d => { d.fighters[1].id = 'ace'; }, 'duplicate_fighter');
  bad(d => { d.fighters[0].hp = 2000; }, 'invalid_fighter_stats');
  bad(d => { d.fighters[1].side = 0; }, 'invalid_roster');
});

test('r3 HP scale + town HP: the TS twin computes the C# pins (FightCoreR3Tests) on the same stat lines', () => {
  const r = F.defaultRules();
  assert.equal(r.hpScaleLights, 19);
  assert.equal(F.meanLightsToKoMilli(r), 15151, '1000 HP / a 66 light = 15.151 lights');
  const c = new F.FightCore(r, '0'.repeat(64));
  assert.equal(c.F[0].maxHp, 1254); assert.equal(c.F[0].hp, 1254); assert.equal(c.F[0].def.maxHp, 1000);
  assert.equal(F.townHp(c.F[0]), 1000);
  const carried = F.defaultRules(); carried.fighters[0].hp = 500; carried.fighters[1].hp = 1;
  const k = new F.FightCore(carried, '0'.repeat(64));
  assert.equal(k.F[0].hp, 627); assert.equal(F.townHp(k.F[0]), 500); assert.equal(k.F[1].hp, 1); assert.equal(F.townHp(k.F[1]), 1);
  for (const [atk, def, hp] of [[50, 50, 175], [140, 140, 490]]) {
    const q = F.defaultRules('wolf', 'kuma');
    for (const f of q.fighters) { f.attack = atk; f.defense = def; f.maxHp = hp; f.hp = hp; }
    const light = Math.trunc(atk * 100 / (100 + def)), lk = Math.trunc(new F.FightCore(q, '0'.repeat(64)).F[0].maxHp * 1000 / light);
    assert.ok(lk >= 18500 && lk <= 19500, `fight HP / light = 19 at every level (${lk})`);
  }
  assert.equal(F.defaultRules().ringRadiusMm, 6000, 'the town duel ring is 6 m (#72.26/#72.29)');
});
