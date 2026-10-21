import { writeFileSync } from 'node:fs';
import { buildReceipt2Fixture } from './lib/duel-receipt2-fixture.mjs';
const out = new URL('../../Schemas/fixtures/duel-receipt-2.fixture.json', import.meta.url);
writeFileSync(out, JSON.stringify(buildReceipt2Fixture(), null, 1) + '\n');
console.log('wrote', out.pathname);
