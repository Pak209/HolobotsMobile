// Equipped parts in rival, Arena, cup and Guild Court fights through the real stores (Firestore emulator).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-parts';
const { db } = require('../lib/admin.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { transactArenaMatch } = require('../lib/arena/arenaMatchStore.js');
const { transactTournamentBracket } = require('../lib/story/tournamentBracketStore.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const { equipHolobotPart } = require('../lib/progression/equipHolobotPart.js');
const { resolveDuel } = require('../lib/lib/duelResolver.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const { STORY_CUPS } = require('../lib/story/storyFlags.js');
const { calculateExperience } = require('../lib/lib/progression.js');
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0), R = 'duel-receipt-1';
let serial = 0;
const flags = won => ({ arenaGatheringSeen: true, tournamentsWon: won, arenaArcBuilt: won >= 3, holoZonesArcBuilt: false });
const armsPart = (rarity = 'Epic') => ({ id: 'p1', name: 'Boxer Arm', rarity, slot: 'arms' });
const corePart = { id: 'p2', name: 'Quantum Core', rarity: 'Epic', slot: 'core' };
const GEAR = { ACE: { arms: armsPart(), core: corePart } };
const setup = async (fields = {}, level = 21) => {
  const uid = `parts_${Date.now()}_${serial++}`;
  await db.doc(`users/${uid}`).set({ holobots: [{ name: 'ACE', level, experience: 0, nextLevelExp: calculateExperience(level + 1), attributePoints: 0, boostedAttributes: {} }],
    travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] }, buddyUnits: { light: 0, medium: 0, heavy: 0 }, holosTokens: 1000, arenaPassses: 5, syncPoints: 0, wins: 0, losses: 0, blueprints: {},
    storyFlags: flags(2), equippedParts: GEAR, ...fields });
  return uid;
};
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const ON = { issueLegacy: false, allowLegacySettlement: true };
const rival = (uid, data, now, options = ON) => transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', ...data }, now, () => 0.4, options);
const arena = (uid, data, now) => transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', ...data }, now);
const arenaIssue = (uid, extra, now = T0) => arena(uid, { operation: 'issue', requestId: `parts_req_${serial++}`, tierId: 'rookie', paymentMethod: 'pass', holobotId: 'ace', opponentName: 'HARE', ...extra }, now);
const unequip = uid => db.doc(`users/${uid}`).update({ equippedParts: {} });

test('rival: an opted-in fight pins the parts; a later change doesn\'t alter it; HP settles on the ledger\'s scale; no opt-in sees no parts', async () => {
  const bare = await setup({ equippedParts: {} }), uid = await setup();
  const a = (await rival(bare, { operation: 'issue', duelSchema: R }, T0)).duel.player[0];
  const i = await rival(uid, { operation: 'issue', duelSchema: R }, T0), b = i.duel.player[0];
  assert.equal(b.attack, a.attack + 8); assert.equal(b.speed, a.speed + 2); assert.equal(b.maxHealth, a.maxHealth + 80);
  const stored = (await db.doc(`rivalBattles/${uid}/battles/${i.battleId}`).get()).data();
  assert.equal(stored.issuedVitals.ace.maxHealth, a.maxHealth, 'the ledger stays on the Holobot\'s own max');
  await unequip(uid);
  const s = await rival(uid, { operation: 'settle', battleId: i.battleId, playerIntents: ['strike'] }, T0 + 20000);
  assert.deepEqual(s.duelReceipt, resolveDuel({ ...stored.duel.input, playerIntents: ['strike'] }));
  const hp = (await user(uid)).holobotVitals.ace;
  assert.equal(hp.maxHealth, a.maxHealth); assert.ok(hp.currentHealth <= a.maxHealth);
  const old = await setup();
  const legacy = await rival(old, { operation: 'issue' }, T0);
  assert.equal(legacy.duel.mode, 'legacy');
  assert.equal(legacy.playerCombatants[0].attack, a.attack, 'a client that did not opt in sees no parts');
});

test('rival: gear above the pilot\'s cups fights as unequipped', async () => {
  const stats = async won => { const uid = await setup({ storyFlags: flags(won) }); return (await rival(uid, { operation: 'issue', duelSchema: R }, T0)).duel.player[0]; };
  const [none, one, two] = [await stats(0), await stats(1), await stats(2)];
  assert.equal(none.attack, one.attack, 'epic needs the Champion Cup'); assert.equal(none.maxHealth, one.maxHealth);
  assert.equal(two.attack, none.attack + 8); assert.equal(two.maxHealth, none.maxHealth + 80);
});

