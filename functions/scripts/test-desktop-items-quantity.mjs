// desktop-items-quantity-1 (HolobotsUnity DECISIONS #72.32; mirrors market-quantity-host-1 / Mobile #175 for the healing items)
// domain tests: the optional `quantity` on a desktop-items-2 "buy" (lib/desktopItems.ts, lib/repairItems.ts), the additive
// Schemas/desktop-items-2.json field and the frozen fixture. Pure modules only; the Firestore lifecycle and the callable's
// error details are test-desktop-items-quantity-emulator.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;
const require = createRequire(import.meta.url);
const I = require('../lib/lib/desktopItems.js');
const H = require('../lib/lib/repairItems.js');
const V = require('../lib/lib/vendors.js');
const { default: Ajv2020 } = require('ajv/dist/2020');
const schema = require('../../Schemas/desktop-items-2.json');
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addSchema(schema);
const vRequest = ajv.getSchema('desktop-items-2');
const [vResult, vReply, vDetails, vReceipt] = ['quantityBuyResult', 'quantityBuyReply', 'quantityRefusalDetails', 'receipt'].map(n => ajv.getSchema(`desktop-items-2#/$defs/${n}`));
const fixture = require('./fixtures/desktop-items-2-quantity/cases.json');
const { digest, sha256 } = await import('./generate-desktop-items-quantity-fixture.mjs');

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const HEALING = [['item.emergency_patch', 100], ['item.repair_kit', 250], ['item.full_restore', 600]];
const stock = (id, n) => id === 'item.emergency_patch' ? { emergencyPatches: n } : { itemStocks: { [id.slice(5)]: n } };
const profile = (extra = {}) => ({ holosTokens: 1e6, ...extra });
const req = (itemId, quantity, requestId = 'r1', extra = {}) => ({ schemaVersion: 'desktop-items-2', operation: 'buy', itemId, requestId, ...(quantity === undefined ? {} : { quantity }), ...extra });
const buy = (p, r, now = NOW) => I.applyItemCommand(p, null, I.validateItemCommand(r), now);
const refusedWith = (fn, code, extra) => assert.throws(fn, e => {
  assert.ok(e instanceof I.ItemError, String(e)); assert.equal(e.code, code);
  assert.deepEqual(e.extra, extra, `${code} extra`); return true;
});

test('healing items are the quantity items; limits 1-99, cap 999; the vendor-3 healing listings are unchanged', () => {
  assert.deepEqual(H.HEALING_ITEMS.map(i => [i.id, i.price]), HEALING);
  assert.deepEqual([H.HEALING_QUANTITY_MIN, H.HEALING_QUANTITY_MAX, H.HEALING_STACK_CAP], [1, 99, 999]);
  assert.deepEqual(schema.$defs.healingItemId.enum, HEALING.map(([id]) => id), 'schema item enum = host set');
  assert.deepEqual([schema.$defs.quantity.minimum, schema.$defs.quantity.maximum, schema.$defs.quantityRefusalDetails.properties.cap.const], [1, 99, 999]);
  assert.equal(schema.properties.schemaVersion.const, I.ITEMS_SCHEMA, 'additive: still desktop-items-2');
  const listings = V.buildCatalog(profile(), 'marketplace', NOW).listings.filter(l => H.healingItem(l.listingId));
  assert.deepEqual(listings.map(l => [l.listingId, l.price, l.quantity]), HEALING.map(([id, price]) => [id, price, 1]));
  for (const l of listings) assert.deepEqual(l.purchase, { callable: 'desktopItemsHost', request: { schemaVersion: 'desktop-items-2', operation: 'buy', itemId: l.listingId, requestId: '<client-generated>' } });
});

