// Offline fixture only (desktop-items-quantity-1). No Firebase account access or production calls: the pure host ruling
// (lib/desktopItems.ts validateItemCommand + applyItemCommand, lib/repairItems.ts healingQuantityPurchase) and the callable's
// refusal mapping (desktopItemsHost: failed-precondition, message = code, details {...extra, rejectionCode}), driven over
// fixed profiles at a fixed host time. Regenerate: npm run build, then node scripts/generate-desktop-items-quantity-fixture.mjs [out].
// Default out is the frozen fixture scripts/fixtures/desktop-items-2-quantity/cases.json; Unity mirrors it verbatim as
// Schemas/fixtures/desktop-items-2-quantity.fixture.json. The emulator test replays every case through Firestore.
// A reply is stored as its digest (the contract fields: schemaVersion, holosTokens, result, the bought item's row and, on a
// replay, alreadyProcessed) plus replySha256 = sha256 of the whole reply as JSON, so the unchanged rest of the inventory
// snapshot is pinned byte for byte without being copied into every case. A receipt is stored without its reply (it is the
// case's reply); storedReceiptOf names the case whose receipt a replay / conflict case is seeded with.
// `legacyCases` pin the request WITHOUT quantity (the legacy one-per-buy buy): same reply, writes, identity and refusals as
// main before this lane (README: checked against a build of main d4bfdf2).
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG; // the vendor-3 catalog lists expedition offers only when configured
const require = createRequire(import.meta.url);
const I = require('../lib/lib/desktopItems.js');
const H = require('../lib/lib/repairItems.js');

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const base = (extra = {}) => ({ holosTokens: 100000, emergencyPatches: 2, itemStocks: { repair_kit: 1, full_restore: 0 }, energyRefills: 1, ...extra });
const req = (itemId, quantity, requestId, extra = {}) => ({ schemaVersion: 'desktop-items-2', operation: 'buy', itemId, requestId, ...(quantity === undefined ? {} : { quantity }), ...extra });

export const sha256 = reply => createHash('sha256').update(JSON.stringify(reply)).digest('hex');
export const digest = reply => ({ schemaVersion: reply.schemaVersion, holosTokens: reply.holosTokens, result: reply.result,
  item: reply.items.find(i => i.listingId === reply.result?.itemId) ?? null, ...(reply.alreadyProcessed ? { alreadyProcessed: true } : {}) });
const full = {};
function run(name, profile, request, storedOf) {
  try {
    const command = I.validateItemCommand(request);
    const identity = JSON.stringify(command);
    if (storedOf) {
      const stored = full[storedOf];
      if (stored.identity !== identity) throw new I.ItemError('sequence_conflict');
      return { reply: digest({ ...stored.reply, alreadyProcessed: true }) };
    }
    const r = I.applyItemCommand(profile, null, command, NOW);
    full[name] = { identity, reply: r.reply };
    return { reply: digest(r.reply), replySha256: sha256(r.reply), updates: r.updates, receipt: { identity, createdAtMs: NOW } };
  } catch (e) {
    if (!(e instanceof I.ItemError || e instanceof H.RepairError)) throw e;
    return { refusal: { code: 'failed-precondition', message: e.code, details: { ...(e instanceof I.ItemError ? e.extra : undefined), rejectionCode: e.code } } };
  }
}
const into = target => (name, profile, request, storedOf) => { target[name] = { profile, request, ...(storedOf ? { storedReceiptOf: storedOf } : {}), ...run(name, profile, request, storedOf) }; };
const cases = {}, legacyCases = {};
const add = into(cases), legacy = into(legacyCases);

