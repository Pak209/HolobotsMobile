// market-quantity-host-1 (HolobotsUnity DECISIONS #72.26, UI plan P3) domain tests: the optional `quantity` on
// purchaseMarketplaceItem (lib/marketplaceQuantity.ts), its refusals (lib/marketplaceRefusals.ts) and the
// marketplace-item-purchase-1 schema + frozen fixture. Pure modules only; the Firestore lifecycle is
// test-marketplace-quantity-emulator.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const Q = require('../lib/lib/marketplaceQuantity.js');
const R = require('../lib/lib/marketplaceRefusals.js');
const E = require('../lib/lib/economy.js');
const V = require('../lib/lib/vendors.js');
const { default: Ajv } = require('ajv');
const schema = require('../../Schemas/marketplace-item-purchase-1.json');
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(schema);
const def = name => ajv.getSchema(`${schema.$id}#/definitions/${name}`);
const [vRequest, vReply, vDetails, vReceipt] = ['request', 'reply', 'refusalDetails', 'receipt'].map(def);
const fixture = require('./fixtures/marketplace-item-purchase-1/cases.json');

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const DAY = 86400000;
const STACKABLES = ['Arena Pass', 'Gacha Ticket', 'Energy Refill', 'EXP Booster', 'Rank Skip'];
const profile = (extra = {}) => ({ holosTokens: 1e6, arenaPassses: 0, gachaTickets: 0, energyRefills: 0, expBoosters: 0, rankSkips: 0, wildcardBlueprints: 0, ...extra });
const cmd = (itemName, quantity, requestId = 'r1') => ({ itemName, quantity, requestId });
const refusedWith = (fn, rejectionCode, extra) => assert.throws(fn, e => {
  assert.ok(e instanceof Q.QuantityPurchaseRefusal, String(e));
  assert.equal(e.refusal.rejectionCode, rejectionCode);
  if (extra) assert.deepEqual(e.extra, extra);
  return true;
});
const buy = (p, c, now = NOW) => Q.buildQuantityPurchase(p, c, now);

test('stackables are every marketplace single item but the weekly Wildcard pack; limits 1-99, cap 999; vendor-3 listings unchanged', () => {
  assert.deepEqual([...Q.MARKETPLACE_STACKABLE_ITEM_NAMES], STACKABLES);
  assert.deepEqual([...Q.MARKETPLACE_STACKABLE_ITEM_NAMES, 'Wildcard Blueprints'], E.MARKETPLACE_ITEM_NAMES);
  assert.deepEqual([Q.MARKETPLACE_QUANTITY_MIN, Q.MARKETPLACE_QUANTITY_MAX, Q.MARKETPLACE_STACK_CAP], [1, 99, 999]);
  assert.equal(Q.MARKETPLACE_PURCHASE_SCHEMA, 'marketplace-item-purchase-1');
  assert.deepEqual(schema.definitions.stackableItemName.enum, STACKABLES, 'schema stackable enum = host set');
  assert.deepEqual(schema.definitions.itemName.enum, E.MARKETPLACE_ITEM_NAMES, 'schema item enum = host set');
  for (const name of E.MARKETPLACE_ITEM_NAMES) assert.ok(V.ITEM_INVENTORY_FIELD[name], name);
  // The vendor-3 catalog is not part of this change: same listing request, and `quantity` there is units per purchase.
  const items = V.buildCatalog(profile(), 'marketplace', NOW).listings.filter(l => l.purchase.callable === 'purchaseMarketplaceItem');
  assert.deepEqual(items.map(l => [l.displayName, l.quantity]), [...STACKABLES.map(n => [n, 1]), ['Wildcard Blueprints', 5]]);
  for (const l of items) assert.deepEqual(l.purchase.request, { itemName: l.displayName });
});

