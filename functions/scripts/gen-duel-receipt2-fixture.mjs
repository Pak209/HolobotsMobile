import { writeFileSync } from 'node:fs';
import { buildReceipt2ChaseFixture, buildReceipt2Fixture } from './lib/duel-receipt2-fixture.mjs';
const out = new URL('../../Schemas/fixtures/duel-receipt-2.fixture.json', import.meta.url);
writeFileSync(out, JSON.stringify(buildReceipt2Fixture(), null, 1) + '\n');
console.log('wrote', out.pathname);
const chase = new URL('../../Schemas/fixtures/duel-receipt-2-chase.fixture.json', import.meta.url);   // duel-rules-4-1
writeFileSync(chase, JSON.stringify(buildReceipt2ChaseFixture(), null, 1) + '\n');
console.log('wrote', chase.pathname);