test('price x quantity: one update debits unit price x quantity and raises the stock by quantity (every healing item, 1 / 2 / 50 / 99)', () => {
  for (const [id, unit] of HEALING) for (const quantity of [1, 2, 50, 99]) {
    const r = buy(profile(stock(id, 7)), req(id, quantity));
    assert.deepEqual(r.updates, { ...stock(id, 7 + quantity), holosTokens: 1e6 - unit * quantity }, `${id} x${quantity}`);
    assert.deepEqual(r.reply.result, { kind: 'buy', itemId: id, quantity, unitPrice: unit, price: unit * quantity, owned: 7 + quantity });
    assert.equal(r.reply.holosTokens, 1e6 - unit * quantity);
    assert.equal(r.reply.items.find(i => i.listingId === id).owned, 7 + quantity, 'the row and the result agree');
    assert.ok(vReply(r.reply), JSON.stringify(vReply.errors));
    assert.ok(vRequest(req(id, quantity)), JSON.stringify(vRequest.errors));
  }
  // The other healing stocks are carried, never reset; exactly one stock key plus the balance is written.
  const kit = buy(profile({ emergencyPatches: 3, itemStocks: { repair_kit: 1, full_restore: 2, sync_shard: 4 } }), req('item.repair_kit', 40));
  assert.deepEqual(kit.updates, { itemStocks: { repair_kit: 41, full_restore: 2, sync_shard: 4 }, holosTokens: 1e6 - 10000 });
});

test('inventory cap: owned + quantity may reach 999 but never pass it; over_cap carries cap/owned/maxQuantity and comes before funds', () => {
  assert.equal(buy(profile({ emergencyPatches: 994 }), req('item.emergency_patch', 5)).reply.result.owned, 999);
  assert.equal(buy(profile(stock('item.full_restore', 900)), req('item.full_restore', 99)).reply.result.owned, 999);
  refusedWith(() => buy(profile(stock('item.repair_kit', 995)), req('item.repair_kit', 5)), 'over_cap', { cap: 999, owned: 995, maxQuantity: 4 });
  refusedWith(() => buy(profile({ emergencyPatches: 999 }), req('item.emergency_patch', 1)), 'over_cap', { cap: 999, owned: 999, maxQuantity: 0 });
  // A stock already above the cap (grants and legacy buys are not capped) reads maxQuantity 0, never negative.
  refusedWith(() => buy(profile(stock('item.full_restore', 1200)), req('item.full_restore', 1)), 'over_cap', { cap: 999, owned: 1200, maxQuantity: 0 });
  refusedWith(() => buy(profile({ ...stock('item.repair_kit', 990), holosTokens: 0 }), req('item.repair_kit', 10)), 'over_cap', { cap: 999, owned: 990, maxQuantity: 9 });
  // The legacy one-per-buy request stays uncapped, as today.
  assert.equal(buy(profile({ emergencyPatches: 999 }), req('item.emergency_patch', undefined)).updates.emergencyPatches, 1000);
});

test('not enough Holos: exact funds buy to 0; one Holo short refuses with the host price / balance / shortfall', () => {
  const exact = buy(profile({ holosTokens: 1800 }), req('item.full_restore', 3));
  assert.equal(exact.updates.holosTokens, 0); assert.equal(exact.reply.holosTokens, 0);
  refusedWith(() => buy(profile({ holosTokens: 1799 }), req('item.full_restore', 3)), 'not_enough_holos', { price: 1800, holosTokens: 1799, shortfall: 1 });
  refusedWith(() => buy({}, req('item.emergency_patch', 2)), 'not_enough_holos', { price: 200, holosTokens: 0, shortfall: 200 });
  // A balance that covers ONE unit but not the total is short (the legacy single-unit check would have passed).
  refusedWith(() => buy(profile({ holosTokens: 300 }), req('item.repair_kit', 2)), 'not_enough_holos', { price: 500, holosTokens: 300, shortfall: 200 });
  // The legacy refusal carries no numbers.
  refusedWith(() => buy(profile({ holosTokens: 50 }), req('item.repair_kit', undefined)), 'not_enough_holos', undefined);
});

