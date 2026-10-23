// duel-rules-5 parity gate (lane speed-special-p2-1, DECISIONS #72.77/#72.78; Contract-Change approved): the TS host twin of the
// SPEED / SPECIAL attrs block must reproduce, byte for byte, the frozen vectors HolobotsUnity ships in Schemas/fixtures/duel-rules-5
// (copied verbatim to scripts/fixtures/duel-rules-5): rules hash (duel-rules-5 canonical bytes), initial / every-tick / final state
// hash (the duel-sim-4 prefix, per-member syncAcc / evadeRolls / retreatChain and the fight-attrs-1 tail), outcome, witness, every
// event (Stuffed 27, SPEED evades = Contact Evaded -1, Denied 13 from the kite guard) and the final SYNC; plus the C# FightCoreBrain
// vs FightCoreBrain CPU vectors (the rank SYNC spend policy). Mirrors C# FightCoreRules5Tests: the strict parser codes, the canonical
// layout, every attrs number and fighter stat in the hash, the curve / roll pins, the schema, and the known-bad duel-rules-4 control.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ajv2020 } from './lib/ajv2020.mjs';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const { firstDivergence } = require('../lib/sim/fight/diff.js');
const dir = new URL('./fixtures/duel-rules-5/', import.meta.url);
const index = JSON.parse(readFileSync(new URL('index.json', dir)));
const load = name => JSON.parse(readFileSync(new URL(name + '.json', dir)));
const cpuDoc = load('cpu-brain-sync-vectors');
const schema5 = JSON.parse(readFileSync(new URL('../../Schemas/duel-rules-5.json', import.meta.url)));
const schema4 = JSON.parse(readFileSync(new URL('../../Schemas/duel-rules-4.json', import.meta.url)));

const NAMES = ['attrs-move-run', 'attrs-escape-chase-parity', 'attrs-evade-sure', 'attrs-evade-roll', 'attrs-initiative-stuff', 'attrs-tempo-opener',
  'attrs-sync-special', 'attrs-retreat-chain', 'attrs-tuned-numbers', 'cpu-stub-attrs-smoke-0', 'cpu-stub-attrs-smoke-1'];

/** FightCoreFixtures.Seed(i): hex8(i * 2654435761 mod 2^32) + 48 zeros + hex8(i). */
const seedOf = i => (Math.imul(i, 2654435761) >>> 0).toString(16).padStart(8, '0') + '0'.repeat(48) + (i >>> 0).toString(16).padStart(8, '0');

/** FightRules5Fixtures.Strip: the attrs block and every fighter's speed / special removed -> the duel-rules-4 document. */
function strip(rules5) {
  const { attrs: _a, ...o } = structuredClone(rules5);
  return { ...o, schemaVersion: 'duel-rules-4', simVersion: 'duel-sim-3', fighters: o.fighters.map(({ speed: _s, special: _p, ...f }) => f) };
}

function replay(doc, asRules4 = false, rulesDoc = doc.rules) {
  const { rules, chase, attrs } = F.rulesDocFromJson(asRules4 ? strip(rulesDoc) : rulesDoc);
  const cpu = doc.drivers[0] === 'stub-brain';
  const script = F.FightScript.fromJson(doc.script);
  const drv = () => (cpu ? { brain: new F.FightStubBrain(), profile: null, skill: null } : { inputs: script });
  return F.runFight(rules, doc.seed, drv(), drv(), { tickHashes: true, chase, attrs });
}
const isSpeedEvent = e => e.kind === F.EventKind.Stuffed || (e.kind === F.EventKind.Contact && e.value === -1);
const ev = n => load(n).expected.events;

test('the index lists the 11 duel-rules-5 vectors (the C# Names order)', () => {
  assert.equal(index.vectorVersion, 'duel-rules-5-vectors-1');
  assert.deepEqual(index.vectors, NAMES);
  assert.equal(cpuDoc.fixtureVersion, 'duel-rules-5-cpu-brain-1');
  assert.equal(cpuDoc.vectors.length, 5);
});

