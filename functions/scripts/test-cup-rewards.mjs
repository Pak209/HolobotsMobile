// cup-prize-1 (Pak 2026-11-08): cup prize table, part-tier gates on the Workshop catalog and the part purchase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const C = require('../lib/lib/cupRewards.js');
const V = require('../lib/lib/vendors.js');
const E = require('../lib/lib/economy.js');
const T = require('../lib/story/arenaTournament.js');
const P = require('../lib/economy/purchaseMarketplacePart.js');

const NOW = Date.UTC(2026, 10, 8, 12);
const flags = (tournamentsWon) => ({ arenaGatheringSeen: true, tournamentsWon, arenaArcBuilt: tournamentsWon === 3, holoZonesArcBuilt: false });
const profile = (won, extra = {}) => ({ holosTokens: 9000, buddyUnits: { light: 1, medium: 0, heavy: 0 }, storyFlags: flags(won), ...extra });
const ids = (reply) => reply.listings.map(l => l.listingId).sort();
const prices = (reply) => [...new Set(reply.listings.map(l => l.price))].sort((a, b) => a - b);

test('prize table (PROPOSED numbers), cup ids match the tournaments, every catalog part has a tier', () => {
  assert.deepEqual(C.CUP_IDS, [...T.TOURNAMENTS]);
  assert.deepEqual(C.CUP_PRIZES, { starter: { holos: 750, blueprints: 15, heavyBuddyUnits: 0 }, champion: { holos: 1500, blueprints: 25, heavyBuddyUnits: 0 }, rare: { holos: 3000, blueprints: 30, heavyBuddyUnits: 1 } });
  assert.deepEqual(C.PART_TIERS.map(t => [t.price, t.cupsWon, t.cupId]), [[300, 0, null], [750, 1, 'starter'], [1500, 2, 'champion']]);
  for (const o of E.MARKETPLACE_PART_CATALOG) assert.ok(C.PART_TIERS.some(t => t.price === o.price), o.id);
  assert.equal(C.partTierOpen(999, 3), false, 'a price outside the table is not for sale');
});

test('docs/contracts/cup-prize-1.json matches the constants', () => {
  const c = JSON.parse(readFileSync(new URL('../../docs/contracts/cup-prize-1.json', import.meta.url), 'utf8'));
  assert.equal(c.schemaVersion, C.CUP_PRIZE_SCHEMA);
  assert.deepEqual(c.prizes, C.CUP_PRIZES);
  assert.deepEqual(c.partTiers, C.PART_TIERS);
});

test('Workshop: 300 tier only before any cup, each cup opens the next; partTier says what to win', () => {
  const at = (won) => V.buildCatalog(profile(won), 'workshop', NOW);
  assert.deepEqual(prices(at(0)), [300]);
  assert.deepEqual(at(0).partTier, { unlockedMaxPrice: 300, unlockedPrices: [300], next: { price: 750, cupId: 'starter', cupName: 'Starter Cup' } });
  assert.deepEqual(prices(at(1)), [300, 750]);
  assert.deepEqual(at(1).partTier.next, { price: 1500, cupId: 'champion', cupName: 'Champion Cup' });
  assert.deepEqual(prices(at(2)), [300, 750, 1500]);
  assert.equal(at(2).partTier.next, null);
  assert.deepEqual(ids(at(3)), E.MARKETPLACE_PART_CATALOG.map(o => o.id).sort());
  assert.deepEqual(prices(V.buildCatalog({ holosTokens: 1, buddyUnits: { light: 0, medium: 0, heavy: 0 } }, 'workshop', NOW)), [300], 'no flags yet = no cups');
});

test('existing owners keep what they own; other vendors unchanged; malformed flags fail closed', () => {
  const owned = profile(0, { parts: [{ name: 'Void Mask', rarity: 'epic', slot: 'head' }] });
  const c = V.buildCatalog(owned, 'workshop', NOW);
  assert.equal(c.inventory.parts, 1, 'the locked part stays counted');
  assert.ok(!c.listings.some(l => l.listingId === 'part.voidMask'));
  assert.deepEqual(owned.parts, [{ name: 'Void Mask', rarity: 'epic', slot: 'head' }]);
  assert.equal('partTier' in V.buildCatalog(profile(0), 'marketplace', NOW), false);
  assert.equal('partTier' in V.buildCatalog(profile(0), 'boutique', NOW), false);
  assert.throws(() => V.buildCatalog(profile(0, { storyFlags: 'bad' }), 'workshop', NOW), e => e.code === 'unavailable');
  assert.doesNotThrow(() => V.buildCatalog(profile(0, { storyFlags: 'bad' }), 'marketplace', NOW));
});