test('request validation: quantity only as an integer 1-99 on a healing buy, beside nothing but schemaVersion / operation / itemId / requestId', () => {
  assert.equal(JSON.stringify(I.validateItemCommand(req('item.repair_kit', 3, 'a_B-9'))), JSON.stringify({ schemaVersion: 'desktop-items-2', operation: 'buy', itemId: 'item.repair_kit', requestId: 'a_B-9', quantity: 3 }));
  const host = r => { try { I.validateItemCommand(r); return true; } catch (e) { assert.ok(e instanceof I.ItemError); assert.equal(e.code, 'invalid_request'); assert.equal(e.extra, undefined); return false; } };
  const refused = [];
  for (const quantity of [0, -1, 100, 2.5, '5', null, NaN, Infinity, true, [2], { n: 2 }]) refused.push(req('item.repair_kit', quantity));
  for (const itemId of ['item.energy_refill', 'item.exp_booster', 'item.gacha_ticket', 'item.arena_pass', 'buddy.light', 'item.mystery', 'item.REPAIR_KIT']) refused.push(req(itemId, 2), req(itemId, 1));
  for (const operation of ['use', 'favorite', 'read']) refused.push({ ...req('item.repair_kit', 2), operation });
  for (const extra of [{ holobotId: 'ace' }, { packId: 'basic' }, { currentHealth: 1 }, { price: 1 }, { unitPrice: 0 }, { owned: 0 }]) refused.push(req('item.repair_kit', 2, 'r', extra));
  refused.push((({ requestId, ...rest }) => rest)(req('item.repair_kit', 2)));
  for (const requestId of ['', 'a b', 'x'.repeat(129), 7, null]) refused.push(req('item.repair_kit', 2, requestId));
  refused.push({ ...req('item.repair_kit', 2), schemaVersion: 'desktop-items-3' });
  for (const r of refused) {
    assert.equal(host(r), false, JSON.stringify(r));
    // JSON-representable requests: the schema agrees with the host (NaN / Infinity are not JSON).
    if (JSON.stringify(r) === JSON.stringify(JSON.parse(JSON.stringify(r))) && !(typeof r.quantity === 'number' && !Number.isFinite(r.quantity))) assert.equal(vRequest(r), false, `schema: ${JSON.stringify(r)}`);
  }
  for (const [id] of HEALING) for (const quantity of [1, 2, 98, 99]) { assert.equal(host(req(id, quantity)), true); assert.equal(vRequest(req(id, quantity)), true); }
  // Absent = the legacy request, valid as before.
  for (const [id] of HEALING) assert.equal(I.validateItemCommand(req(id, undefined)).quantity, undefined);
});

test('malformed balance / stock fail closed (unavailable); the stock is read by the shared healingStock reader (absent or null = 0)', () => {
  for (const holosTokens of ['10000', [10000], null, NaN, -1, true, { v: 1 }])
    refusedWith(() => buy(profile({ holosTokens }), req('item.repair_kit', 2)), 'unavailable', undefined);
  for (const n of ['3', 1.5, -1, NaN, 2 ** 53, true, [1]]) {
    assert.throws(() => buy(profile(stock('item.repair_kit', n)), req('item.repair_kit', 2)), e => e.code === 'unavailable' && e.extra === undefined);
    assert.throws(() => buy(profile({ emergencyPatches: n }), req('item.emergency_patch', 2)), e => e.code === 'unavailable' && e.extra === undefined);
  }
  // The same reader as the catalog and the legacy buy: a null stock reads 0, as it always has.
  assert.equal(buy(profile({ emergencyPatches: null }), req('item.emergency_patch', 2)).reply.result.owned, 2);
  assert.equal(buy(profile(stock('item.repair_kit', null)), req('item.repair_kit', 2)).reply.result.owned, 2);
  for (const itemStocks of [[], 'x', 0, null]) assert.throws(() => buy(profile({ itemStocks }), req('item.full_restore', 2)), e => e.code === 'unavailable');
  assert.throws(() => H.healingQuantityPurchase(profile(), 'item.repair_kit', 100), e => e instanceof H.RepairError && e.code === 'invalid_request', 'the pure rule re-checks the limit');
  assert.throws(() => H.healingQuantityPurchase(profile(), 'item.energy_refill', 2), e => e.code === 'unknown_item');
});

