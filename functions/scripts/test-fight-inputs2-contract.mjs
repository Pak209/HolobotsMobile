// fight-host-1: duel-inputs-2 decoder parity with HolobotsUnity fight-input-1 (C# FightInputLog, the Python reference codec).
// The fixture (scripts/fixtures/duel-inputs-2.fixture.json = Unity Schemas/fixtures/duel-inputs-2.fixture.json, verbatim):
// the 4 valid logs schema-validate, decode to their sparse keys and re-encode byte for byte (whole wire JSON); the 35 invalid
// ones are refused (schema class: by the JSON Schema; decoder class: schema-valid but refused by the decoder), and the host
// decoder refuses EVERY one with the C# decoder's own code (duel-inputs-2.csharp-codes.json, emitted by the cold oracle).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const Ajv2020 = createRequire(new URL('../../rules-tests/package.json', import.meta.url))('ajv/dist/2020');
const ajv = new Ajv2020({ strict: false });
const schema = JSON.parse(readFileSync(new URL('../../Schemas/duel-inputs-2.json', import.meta.url)));
const validate = ajv.compile(schema);
const fixture = JSON.parse(readFileSync(new URL('./fixtures/duel-inputs-2.fixture.json', import.meta.url)));
const csharp = JSON.parse(readFileSync(new URL('./fixtures/duel-inputs-2.csharp-codes.json', import.meta.url)));
const brain = JSON.parse(readFileSync(new URL('./fixtures/duel-sim-3-brain/brain-vectors.json', import.meta.url)));

const NAMES = { 1: 'light', 2: 'heavy', 3: 'special', 4: 'feint', 5: 'step', 6: 'shove', 7: 'disengage' };
/** The Python codec's to_keys (sparse per-tick expectations; levels persist). */
function toKeys(sides) {
  const keys = [];
  for (let t = 0; t < sides[0].length; t++) for (const s of [0, 1]) {
    const r = sides[s][t], prev = t ? sides[s][t - 1] : F.idleRecord();
    const k = { t, s };
    if (r.moveX !== prev.moveX || r.moveZ !== prev.moveZ) k.move = [r.moveX, r.moveZ];
    if (r.guard !== prev.guard) k.guard = r.guard;
    if (r.press) k.press = NAMES[r.press];
    if (r.stepX !== 0 || r.stepZ !== 0) k.step = [r.stepX, r.stepZ];
    if (r.specialTier) k.tier = r.specialTier;
    if (r.deploy !== 255) k.deploy = r.deploy;
    if (r.target !== 255) k.target = r.target;
    if (Object.keys(k).length > 2) keys.push(k);
  }
  return keys;
}

test('fixture shape: 4 valid, 35 invalid, every invalid has a C# code', () => {
  assert.equal(fixture.schemaVersion, 'duel-inputs-2');
  assert.equal(fixture.valid.length, 4);
  assert.equal(fixture.invalid.length, 35);
  for (const c of fixture.invalid) assert.ok(csharp.invalid[c.name] && csharp.invalid[c.name] !== 'ACCEPTED', c.name);
  for (const c of fixture.valid) assert.equal(csharp.valid[c.name], 'roundtrip');
});

for (const c of fixture.valid) {
  test(`valid ${c.name}: schema, decode to keys, byte-identical re-encode`, () => {
    assert.equal(validate(c.log), true, JSON.stringify(validate.errors));
    const log = F.parseInputLog(c.log);
    assert.deepEqual(toKeys(log.sides.map(s => s.ticks)), c.keys);
    for (const i of [0, 1]) assert.equal(F.encodeStream(log.sides[i].ticks).toString('base64'), c.log.sides[i].stream);
    assert.equal(JSON.stringify(F.inputLogToWire(log)), JSON.stringify(c.log), 'whole wire JSON round-trips (C# ToWire key order)');
  });
}

for (const c of fixture.invalid) {
  test(`invalid ${c.name} (${c.reason}): refused with the C# code ${csharp.invalid[c.name]}`, () => {
    const ok = validate(c.log);
    if (c.reason === 'schema') assert.equal(ok, false, 'schema refuses');
    else assert.equal(ok, true, 'decoder cases are structurally valid');
    assert.throws(() => F.parseInputLog(c.log), e => e instanceof F.FightInputLogError && e.code === csharp.invalid[c.name]);
  });
}

test('real core logs (cold oracle, C# FightInputLog.ToWire) schema-validate, decode and re-encode byte for byte', () => {
  const logs = brain.vectors.filter(v => v.log);
  assert.equal(logs.length, 4);
  for (const v of logs) {
    assert.equal(validate(v.log), true, v.name);
    const log = F.parseInputLog(v.log);
    assert.equal(JSON.stringify(F.inputLogToWire(log)), JSON.stringify(v.log), v.name);
    assert.equal(log.tickCount, v.expected.endTick + 1);
    assert.equal(log.finalHash, v.expected.finalHash);
  }
});

test('encoder refuses out-of-range records exactly like FightTickRecord.Check', () => {
  const bad = (patch, code) => assert.throws(() => F.encodeStream([{ ...F.idleRecord(), ...patch }]), e => e.code === code);
  bad({ moveX: -128 }, 'fight_input_axis');
  bad({ press: 8 }, 'fight_input_press');
  bad({ press: 1, stepX: 3 }, 'fight_input_step');
  bad({ press: 3, specialTier: 0 }, 'fight_input_tier');
  bad({ press: 1, specialTier: 1 }, 'fight_input_tier');
});

test('first divergent sample: -1 on an exact replay, k at the first bad window, hashes.length for the final hash / length', () => {
  const v = brain.vectors.find(x => x.name === 'log-ace-vs-cpu-wolf');
  const log = F.parseInputLog(v.log);
  const prefixes = [];
  for (let i = 0; i * 16 < v.expected.tickHashPrefixes.length; i++) prefixes.push(v.expected.tickHashPrefixes.slice(i * 16, i * 16 + 16));
  const replay = new Map(prefixes.map((h, t) => [t, h + '0'.repeat(48)]));
  replay.set(log.tickCount - 1, log.finalHash);
  assert.equal(F.firstDivergentSample(log, replay, log.tickCount), -1);
  const bad = new Map(replay); bad.set(F.sampleTick(log, 3), 'f'.repeat(64));
  assert.equal(F.firstDivergentSample(log, bad, log.tickCount), 3);
  const fin = new Map(replay); fin.set(log.tickCount - 1, 'f'.repeat(64));
  assert.equal(F.firstDivergentSample(log, fin, log.tickCount), log.hashes.length);
  assert.equal(F.firstDivergentSample(log, replay, log.tickCount - 1), log.hashes.length);
});