test('Arena: a resolver fight pins parts in its duel block; a client-played match has none and its record is unchanged', async () => {
  const bare = await setup({ equippedParts: {} }), uid = await setup();
  const a = (await arenaIssue(bare, { duelSchema: R })).duel.player[0];
  const i = await arenaIssue(uid, { duelSchema: R }), b = i.duel.player[0];
  assert.equal(b.attack, a.attack + 8); assert.equal(b.maxHealth, a.maxHealth + 80);
  await unequip(uid);
  await arena(uid, { operation: 'start', matchId: i.matchId }, T0 + 1);
  const s = await arena(uid, { operation: 'settle', matchId: i.matchId, playerIntents: ['strike'] }, T0 + 5000);
  assert.equal(s.match.state, 'settled'); assert.deepEqual(s.duelReceipt.playerFinal[0].maxHealth, b.maxHealth);
  const hp = (await user(uid)).holobotVitals.ace;
  assert.equal(hp.maxHealth, a.maxHealth); assert.ok(hp.currentHealth <= a.maxHealth);
  const legacyUid = await setup(), legacy = await arenaIssue(legacyUid, {});
  assert.equal(legacy.duel, undefined);
  const record = (await db.doc(`arenaMatches/${legacyUid}/matches/${legacy.matchId}`).get()).data();
  assert.equal(record.partBoosts, undefined); assert.equal(record.entrant.attack, a.attack);
});

test('cups: parts are pinned at issue, reach the bracket fighter at start, never appear on the wire, and HP closes on the ledger\'s scale', async () => {
  const bare = await setup({ equippedParts: {}, storyFlags: flags(0) });
  const bareIssue = await arenaIssue(bare, { tournamentId: 'starter' });
  const bareStart = await transactTournamentBracket(db, bare, { schemaVersion: 'arena-bracket-1', operation: 'start', matchId: bareIssue.matchId }, T0);
  const base = bareStart.bracket.entrants.find(e => e.isPlayer).fighter;
  assert.equal((await db.doc(`arenaMatches/${bare}/matches/${bareIssue.matchId}`).get()).data().partBoosts, undefined, 'no parts, no field');
  const uid = await setup({ storyFlags: flags(0), equippedParts: { ACE: { arms: armsPart('Common') } } });
  const i = await arenaIssue(uid, { tournamentId: 'starter' });
  assert.equal(JSON.stringify(i).includes('partBoosts'), false);
  assert.deepEqual((await db.doc(`arenaMatches/${uid}/matches/${i.matchId}`).get()).data().partBoosts, { attack: 2, defense: 0, speed: 0, special: 0, hp: 0 });
  await unequip(uid);
  let r = await transactTournamentBracket(db, uid, { schemaVersion: 'arena-bracket-1', operation: 'start', matchId: i.matchId }, T0);
  assert.equal(r.bracket.entrants.find(e => e.isPlayer).fighter.attack, base.attack + 2, 'pinned at issue, unequipped before start');
  while (!r.bracket.done && r.bracket.playerAlive) r = await transactTournamentBracket(db, uid, { schemaVersion: 'arena-bracket-1', operation: 'advance', matchId: i.matchId, expectedRound: r.bracket.round }, T0);
  const hp = (await user(uid)).holobotVitals.ace;
  assert.equal(hp.maxHealth, base.maxHealth); assert.ok(hp.currentHealth <= base.maxHealth);

  const coreUid = await setup({ storyFlags: flags(0), equippedParts: { ACE: { core: { ...corePart, rarity: 'Common' } } } });
  const c = await arenaIssue(coreUid, { tournamentId: 'starter' });
  const started = await transactTournamentBracket(db, coreUid, { schemaVersion: 'arena-bracket-1', operation: 'start', matchId: c.matchId }, T0);
  assert.equal(started.bracket.entrants.find(e => e.isPlayer).fighter.maxHealth, base.maxHealth + 20);
  await transactTournamentBracket(db, coreUid, { schemaVersion: 'arena-bracket-1', operation: 'cancel', matchId: c.matchId }, T0);
  const cancelled = (await user(coreUid)).holobotVitals.ace;
  assert.equal(cancelled.maxHealth, base.maxHealth); assert.equal(cancelled.currentHealth, base.maxHealth, 'an abandoned bracket costs nothing it didn\'t lose');
});