for (const name of NAMES) {
  test(`duel-rules-5 vector ${name}: rules hash, every tick hash, outcome, witness, events, final SYNC`, () => {
    const doc = load(name), ex = doc.expected;
    assert.equal(doc.rules.schemaVersion, 'duel-rules-5');
    const r = replay(doc);
    assert.equal(r.rulesHash, ex.rulesHash, 'rules hash');
    assert.equal(r.initialHash, ex.initialHash, 'initial hash');
    if (ex.tickHashes) {
      const div = firstDivergence(ex.tickHashes, r.tickHashes);
      if (div) assert.fail(`${name}: first divergent tick ${div.tick}`);
      assert.equal(r.tickHashes.size, ex.tickHashes.length);
    } else {
      assert.ok(ex.tickHashesEvery60.length > 10);
      ex.tickHashesEvery60.forEach((h, i) => assert.equal(r.tickHashes.get(i * 60), h, `${name} tick ${i * 60}`));
    }
    assert.equal(r.finalHash, ex.finalHash, 'final hash');
    assert.equal(r.winner, ex.winner); assert.equal(r.reason, ex.reason); assert.equal(r.endTick, ex.endTick);
    assert.deepEqual([r.core.F[0].hp, r.core.F[1].hp], ex.finalHp);
    assert.deepEqual([r.core.F[0].sta, r.core.F[1].sta], ex.finalStaminaPm);
    assert.deepEqual([r.core.F[0].sync, r.core.F[1].sync], ex.finalSync, 'final SYNC');
    assert.deepEqual(r.witness, ex.witness, 'witness');
    if (ex.events) assert.deepEqual(r.events.map(F.eventText), ex.events, 'events');
    else assert.ok(name.startsWith('cpu-stub-'), 'only the CPU smoke vectors carry no event list');
  });
}

for (const v of cpuDoc.vectors) {
  test(`duel-rules-5 CPU brain vector ${v.name} (${v.rank}): every 30th tick hash, final, SYNC spends, special telegraphs`, () => {
    assert.match(v.seed, /^[0-9a-f]{64}$/);   // SpeedSpecial.cs's own seed stream (not FightCoreFixtures.Seed)
    const { rules, chase, attrs } = F.rulesDocFromJson(v.rules);
    assert.ok(chase && attrs);
    const brains = [new F.FightCoreBrain(), new F.FightCoreBrain()];
    const D = s => ({ brain: brains[s], profile: F.issuedProfile(F.brainProfile(v.botIds[s])), skill: F.issuedSkill(v.rank) });
    const r = F.runFight(rules, v.seed, D(0), D(1), { tickHashes: true, chase, attrs });
    const ex = v.expected;
    assert.equal(r.rulesHash, ex.rulesHash); assert.equal(r.initialHash, ex.initialHash);
    assert.equal(ex.tickHashesEvery30.length, Math.floor(ex.endTick / 30) + 1);
    ex.tickHashesEvery30.forEach((h, i) => assert.equal(r.tickHashes.get(i * 30), h, `${v.name} tick ${i * 30}`));
    assert.equal(r.finalHash, ex.finalHash);
    assert.equal(r.endTick, ex.endTick); assert.equal(r.reason, ex.reason); assert.equal(r.winner, ex.winner);
    assert.deepEqual(brains.map(b => b.brain.stats.halfSpends), ex.halfSpends, 'half spends');
    assert.deepEqual(brains.map(b => b.brain.stats.fullSpends), ex.fullSpends, 'full spends');
    const sp = s => r.events.filter(e => e.kind === F.EventKind.Telegraph && e.move === F.Move.Special && e.side === s).length;
    assert.deepEqual([sp(0), sp(1)], ex.specialTelegraphs, 'special telegraphs');
  });
}