test('price x quantity: one update debits unitPrice x quantity and raises the counter by quantity (every stackable, 1 / 2 / 50 / 99)', () => {
  for (const name of STACKABLES) for (const quantity of [1, 2, 50, 99]) {
    const field = V.ITEM_INVENTORY_FIELD[name];
    const r = buy(profile({ [field]: 7 }), cmd(name, quantity));
    const unit = E.getMarketplacePrice(name);
    assert.deepEqual(r.updates, { holosTokens: 1e6 - unit * quantity, [field]: 7 + quantity }, `${name} x${quantity}`);
    assert.deepEqual(r.reply, { schemaVersion: 'marketplace-item-purchase-1', requestId: 'r1', itemName: name, quantity, unitPrice: unit, price: unit * quantity, holosTokens: 1e6 - unit * quantity, owned: 7 + quantity, alreadyProcessed: false });
    assert.ok(vReply(r.reply), JSON.stringify(vReply.errors));
  }
  // Exactly one field per effect: no per-unit loop leaves a trail (the legacy field name keeps its triple s).
  assert.deepEqual(Object.keys(buy(profile(), cmd('Arena Pass', 40)).updates).sort(), ['arenaPassses', 'holosTokens']);
});

test('inventory cap: owned + quantity may reach 999 but never pass it; over_cap carries cap/owned/maxQuantity and comes before funds', () => {
  assert.equal(buy(profile({ gachaTickets: 994 }), cmd('Gacha Ticket', 5)).reply.owned, 999);
  assert.equal(buy(profile({ gachaTickets: 900 }), cmd('Gacha Ticket', 99)).reply.owned, 999);
  refusedWith(() => buy(profile({ gachaTickets: 995 }), cmd('Gacha Ticket', 5)), 'over_cap', { cap: 999, owned: 995, maxQuantity: 4 });
  refusedWith(() => buy(profile({ gachaTickets: 999 }), cmd('Gacha Ticket', 1)), 'over_cap', { cap: 999, owned: 999, maxQuantity: 0 });
  // A counter already above the cap (grants from other sources are not capped) reads maxQuantity 0, never negative.
  refusedWith(() => buy(profile({ rankSkips: 1200 }), cmd('Rank Skip', 1)), 'over_cap', { cap: 999, owned: 1200, maxQuantity: 0 });
  refusedWith(() => buy(profile({ rankSkips: 990, holosTokens: 0 }), cmd('Rank Skip', 10)), 'over_cap', { cap: 999, owned: 990, maxQuantity: 9 });
});

test('not enough Holos: exact funds buy to 0; one Holo short refuses with the host price / balance / shortfall', () => {
  const exact = buy(profile({ holosTokens: 15000 }), cmd('Rank Skip', 3));
  assert.equal(exact.reply.holosTokens, 0); assert.equal(exact.updates.holosTokens, 0);
  refusedWith(() => buy(profile({ holosTokens: 14999 }), cmd('Rank Skip', 3)), 'not_enough_holos', { price: 15000, holosTokens: 14999, shortfall: 1 });
  refusedWith(() => buy({}, cmd('Arena Pass', 2)), 'not_enough_holos', { price: 100, holosTokens: 0, shortfall: 100 });
  // A balance that covers ONE unit but not the total is short (the legacy single-unit check would have passed).
  refusedWith(() => buy(profile({ holosTokens: 750 }), cmd('EXP Booster', 2)), 'not_enough_holos', { price: 1500, holosTokens: 750, shortfall: 750 });
});