test('purchase gate: a locked tier is part_locked naming the cup, before Holos; open tiers pass; malformed flags refuse', () => {
  const refused = (fn, code, msg) => assert.throws(fn, e => e.code === 'failed-precondition' && e.details.rejectionCode === code && (!msg || e.message === msg));
  refused(() => P.requirePartTierOpen(profile(0), 750), 'part_locked', 'Win the Starter Cup to unlock this part.');
  refused(() => P.requirePartTierOpen(profile(0), 1500), 'part_locked', 'Win the Champion Cup to unlock this part.');
  refused(() => P.requirePartTierOpen(profile(1), 1500), 'part_locked', 'Win the Champion Cup to unlock this part.');
  refused(() => P.requirePartTierOpen(profile(0, { storyFlags: 'bad' }), 300), 'unavailable');
  for (const [won, price] of [[0, 300], [1, 750], [2, 1500], [3, 1500]]) assert.doesNotThrow(() => P.requirePartTierOpen(profile(won), price));
});

test('applyCupPrize: Holos, blueprints of the winning bot, Heavy Unit on Rare; existing grant rules; malformed fails closed', () => {
  const p = profile(0, { blueprints: { ace: 3, kuma: 7 } });
  const s = C.applyCupPrize(p, 'starter', 'ace', 'am_1', NOW);
  assert.deepEqual(s.userUpdates, { holosTokens: 9750, blueprints: { ace: 18, kuma: 7 } });
  assert.deepEqual(s.receipt, { cupId: 'starter', matchId: 'am_1', holobotId: 'ace', awardedAtMs: NOW, holos: 750, blueprints: 15, heavyBuddyUnits: 0 });
  assert.deepEqual(p.blueprints, { ace: 3, kuma: 7 }, 'input not mutated');
  assert.deepEqual(C.applyCupPrize(profile(1), 'champion', 'tsuin', 'am_2', NOW).userUpdates, { holosTokens: 10500, blueprints: { tsuin: 25 } });
  const r = C.applyCupPrize(profile(2), 'rare', 'ace', 'am_3', NOW);
  assert.deepEqual(r.userUpdates, { holosTokens: 12000, blueprints: { ace: 30 }, buddyUnits: { light: 1, medium: 0, heavy: 1 } });
  assert.deepEqual(C.cupPrizeView(s.receipt, false), { schemaVersion: 'cup-prize-1', cupId: 'starter', matchId: 'am_1', holobotId: 'ace', holos: 750, blueprints: 15, heavyBuddyUnits: 0, unlocksPartPrice: 750, ride: 'skates', alreadyPaid: false });
  assert.equal(C.cupPrizeView(r.receipt, true).unlocksPartPrice, null);
  assert.equal(C.cupPrizeView(r.receipt, true).ride, null, 'the Rare Cup awards no ride');
  for (const bad of [{ holosTokens: -1 }, { holosTokens: 'x' }, { blueprints: [] }, { blueprints: { ace: 'x' } }, { blueprints: { ace: 1.5 } }]) assert.equal(C.applyCupPrize(profile(0, bad), 'starter', 'ace', 'am', NOW), null, JSON.stringify(bad));
  assert.equal(C.applyCupPrize(profile(2, { buddyUnits: 'x' }), 'rare', 'ace', 'am', NOW), null);
});

test('rides: skates for the Starter Cup, the hoverboard for the Champion Cup, derived from tournamentsWon alone', () => {
  assert.deepEqual([0, 1, 2, 3].map(C.ridesUnlocked), [[], ['skates'], ['skates', 'hoverboard'], ['skates', 'hoverboard']]);
  assert.deepEqual(C.CUP_IDS.map(C.rideForCup), ['skates', 'hoverboard', null]);
  // The reply says the ride on a replay too, and a receipt from before rides existed still shows it (no stored field).
  const receipt = { cupId: 'champion', matchId: 'am_2', holobotId: 'ace', awardedAtMs: 1, holos: 1500, blueprints: 25, heavyBuddyUnits: 0 };
  assert.equal(C.cupPrizeView(receipt, true).ride, 'hoverboard');
  assert.equal(C.readCupPrizeLedger({ schemaVersion: 'cup-prize-1', prizes: { champion: receipt } }).prizes.champion.ride, undefined, 'nothing about a ride is stored');
});

test('prize ledger: absent = empty; malformed = null, never treated as empty', () => {
  assert.deepEqual(C.readCupPrizeLedger(undefined), { schemaVersion: 'cup-prize-1', prizes: {} });
  const good = { schemaVersion: 'cup-prize-1', prizes: { starter: { cupId: 'starter', matchId: 'm', holobotId: 'ace', awardedAtMs: 1, holos: 750, blueprints: 15, heavyBuddyUnits: 0 } } };
  assert.deepEqual(C.readCupPrizeLedger(good), good);
  for (const bad of [null, {}, { schemaVersion: 'x', prizes: {} }, { schemaVersion: 'cup-prize-1' }, { schemaVersion: 'cup-prize-1', prizes: { elite: good.prizes.starter } }, { schemaVersion: 'cup-prize-1', prizes: { starter: { ...good.prizes.starter, holos: -1 } } }]) assert.equal(C.readCupPrizeLedger(bad), null, JSON.stringify(bad));
});
