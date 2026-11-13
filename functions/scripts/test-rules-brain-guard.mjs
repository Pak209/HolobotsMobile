// rules-brain-guard-1 (early-progression-1 item 6, Pak 2026-11-12): we learned that changing the CPU brain under an unchanged rules
// id makes older phones fail live-duel verification (the phone predicts the CPU locally with ITS brain; the host replays with its
// own; the rulesHash only covers the rules NUMBERS, not the brain code). This pins a behaviour fingerprint of the fight core + CPU
// brain to each shipped rules version. If the fingerprint moves while the rules id stays 'duel-rules-8', the test fails.
//
// Fingerprint: CPU-vs-CPU fights (every Holobot profile row, the Guild Court beast and the issued Arena CPU, across all six ranks)
// on two FROZEN real live duel-rules-8 rules documents (scripts/fixtures/brain-fingerprint-rules8-input.json); each fight's final
// state hash (which covers both sides' RNG draw counts), end tick and winner are joined and SHA-256'd. Inputs are frozen, so tuning a
// rules default or a profile table row (both travel in the issue) does not move it; changing core / brain code does.
// The phone pins the SAME value (mobile src/lite/features/ringduel/__tests__/rulesBrainGuard.test.ts, verbatim fixture copy).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { F } from './lib/fight-replay-helpers.mjs';

/** rules id -> pinned brain fingerprint. A NEW brain behaviour ships under a NEW rules id with its own row; never re-pin a row. */
export const BRAIN_FINGERPRINTS = Object.freeze({
  'duel-rules-8': '6869d71508267a56d1a4fa29d67122b9974af358def70969ee80f8a4ea5b7b33',
});

const fixture = JSON.parse(readFileSync(new URL('./fixtures/brain-fingerprint-rules8-input.json', import.meta.url), 'utf8'));

export function brainFingerprint(fx, sim) {
  const docs = { arena: sim.rulesDocFromJson(fx.rulesDocs.arena), court: sim.rulesDocFromJson(fx.rulesDocs.court) };
  const ids = Object.keys(fx.profiles).filter(id => id !== 'arena_cpu');
  const cases = [];
  for (let k = 0; k < ids.length; k++) cases.push({ doc: k % 2 ? 'court' : 'arena', p0: ids[k], p1: ids[(k + 3) % ids.length], r0: sim.RANKS[k % 6], r1: sim.RANKS[(k + 2) % 6] });
  for (let k = 0; k < 6; k++) cases.push({ doc: 'arena', p0: 'ace', p1: 'arena_cpu', r0: sim.RANKS[(k + 3) % 6], r1: sim.RANKS[k] });
  const rows = cases.map((c, k) => {
    const d = docs[c.doc];
    const res = sim.runFight(d.rules, k.toString(16).padStart(2, '0').repeat(32),
      { brain: new sim.FightCoreBrain(), profile: fx.profiles[c.p0], skill: sim.issuedSkill(c.r0) },
      { brain: new sim.FightCoreBrain(), profile: fx.profiles[c.p1], skill: sim.issuedSkill(c.r1) },
      { recordEvents: false, chase: d.chase, attrs: d.attrs, tempo: d.tempo });
    return `${c.doc}:${c.p0}/${c.r0}-${c.p1}/${c.r1}:${res.finalHash}:${res.endTick}:${res.winner}:${res.reason}`;
  });
  return { fingerprint: createHash('sha256').update(rows.join('|')).digest('hex'), rows };
}

test('the duel-rules-8 brain fingerprint is pinned (a brain / core change needs a NEW rules version)', () => {
  assert.equal(F.RULES_SCHEMA_8, 'duel-rules-8');
  assert.equal(fixture.rulesSchema, 'duel-rules-8');
  for (const doc of Object.values(fixture.rulesDocs)) assert.equal(doc.schemaVersion, 'duel-rules-8', 'the frozen fixture must stay a duel-rules-8 document');
  const { fingerprint, rows } = brainFingerprint(fixture, F);
  console.log(`# duel-rules-8 brain fingerprint ${fingerprint} (${rows.length} CPU-vs-CPU fights)`);
  assert.equal(fingerprint, BRAIN_FINGERPRINTS['duel-rules-8'],
    `The fight core / CPU brain behaviour changed under the unchanged rules id 'duel-rules-8' (fingerprint ${fingerprint}, pinned ` +
    `${BRAIN_FINGERPRINTS['duel-rules-8']}). Phones already shipped with the duel-rules-8 brain will fail live-duel verification ` +
    `(replay_mismatch cpu_stream). Ship the new behaviour under a NEW rules version (duel-rules-9: new RULES_SCHEMA constant, issue it only ` +
    `on the new fightRules ask) and pin a new row for it here and in the phone's rulesBrainGuard.test.ts. Do NOT re-pin duel-rules-8.`);
});

test('every rules version the hosts issue has a pinned brain fingerprint', () => {
  const versions = Object.entries(F).filter(([k, v]) => /^RULES_SCHEMA_\d+$/.test(k) && typeof v === 'string').map(([, v]) => v);
  const newest = versions.sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop())).pop();
  assert.ok(Object.hasOwn(BRAIN_FINGERPRINTS, newest),
    `The newest rules version '${newest}' has no pinned brain fingerprint. Add a frozen fixture and a BRAIN_FINGERPRINTS row for it ` +
    `(here and in the phone's rulesBrainGuard.test.ts) so a later brain change under '${newest}' is caught.`);
});

test('the guard sees a small brain change (one extra RNG draw in one fight)', () => {
  const pinned = brainFingerprint(fixture, F).fingerprint;
  const decide = F.FightCoreBrain.prototype.decide;
  try {
    let n = 0;
    F.FightCoreBrain.prototype.decide = function (view, rng) { if (++n === 500) rng.next(); return decide.call(this, view, rng); };
    assert.notEqual(brainFingerprint(fixture, F).fingerprint, pinned);
  } finally { F.FightCoreBrain.prototype.decide = decide; }
  assert.equal(brainFingerprint(fixture, F).fingerprint, pinned);
});