test('known-bad control: every vector on duel-rules-4 (attrs + speed / special stripped) runs the chase core', () => {
  for (const name of NAMES) {
    const doc = load(name), four = replay(doc, true);
    assert.notEqual(four.rulesHash, doc.expected.rulesHash, name);
    assert.notEqual(four.initialHash, doc.expected.initialHash, name);
    assert.equal(four.events.some(isSpeedEvent), false, name + ': no Stuffed / -1 evades on duel-rules-4');
    const s = F.rulesDocFromJson(strip(doc.rules));
    assert.equal(s.attrs, null); assert.equal(four.rulesHash, F.rulesHash(s.rules, s.chase), name);
  }
  // the CPU vectors: the same brains on the attrs-stripped document never take the SYNC spend branch and diverge
  const v = cpuDoc.vectors[0]; const s = F.rulesDocFromJson(strip(v.rules));
  const brains = [new F.FightCoreBrain(), new F.FightCoreBrain()];
  const D = i => ({ brain: brains[i], profile: F.issuedProfile(F.brainProfile(v.botIds[i])), skill: F.issuedSkill(v.rank) });
  const r = F.runFight(s.rules, v.seed, D(0), D(1), { tickHashes: true, chase: s.chase });
  assert.notEqual(r.finalHash, v.expected.finalHash);
  assert.deepEqual(brains.map(b => b.brain.stats.halfSpends + b.brain.stats.fullSpends), [0, 0], 'no SYNC spend policy off duel-rules-5');
});

test('every scripted vector shows its rule (the C# pins)', () => {
  const sure = ev('attrs-evade-sure');
  assert.ok(sure.filter(e => e.includes(' s1 Contact Light Evaded -1')).length >= 2, 'clean lights on a free defender are SPEED evades');
  assert.equal(sure.some(e => e.includes('Contact Special Evaded')), false, 'a finisher is never evaded');
  assert.ok(sure.some(e => e.includes(' s1 Contact Special Hit')), 'the finisher lands');
  assert.ok(sure.some(e => e.includes(' s1 Contact Light Hit') && e.includes('COUNTER')), 'a counter hit is never evaded');
  const roll = ev('attrs-evade-roll');
  const evaded = roll.filter(e => e.includes('Contact Light Evaded -1')).length, hits = roll.filter(e => e.includes(' s1 Contact Light Hit')).length;
  assert.ok(evaded > 0); assert.ok(hits > evaded, 'a 15 % cap: most clean lights still land');
  assert.ok(ev('attrs-initiative-stuff').includes('15 s1 Stuffed Light 0'));
  assert.ok(ev('attrs-initiative-stuff').some(e => e.startsWith('15 s0 Contact Light Hit')));
  assert.ok(ev('attrs-tempo-opener').includes('0 s0 Telegraph Light 13'), 'the faster opener\'s contact tick is 13');
  assert.ok(ev('attrs-tempo-opener').includes('0 s1 Telegraph Light 15'));
  const chain = ev('attrs-retreat-chain');
  assert.ok(chain.includes('150 s0 Denied ' + F.Deny.RetreatCooldown), 'the 4th retreat in a row is refused');
  assert.equal(chain.filter(e => e.includes(' s0 Retreat ')).length, 4, 'three, then one more after the light');
  assert.ok(ev('attrs-sync-special').some(e => e.includes(' s0 Contact Special Hit')));
  const noAttrs = replay(load('attrs-sync-special'), true);
  assert.ok(noAttrs.events.some(e => e.kind === F.EventKind.Denied && e.value === F.Deny.Sync), 'duel-rules-4: four lights = 40 SYNC, the half special is refused');
  const flat = load('attrs-sync-special'); flat.rules.attrs.specialDmgEdgePm = 0;
  const dmg5 = ev('attrs-sync-special').filter(e => e.includes('Contact Special Hit')).map(e => Number(e.split(' ').pop()));
  const dmg0 = replay(flat, false, flat.rules).events.filter(e => e.kind === F.EventKind.Contact && e.move === F.Move.Special).map(e => e.value);
  assert.equal(dmg5.length, 1); assert.equal(dmg0.length, 1);
  assert.ok(Math.abs(dmg5[0] - Math.trunc(dmg0[0] * 1300 / 1000)) <= 1, 'SPECIAL edge 250: finisher damage x1.30 (cap)');
});

