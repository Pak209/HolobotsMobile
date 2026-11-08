// cup-prize-1 end to end on the Firestore emulator: a real paid bracket, the one-time prize, the opt-in reply, the part gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Loopback demo emulator only; production forbidden');
const { db } = require('../lib/admin.js');
const { transactTournamentBracket } = require('../lib/story/tournamentBracketStore.js');
const { transactArenaMatch } = require('../lib/arena/arenaMatchStore.js');
const { transactTournamentResult } = require('../lib/story/tournamentResultStore.js');
const { transactArenaGathering } = require('../lib/story/arenaGathering.js');
const { calculateExperience } = require('../lib/lib/progression.js');
const { purchaseMarketplacePart } = require('../lib/economy/purchaseMarketplacePart.js');
const { readVendorCatalog } = require('../lib/vendors/vendorStore.js');

const S = 'arena-bracket-1', T0 = Date.UTC(2026, 10, 8, 7), PRIZE = 'cup-prize-1';
let serial = 0;
const flags = (won = 0) => ({ arenaGatheringSeen: true, tournamentsWon: won, arenaArcBuilt: false, holoZonesArcBuilt: false });
const bot = (level) => ({ name: 'ACE', level, experience: 0, nextLevelExp: calculateExperience(level + 1), attributePoints: 0, boostedAttributes: { attack: 1000, defense: 1000, health: 1000, speed: 1000 } });
const CUPS = { starter: 2, champion: 11, rare: 21 };
async function setup(extra = {}, level = 99) {
  const uid = `cup_throwaway_${Date.now()}_${serial++}`;
  await db.doc(`users/${uid}`).set({ holobots: [bot(level)], storyFlags: flags(), arenaPassses: 10, holosTokens: 2000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, ...extra });
  await transactArenaGathering(db, uid, { schemaVersion: 'arena-gathering-1' });
  return uid;
}
const user = async (uid) => (await db.doc(`users/${uid}`).get()).data();
const call = (uid, operation, matchId, fields = {}) => transactTournamentBracket(db, uid, { schemaVersion: S, operation, matchId, ...fields }, T0);
async function issue(uid, tournamentId) {
  return transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', operation: 'issue', requestId: `cup_request_${serial++}`, tierId: 'rookie', paymentMethod: 'pass', holobotId: 'ace', opponentName: 'HARE', tournamentId }, T0);
}
async function win(uid, tournamentId, fields = {}) {
  const id = (await issue(uid, tournamentId)).matchId;
  let r = await call(uid, 'start', id);
  while (!r.bracket.done && r.bracket.playerAlive) r = await call(uid, 'advance', id, { expectedRound: r.bracket.round, ...fields });
  assert.equal(r.bracket.playerAlive, true);
  return { id, r };
}
const buy = (uid, partId) => purchaseMarketplacePart.run({ auth: { uid }, data: { partId } });

test('first win pays once, in the win transaction; reply opt-in; resume shows the receipt without paying again', async () => {
  const uid = await setup({ blueprints: { ace: 3 } });
  const { id, r } = await win(uid, 'starter', { prizeSchema: PRIZE });
  assert.deepEqual(r.cupPrize, { schemaVersion: PRIZE, cupId: 'starter', matchId: id, holobotId: 'ace', holos: 500, blueprints: 10, heavyBuddyUnits: 0, unlocksPartPrice: 750, alreadyPaid: false });
  const after = await user(uid), match = (await db.doc(`arenaMatches/${uid}/matches/${id}`).get()).data();
  assert.equal(after.storyFlags.tournamentsWon, 1);
  const paid = match.settlementReceipt.settlement, arenaAce = paid.blueprints.holobotKey === 'ace' ? paid.blueprints.amount : 0;
  assert.equal(after.holosTokens, 2000 + paid.holos + 500);
  assert.equal(after.blueprints.ace, 3 + arenaAce + 10);
  assert.equal((await db.doc(`cupPrizes/${uid}`).get()).data().prizes.starter.matchId, id);
  const resumed = await call(uid, 'resume', id, { prizeSchema: PRIZE });
  assert.equal(resumed.cupPrize.alreadyPaid, true); assert.equal(resumed.cupPrize.holos, 500);
  assert.deepEqual(await user(uid), after, 'nothing paid twice');
});

