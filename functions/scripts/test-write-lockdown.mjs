// holobots-write-lockdown-1: the callables that replace the last client profile writes
// (equipSyncAbility, equipHolobotPart, claimStarterDeck) and the recomputed leaderboard projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../lib/lib/holobotLoadout.js');
const G = require('../lib/lib/genesisSignup.js');
const E = require('../lib/lib/progressionEconomy.js');
const P = require('../lib/lib/leaderboardProjection.js');

const aceAbility = E.SYNC_ABILITY_REQUIREMENTS.find((a) => a.holobot === 'ACE');
const kumaAbility = E.SYNC_ABILITY_REQUIREMENTS.find((a) => a.holobot === 'KUMA');
const maxed = { bond: 50, focus: 50, guard: 50, power: 50, tempo: 50 };

test('equipSyncAbility request validation', () => {
  assert.deepEqual(L.validateEquipSyncAbilityRequest({ holobotName: ' ACE ', abilityId: 'x' }), { holobotName: 'ACE', abilityId: 'x' });
  for (const bad of [undefined, null, 'x', {}, { holobotName: 'ACE' }, { abilityId: 'x' }, { holobotName: '', abilityId: 'x' },
    { holobotName: 'A'.repeat(65), abilityId: 'x' }, { holobotName: 'ACE', abilityId: '' }, { holobotName: 'ACE', abilityId: 7 },
    { holobotName: 'ACE', abilityId: 'x'.repeat(201) }]) {
    assert.equal(L.validateEquipSyncAbilityRequest(bad), null, JSON.stringify(bad));
  }
});

test('equipSyncAbility: stored unlocks gate the equip; only that holobot changes', () => {
  const kuma = { name: 'KUMA', level: 2 };
  const data = { holobots: [{ name: 'ACE', level: 4, syncAbilityUnlocks: [aceAbility.id] }, kuma], syncPoints: 9 };
  const out = L.buildEquipSyncAbility(data, { holobotName: 'ace', abilityId: aceAbility.id });
  assert.deepEqual(out.reply, { equipped: true, changed: true, abilityId: aceAbility.id });
  assert.deepEqual(Object.keys(out.updates), ['holobots'], 'writes holobots only');
  assert.equal(out.updates.holobots[0].equippedSyncAbilityId, aceAbility.id);
  assert.equal(out.updates.holobots[0].level, 4);
  assert.deepEqual(out.updates.holobots[1], kuma);
  assert.equal(data.holobots[0].equippedSyncAbilityId, undefined, 'input not mutated');
});

test('equipSyncAbility refusals: not owned, locked, another bot\'s ability, stored unlocks win over stats', () => {
  const data = { holobots: [{ name: 'ACE', syncAbilityUnlocks: [] , syncStats: maxed }] };
  assert.equal(L.buildEquipSyncAbility(data, { holobotName: 'SHADOW', abilityId: aceAbility.id }), 'not_owned');
  assert.equal(L.buildEquipSyncAbility(data, { holobotName: 'ACE', abilityId: aceAbility.id }), 'ability_locked');
  assert.equal(L.buildEquipSyncAbility({ holobots: [{ name: 'ACE', syncStats: maxed }] }, { holobotName: 'ACE', abilityId: kumaAbility.id }), 'ability_locked');
  assert.equal(L.buildEquipSyncAbility({}, { holobotName: 'ACE', abilityId: aceAbility.id }), 'not_owned');
});

test('equipSyncAbility: unlocks fall back to stored syncStats when syncAbilityUnlocks is absent', () => {
  const out = L.buildEquipSyncAbility({ holobots: [{ name: 'ACE', syncStats: maxed }] }, { holobotName: 'ACE', abilityId: aceAbility.id });
  assert.equal(out.reply.changed, true);
  assert.equal(L.buildEquipSyncAbility({ holobots: [{ name: 'ACE' }] }, { holobotName: 'ACE', abilityId: aceAbility.id }), 'ability_locked');
});

test('equipSyncAbility is idempotent: re-equipping writes nothing', () => {
  const data = { holobots: [{ name: 'ACE', syncAbilityUnlocks: [aceAbility.id], equippedSyncAbilityId: aceAbility.id }] };
  assert.deepEqual(L.buildEquipSyncAbility(data, { holobotName: 'ACE', abilityId: aceAbility.id }), {
    updates: null, reply: { equipped: true, changed: false, abilityId: aceAbility.id },
  });
});

const parts = [
  { id: 'p1', name: 'Neon Visor', rarity: 'Epic', slot: 'head' },
  { name: 'Titan Chassis', rarity: 'Rare', slot: 'torso' },
  { id: 'p3', name: 'Pulse Core', rarity: 'Legendary', slot: 'core' },
];