test('Wildcard pack: quantity 1 is the legacy grant (5 units, cooldown stamp); 2-99 not_stackable; inside 7 days on_cooldown', () => {
  const w = buy(profile({ wildcardBlueprints: 5, lastWildcardPackAt: NOW - 8 * DAY }), cmd('Wildcard Blueprints', 1));
  assert.deepEqual(w.updates, { lastWildcardPackAt: NOW, holosTokens: 1e6 - 300, wildcardBlueprints: 10 });
  assert.equal(w.reply.owned, 10); assert.equal(w.reply.price, 300);
  assert.equal(buy(profile(), cmd('Wildcard Blueprints', 1)).reply.owned, 5, 'never bought = open');
  for (const quantity of [2, 5, 99]) refusedWith(() => buy(profile(), cmd('Wildcard Blueprints', quantity)), 'not_stackable');
  refusedWith(() => buy(profile({ lastWildcardPackAt: NOW - 3 * DAY }), cmd('Wildcard Blueprints', 1)), 'on_cooldown');
  refusedWith(() => buy(profile({ lastWildcardPackAt: NOW - 3 * DAY }), cmd('Wildcard Blueprints', 2)), 'not_stackable', undefined);
  // The cap is a stackable rule: a large blueprint count does not block the weekly pack.
  assert.equal(buy(profile({ wildcardBlueprints: 5000 }), cmd('Wildcard Blueprints', 1)).reply.owned, 5005);
});

test('request validation: exactly {itemName, quantity integer 1-99, requestId}; the quantity path is chosen by the key alone', () => {
  assert.deepEqual(Q.validateQuantityPurchase({ itemName: 'Arena Pass', quantity: 3, requestId: 'a_B-9' }), { itemName: 'Arena Pass', quantity: 3, requestId: 'a_B-9' });
  for (const quantity of [0, -1, 100, 2.5, '5', null, NaN, Infinity, true, [2], { n: 2 }])
    refusedWith(() => Q.validateQuantityPurchase({ itemName: 'Arena Pass', quantity, requestId: 'r' }), 'invalid_request');
  for (const requestId of [undefined, '', 'a b', 'x'.repeat(129), 7, 'é'])
    refusedWith(() => Q.validateQuantityPurchase({ itemName: 'Arena Pass', quantity: 2, requestId }), 'invalid_request');
  for (const extra of [{ price: 1 }, { unitPrice: 0 }, { owned: 0 }, { schemaVersion: 'marketplace-item-purchase-1' }])
    refusedWith(() => Q.validateQuantityPurchase({ itemName: 'Arena Pass', quantity: 2, requestId: 'r', ...extra }), 'invalid_request');
  assert.throws(() => Q.validateQuantityPurchase({ quantity: 2, requestId: 'r' }), e => e.refusal === R.REFUSALS.itemNameRequired);
  assert.throws(() => Q.validateQuantityPurchase({ itemName: '  ', quantity: 2, requestId: 'r' }), e => e.refusal === R.REFUSALS.itemNameRequired);
  assert.ok(Q.validateQuantityPurchase({ itemName: 'x'.repeat(129), quantity: 2, requestId: 'r' }), 'any item name passes validation; the host answers unknown_item');
  refusedWith(() => buy(profile(), cmd('Mystery Box', 2)), 'unknown_item');
  refusedWith(() => buy(profile(), cmd('arena pass', 2)), 'unknown_item', undefined);
  for (const raw of [{ itemName: 'Arena Pass', quantity: 1 }, { quantity: null }, { quantity: 0 }]) assert.equal(Q.isQuantityPurchase(raw), true, JSON.stringify(raw));
  for (const raw of [undefined, null, 'x', [], {}, { itemName: 'Arena Pass' }, { itemName: 'Arena Pass', requestId: 'r' }, { itemName: 'Arena Pass', quantity: undefined }])
    assert.equal(Q.isQuantityPurchase(raw), false, JSON.stringify(raw));
});

test('malformed balance / counter / pack time fail closed (unavailable), never coerced', () => {
  for (const holosTokens of ['10000', [10000], null, NaN, -1, true, { v: 1 }])
    refusedWith(() => buy(profile({ holosTokens }), cmd('Arena Pass', 2)), 'unavailable');
  for (const arenaPassses of ['3', 1.5, -1, null, NaN, 2 ** 53])
    refusedWith(() => buy(profile({ arenaPassses }), cmd('Arena Pass', 2)), 'unavailable');
  for (const lastWildcardPackAt of ['0', null, -5, NaN])
    refusedWith(() => buy(profile({ lastWildcardPackAt }), cmd('Wildcard Blueprints', 1)), 'unavailable');
  assert.equal(R.QUANTITY_REFUSALS.accountUnavailable.httpsCode, 'failed-precondition');
});

