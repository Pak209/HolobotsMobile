// DECISIONS #47 vendor catalog + Buddy Unit purchase domain tests (pure module).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const V = require('../lib/lib/vendors.js');
const E = require('../lib/lib/economy.js');
const B = require('../lib/lib/buddyUnits.js');
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const inv = (light = 0, medium = 0, heavy = 0) => ({ light, medium, heavy });
const profile = (extra = {}) => ({ holosTokens: 1000, arenaPassses: 2, gachaTickets: 3, energyRefills: 1, expBoosters: 0, rankSkips: 0, wildcardBlueprints: 5, parts: [{ name: 'Combat Mask', slot: 'head' }, { name: 'Combat Mask', slot: 'head' }], buddyUnits: inv(1, 2, 0), ...extra });

test('marketplace catalog: every item, booster and Buddy Unit at the economy / data-module price, with its purchase call', () => {
  const c = V.buildCatalog(profile(), 'marketplace', NOW);
  assert.equal(c.schemaVersion, 'vendor-3'); assert.equal(c.vendorId, 'marketplace'); assert.equal(c.holosTokens, 1000);
  const items = c.listings.filter(l => l.kind === 'item');
  assert.deepEqual(items.map(l => l.displayName), E.MARKETPLACE_ITEM_NAMES);
  for (const l of items) { assert.equal(l.price, E.getMarketplacePrice(l.displayName)); assert.deepEqual(l.purchase, { callable: 'purchaseMarketplaceItem', request: { itemName: l.displayName } }); }
  assert.deepEqual(items.map(l => l.price), [50, 100, 200, 750, 5000, 300]);
  const boosters = c.listings.filter(l => l.kind === 'booster');
  assert.deepEqual(Object.fromEntries(boosters.map(l => [l.details.packId, l.price])), E.MARKETPLACE_BOOSTER_PRICES);
  for (const l of boosters) { assert.deepEqual(l.purchase, { callable: 'purchaseMarketplaceBooster', request: { packId: l.details.packId } }); assert.equal(l.details.bonusItem, E.BOOSTER_ITEM_AWARD_MAP[l.details.packId]); }
  const buddy = c.listings.filter(l => l.kind === 'buddy_unit');
  assert.deepEqual(buddy.map(l => [l.details.tierId, l.price, l.owned]), [['buddy_medium', 300, 2], ['buddy_heavy', 1500, 0]]);
  assert.deepEqual(buddy[0].purchase, { callable: 'purchaseBuddyUnit', request: { tierId: 'buddy_medium', requestId: '<client-generated>' } });
  assert.deepEqual(B.BUDDY_UNIT_PRICES_HOLOS, { medium: 300, heavy: 1500 });
  assert.equal(c.listings.some(l => l.kind === 'part' || l.kind === 'clothing'), false);
  assert.deepEqual(c.listings.map(l => [l.listingId, l.affordable]).filter(([, a]) => !a).map(([id]) => id), ['item.rank_skip', 'buddy.heavy']);
  assert.equal(new Set(c.listings.map(l => l.listingId)).size, c.listings.length);
});

test('workshop catalog: every MARKETPLACE_PART_CATALOG part at its price with owned copies', () => {
  const c = V.buildCatalog(profile(), 'workshop', NOW);
  assert.deepEqual(c.listings.map(l => [l.listingId, l.price, l.details.rarity, l.details.slot]), E.MARKETPLACE_PART_CATALOG.map(o => [o.id, o.price, o.rarity, o.slot]));
  for (const l of c.listings) assert.deepEqual(l.purchase, { callable: 'purchaseMarketplacePart', request: { partId: l.listingId } });
  assert.equal(c.listings.find(l => l.listingId === 'part.combatMask').owned, 2);
  assert.deepEqual(c.inventory, { arenaPasses: 2, gachaTickets: 3, energyRefills: 1, expBoosters: 0, rankSkips: 0, wildcardBlueprints: 5, parts: 2, buddyUnits: inv(1, 2, 0) });
});

test('weekly Wildcard pack: unavailable with its reopen time inside the cooldown, available after; quantity 5', () => {
  const day = 86400000;
  const w = c => c.listings.find(l => l.listingId === 'item.wildcard_blueprints');
  const shut = w(V.buildCatalog(profile({ lastWildcardPackAt: NOW - 3 * day }), 'marketplace', NOW));
  assert.equal(shut.available, false); assert.equal(shut.availableAtMs, NOW - 3 * day + E.WILDCARD_PACK_COOLDOWN_MS); assert.equal(shut.quantity, 5);
  const open = w(V.buildCatalog(profile({ lastWildcardPackAt: NOW - 8 * day }), 'marketplace', NOW));
  assert.equal(open.available, true); assert.equal(open.availableAtMs, 0);
});

test('catalog is a pure read: missing / integer buddyUnits are reported as they will be stored; malformed fails closed; bad vendors rejected', () => {
  assert.deepEqual(V.buildCatalog({}, 'marketplace', NOW).inventory.buddyUnits, inv(1));
  assert.deepEqual(V.buildCatalog({ buddyUnits: 4 }, 'marketplace', NOW).inventory.buddyUnits, inv(4));
  assert.throws(() => V.buildCatalog({ buddyUnits: { light: 1 } }, 'marketplace', NOW), /unavailable/);
  for (const bad of [null, {}, { operation: 'catalog' }, { operation: 'catalog', vendorId: 'portal' }, { operation: 'buy', vendorId: 'marketplace' }]) assert.throws(() => V.validateCatalogCommand(bad), /invalid_request/);
  assert.deepEqual(V.validateCatalogCommand({ operation: 'catalog', vendorId: 'workshop' }), { operation: 'catalog', vendorId: 'workshop' });
});

