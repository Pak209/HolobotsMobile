// Equipped parts in server fights: the table, the cup gate, part HP as a fight-time layer, and the equip refusal (pure rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../lib/lib/partStats.js');
const H = require('../lib/lib/holobotLoadout.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const flags = won => ({ arenaGatheringSeen: true, tournamentsWon: won, arenaArcBuilt: false, holoZonesArcBuilt: false });
const part = (rarity, name = 'Test Part') => ({ id: `p_${rarity}`, name, rarity, slot: 'arms' });
const noSpecial = ({ special: _s, ...b }) => b;

test('the table: today\'s partStats numbers by slot and rarity, except rare and above legs at SPD +1', () => {
  const row = (slot, rarity) => P.partBoostsFor(slot, part(rarity));
  assert.deepEqual(row('head', 'Epic'), { attack: 0, defense: 2, speed: 0, special: 8, hp: 0 });
  assert.deepEqual(row('torso', 'Rare'), { attack: 0, defense: 6, speed: 0, special: 0, hp: 10 });
  assert.deepEqual(row('arms', 'Epic'), { attack: 8, defense: 0, speed: 2, special: 0, hp: 0 });
  assert.deepEqual(row('core', 'Common'), { attack: 0, defense: 0, speed: 0, special: 0, hp: 20 });
  assert.deepEqual(row('legs', 'Common'), { attack: 0, defense: 0, speed: 0, special: 0, hp: 0 });
  assert.deepEqual(row('legs', 'Rare'), { attack: 1, defense: 0, speed: 1, special: 0, hp: 0 });
  assert.deepEqual(row('legs', 'Epic'), { attack: 2, defense: 0, speed: 1, special: 0, hp: 0 });
});

test('rarity: none counts as common, stored rarity is honoured, a legacy "(Epic)" suffix counts, a word containing one does not', () => {
  assert.equal(P.partStars({ name: 'Void Mask' }), 1);
  assert.equal(P.partStars({ name: 'Void Mask', rarity: '' }), 1);
  for (const [rarity, stars] of [['common', 1], ['Rare', 3], ['EPIC', 4], ['Elite', 4], ['Legendary', 5], ['Champion', 2]]) assert.equal(P.partStars({ name: 'x', rarity }), stars, rarity);
  assert.equal(P.partStars({ name: 'Quantum Core (Epic)' }), 4);
  assert.equal(P.partStars({ name: 'Flare Cannon' }), 1);
  assert.equal(P.partBoostsFor('arms', { rarity: 'Epic' }).attack, 0, 'no name, no part');
});

test('the cup gate at each cup count: a part above the pilot\'s cups counts as unequipped', () => {
  const equip = rarity => ({ equippedParts: { ACE: { arms: part(rarity) } } });
  const attack = (rarity, won) => P.equippedPartBoosts({ ...equip(rarity), storyFlags: flags(won) }, 'ace').attack;
  assert.deepEqual([0, 1, 2, 3].map(w => attack('Common', w)), [2, 2, 2, 2]);
  assert.deepEqual([0, 1, 2, 3].map(w => attack('Rare', w)), [0, 6, 6, 6]);
  assert.deepEqual([0, 1, 2, 3].map(w => attack('Epic', w)), [0, 0, 8, 8]);
  assert.deepEqual([0, 1, 2, 3, 4].map(w => attack('Legendary', w)), [0, 0, 0, 0, 10], 'legendary needs the Legends Cup (4 cups)');
  assert.equal(P.equippedPartBoosts({ ...equip('Epic') }, 'ace').attack, 0, 'no flags');
  assert.equal(P.equippedPartBoosts({ ...equip('Epic'), storyFlags: { tournamentsWon: 'x' } }, 'ace').attack, 0, 'malformed flags switch gear off');
});

test('a mixed loadout sums only the open parts; malformed entries count for nothing; key case is tolerated; other Holobots are separate', () => {
  const profile = { storyFlags: flags(1), equippedParts: { kuma: { arms: part('Rare'), core: part('Epic'), legs: 'junk', head: null } } };
  assert.deepEqual(P.equippedPartBoosts(profile, 'kuma'), { attack: 6, defense: 0, speed: 1, special: 0, hp: 0 });
  assert.deepEqual(P.equippedPartBoosts(profile, 'ace'), { ...P.EMPTY_PART_BOOSTS });
  for (const equippedParts of [undefined, null, [], 'x', { ACE: 'x' }]) assert.deepEqual(P.equippedPartBoosts({ equippedParts }, 'ace'), { ...P.EMPTY_PART_BOOSTS });
});

test('applyPartBoosts: adds the four fight stats, SPECIAL changes nothing, and no boost returns the same object', () => {
  const c = { maxHealth: 150, attack: 80, defense: 60, speed: 70, currentHealth: 150 };
  assert.equal(P.applyPartBoosts(c, { ...P.EMPTY_PART_BOOSTS, special: 8 }), c);
  assert.deepEqual(P.applyPartBoosts(c, { attack: 8, defense: 6, speed: 1, special: 8, hp: 80 }), { maxHealth: 230, attack: 88, defense: 66, speed: 71, currentHealth: 230 });
  assert.equal(P.applyPartBoosts({ ...c, currentHealth: 75 }, { ...P.EMPTY_PART_BOOSTS, hp: 150 }).currentHealth, 150, 'same fraction');
  assert.equal(P.applyPartBoosts({ ...c, currentHealth: 0 }, { ...P.EMPTY_PART_BOOSTS, hp: 80 }).currentHealth, 0);
  assert.equal(P.applyPartBoosts({ maxHealth: 150, attack: 1, defense: 1 }, { ...P.EMPTY_PART_BOOSTS, hp: 10 }).currentHealth, undefined);
});

test('part HP is a fight-time layer: the ledger keeps its own scale, never exceeds what was issued, and a survivor stays above zero', () => {
  const issued = { currentHealth: 150, maxHealth: 150 };
  assert.equal(P.ledgerHealthAfterFight(77.5, 150, issued), 77.5, 'no part HP: unchanged');
  assert.equal(P.ledgerHealthAfterFight(230, 230, issued), 150, 'undamaged stays full');
  assert.equal(P.ledgerHealthAfterFight(115, 230, issued), 75);
  assert.equal(P.ledgerHealthAfterFight(1, 230, issued), 1);
  assert.equal(P.ledgerHealthAfterFight(0, 230, issued), 0);
  const hurt = { currentHealth: 40, maxHealth: 150 }, start = P.applyPartBoosts({ maxHealth: 150, attack: 1, defense: 1, speed: 1, currentHealth: 40 }, { ...P.EMPTY_PART_BOOSTS, hp: 80 }).currentHealth;
  assert.ok(P.ledgerHealthAfterFight(start, 230, hurt) <= 40);
});

test('buildEquipPart: rare and epic need their cup; common and no-rarity parts don\'t; re-saving what is equipped stays a no-op', () => {
  const account = (rarity, won, extra = {}) => ({ holobots: [{ name: 'ACE' }], parts: [{ id: 'p1', name: 'Boxer Arm', rarity, slot: 'arms' }], storyFlags: flags(won), ...extra });
  const req = { holobotName: 'ACE', slot: 'arms', partId: 'p1' };
  assert.deepEqual(H.buildEquipPart(account('Rare', 0), req), { locked: 'starter' });
  assert.equal(H.buildEquipPart(account('Rare', 1), req).reply.changed, true);
  assert.deepEqual(H.buildEquipPart(account('Epic', 1), req), { locked: 'champion' });
  assert.equal(H.buildEquipPart(account('Epic', 2), req).reply.changed, true);
  for (const rarity of ['Common', '']) assert.equal(H.buildEquipPart(account(rarity, 0), req).reply.changed, true, rarity);
  const saved = { equippedParts: { ACE: { arms: { id: 'p1', name: 'Boxer Arm', rarity: 'Epic', slot: 'arms' } } } };
  const again = H.buildEquipPart(account('Epic', 0, saved), req);
  assert.equal(again.updates, null); assert.equal(again.reply.changed, false);
});

test('Guild Court: parts reach the pinned fighter on the opted-in run only; the ledger settles on its own scale; a plain run is untouched', () => {
  const RUN = '11111111-1111-4111-8111-111111111111', T0 = 1_800_000_000_000;
  const profile = { holosTokens: 0, holobots: [{ name: 'ACE', level: 1, experience: 0, nextLevelExp: 400, attributePoints: 0 }], storyFlags: flags(2), equippedParts: { ACE: { arms: part('Epic'), core: { ...part('Epic'), slot: 'core' } } } };
  const bare = Z.issueHoloZoneRun([], 'guild_court', ['ace'], RUN, T0, { profile: { ...profile, equippedParts: {} }, includeHealth: true, courtDuel: { holobotId: 'ace', seed: 3 } });
  const geared = Z.issueHoloZoneRun([], 'guild_court', ['ace'], RUN, T0, { profile, includeHealth: true, courtDuel: { holobotId: 'ace', seed: 3 } });
  const a = bare.reply.duel.player[0], b = geared.reply.duel.player[0];
  assert.equal(b.attack, a.attack + 8); assert.equal(b.maxHealth, a.maxHealth + 80); assert.equal(b.currentHealth, a.maxHealth + 80); assert.equal(b.speed, a.speed + 2);
  const beastA = bare.reply.duel.opponent[0], beastB = geared.reply.duel.opponent[0];
  assert.equal(beastB.attack, beastA.attack + 8, 'Cacheback gains the gear\'s ATK'); assert.equal(beastB.maxHealth, beastA.maxHealth + 80); assert.equal(beastB.defense, beastA.defense); assert.equal(beastB.speed, beastA.speed, 'no share of SPD');
  assert.deepEqual(geared.doc.runs[0].issuedVitals, bare.doc.runs[0].issuedVitals, 'the ledger is issued on the Holobot\'s own scale');
  const plain = Z.issueHoloZoneRun([], 'guild_court', ['ace'], RUN, T0, { profile, includeHealth: true });
  assert.equal(plain.reply.playerCombatants[0].attack, a.attack, 'a client-reported run sees no parts');
  const cmd = Z.validateHoloZoneCommand({ schemaVersion: 'holozone-run-2', operation: 'settle', runId: RUN, playerIntents: ['strike'] });
  const report = Z.courtSettleCommand(geared.doc.runs, cmd, T0 + Z.HOLOZONE_MIN_XP_MS).command.health[0];
  assert.ok(report.currentHealth <= geared.doc.runs[0].issuedVitals.ace.currentHealth);
});

test('Cacheback with gear: a full rare set wins clearly more than none, is not a certain win, and real HP is still lost', () => {
  const D = require('../lib/lib/duelResolver.js'), R = require('../lib/lib/rivalLadder.js'), Pr = require('../lib/lib/progression.js'), B = require('../lib/lib/holoZoneBeastStats.js');
  const fair = ['strike', 'strike', 'heavy', 'defend'], names = Object.keys(Pr.HOLOBOT_BASE_STATS);
  const set = rarity => P.PART_SLOTS.reduce((t, s) => { const b = P.partBoostsFor(s, { name: 'x', rarity }); for (const k of Object.keys(t)) t[k] += b[k]; return t; }, { ...P.EMPTY_PART_BOOSTS });
  const run = (level, gear) => {
    const s = B.scaledBeastStats('guild_court', 0, 'cacheback', level, gear), o = D.duelFighterFromCombatant({ holobotId: 'cacheback', level: s.level, tier: 0, maxHealth: s.maxHealth, attack: s.attack, defense: s.defense, speed: s.speed });
    let wins = 0, hp = 0, total = 0;
    for (const name of names) {
      const c = R.buildPlayerCombatants({ holobots: [{ name, level, experience: 0 }] }, [name.toLowerCase()])[0], p = D.duelFighterFromCombatant({ ...P.applyPartBoosts(c, gear), tier: 0 });
      for (let seed = 0; seed < 150; seed++) { const r = D.resolveDuel({ seed, player: [p], opponent: [o], playerIntents: fair }); if (r.winner === 'player') wins++; hp += r.playerFinal[0].currentHealth / r.playerFinal[0].maxHealth; total++; }
    }
    return { win: wins / total, hp: hp / total };
  };
  for (const level of [1, 10, 20]) {
    const none = run(level, { ...P.EMPTY_PART_BOOSTS }), rare = run(level, set('Rare'));
    assert.ok(rare.win > none.win + 0.02, `level ${level}: ${rare.win} vs ${none.win}`);
    assert.ok(rare.win < 0.99, `level ${level}: ${rare.win} is a certain win`);
    assert.ok(rare.hp < 0.6, `level ${level}: HP left ${rare.hp}`);
  }
});