test('the curves and the roll are pinned (C# TheCurvesAndTheRollArePinned)', () => {
  const a = F.defaultAttrRules();
  assert.equal(F.attrEdge(60, 40), 200); assert.equal(F.attrEdge(40, 60), -200); assert.equal(F.attrEdge(0, 0), 0);
  assert.equal(F.moveMul(a, 200), 1100); assert.equal(F.moveMul(a, -200), 900); assert.equal(F.moveMul(a, 91), 1054);
  assert.equal(F.evadeChance(a, 91), 91); assert.equal(F.evadeChance(a, 400), 150); assert.equal(F.evadeChance(a, -50), 0);
  assert.equal(F.tempoTicks(a, 74), 0); assert.equal(F.tempoTicks(a, 75), 1); assert.equal(F.tempoTicks(a, 150), 2); assert.equal(F.tempoTicks(a, 900), 2);
  assert.equal(F.syncMul(a, 111), 1222); assert.equal(F.syncMul(a, -400), 750); assert.equal(F.syncMul(a, 400), 1400);
  assert.equal(F.specialDmgMul(a, 100), 1200); assert.equal(F.specialDmgMul(a, -500), 700);
  assert.equal(seedOf(1), '9e3779b1' + '0'.repeat(48) + '00000001');
  assert.equal(F.evadeWord(F.seedBytes(seedOf(1))), 3302488080);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => F.rollPm(0x12345678, i % 2, i)), [173, 841, 193, 530, 853, 46]);
  // the roll is a uint32 function: the extremes stay inside 0..999
  for (const w of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) for (let i = 0; i < 64; i++) { const r = F.rollPm(w, i & 1, i); assert.ok(Number.isInteger(r) && r >= 0 && r < 1000); }
});

test('rules-5-default.json round-trips; older documents keep their hash; attrs need the chase block', () => {
  const file = JSON.parse(readFileSync(new URL('rules-5-default.json', dir)));
  const { rules, chase, attrs } = F.rulesDocFromJson(file);
  assert.ok(chase && attrs);
  assert.equal(rules.fighters[0].speed, 60); assert.equal(rules.fighters[1].special, 40);
  const def = F.defaultRules(); def.fighters[0].speed = 60; def.fighters[1].speed = 50; def.fighters[0].special = 50; def.fighters[1].special = 40;
  assert.equal(JSON.stringify(F.rulesDocToJson5(def, F.defaultChaseRules(), F.defaultAttrRules())), JSON.stringify(file), 'key order = the C# document');
  assert.deepEqual(F.rulesDocToJson5(rules, chase, attrs), file);
  assert.deepEqual(attrs, F.defaultAttrRules());
  assert.notEqual(F.rulesHash(rules, chase, attrs), F.rulesHash(rules, chase));
  const four = F.rulesDocToJson(F.defaultRules(), F.defaultChaseRules());
  const r4 = F.rulesDocFromJson(four);
  assert.equal(r4.attrs, null); assert.equal(F.rulesHash(r4.rules, r4.chase, null), F.rulesHash(F.defaultRules(), F.defaultChaseRules()));
  assert.deepEqual(F.rulesCanonicalBytes5(r4.rules, r4.chase, null), F.rulesCanonicalBytes4(r4.rules, r4.chase));
  assert.deepEqual(F.rulesDocToJson5(r4.rules, r4.chase, null), four);
  const r3 = F.rulesDocFromJson(F.rulesToJson(F.defaultRules()));
  assert.equal(r3.chase, null); assert.equal(r3.attrs, null); assert.equal(F.rulesHash(r3.rules, null, null), F.rulesHash(F.defaultRules()));
  assert.throws(() => F.rulesFromJson(file), e => e.message === 'invalid_fields', 'the duel-rules-3 reader refuses a duel-rules-5 document');
  assert.throws(() => new F.FightCore(F.defaultRules(), seedOf(1), null, F.defaultAttrRules()), e => e.message === 'invalid_attrs_without_chase');
  assert.throws(() => F.rulesDocToJson5(F.defaultRules(), null, F.defaultAttrRules()), e => e.message === 'invalid_attrs_without_chase');
});

