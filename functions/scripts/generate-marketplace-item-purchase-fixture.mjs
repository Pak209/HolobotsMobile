// Offline fixture only (market-quantity-host-1). No Firebase account access or production calls: the pure host
// ruling (lib/marketplaceQuantity.ts) and the callable refusal mapper (lib/marketplaceRefusals.ts refusalError),
// driven over fixed profiles at a fixed host time. Regenerate: npm run build, then
// node scripts/generate-marketplace-item-purchase-fixture.mjs [out]. Default out is the frozen fixture
// scripts/fixtures/marketplace-item-purchase-1/cases.json; Unity mirrors it verbatim as
// Schemas/fixtures/marketplace-item-purchase-1.fixture.json. The emulator test replays every case through Firestore.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const Q = require('../lib/lib/marketplaceQuantity.js');
const { refusalError } = require('../lib/lib/marketplaceRefusals.js');

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 86400000;
const base = (extra = {}) => ({ holosTokens: 10000, arenaPassses: 2, gachaTickets: 3, energyRefills: 0, expBoosters: 1, rankSkips: 0, wildcardBlueprints: 5, lastWildcardPackAt: NOW - 8 * DAY, ...extra });
const req = (itemName, quantity, requestId) => ({ itemName, quantity, requestId });

function run(profile, request, stored) {
  try {
    const command = Q.validateQuantityPurchase(request);
    if (stored) return { reply: Q.replayQuantityPurchase(stored, command) };
    const r = Q.buildQuantityPurchase(profile, command, NOW);
    return { reply: r.reply, updates: r.updates, receipt: r.receipt };
  } catch (e) {
    if (!(e instanceof Q.QuantityPurchaseRefusal)) throw e;
    const h = refusalError(e.refusal, e.extra);
    return { refusal: { code: h.code, message: h.message, details: h.details } };
  }
}
const cases = {};
const add = (name, profile, request, stored) => { cases[name] = { profile, request, ...(stored ? { storedReceipt: stored } : {}), ...run(profile, request, stored) }; };

// Accepted: price = unitPrice x quantity, counter + quantity, one receipt each.
add('arenaPassX5', base(), req('Arena Pass', 5, 'fx_arena_5'));
add('gachaTicketX1', base(), req('Gacha Ticket', 1, 'fx_gacha_1'));
add('energyRefillX99', base({ holosTokens: 20000 }), req('Energy Refill', 99, 'fx_energy_99'));
add('rankSkipExactFunds', base({ holosTokens: 15000 }), req('Rank Skip', 3, 'fx_rank_3'));
add('expBoosterToCap', base({ expBoosters: 994, holosTokens: 5000 }), req('EXP Booster', 5, 'fx_exp_cap'));
add('wildcardPackX1', base(), req('Wildcard Blueprints', 1, 'fx_wildcard_1'));
// Replay and conflict against the arenaPassX5 ledger entry.
add('replay', base(), req('Arena Pass', 5, 'fx_arena_5'), cases.arenaPassX5.receipt);
add('conflictQuantity', base(), req('Arena Pass', 6, 'fx_arena_5'), cases.arenaPassX5.receipt);
add('conflictItem', base(), req('Gacha Ticket', 5, 'fx_arena_5'), cases.arenaPassX5.receipt);
// Refusals (nothing written).
add('notStackable', base(), req('Wildcard Blueprints', 2, 'fx_ns'));
add('overCap', base({ gachaTickets: 995 }), req('Gacha Ticket', 5, 'fx_cap'));
add('overCapAtCap', base({ gachaTickets: 999 }), req('Gacha Ticket', 1, 'fx_cap_full'));
add('overCapBeforeFunds', base({ rankSkips: 990, holosTokens: 0 }), req('Rank Skip', 10, 'fx_cap_poor'));
add('notEnoughHolos', base({ holosTokens: 2000 }), req('EXP Booster', 3, 'fx_poor'));
add('onCooldown', base({ lastWildcardPackAt: NOW - 3 * DAY }), req('Wildcard Blueprints', 1, 'fx_cd'));
add('unknownItem', base(), req('Mystery Box', 2, 'fx_unknown'));
add('itemNameMissing', base(), { quantity: 2, requestId: 'fx_noname' });
add('quantityZero', base(), req('Arena Pass', 0, 'fx_q0'));
add('quantity100', base(), req('Arena Pass', 100, 'fx_q100'));
add('quantityFraction', base(), req('Arena Pass', 2.5, 'fx_qf'));
add('quantityString', base(), req('Arena Pass', '5', 'fx_qs'));
add('quantityNull', base(), req('Arena Pass', null, 'fx_qn'));
add('requestIdMissing', base(), { itemName: 'Arena Pass', quantity: 2 });
add('requestIdMalformed', base(), req('Arena Pass', 2, 'a b'));
add('clientPriceRefused', base(), { ...req('Arena Pass', 2, 'fx_price'), price: 1 });
add('malformedBalance', base({ holosTokens: '10000' }), req('Arena Pass', 2, 'fx_bad_holos'));
add('malformedCounter', base({ arenaPassses: 1.5 }), req('Arena Pass', 2, 'fx_bad_count'));

const fixture = {
  schemaVersion: Q.MARKETPLACE_PURCHASE_SCHEMA,
  generatedBy: 'functions/scripts/generate-marketplace-item-purchase-fixture.mjs',
  nowMs: NOW,
  rules: {
    quantityMin: Q.MARKETPLACE_QUANTITY_MIN,
    quantityMax: Q.MARKETPLACE_QUANTITY_MAX,
    stackCap: Q.MARKETPLACE_STACK_CAP,
    stackableItemNames: [...Q.MARKETPLACE_STACKABLE_ITEM_NAMES],
    ledgerEntryPath: `vendorPurchases/{uid}/${Q.MARKETPLACE_RECEIPTS_COLLECTION}/{requestId}`,
  },
  cases,
};
writeFileSync(process.argv[2] ?? new URL('./fixtures/marketplace-item-purchase-1/cases.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
