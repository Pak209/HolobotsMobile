// live-tuning-1 (Pak 2026-11-11, after the first live Arena fight: a level-4 ACE knocked out by one rookie HARE Special):
//  1 REVERTED (Pak: the Special is built up in battle): live start SYNC stays 0 / readiness exactly as before
//  2 the rookie Arena CPU is at the entrant's level, clamped 1..12 (other tiers unchanged)
//  3 an unguarded Special is x2 (issued attrs.specialOpenPm 2000), ATTR_DEFAULTS stays the Unity-parity 5000
//  4 a live Arena fight starts at full HP; the ledger after it is min(ledger before, fight end)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, buildFightReplayIssue, issueFor, recordFightLog, smartPlayer, verifyFightReplay, combatant } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const A = require('../lib/arena/arenaMatchStore.js');
const FI = require('../lib/rival/fightReplayIssue.js');
const P = require('../lib/lib/progression.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { courtLiveIssue } = require('../lib/lib/holoZoneCourtLive.js');
const { buildPlayerCombatants, playerCombatant } = require('../lib/lib/rivalLadder.js');
const { ledgerHealthAfterFight } = require('../lib/lib/partStats.js');

const T0 = Date.UTC(2026, 10, 11, 9), START = T0 + 1, LATER = START + A.ARENA_MIN_WIN_MS_LIVE + 5_000, SEED = '3e'.repeat(32);
const ON = { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
const LIVE = { duelSchema: 'duel-receipt-1', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' };
const bot = (name, level, boosted = {}) => ({ name, level, experience: 0, nextLevelExp: P.calculateExperience(level + 1), attributePoints: 0, boostedAttributes: boosted });
const db = fakeDb({ now: T0 });
let serial = 0;
async function setup(b = bot('ACE', 4), extra = {}) {
  const uid = `live_tuning_${serial++}`;
  await db.doc(`users/${uid}`).set({ holobots: [b], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false }, ...extra });
  return uid;
}
const call = (uid, body, now = T0, options = ON) => A.transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', ...body }, now, options);
const issue = (uid, extra = LIVE, tierId = 'rookie', opponentName = 'HARE') => call(uid, { operation: 'issue', requestId: `req_lt_${serial++}`, tierId, paymentMethod: 'tokens', holobotId: 'ace', opponentName, ...extra });
const record = async (uid, id) => (await db.doc(`arenaMatches/${uid}/matches/${id}`).get()).data();
const user = async (uid) => (await db.doc(`users/${uid}`).get()).data();
const fighters = d => d.rules.fighters;

// ------------------------------------------------------------------ 1 start SYNC (reverted)
// Pak 2026-11-11: "Special should be built up from battle for both users and enemy": item 1 (live start SYNC 50) is undone. A live
// issue's start SYNC is exactly the pre-live-tuning one: 0, or the readiness / CPU start SYNC the caller passes.
test('1 (reverted): live issues keep start SYNC 0 (readiness / CPU starts exactly as before); a Special at tick 1 is denied (NO SYNC)', () => {
  const args = { battleId: 'rb_lt', seed: SEED, tier: 4, mentor: false, player: [combatant('ace')], opponent: [combatant('wolf', 450, 85, 40)], chase: true, attrs: true, tempo: true };
  const lv = buildFightReplayIssue({ ...args, live: true });
  assert.equal('liveStartSync' in FI, false, 'no live start-SYNC rule exists');
  assert.deepEqual(fighters(lv).map(f => f.startSync), [0, 0]);
  const off = buildFightReplayIssue(args);
  assert.deepEqual(fighters(off), fighters(lv), 'fighters identical to the non-live issue (live only changes attrs.specialOpenPm)');
  const rs = { playerStartSync: { ace: 37 }, cpuStartSync: 12 };
  assert.deepEqual(fighters(buildFightReplayIssue({ ...args, ...rs, live: true })).map(f => f.startSync), [37, 12], 'readiness / CPU starts pass through unchanged');
  assert.deepEqual(fighters(buildFightReplayIssue({ ...args, ...rs, live: true })), fighters(buildFightReplayIssue({ ...args, ...rs })));
  const { rules, chase, attrs, tempo } = F.rulesDocFromJson(lv.rules);
  const r = F.runFight(rules, lv.seed, { inputs: F.FightScript.fromJson([{ t: 1, s: 0, press: 'special', tier: 1 }]) }, { inputs: F.FightScript.fromJson([]) },
    { maxTicks: 3, chase, attrs, tempo });
  assert.ok(r.events.some(e => e.side === 0 && e.tick === 1 && e.kind === F.EventKind.Denied && e.value === F.Deny.Sync), 'the Special is built up in battle');
});

test('1 (reverted): the rival, Arena and Guild Court hosts issue live (2x open) with start SYNC 0 for both sides', async () => {
  const rdb = fakeDb({ now: T0 }), ruid = 'lt_rival';
  rdb.put(`users/${ruid}`, { holobots: [bot('ACE', 20)], holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
  const r = await transactRivalBattle(rdb, ruid, { schemaVersion: 'rival-battle-3', operation: 'issue', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' }, T0, () => 0.4,
    { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, fightChase: true, fightAttrs: true, fightSeed: () => SEED });
  assert.equal(r.duel.mode, 'input-log');
  assert.ok(fighters(r.duel).every(f => f.startSync === 0)); assert.equal(r.duel.rules.attrs.specialOpenPm, 2000);
  const uid = await setup(), a = await issue(uid);
  assert.deepEqual(fighters(a.duel).map(f => f.startSync), [0, 0]); assert.equal(a.duel.rules.attrs.specialOpenPm, 2000);
  const ace = buildPlayerCombatants({ holobots: [bot('ACE', 21)] }, ['ace'])[0];
  const c = courtLiveIssue({ fighter: { ...ace, currentHealth: ace.maxHealth }, gear: { attack: 0, defense: 0, health: 0, speed: 0, special: 0 }, zoneId: 'guild_court', tier: 0, runId: 'run1', seed: SEED, chase: true, attrs: true, tempo: true });
  assert.deepEqual(fighters(c).map(f => f.startSync), [0, 0]); assert.equal(c.rules.attrs.specialOpenPm, 2000);
});

// ------------------------------------------------------------------ 2 rookie level
test('2: rookie live opponent = entrant level clamped 1..12; other tiers keep 24 / 36 / 45', async () => {
  assert.deepEqual([1, 4, 12, 13, 60].map(l => A.arenaLiveOpponentLevel('rookie', 12, l)), [1, 4, 12, 12, 12]);
  assert.equal(A.arenaLiveOpponentLevel('rookie', 12, NaN), 1);
  assert.deepEqual([['challenger', 24], ['elite', 36], ['legend', 45]].map(([t, l]) => A.arenaLiveOpponentLevel(t, l, 4)), [24, 36, 45]);
  const uid = await setup(), i = await issue(uid), m = await record(uid, i.matchId);
  assert.equal(m.opponent.level, 4, 'level-4 ACE meets a level-4 HARE');
  assert.equal(i.match.opponent.level, 4, 'the served match shows the same level');
  const hare4 = playerCombatant('hare', { name: 'HARE', level: 4 }), hare12 = playerCombatant('hare', { name: 'HARE', level: 12 });
  assert.equal(m.opponent.maxHealth, hare4.maxHealth); assert.ok(hare4.maxHealth < hare12.maxHealth);
  const high = await setup(bot('ACE', 30)), h = await record(high, (await issue(high)).matchId);
  assert.equal(h.opponent.level, 12, 'capped at the old rookie level');
  const ch = await setup(bot('ACE', 4)), c = await record(ch, (await issue(ch, LIVE, 'challenger', 'KUMA')).matchId);
  assert.equal(c.opponent.level, 24, 'challenger unchanged');
  const res = await setup(bot('ACE', 4)), rm = await record(res, (await issue(res, { duelSchema: 'duel-receipt-1' })).matchId);
  assert.equal(rm.opponent.level, 12, 'resolver (non-live) match keeps the fixed rookie level');
});

// ------------------------------------------------------------------ 3 special open
test('3: live attrs.specialOpenPm = 2000 (issued + hashed); defaults stay 5000; the value is inside the client validator range', () => {
  assert.equal(F.ATTR_DEFAULTS.specialOpenPm, 5000, 'Unity-parity default unchanged');
  assert.equal(FI.LIVE_SPECIAL_OPEN_PM, 2000);
  const off = issueFor({ chase: true, attrs: true });
  assert.equal(off.rules.attrs.specialOpenPm, 5000);
  const lv = buildFightReplayIssue({ battleId: 'rb_fixture000000000000000000', seed: '5eed'.repeat(16), tier: 4, mentor: false, player: [combatant('ace')], opponent: [combatant('wolf', 450, 85, 40)], chase: true, attrs: true, live: true });
  assert.equal(lv.rules.attrs.specialOpenPm, 2000);
  const doc = F.rulesDocFromJson(lv.rules);   // the phone's rulesDocFromJson has the same 1000..5000 check
  assert.equal(doc.attrs.specialOpenPm, 2000);
  assert.equal(F.rulesHash(doc.rules, doc.chase, doc.attrs, doc.tempo), lv.rulesHash);
  assert.notEqual(lv.rulesHash, off.rulesHash);
  assert.throws(() => F.attrsFromJson({ ...F.defaultAttrRules(), specialOpenPm: 999 }), /invalid_attrs_rules/);
  // an unguarded Special does 2x its base damage, a guarded one is the unchanged chip
  const { rules, chase, attrs, tempo } = doc;
  const core = new F.FightCore(rules, lv.seed, chase, attrs, tempo), f = core.F[0];
  f.atkTier = 1; const base = core.damage(0, F.Move.Special, false, 1000, 3000), chip = core.damage(0, F.Move.Special, false, rules.chipSpecialPm, 3000); f.atkTier = 0;
  assert.equal(Math.trunc(base * attrs.specialOpenPm / 1000), base * 2);
  assert.ok(chip < base);
});

test('3: a live issue verifies end to end (a brain-played log replays with the issued startSync + specialOpenPm)', () => {
  const lv = buildFightReplayIssue({ battleId: 'rb_live', seed: SEED, tier: 2, mentor: false, chase: true, attrs: true, tempo: true, live: true,
    player: [{ ...buildPlayerCombatants({ holobots: [bot('ACE', 4)] }, ['ace'])[0] }], opponent: [{ ...playerCombatant('hare', { name: 'HARE', level: 4 }), statSource: 'progression' }] });
  const v = verifyFightReplay(lv, recordFightLog(lv, smartPlayer(lv, 'ace', 'Starter')).wire, { battleId: 'rb_live' });
  assert.equal(v.receipt.verified, true);
});

// ------------------------------------------------------------------ 4 full HP
test('4: a live Arena fight starts at full HP; the ledger after a settle is min(ledger before, fight end); a forfeit leaves it', async () => {
  const uid = await setup(bot('ACE', 21, { attack: 2000, defense: 2000, health: 2000, speed: 2000 }));
  const maxHp = buildPlayerCombatants({ holobots: [bot('ACE', 21, { attack: 2000, defense: 2000, health: 2000, speed: 2000 })] }, ['ace'])[0].maxHealth;
  const low = Math.ceil(maxHp * 0.3); // ko-return-25: a ledger HP the gate admits
  await db.doc(`users/${uid}`).update({ holobotVitals: { ace: { currentHealth: low, maxHealth: maxHp, hpUpdatedAt: T0 } } });
  const i = await issue(uid), m = await record(uid, i.matchId);
  const p = fighters(i.duel)[0];
  assert.equal(p.hp, p.maxHp, 'fight HP is full');
  assert.equal(m.entrant.currentHealth, maxHp, 'the match pins full HP');
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, low, 'issue leaves the ledger as it was');
  await call(uid, { operation: 'start', matchId: i.matchId }, START);
  const log = recordFightLog(i.duel, smartPlayer(i.duel, 'ace', 'Legendary')).wire, v = verifyFightReplay(i.duel, log, { battleId: i.matchId });
  await call(uid, { operation: 'settle', matchId: i.matchId, inputLog: log }, LATER);
  const pf = v.receipt.playerFinal[0], end = ledgerHealthAfterFight(pf.currentHealth, pf.maxHealth, m.entrant);
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, Math.min(low, end));
  assert.equal(A.readArenaMatchRecord(await record(uid, i.matchId), i.matchId).state, 'settled', 'the record validator accepts it');
  // forfeit after start
  const u2 = await setup(), max2 = buildPlayerCombatants({ holobots: [bot('ACE', 4)] }, ['ace'])[0].maxHealth, carried = Math.ceil(max2 * 0.3); await db.doc(`users/${u2}`).update({ holobotVitals: { ace: { currentHealth: carried, maxHealth: max2, hpUpdatedAt: T0 } } });
  const j = await issue(u2); await call(u2, { operation: 'start', matchId: j.matchId }, START);
  const f = await call(u2, { operation: 'cancel', matchId: j.matchId }, START + 1000);
  assert.deepEqual([f.match.settlementReceipt.outcome, f.match.settlementReceipt.countedAsLoss], ['forfeit', true]);
  assert.equal((await user(u2)).holobotVitals.ace.currentHealth, carried, 'forfeit (a loss) keeps the ledger as it was');
  assert.equal(A.readArenaMatchRecord(await record(u2, j.matchId), j.matchId).state, 'cancelled', 'the record validator accepts it');
  // a KO'd ledger still cannot enter
  const u3 = await setup(); await db.doc(`users/${u3}`).update({ holobotVitals: { ace: { currentHealth: 0, maxHealth: 100, hpUpdatedAt: T0 } } });
  await assert.rejects(issue(u3));
});