test('one ledger entry per requestId: the receipt identity includes quantity, so a retry replays and another item / quantity / shape conflicts', () => {
  const identity = r => JSON.stringify(I.validateItemCommand(r));
  assert.equal(identity(req('item.repair_kit', 12, 'led_1')), '{"schemaVersion":"desktop-items-2","operation":"buy","itemId":"item.repair_kit","requestId":"led_1","quantity":12}');
  // The legacy identity is the pre-lane string byte for byte (the undefined quantity key is dropped by JSON).
  assert.equal(identity(req('item.repair_kit', undefined, 'led_1')), '{"schemaVersion":"desktop-items-2","operation":"buy","itemId":"item.repair_kit","requestId":"led_1"}');
  const ids = [req('item.repair_kit', 12, 'led_1'), req('item.repair_kit', 13, 'led_1'), req('item.full_restore', 12, 'led_1'), req('item.repair_kit', undefined, 'led_1'), req('item.repair_kit', 1, 'led_1')].map(identity);
  assert.equal(new Set(ids).size, ids.length, 'every variant has its own identity');
  const r = buy(profile(), req('item.repair_kit', 12, 'led_1'));
  assert.ok(vReceipt({ identity: ids[0], reply: r.reply, createdAtMs: NOW }), JSON.stringify(vReceipt.errors));
  assert.equal(vReceipt({ identity: ids[0], reply: { ...r.reply, alreadyProcessed: true }, createdAtMs: NOW }), false, 'a stored reply is never alreadyProcessed');
  assert.ok(vReply({ ...r.reply, alreadyProcessed: true }), 'the replay reply validates');
});

test('frozen legacy pins: a request without quantity keeps its reply (sha256), writes, receipt identity and refusal details exactly {rejectionCode}', () => {
  const entries = Object.entries(fixture.legacyCases);
  assert.equal(entries.length, 8);
  for (const [name, c] of entries) {
    assert.equal(c.request.quantity, undefined, name);
    let got;
    try { const cmd = I.validateItemCommand(c.request); const r = I.applyItemCommand(c.profile, null, cmd, fixture.nowMs); got = { reply: digest(r.reply), replySha256: sha256(r.reply), updates: r.updates, receipt: { identity: JSON.stringify(cmd), createdAtMs: fixture.nowMs } }; }
    catch (e) { got = { refusal: { code: 'failed-precondition', message: e.code, details: { ...e.extra, rejectionCode: e.code } } }; }
    const { profile: _p, request: _r, ...want } = c;
    assert.deepEqual(got, want, name);
    if (c.reply) assert.deepEqual(Object.keys(c.reply.result), ['kind', 'itemId'], `${name}: legacy result shape`);
    else assert.deepEqual(Object.keys(c.refusal.details), ['rejectionCode'], `${name}: legacy details`);
  }
});