test('the canonical bytes are the documented layout', () => {
  const r = F.defaultRules(); r.fighters[0].speed = 7; r.fighters[1].special = 9; const c = F.defaultChaseRules(), a = F.defaultAttrRules();
  const parts = [Buffer.from('duel-rules-5', 'ascii')];
  const ints = vs => { const b = Buffer.alloc(4 * vs.length); vs.forEach((v, i) => b.writeInt32LE(v, 4 * i)); return b; };
  parts.push(ints(F.GLOBAL_KEYS.map(k => r[k])), ints(F.CHASE_KEYS.map(k => c[k])), ints(F.ATTR_KEYS.map(k => a[k])), ints([r.fighters.length]));
  for (const f of r.fighters) {
    const id = Buffer.from(f.id, 'ascii');
    parts.push(ints([id.length]), id, ints(F.FIGHTER_KEYS.map(k => f[k])), ints([f.speed ?? 0, f.special ?? 0]));
  }
  assert.deepEqual(F.rulesCanonicalBytes5(r, c, a), Buffer.concat(parts));
});

test('every attrs number and fighter speed / special is in the hash (duel-rules-4 never hashes them)', () => {
  const r = F.defaultRules(), c = F.defaultChaseRules();
  const seen = new Set([F.rulesHash(r, c, F.defaultAttrRules())]);
  for (const k of F.ATTR_KEYS) {
    const a = F.defaultAttrRules(), v = a[k];
    a[k] = k === 'chaseParity' || k === 'evadeWide' || k === 'evadeSpecials' ? 1 - v : k.endsWith('MinPm') ? v - 1 : v + 1;
    const h = F.rulesHash(r, c, a); assert.ok(!seen.has(h), k); seen.add(h);
  }
  const s = F.defaultRules(); s.fighters[1].speed = 1; assert.ok(!seen.has(F.rulesHash(s, c, F.defaultAttrRules())), 'speed'); seen.add(F.rulesHash(s, c, F.defaultAttrRules()));
  const p = F.defaultRules(); p.fighters[0].special = 1; assert.ok(!seen.has(F.rulesHash(p, c, F.defaultAttrRules())), 'special');
  assert.equal(F.rulesHash(s, c), F.rulesHash(r, c), 'duel-rules-4 never hashes speed / special');
  assert.equal(F.rulesHash(s), F.rulesHash(r), 'duel-rules-3 never hashes speed / special');
});

test('the duel-rules-5 parser is strict with the C# codes (TheParserIsStrict)', () => {
  const base = () => structuredClone(F.rulesDocToJson5(F.defaultRules(), F.defaultChaseRules(), F.defaultAttrRules()));
  const bad = (f, code) => { const d = base(); f(d); assert.throws(() => F.rulesDocFromJson(d), e => e.message === code, code); };
  bad(d => { delete d.attrs; }, 'invalid_fields');
  bad(d => { delete d.attrs.retreatChainMax; }, 'invalid_fields');
  bad(d => { d.attrs.extra = 1; }, 'invalid_fields');
  bad(d => { d.attrs.evadeMaxPm = 1.5; }, 'invalid_evadeMaxPm');
  bad(d => { d.attrs.moveMinPm = 1001; }, 'invalid_attrs_rules');
  bad(d => { d.attrs.chaseParity = 2; }, 'invalid_attrs_rules');
  bad(d => { d.attrs.syncEdgePm = -1; }, 'invalid_attrs_syncEdgePm');
  bad(d => { d.attrs = []; }, 'invalid_attrs');
  bad(d => { d.simVersion = 'duel-sim-3'; }, 'invalid_version');
  bad(d => { delete d.fighters[0].speed; }, 'missing_speed');
  bad(d => { delete d.fighters[1].special; }, 'missing_special');
  bad(d => { d.fighters[0].speed = -1; }, 'invalid_fighter_attrs');
  bad(d => { d.fighters[0].special = '4'; }, 'invalid_special');
  bad(d => { delete d.chase; }, 'invalid_fields');
  // TS extras on the same rules
  bad(d => { d.fighters[0].speed = 100001; }, 'invalid_fighter_attrs');
  bad(d => { delete d.attrs.retreatChainMax; d.attrs.retreatchainmax = 3; }, 'missing_retreatChainMax');
  bad(d => { d.fighters[0].extra = 1; }, 'invalid_fields');
  const four = { ...F.rulesDocToJson(F.defaultRules(), F.defaultChaseRules()), attrs: F.defaultAttrRules() };
  assert.throws(() => F.rulesDocFromJson(four), e => e.message === 'invalid_fields', 'an attrs block on a duel-rules-4 document is refused');
  const fourSpeed = structuredClone(F.rulesDocToJson(F.defaultRules(), F.defaultChaseRules())); fourSpeed.fighters[0].speed = 5;
  assert.throws(() => F.rulesDocFromJson(fourSpeed), e => e.message === 'invalid_fields', 'speed on a duel-rules-4 fighter is refused');
});