// Accepted: price = unitPrice x quantity, stock + quantity, one receipt each.
add('patchX5', base(), req('item.emergency_patch', 5, 'fx_patch_5'));
add('repairKitX1', base(), req('item.repair_kit', 1, 'fx_kit_1'));
add('fullRestoreX99', base(), req('item.full_restore', 99, 'fx_full_99'));
add('repairKitExactFunds', base({ holosTokens: 1000 }), req('item.repair_kit', 4, 'fx_kit_exact'));
add('patchToCap', base({ emergencyPatches: 994 }), req('item.emergency_patch', 5, 'fx_patch_cap'));
add('repairKitNoStocksYet', base({ itemStocks: undefined }), req('item.repair_kit', 3, 'fx_kit_new'));
// Replay and conflict against the patchX5 ledger entry.
add('replay', base(), req('item.emergency_patch', 5, 'fx_patch_5'), 'patchX5');
add('conflictQuantity', base(), req('item.emergency_patch', 6, 'fx_patch_5'), 'patchX5');
add('conflictItem', base(), req('item.repair_kit', 5, 'fx_patch_5'), 'patchX5');
add('conflictLegacyShape', base(), req('item.emergency_patch', undefined, 'fx_patch_5'), 'patchX5');
// Refusals (nothing written).
add('overCap', base({ itemStocks: { repair_kit: 995 } }), req('item.repair_kit', 5, 'fx_cap'));
add('overCapAtCap', base({ emergencyPatches: 999 }), req('item.emergency_patch', 1, 'fx_cap_full'));
add('overCapAboveCap', base({ itemStocks: { full_restore: 1200 } }), req('item.full_restore', 1, 'fx_cap_above'));
add('overCapBeforeFunds', base({ itemStocks: { repair_kit: 990 }, holosTokens: 0 }), req('item.repair_kit', 10, 'fx_cap_poor'));
add('notEnoughHolos', base({ holosTokens: 1000 }), req('item.full_restore', 3, 'fx_poor'));
add('notEnoughHolosOneUnitAffordable', base({ holosTokens: 300 }), req('item.repair_kit', 2, 'fx_poor_one'));
add('nonHealingItem', base(), req('item.energy_refill', 2, 'fx_energy'));
add('nonHealingItemX1', base(), req('item.energy_refill', 1, 'fx_energy_1'));
add('unknownItem', base(), req('item.mystery_box', 2, 'fx_unknown'));
add('useWithQuantity', base(), { ...req('item.repair_kit', 2, 'fx_use'), operation: 'use' });
add('favoriteWithQuantity', base(), { ...req('item.repair_kit', 2, 'fx_fav'), operation: 'favorite' });
add('quantityZero', base(), req('item.repair_kit', 0, 'fx_q0'));
add('quantity100', base(), req('item.repair_kit', 100, 'fx_q100'));
add('quantityNegative', base(), req('item.repair_kit', -3, 'fx_qneg'));
add('quantityFraction', base(), req('item.repair_kit', 2.5, 'fx_qf'));
add('quantityString', base(), req('item.repair_kit', '5', 'fx_qs'));
add('quantityNull', base(), req('item.repair_kit', null, 'fx_qn'));
add('requestIdMissing', base(), { schemaVersion: 'desktop-items-2', operation: 'buy', itemId: 'item.repair_kit', quantity: 2 });
add('requestIdMalformed', base(), req('item.repair_kit', 2, 'a b'));
add('withHolobotId', base(), req('item.repair_kit', 2, 'fx_bot', { holobotId: 'ace' }));
add('withPackId', base(), req('item.repair_kit', 2, 'fx_pack', { packId: 'basic' }));
add('withCurrentHealth', base(), req('item.repair_kit', 2, 'fx_hp', { currentHealth: 10 }));
add('clientPriceRefused', base(), req('item.repair_kit', 2, 'fx_price', { price: 1 }));
add('wrongSchemaVersion', base(), { ...req('item.repair_kit', 2, 'fx_v3'), schemaVersion: 'desktop-items-3' });
add('malformedBalance', base({ holosTokens: '100000' }), req('item.repair_kit', 2, 'fx_bad_holos'));
add('malformedStock', base({ itemStocks: { repair_kit: 1.5 } }), req('item.repair_kit', 2, 'fx_bad_stock'));
add('malformedPatches', base({ emergencyPatches: -1 }), req('item.emergency_patch', 2, 'fx_bad_patch'));
add('malformedItemStocks', base({ itemStocks: [] }), req('item.full_restore', 2, 'fx_bad_stocks'));

// Legacy pins: no `quantity` (today's request), unchanged by this lane.
legacy('legacyPatch', base(), req('item.emergency_patch', undefined, 'lg_patch'));
legacy('legacyRepairKit', base(), req('item.repair_kit', undefined, 'lg_kit'));
legacy('legacyFullRestore', base(), req('item.full_restore', undefined, 'lg_full'));
legacy('legacyEnergyRefill', base(), req('item.energy_refill', undefined, 'lg_energy'));
legacy('legacyNotEnoughHolos', base({ holosTokens: 50 }), req('item.repair_kit', undefined, 'lg_poor'));
legacy('legacyAboveCapUncapped', base({ emergencyPatches: 999 }), req('item.emergency_patch', undefined, 'lg_above_cap'));
legacy('legacyMalformedStock', base({ itemStocks: { repair_kit: 1.5 } }), req('item.repair_kit', undefined, 'lg_bad_stock'));
legacy('legacyUnknownKey', base(), req('item.repair_kit', undefined, 'lg_key', { amount: 5 }));

const fixture = {
  schemaVersion: I.ITEMS_SCHEMA,
  generatedBy: 'functions/scripts/generate-desktop-items-quantity-fixture.mjs',
  nowMs: NOW,
  rules: {
    quantityMin: H.HEALING_QUANTITY_MIN,
    quantityMax: H.HEALING_QUANTITY_MAX,
    stackCap: H.HEALING_STACK_CAP,
    healingItemIds: H.HEALING_ITEMS.map(i => i.id),
    unitPrices: Object.fromEntries(H.HEALING_ITEMS.map(i => [i.id, i.price])),
    ledgerEntryPath: 'itemInventories/{uid}/receipts/{requestId}',
  },
  cases,
  legacyCases,
};
if (import.meta.url === `file://${process.argv[1]}`) writeFileSync(process.argv[2] ?? new URL('./fixtures/desktop-items-2-quantity/cases.json', import.meta.url), JSON.stringify(fixture, null, 2) + '\n');