test('Buddy Unit purchase: Medium 300 / Heavy 1500 spend Holos and add one of that tier in the same update', () => {
  const m = V.buildBuddyUnitPurchase(profile(), V.validateBuddyPurchase({ tierId: 'buddy_medium', requestId: 'r1' }));
  assert.deepEqual(m.updates, { holosTokens: 700, buddyUnits: inv(1, 3, 0) });
  assert.deepEqual(m.reply, { schemaVersion: 'vendor-3', requestId: 'r1', tierId: 'buddy_medium', price: 300, holosTokens: 700, buddyUnits: inv(1, 3, 0), alreadyProcessed: false });
  const h = V.buildBuddyUnitPurchase(profile({ holosTokens: 1500 }), V.validateBuddyPurchase({ tierId: 'buddy_heavy', requestId: 'r2' }));
  assert.deepEqual(h.updates, { holosTokens: 0, buddyUnits: inv(1, 2, 1) });
  // #43 integer / missing inventories are migrated in the same write.
  assert.deepEqual(V.buildBuddyUnitPurchase({ holosTokens: 300, buddyUnits: 2 }, { tierId: 'buddy_medium', requestId: 'r' }).updates.buddyUnits, inv(2, 1, 0));
  assert.deepEqual(V.buildBuddyUnitPurchase({ holosTokens: 300 }, { tierId: 'buddy_medium', requestId: 'r' }).updates.buddyUnits, inv(1, 1, 0));
});

test('Buddy Unit purchase refusals: not enough Holos, Light not for sale, bad ids, malformed data', () => {
  assert.throws(() => V.buildBuddyUnitPurchase(profile({ holosTokens: 299 }), { tierId: 'buddy_medium', requestId: 'r' }), /not_enough_holos/);
  assert.throws(() => V.buildBuddyUnitPurchase(profile({ holosTokens: 1499 }), { tierId: 'buddy_heavy', requestId: 'r' }), /not_enough_holos/);
  assert.throws(() => V.buildBuddyUnitPurchase({ buddyUnits: inv(0) }, { tierId: 'buddy_medium', requestId: 'r' }), /not_enough_holos/);
  for (const bad of [{ tierId: 'buddy_light', requestId: 'r' }, { tierId: 'medium', requestId: 'r' }, { tierId: 'buddy_heavy' }, { tierId: 'buddy_heavy', requestId: 'a b' }, null])
    assert.throws(() => V.validateBuddyPurchase(bad), /invalid_request/);
  assert.throws(() => V.buildBuddyUnitPurchase(profile({ holosTokens: 'lots' }), { tierId: 'buddy_medium', requestId: 'r' }), /unavailable/);
  assert.throws(() => V.buildBuddyUnitPurchase(profile({ buddyUnits: null }), { tierId: 'buddy_medium', requestId: 'r' }), /unavailable/);
});

test('boutique catalog (vendor-3): every sold wardrobe item at MARKETPLACE_PART_PRICES[rarity], owned flags, wardrobeHost purchase descriptor', () => {
  const C = require('../lib/lib/wardrobeCatalog.js');
  const sold = C.WARDROBE_ITEMS.filter(i => i.sellable);
  assert.equal(sold.length, 80);
  const c = V.buildCatalog(profile(), 'boutique', NOW, ['hat_fedora', 'retired_item']);
  assert.equal(c.schemaVersion, 'vendor-3'); assert.equal(c.vendorId, 'boutique');
  assert.deepEqual(c.listings.map(l => [l.listingId, l.kind, l.price]), sold.map(i => [`clothing.${i.itemId}`, 'clothing', E.MARKETPLACE_PART_PRICES[i.rarity]]));
  for (const l of c.listings) {
    const item = C.WARDROBE_ITEM_BY_ID.get(l.details.itemId);
    assert.deepEqual(l.details, { itemId: item.itemId, bozoPart: item.bozoPart, slot: item.slot, rarity: item.rarity, colorChannels: String(item.colorChannels), hidesSlots: item.hidesSlots });
    assert.deepEqual(l.purchase, { callable: 'wardrobeHost', request: { schemaVersion: 'wardrobe-3', operation: 'purchase', itemId: item.itemId, requestId: '<client-generated>' } });
  }
  const helmet = c.listings.find(l => l.listingId === 'clothing.hat_fedora');
  assert.equal(helmet.owned, 1); assert.equal(helmet.available, false);
  assert.ok(c.listings.filter(l => l !== helmet).every(l => l.owned === 0 && l.available));
  assert.equal(c.listings.some(l => C.WARDROBE_ITEM_BY_ID.get(l.details.itemId).starter), false, 'starter items are never listed');
  assert.equal(c.listings.some(l => l.details.itemId === 'upperface_roundglasseslens'), false, 'non-sellable lens is never listed');
  const overall = c.listings.find(l => l.details.bozoPart === 'Top_Overall');
  assert.deepEqual(overall.details.hidesSlots, ['bottom']);
  assert.deepEqual(V.validateCatalogCommand({ operation: 'catalog', vendorId: 'boutique' }), { operation: 'catalog', vendorId: 'boutique' });
});