test('Guild Court: an opted-in run pins the parts through the store; HP closes on the ledger\'s scale', async () => {
  const uid = await setup({}, 5);
  const newRun = () => '22222222-1111-4111-8111-111111111111';
  const i = await transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-2', operation: 'issue', zoneId: 'guild_court', duelSchema: R, holobotId: 'ace' }, T0, newRun);
  const own = i.playerCombatants[0];
  assert.equal(i.duel.player[0].attack, own.attack + 8); assert.equal(i.duel.player[0].maxHealth, own.maxHealth + 80);
  await unequip(uid);
  await transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-2', operation: 'settle', runId: i.runId, playerIntents: ['strike', 'strike', 'heavy', 'defend'] }, T0 + Z.HOLOZONE_MIN_XP_MS);
  const hp = (await user(uid)).holobotVitals.ace;
  assert.equal(hp.maxHealth, own.maxHealth); assert.ok(hp.currentHealth <= own.maxHealth);
});

test('the Legends Cup is dormant: refused and tournamentsWon capped; once live, a win takes the pilot to 4 and pays its prize', async () => {
  const champ = await setup({ storyFlags: flags(3), holobots: [{ name: 'ACE', level: 99, experience: 0, nextLevelExp: calculateExperience(100), attributePoints: 0, boostedAttributes: { attack: 3000, defense: 3000, health: 3000, speed: 3000 } }], equippedParts: {} });
  await assert.rejects(() => arenaIssue(champ, { tournamentId: 'legends' }), e => e.code === 'invalid_request');
  STORY_CUPS.legendsLive = true;
  try {
    const low = await setup({ storyFlags: flags(3) }, 30);
    await assert.rejects(() => arenaIssue(low, { tournamentId: 'legends' }), e => e.code === 'rank_too_low');
    const before = (await user(champ)).holosTokens;
    const i = await arenaIssue(champ, { tournamentId: 'legends' });
    let r = await transactTournamentBracket(db, champ, { schemaVersion: 'arena-bracket-1', operation: 'start', matchId: i.matchId }, T0);
    while (!r.bracket.done && r.bracket.playerAlive) r = await transactTournamentBracket(db, champ, { schemaVersion: 'arena-bracket-1', operation: 'advance', matchId: i.matchId, expectedRound: r.bracket.round, prizeSchema: 'cup-prize-1' }, T0);
    assert.equal(r.bracket.playerAlive, true);
    assert.deepEqual([r.storyFlags.tournamentsWon, r.storyFlags.arenaArcBuilt], [4, true]);
    assert.equal(r.cupPrize.cupId, 'legends'); assert.equal(r.cupPrize.ride, null);
    const after = await user(champ);
    assert.equal(after.holosTokens, before + 6000 + (await db.doc(`arenaMatches/${champ}/matches/${i.matchId}`).get()).data().settlementReceipt.settlement.holos);
    await assert.rejects(() => arenaIssue(champ, { tournamentId: 'legends' }, T0 + 1), e => e.code === 'already_won');
  } finally { STORY_CUPS.legendsLive = false; }
});

test('equipHolobotPart: a legendary part\'s refusal names the Elite Cup while Legends is dormant and the Legends Cup once it is live', async () => {
  const uid = await setup({ storyFlags: flags(2), equippedParts: {}, parts: [armsPart('Legendary')] });
  const equip = () => equipHolobotPart.run({ auth: { uid }, data: { holobotName: 'ACE', slot: 'arms', partId: 'p1' } });
  await assert.rejects(equip, e => e.details.rejectionCode === 'part_locked' && e.message === 'Win the Elite Cup to equip this part.');
  STORY_CUPS.legendsLive = true;
  try { await assert.rejects(equip, e => e.details.rejectionCode === 'part_locked' && e.message === 'Win the Legends Cup to equip this part.'); }
  finally { STORY_CUPS.legendsLive = false; }
  await db.doc(`users/${uid}`).update({ storyFlags: flags(3) });
  assert.equal((await equip()).changed, true);
});

test('equipHolobotPart: a part above the pilot\'s cups is refused with part_locked and nothing written', async () => {
  const uid = await setup({ storyFlags: flags(0), equippedParts: {}, parts: [armsPart('Rare')] });
  await assert.rejects(() => equipHolobotPart.run({ auth: { uid }, data: { holobotName: 'ACE', slot: 'arms', partId: 'p1' } }),
    e => e.code === 'failed-precondition' && e.details.rejectionCode === 'part_locked' && e.message === 'Win the Starter Cup to equip this part.');
  assert.deepEqual((await user(uid)).equippedParts, {});
  await db.doc(`users/${uid}`).update({ storyFlags: flags(1) });
  assert.equal((await equipHolobotPart.run({ auth: { uid }, data: { holobotName: 'ACE', slot: 'arms', partId: 'p1' } })).changed, true);
});