test('one ledger entry: the receipt holds item, quantity, time and the reply; replay returns it once more; another item or quantity is sequence_conflict', () => {
  const r = buy(profile(), cmd('Energy Refill', 12, 'led_1'));
  assert.deepEqual(r.receipt, { schemaVersion: 'marketplace-item-purchase-1', itemName: 'Energy Refill', quantity: 12, createdAtMs: NOW, reply: r.reply });
  assert.ok(vReceipt(r.receipt), JSON.stringify(vReceipt.errors));
  assert.equal(Q.MARKETPLACE_RECEIPTS_COLLECTION, 'marketplaceItems');
  assert.deepEqual(Q.replayQuantityPurchase(r.receipt, cmd('Energy Refill', 12, 'led_1')), { ...r.reply, alreadyProcessed: true });
  refusedWith(() => Q.replayQuantityPurchase(r.receipt, cmd('Energy Refill', 13, 'led_1')), 'sequence_conflict');
  refusedWith(() => Q.replayQuantityPurchase(r.receipt, cmd('Gacha Ticket', 12, 'led_1')), 'sequence_conflict');
  for (const bad of [undefined, null, {}, { itemName: 'Energy Refill', quantity: 12 }, { tierId: 'buddy_medium', reply: {} }])
    refusedWith(() => Q.replayQuantityPurchase(bad, cmd('Energy Refill', 12, 'led_1')), 'sequence_conflict');
  const stored = { ...r.receipt, reply: { ...r.reply, alreadyProcessed: true } };
  assert.equal(vReceipt(stored), false, 'a stored ledger reply is never alreadyProcessed');
});

test('legacy single purchase untouched: no `quantity` = old builder and refusal details exactly {rejectionCode}', () => {
  assert.deepEqual(E.buildItemPurchaseUpdatesRaw({ holosTokens: 100, arenaPassses: 1 }, 'Arena Pass'), { price: 50, updates: { holosTokens: 50, arenaPassses: 2 } });
  assert.equal(E.buildItemPurchaseUpdatesRaw({ holosTokens: 40 }, 'Arena Pass'), null);
  for (const r of [R.REFUSALS.notEnoughHolos, R.REFUSALS.unknownItem, R.REFUSALS.wildcardCooldown, R.REFUSALS.itemNameRequired, R.REFUSALS.profileMissing]) {
    const h = R.refusalError(r);
    assert.deepEqual([h.code, h.message, h.details], [r.httpsCode, r.message, { rejectionCode: r.rejectionCode }]);
  }
  assert.deepEqual(R.REFUSALS.notEnoughHolos, { rejectionCode: 'not_enough_holos', httpsCode: 'failed-precondition', message: 'Not enough Holos.' });
  assert.deepEqual(R.REFUSALS.wildcardCooldown, { rejectionCode: 'on_cooldown', httpsCode: 'invalid-argument', message: 'Unknown marketplace item.' });
  assert.equal(R.refusalError(R.QUANTITY_REFUSALS.overCap, { rejectionCode: 7 }).details.rejectionCode, 'over_cap', 'extra numbers never replace the code');
});