test('Schemas/duel-rules-5.json = duel-rules-4 + the attrs block; lists every attrs key; accepts every vector snapshot', () => {
  assert.equal(schema5.properties.schemaVersion.const, 'duel-rules-5');
  assert.equal(schema5.properties.simVersion.const, F.SIM_VERSION_4);
  assert.deepEqual(schema5.required, ['schemaVersion', 'simVersion', 'tickHz', 'rules', 'fighters', 'chase', 'attrs']);
  assert.deepEqual(schema5.properties.rules, schema4.properties.rules);
  assert.deepEqual(schema5.properties.chase, schema4.properties.chase);
  assert.deepEqual(schema5.properties.attrs.required, F.ATTR_KEYS);
  assert.deepEqual(Object.keys(schema5.properties.attrs.properties), F.ATTR_KEYS);
  assert.deepEqual(schema5.$defs.fighter.required.slice(1), [...F.FIGHTER_KEYS, 'speed', 'special']);
  const validate = ajv2020().compile(schema5);
  assert.equal(validate(JSON.parse(readFileSync(new URL('rules-5-default.json', dir)))), true, JSON.stringify(validate.errors));
  for (const name of NAMES) assert.equal(validate(load(name).rules), true, name);
  for (const v of cpuDoc.vectors) assert.equal(validate(v.rules), true, v.name);
  assert.equal(validate(strip(load('attrs-move-run').rules)), false, 'a duel-rules-4 document is not duel-rules-5');
});

test('the attrs-off core is the duel-rules-4 core byte for byte; the decoder consumes the duel-sim-4 state exactly', () => {
  const doc = load('attrs-retreat-chain'); const { rules, chase, attrs } = F.rulesDocFromJson(doc.rules);
  const script = F.FightScript.fromJson(doc.script);
  const a = F.runFight(rules, doc.seed, { inputs: script }, { inputs: script }, { tickHashes: true, chase });
  const b = F.runFight(rules, doc.seed, { inputs: script }, { inputs: script }, { tickHashes: true, chase, attrs: null });
  assert.deepEqual([...b.tickHashes], [...a.tickHashes]); assert.equal(b.rulesHash, a.rulesHash);
  const four = F.rulesDocFromJson(strip(doc.rules));
  const c = F.runFight(four.rules, doc.seed, { inputs: script }, { inputs: script }, { tickHashes: true, chase: four.chase });
  assert.deepEqual([...c.tickHashes], [...a.tickHashes], 'speed / special on the fighters are inert without the attrs block');
  const off = new F.FightCore(rules, doc.seed, chase);
  assert.equal(off.attrs, null); assert.equal(off.stateBytes().toString('ascii', 0, 10), 'duel-sim-3');
  const on = new F.FightCore(rules, doc.seed, chase, attrs);
  assert.equal(on.stateBytes().toString('ascii', 0, 10), 'duel-sim-4');
  const fields = F.decodeState(on.stateBytes(), rules);
  assert.equal(fields.trailingBytes, undefined, 'the decoder consumes the per-member extras and the attrs tail exactly');
  assert.equal(fields['attrs.retreatChainMax'], 3); assert.equal(fields[`${rules.fighters[0].id}.retreatChain`], 0);
  assert.equal(fields['chase.chaserSpeedPm'], 1100);
  assert.equal(F.decodeState(off.stateBytes(), rules).trailingBytes, undefined);
  // the retreat-chain vector's own end state names the chain counter
  const r = replay(doc); assert.equal(F.coreFields(r.core)[`${rules.fighters[0].id}.retreatChain`], r.core.F[0].retreatChain);
});
