// fight-host-1: duel-receipt-2 contract (Schemas/duel-receipt-2.json + Schemas/fixtures/duel-receipt-2.fixture.json; the
// HolobotsUnity mirror copies both byte for byte). The valid receipt is re-derived from the fixture's issue + log by the host
// verifier (so the fixture is evidence, not a hand-written sample); every invalid case is refused by the schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ajv2020 } from './lib/ajv2020.mjs';
import { buildReceipt2ChaseFixture, buildReceipt2Fixture } from './lib/duel-receipt2-fixture.mjs';
import { verifyFightReplay } from './lib/fight-replay-helpers.mjs';
const ajv = ajv2020();
const schema = JSON.parse(readFileSync(new URL('../../Schemas/duel-receipt-2.json', import.meta.url)));
const validate = ajv.compile(schema);
const fixture = JSON.parse(readFileSync(new URL('../../Schemas/fixtures/duel-receipt-2.fixture.json', import.meta.url)));

test('fixture is current (regenerate with node scripts/gen-duel-receipt2-fixture.mjs)', () => {
  assert.deepEqual(fixture, JSON.parse(JSON.stringify(buildReceipt2Fixture())));
});
test('valid receipt: schema-valid and re-derived by the host from the fixture issue + log', () => {
  for (const c of fixture.valid) {
    assert.equal(validate(c.receipt), true, JSON.stringify(validate.errors));
    assert.deepEqual(verifyFightReplay(fixture.issue, fixture.log, { battleId: c.receipt.battleId }).receipt, c.receipt);
  }
});
for (const c of fixture.invalid) test(`invalid receipt ${c.name} is refused by the schema`, () => assert.equal(validate(c.receipt), false));

// duel-rules-4-1: the chase-rules issue (HOLOCITY_FIGHT_CHASE on) — HolobotsUnity's C# verifier must reproduce this receipt too
const chaseFixture = JSON.parse(readFileSync(new URL('../../Schemas/fixtures/duel-receipt-2-chase.fixture.json', import.meta.url)));
const rules4 = ajv.compile(JSON.parse(readFileSync(new URL('../../Schemas/duel-rules-4.json', import.meta.url))));
test('chase fixture is current, its issue is duel-rules-4, and the receipt is re-derived by the host', () => {
  assert.deepEqual(chaseFixture, JSON.parse(JSON.stringify(buildReceipt2ChaseFixture())));
  assert.equal(chaseFixture.issue.rules.schemaVersion, 'duel-rules-4');
  assert.equal(rules4(chaseFixture.issue.rules), true, JSON.stringify(rules4.errors));
  assert.ok(chaseFixture.issue.rulesId.startsWith('duel-rules-4:'));
  for (const c of chaseFixture.valid) {
    assert.equal(validate(c.receipt), true, JSON.stringify(validate.errors));
    assert.deepEqual(verifyFightReplay(chaseFixture.issue, chaseFixture.log, { battleId: c.receipt.battleId }).receipt, c.receipt);
  }
});