test('a request without prizeSchema keeps the exact reply keys Unity accepts, and still pays', async () => {
  const uid = await setup();
  const { id, r } = await win(uid, 'starter');
  assert.deepEqual(Object.keys(r).sort(), ['alreadyProcessed', 'bracket', 'cancelled', 'matchId', 'schemaVersion', 'storyFlags']);
  assert.deepEqual(Object.keys(r.storyFlags).sort(), ['arenaArcBuilt', 'arenaGatheringSeen', 'holoZonesArcBuilt', 'tournamentsWon']);
  assert.equal((await db.doc(`cupPrizes/${uid}`).get()).data().prizes.starter.matchId, id);
  await assert.rejects(call(uid, 'resume', r.matchId, { prizeSchema: 'cup-prize-9' }), e => e.code === 'invalid_request');
});

test('all three cups in order; Rare adds the Heavy Unit; the ledger stops a second payout after a flag reset', async () => {
  const uid = await setup();
  for (const cup of Object.keys(CUPS)) await win(uid, cup, { prizeSchema: PRIZE });
  const after = await user(uid);
  assert.equal(after.storyFlags.tournamentsWon, 3); assert.equal(after.storyFlags.arenaArcBuilt, true);
  assert.ok(after.blueprints.ace >= 45); assert.equal(after.buddyUnits.heavy, 1);
  assert.deepEqual(Object.values((await db.doc(`cupPrizes/${uid}`).get()).data().prizes).map(p => p.blueprints).sort((a, b) => a - b), [10, 15, 20]);
  await db.doc(`users/${uid}`).update({ storyFlags: flags(0) });
  const before = await user(uid);
  const { id, r } = await win(uid, 'starter', { prizeSchema: PRIZE });
  assert.equal(r.cupPrize.alreadyPaid, true); assert.notEqual(r.cupPrize.matchId, id, 'the original receipt');
  const end = await user(uid), match = (await db.doc(`arenaMatches/${uid}/matches/${id}`).get()).data();
  const paid = match.settlementReceipt.settlement;
  assert.equal(end.holosTokens, before.holosTokens + paid.holos, 'arena payout only');
  assert.equal(end.blueprints.ace, before.blueprints.ace + (paid.blueprints.holobotKey === 'ace' ? paid.blueprints.amount : 0));
});

test('malformed prize ledger fails closed: no win recorded, nothing paid', async () => {
  const uid = await setup();
  const id = (await issue(uid, 'starter')).matchId;
  let r = await call(uid, 'start', id);
  await db.doc(`cupPrizes/${uid}`).set({ schemaVersion: 'nope' });
  await assert.rejects(async () => { while (!r.bracket.done) r = await call(uid, 'advance', id, { expectedRound: r.bracket.round }); }, e => e.code === 'unavailable');
  const u = await user(uid);
  assert.equal(u.storyFlags.tournamentsWon, 0); assert.equal(u.blueprints?.ace ?? 0, 0);
});

test('Workshop and purchase follow the cups on the real callable: locked is refused and not charged; a cup win opens it; owned parts stay', async () => {
  const owned = [{ name: 'Void Mask', rarity: 'epic', slot: 'head' }];
  const uid = await setup({ parts: owned, holosTokens: 5000 });
  const catalog = () => readVendorCatalog(db, uid, { operation: 'catalog', vendorId: 'workshop' });
  assert.equal((await catalog()).partTier.next.cupId, 'starter');
  assert.ok((await catalog()).listings.every(l => l.price === 300));
  await assert.rejects(buy(uid, 'part.alloyChassis'), e => e.code === 'failed-precondition' && e.details.rejectionCode === 'part_locked' && e.message === 'Win the Starter Cup to unlock this part.');
  assert.equal((await user(uid)).holosTokens, 5000); assert.deepEqual((await user(uid)).parts, owned);
  assert.equal((await buy(uid, 'part.combatMask')).price, 300);
  await win(uid, 'starter');
  assert.ok((await catalog()).listings.some(l => l.listingId === 'part.alloyChassis'));
  assert.equal((await buy(uid, 'part.alloyChassis')).price, 750);
  await assert.rejects(buy(uid, 'part.voidMask'), e => e.details.rejectionCode === 'part_locked' && e.message === 'Win the Champion Cup to unlock this part.');
  assert.ok((await user(uid)).parts.some(p => p.name === 'Void Mask'), 'the locked part already owned is kept');
});

test('tournamentResultHost store: prizeSchema opt-in shape; already_won stays a refusal', async () => {
  const uid = await setup();
  const { id } = await win(uid, 'starter');
  await assert.rejects(transactTournamentResult(db, uid, { schemaVersion: 'arena-tournament-1', tournamentId: 'starter', matchId: id, prizeSchema: PRIZE }), e => e.code === 'already_won');
  await assert.rejects(transactTournamentResult(db, uid, { schemaVersion: 'arena-tournament-1', tournamentId: 'starter', matchId: id, prizeSchema: 'x' }), e => e.code === 'invalid_request');
});
