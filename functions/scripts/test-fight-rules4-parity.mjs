// duel-rules-4-1 parity gate (DECISIONS #72.65; Contract-Change duel-rules-4, Pak 2026-10-22): the TS host twin of the
// fight-chase-1 chase / retreat rules must reproduce, byte for byte, the frozen vectors HolobotsUnity ships in
// Schemas/fixtures/duel-rules-4 (copied verbatim to scripts/fixtures/duel-rules-4): rules hash (duel-rules-4 canonical bytes),
// initial / every-tick / final state hash (the chase tail), outcome, witness and every event (Retreat 23, Caught 24, RingStop 25,
// ChaseEnd 26, Denied 13). Plus the C#-pinned parser / hash / schema rules, and the duel-rules-3 control: the same vector with
// its chase block stripped runs today's core (no chase events, different hashes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ajv2020 } from './lib/ajv2020.mjs';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const { firstDivergence } = require('../lib/sim/fight/diff.js');
const dir = new URL('./fixtures/duel-rules-4/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir)));
const load = name => JSON.parse(readFileSync(new URL(name + '.json', dir)));
const schema4 = JSON.parse(readFileSync(new URL('../../Schemas/duel-rules-4.json', import.meta.url)));
const schema3 = JSON.parse(readFileSync(new URL('../../Schemas/duel-rules-3.json', import.meta.url)));

function strip(rulesDoc) { const { chase, ...rest } = structuredClone(rulesDoc); return { ...rest, schemaVersion: 'duel-rules-3' }; }

function replay(doc, asRules3 = false) {
  const { rules, chase } = F.rulesDocFromJson(asRules3 ? strip(doc.rules) : doc.rules);
  const cpu = doc.drivers[0] === 'stub-brain';
  const script = F.FightScript.fromJson(doc.script);
  const drv = () => (cpu ? { brain: new F.FightStubBrain(), profile: null, skill: null } : { inputs: script });
  return F.runFight(rules, doc.seed, drv(), drv(), { tickHashes: true, chase });
}

test('15 duel-rules-4 vectors are listed', () => {
  assert.equal(index.vectorVersion, 'duel-rules-4-vectors-1');
  assert.equal(index.vectors.length, 15);
});

for (const name of index.vectors) {
  test(`duel-rules-4 vector ${name}: rules hash, every tick hash, outcome, witness, events`, () => {
    const doc = load(name), ex = doc.expected;
    assert.equal(doc.rules.schemaVersion, 'duel-rules-4');
    const r = replay(doc);
    assert.equal(r.rulesHash, ex.rulesHash, 'rules hash');
    assert.equal(r.initialHash, ex.initialHash, 'initial hash');
    if (ex.tickHashes) {
      const div = firstDivergence(ex.tickHashes, r.tickHashes);
      if (div) {
        const fields = F.coreFields(r.core);
        assert.fail(`${name}: first divergent tick ${div.tick} (final state chase0.tagged=${fields['chase0.tagged']})`);
      }
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

test('known-bad control: every vector on duel-rules-3 (chase stripped) runs today\'s core', () => {
  for (const name of index.vectors) {
    const doc = load(name), three = replay(doc, true);
    assert.notEqual(three.rulesHash, doc.expected.rulesHash, name);
    assert.notEqual(three.initialHash, doc.expected.initialHash, name);
    assert.equal(three.events.some(e => e.kind >= F.EventKind.Retreat), false, name + ': no chase events');
    assert.equal(three.rulesHash, F.rulesHash(F.rulesFromJson(strip(doc.rules))), name);
  }
});

test('the rules-4 vectors show their rule (the C# pins)', () => {
  const ev = n => load(n).expected.events;
  assert.ok(ev('chase-disengage-chased').includes('0 s0 Retreat 45'));
  assert.ok(ev('chase-escape-cooldown').includes('44 s0 Denied 13'));
  assert.ok(ev('chase-caught-pull').some(e => e.includes(' s0 Caught Heavy ')));
  // chase-caught-rule-1 (Pak 2026-10-22): any hit the runner survives catches it; a KO hit never does
  assert.ok(ev('chase-caught-survivable').some(e => e.startsWith('16 s0 Caught Heavy ')), 'a hit leaving 1 HP (< the 103 damage) catches');
  assert.ok(ev('chase-caught-survivable').includes('16 s1 Contact Heavy Hit 103'));
  assert.equal(load('chase-caught-survivable').expected.finalHp[0], 1);
  assert.equal(ev('chase-caught-ko').some(e => e.includes(' Caught ')), false, 'a KO hit never catches');
  assert.equal(load('chase-caught-ko').expected.reason, 'ko');
  assert.ok(ev('chase-ring-stop').some(e => e.endsWith(' s0 RingStop 6000')));
  assert.ok(ev('chase-squad-ko-bench').includes('15 s1 ChaseEnd 6') && ev('chase-squad-ko-bench').includes('66 s0 ChaseEnd 6'));
  assert.equal(ev('chase-tuned-numbers').some(e => e.includes(' RingStop ')), false, 'ringStop 0 = today\'s clamp');
});

test('duel-rules-4 defaults, round trip, canonical bytes and hash', () => {
  const def = JSON.parse(readFileSync(new URL('rules-4-default.json', dir)));
  assert.deepEqual(F.rulesDocToJson(F.defaultRules(), F.defaultChaseRules()), def);
  assert.equal(JSON.stringify(F.rulesDocToJson(F.defaultRules(), F.defaultChaseRules())), JSON.stringify(def), 'key order = the C# document');
  const { rules, chase } = F.rulesDocFromJson(def);
  assert.deepEqual(chase, F.defaultChaseRules());
  assert.notEqual(F.rulesHash(rules, chase), F.rulesHash(rules), 'duel-rules-4 hashes differently from duel-rules-3');
  assert.equal(F.rulesHash(rules, null), F.rulesHash(rules));
  // layout: "duel-rules-4" + globals + chase + (fighter count + fighters exactly as duel-rules-3)
  const three = F.rulesCanonicalBytes(rules), head = 'duel-rules-3'.length + 4 * F.GLOBAL_KEYS.length;
  const chaseBytes = Buffer.alloc(4 * F.CHASE_KEYS.length); F.CHASE_KEYS.forEach((k, i) => chaseBytes.writeInt32LE(chase[k], 4 * i));
  const want = Buffer.concat([Buffer.from('duel-rules-4', 'ascii'), three.subarray('duel-rules-3'.length, head), chaseBytes, three.subarray(head)]);
  assert.deepEqual(F.rulesCanonicalBytes4(rules, chase), want);
  const seen = new Set([F.rulesHash(rules, chase), F.rulesHash(rules)]);
  for (const k of F.CHASE_KEYS) { const c = { ...chase, [k]: k === 'ringStop' ? 1 - chase[k] : chase[k] + 1 }; assert.ok(!seen.has(F.rulesHash(rules, c)), k); seen.add(F.rulesHash(rules, c)); }
  // duel-rules-3 documents: chase null, today's parse
  const r3 = F.rulesDocFromJson(F.rulesToJson(F.defaultRules()));
  assert.equal(r3.chase, null); assert.equal(F.rulesHash(r3.rules), F.rulesHash(F.defaultRules()));
});

test('the duel-rules-4 parser is strict with the C# codes', () => {
  const def = JSON.parse(readFileSync(new URL('rules-4-default.json', dir)));
  const bad = (f, code) => { const d = structuredClone(def); f(d); assert.throws(() => F.rulesDocFromJson(d), e => e.message === code, code); };
  bad(d => { delete d.chase; }, 'invalid_fields');
  bad(d => { delete d.chase.ringStop; }, 'invalid_fields');
  bad(d => { d.chase.extra = 1; }, 'invalid_fields');
  bad(d => { delete d.chase.ringStop; d.chase.ringstop = 1; }, 'missing_ringStop');
  bad(d => { d.chase.caughtGapMm = 1.5; }, 'invalid_caughtGapMm');
  bad(d => { d.chase.caughtGapMm = '1300'; }, 'invalid_caughtGapMm');
  bad(d => { d.chase.retreatCostPm = -1; }, 'invalid_chase_retreatCostPm');
  bad(d => { d.chase.chaserSpeedPm = 900; }, 'invalid_chase_rules');
  bad(d => { d.chase.ringStop = 2; }, 'invalid_chase_rules');
  bad(d => { d.chase.caughtPullTicks = 0; }, 'invalid_chase_rules');
  bad(d => { d.chase = []; }, 'invalid_chase');
  bad(d => { d.simVersion = 'duel-sim-4'; }, 'invalid_version');
  bad(d => { d.rules.counterPm = 1.5; }, 'invalid_counterPm');
  bad(d => { d.schemaVersion = 'duel-rules-5'; }, 'invalid_fields');
  const three = { ...F.rulesToJson(F.defaultRules()), chase: F.defaultChaseRules() };
  assert.throws(() => F.rulesDocFromJson(three), e => e.message === 'invalid_fields', 'a chase block on duel-rules-3 is refused, not ignored');
  assert.throws(() => F.rulesFromJson(def), e => e.message === 'invalid_fields', 'the duel-rules-3 parser refuses duel-rules-4');
});

test('Schemas/duel-rules-4.json = duel-rules-3 + the chase block; accepts every vector snapshot', () => {
  assert.equal(schema4.properties.schemaVersion.const, 'duel-rules-4');
  assert.deepEqual(schema4.required, ['schemaVersion', 'simVersion', 'tickHz', 'rules', 'fighters', 'chase']);
  assert.deepEqual(schema4.properties.rules, schema3.properties.rules);
  assert.deepEqual(schema4.$defs, schema3.$defs);
  assert.deepEqual(schema4.properties.chase.required, F.CHASE_KEYS);
  assert.deepEqual(Object.keys(schema4.properties.chase.properties), F.CHASE_KEYS);
  const validate = ajv2020().compile(schema4);
  assert.equal(validate(JSON.parse(readFileSync(new URL('rules-4-default.json', dir)))), true);
  for (const name of index.vectors) assert.equal(validate(load(name).rules), true, name);
  const off = structuredClone(load('chase-timeline').rules); off.chase.chaserSpeedPm = 900;
  assert.equal(validate(off), false, 'the schema bounds chaserSpeedPm like the validator');
});

test('the chase-off core is today\'s core: null chase = the pre-duel-rules-4 constructor, byte for byte', () => {
  const doc = load('chase-timeline'); const rules = F.rulesFromJson(strip(doc.rules)); const script = F.FightScript.fromJson(doc.script);
  const a = F.runFight(rules, doc.seed, { inputs: script }, { inputs: script }, { tickHashes: true });
  const b = F.runFight(rules, doc.seed, { inputs: script }, { inputs: script }, { tickHashes: true, chase: null });
  assert.deepEqual([...b.tickHashes], [...a.tickHashes]); assert.equal(b.rulesHash, a.rulesHash);
  const core = new F.FightCore(rules, doc.seed);
  assert.equal(core.chase, null); assert.equal(core.tagged(0), false);
  assert.equal(F.decodeState(core.stateBytes(), rules).trailingBytes, undefined);
  const on = new F.FightCore(rules, doc.seed, F.defaultChaseRules());
  const fields = F.decodeState(on.stateBytes(), rules);
  assert.equal(fields.trailingBytes, undefined, 'the decoder consumes the chase tail exactly');
  assert.equal(fields['chase.chaserSpeedPm'], 1100); assert.equal(fields['chase1.ringStopTick'], -1);
});