test('frozen fixture: requests, results, replies and refusal details validate; host invariants hold; known-bads are rejected', () => {
  assert.equal(fixture.schemaVersion, 'desktop-items-2'); assert.equal(fixture.nowMs, NOW);
  assert.deepEqual(fixture.rules, { quantityMin: 1, quantityMax: 99, stackCap: 999, healingItemIds: HEALING.map(([id]) => id), unitPrices: Object.fromEntries(HEALING), ledgerEntryPath: 'itemInventories/{uid}/receipts/{requestId}' });
  const cases = Object.entries(fixture.cases);
  assert.equal(cases.filter(([, c]) => c.reply).length, 7); assert.equal(cases.filter(([, c]) => c.refusal).length, 31);
  for (const [name, c] of cases) {
    if (c.reply) {
      assert.ok(vRequest(c.request), `${name} request ${JSON.stringify(vRequest.errors)}`);
      assert.ok(vResult(c.reply.result), `${name} result ${JSON.stringify(vResult.errors)}`);
      const { result } = c.reply;
      assert.equal(result.price, result.unitPrice * result.quantity, `${name}: price = unitPrice x quantity`);
      assert.equal(result.unitPrice, fixture.rules.unitPrices[result.itemId], name);
      assert.equal(c.reply.item.owned, result.owned, `${name}: row = result`);
      if (!c.storedReceiptOf) {
        assert.equal(c.reply.holosTokens, c.profile.holosTokens - result.price, `${name}: balance`);
        assert.equal(Object.keys(c.updates).filter(k => k !== 'holosTokens').length, 1, `${name}: one stock field`);
        assert.equal(c.receipt.identity, JSON.stringify(I.validateItemCommand(c.request)), name);
        const r = I.applyItemCommand(c.profile, null, I.validateItemCommand(c.request), NOW);
        assert.equal(sha256(r.reply), c.replySha256, `${name}: whole reply`);
      } else { assert.equal(c.reply.alreadyProcessed, true, name); assert.deepEqual({ ...c.reply, alreadyProcessed: undefined }, { ...fixture.cases[c.storedReceiptOf].reply, alreadyProcessed: undefined }, name); }
    } else {
      assert.ok(vDetails(c.refusal.details), `${name} details ${JSON.stringify(vDetails.errors)}`);
      assert.equal(c.refusal.code, 'failed-precondition', name); assert.equal(c.refusal.message, c.refusal.details.rejectionCode, name);
      assert.equal(c.updates, undefined, `${name}: a refusal has no write`);
      if (!c.storedReceiptOf && !['unavailable', 'over_cap', 'not_enough_holos'].includes(c.refusal.details.rejectionCode)) assert.equal(vRequest(c.request), false, `${name}: the schema refuses the request too`);
    }
  }
  const ok = fixture.cases.patchX5.reply.result;
  for (const [label, bad] of [['quantity 100', { ...ok, quantity: 100 }], ['quantity 0', { ...ok, quantity: 0 }], ['extra field', { ...ok, bonus: 1 }],
    ['owned above the cap', { ...ok, owned: 1000 }], ['non-healing item', { ...ok, itemId: 'item.energy_refill' }], ['legacy result', { kind: 'buy', itemId: ok.itemId }], ['missing owned', (({ owned, ...rest }) => rest)(ok)]])
    assert.equal(vResult(bad), false, label);
  for (const [label, bad] of [['over_cap without maxQuantity', { rejectionCode: 'over_cap', cap: 999, owned: 995 }], ['not_enough_holos with cap', { rejectionCode: 'not_enough_holos', price: 1, holosTokens: 0, shortfall: 1, cap: 999 }],
    ['not_enough_holos without shortfall', { rejectionCode: 'not_enough_holos', price: 1, holosTokens: 0 }], ['invalid_request with numbers', { rejectionCode: 'invalid_request', owned: 1 }], ['unknown code', { rejectionCode: 'sold_out' }]])
    assert.equal(vDetails(bad), false, label);
});

test('fixture is reproducible from the host code (regenerate on any ruling change)', async () => {
  const { execFileSync } = await import('node:child_process'), { mkdtempSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'desktop-items-2-quantity-')), out = join(dir, 'cases.json');
  try {
    execFileSync(process.execPath, [new URL('./generate-desktop-items-quantity-fixture.mjs', import.meta.url).pathname, out], { stdio: 'ignore' });
    assert.equal(readFileSync(out, 'utf8'), readFileSync(new URL('./fixtures/desktop-items-2-quantity/cases.json', import.meta.url), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