test('equipHolobotPart request validation', () => {
  assert.deepEqual(L.validateEquipPartRequest({ holobotName: 'ACE', slot: 'head', partId: 'p1' }), { holobotName: 'ACE', slot: 'head', partId: 'p1' });
  for (const bad of [null, {}, { holobotName: 'ACE', slot: 'hat', partId: 'p1' }, { holobotName: 'ACE', slot: 'HEAD', partId: 'p1' },
    { holobotName: 'ACE', slot: 'head' }, { holobotName: '', slot: 'head', partId: 'p1' }, { holobotName: 'ACE', slot: 'head', partId: 3 }]) {
    assert.equal(L.validateEquipPartRequest(bad), null, JSON.stringify(bad));
  }
});

test('equipHolobotPart copies the OWNED part record (never request data) into one slot', () => {
  const data = { holobots: [{ name: 'ACE' }], parts, equippedParts: { ACE: { core: { id: 'p3', name: 'Pulse Core', rarity: 'Legendary', slot: 'core' } } } };
  const out = L.buildEquipPart(data, { holobotName: 'ACE', slot: 'head', partId: 'p1', rarity: 'Mythic' });
  assert.deepEqual(out.updates, { equippedParts: { ACE: { head: { id: 'p1', name: 'Neon Visor', rarity: 'Epic', slot: 'head' } } } });
  assert.equal(out.reply.changed, true);
});

test('equipHolobotPart: synthesized ids match the HomeScreen fallback `${name}-${index}`', () => {
  const out = L.buildEquipPart({ holobots: [{ name: 'ACE' }], parts }, { holobotName: 'ACE', slot: 'torso', partId: 'Titan Chassis-1' });
  assert.equal(out.reply.part.name, 'Titan Chassis');
});

test('equipHolobotPart refusals: not owned, unknown part, wrong slot', () => {
  const data = { holobots: [{ name: 'ACE' }], parts };
  assert.equal(L.buildEquipPart(data, { holobotName: 'KUMA', slot: 'head', partId: 'p1' }), 'not_owned');
  assert.equal(L.buildEquipPart(data, { holobotName: 'ACE', slot: 'head', partId: 'forged' }), 'part_not_found');
  assert.equal(L.buildEquipPart(data, { holobotName: 'ACE', slot: 'legs', partId: 'p1' }), 'slot_mismatch');
  assert.equal(L.buildEquipPart({ holobots: [{ name: 'ACE' }] }, { holobotName: 'ACE', slot: 'head', partId: 'p1' }), 'part_not_found');
});

test('equipHolobotPart is idempotent', () => {
  const data = { holobots: [{ name: 'ACE' }], parts, equippedParts: { ACE: { head: { id: 'p1', name: 'Neon Visor', rarity: 'Epic', slot: 'head' } } } };
  assert.equal(L.buildEquipPart(data, { holobotName: 'ACE', slot: 'head', partId: 'p1' }).updates, null);
});

test('partFitsSlot follows the HomeScreen compatibleParts words', () => {
  assert.equal(L.partFitsSlot('arms', { name: 'Plasma Cannon', slot: '' }), true);
  assert.equal(L.partFitsSlot('legs', { name: 'Jet Thruster', slot: '' }), true);
  assert.equal(L.partFitsSlot('core', { name: 'Neon Visor', slot: 'head' }), false);
});

test('claimStarterDeck: grants the Genesis deck once, then never again', () => {
  const out = L.buildStarterDeckClaim({ holobots: [] });
  assert.equal(out.granted, true);
  assert.deepEqual(out.updates.arena_deck_template_ids, [...G.GENESIS_STARTER_DECK_IDS]);
  assert.deepEqual(out.updates.battle_cards, Object.fromEntries(G.GENESIS_STARTER_DECK_IDS.map((id) => [id, 1])));
  assert.equal(out.updates.starter_deck_claimed, true);
  assert.deepEqual(L.buildStarterDeckClaim({ starter_deck_claimed: true }), { updates: null, granted: false });
  assert.deepEqual(L.buildStarterDeckClaim({ battle_cards: { 'strike.quickJab': 3 } }), { updates: null, granted: false });
  assert.deepEqual(L.buildStarterDeckClaim({ ...out.updates }), { updates: null, granted: false }, 'replay after grant is a no-op');
});

test('leaderboard projection recomputes the score and ignores a stored (tampered) leaderboardScore', () => {
  const data = { username: 'pilot', leaderboardScore: 99999999, wins: 2, prestigeCount: 1, seasonSyncPoints: 40, holobots: [{ level: 7 }, { level: 3 }] };
  const entry = P.projectLeaderboardEntry('uid12345678', data);
  assert.equal(entry.leaderboardScore, 2 * 120 + 7 * 25 + 40 + 500);
  assert.equal(entry.highestHolobotLevel, 7);
  assert.equal(P.projectLeaderboardEntry('uid12345678', {}).leaderboardScore, 25);
});