test('frozen fixture: requests, replies, ledger entries and refusal details validate; host invariants hold; known-bads are rejected', () => {
  assert.equal(fixture.schemaVersion, 'marketplace-item-purchase-1'); assert.equal(fixture.nowMs, NOW);
  assert.deepEqual(fixture.rules, { quantityMin: 1, quantityMax: 99, stackCap: 999, stackableItemNames: STACKABLES, ledgerEntryPath: 'vendorPurchases/{uid}/marketplaceItems/{requestId}' });
  const cases = Object.entries(fixture.cases);
  assert.equal(cases.filter(([, c]) => c.reply).length, 7); assert.equal(cases.filter(([, c]) => c.refusal).length, 20);
  for (const [name, c] of cases) {
    if (c.reply) {
      assert.ok(vRequest(c.request), `${name} request ${JSON.stringify(vRequest.errors)}`);
      assert.ok(vReply(c.reply), `${name} reply ${JSON.stringify(vReply.errors)}`);
      assert.equal(c.reply.price, c.reply.unitPrice * c.reply.quantity, `${name}: price = unitPrice x quantity`);
      assert.equal(c.reply.unitPrice, E.getMarketplacePrice(c.reply.itemName), name);
      if (!c.storedReceipt) {
        assert.equal(c.reply.holosTokens, c.profile.holosTokens - c.reply.price, `${name}: balance`);
        assert.ok(vReceipt(c.receipt), `${name} receipt ${JSON.stringify(vReceipt.errors)}`);
        assert.equal(Object.keys(c.updates).filter(k => k !== 'holosTokens' && k !== 'lastWildcardPackAt').length, 1, `${name}: one counter`);
      } else assert.equal(c.reply.alreadyProcessed, true, name);
    } else {
      assert.ok(vDetails(c.refusal.details), `${name} details ${JSON.stringify(vDetails.errors)}`);
      assert.ok(['invalid-argument', 'failed-precondition'].includes(c.refusal.code), name);
      assert.equal(c.updates, undefined, `${name}: a refusal has no write`);
    }
  }
  const ok = fixture.cases.arenaPassX5.reply;
  for (const [label, bad] of [
    ['quantity 100', { ...ok, quantity: 100 }], ['quantity 0', { ...ok, quantity: 0 }], ['extra field', { ...ok, bonus: 1 }],
    ['stackable owned above the cap', { ...ok, owned: 1000 }], ['Wildcard quantity 2', { ...fixture.cases.wildcardPackX1.reply, quantity: 2 }],
    ['wrong schema', { ...ok, schemaVersion: 'marketplace-item-purchase-2' }], ['missing owned', (({ owned, ...rest }) => rest)(ok)],
  ]) assert.equal(vReply(bad), false, label);
  for (const [label, bad] of [
    ['over_cap without maxQuantity', { rejectionCode: 'over_cap', cap: 999, owned: 995 }],
    ['not_enough_holos with cap', { rejectionCode: 'not_enough_holos', price: 1, holosTokens: 0, shortfall: 1, cap: 999 }],
    ['not_stackable with numbers', { rejectionCode: 'not_stackable', owned: 1 }], ['unknown code', { rejectionCode: 'sold_out' }],
  ]) assert.equal(vDetails(bad), false, label);
  for (const [label, bad] of [
    ['Wildcard x2', { itemName: 'Wildcard Blueprints', quantity: 2, requestId: 'r' }], ['client price', { itemName: 'Arena Pass', quantity: 2, requestId: 'r', price: 1 }],
    ['no requestId', { itemName: 'Arena Pass', quantity: 2 }], ['legacy shape', { itemName: 'Arena Pass' }],
  ]) assert.equal(vRequest(bad), false, label);
});

test('fixture is reproducible from the host code (regenerate on any ruling change)', async () => {
  const { execFileSync } = await import('node:child_process'), { mkdtempSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'marketplace-item-purchase-1-')), out = join(dir, 'cases.json');
  try {
    execFileSync(process.execPath, [new URL('./generate-marketplace-item-purchase-fixture.mjs', import.meta.url).pathname, out], { stdio: 'ignore' });
    assert.equal(readFileSync(out, 'utf8'), readFileSync(new URL('./fixtures/marketplace-item-purchase-1/cases.json', import.meta.url), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
