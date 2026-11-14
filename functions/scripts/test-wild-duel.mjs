// buddy-capture-1 (owner ruling 2026-11-11): Buddy capture by LIVE DUEL at the city's wild spots (city/wildDuelHost.ts +
// lib/wildDuel.ts) on the in-memory Firestore double: the chance table and the 4th-win guarantee, the Unit spent on any started
// fight and returned on a leave before FIGHT, the roll only on a VERIFIED win (seeded from the server-only session secret and the
// host-minted battle id), +20 per failed win for that wild Holobot, ownership through projectCapture, the spot's rest and the
// capture receipt the old flow's readers use, idempotency, and the old Link path left exactly as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, recordFightLog, smartPlayer, verifyFightReplay } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const W = require('../lib/lib/wildDuel.js');
const Host = require('../lib/city/wildDuelHost.js');
const City = require('../lib/city/cityEncounterHost.js');
const Spots = require('../lib/city/cityWildSpots.js');
const Store = require('../lib/acquisition/wildEncounterStore.js');
const P = require('../lib/lib/progression.js');
const { ledgerHealthAfterFight } = require('../lib/lib/partStats.js');

const T0 = Date.UTC(2026, 10, 12, 10), LATER = T0 + 25_000;
const SEED = 'cd'.repeat(32), FIGHT_SEED = process.env.WILD_DUEL_SEED || '4f'.repeat(32);
const SPOT = 'kuma_transit', WILD = 'kuma';
const threshold = l => P.calculateExperience(l + 1);
const strong = (name = 'ACE', level = 21) => ({ name, level, experience: 0, nextLevelExp: threshold(level), attributePoints: 0, boostedAttributes: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
const weak = (name = 'ACE') => ({ name, level: 1, experience: 0, nextLevelExp: threshold(1), attributePoints: 0, boostedAttributes: {} });
const dump = db => JSON.stringify([...db.docs.entries()].map(([k, v]) => [k, v.data]).sort(([a], [b]) => a < b ? -1 : 1));
const isCode = (code, detail = {}) => e => { assert.equal(e.code, code, e.message); for (const [k, v] of Object.entries(detail)) assert.equal(e.detail?.[k], v, k); return true; };
const winLog = duel => recordFightLog(duel, smartPlayer(duel, 'ace', 'Legendary')).wire;
const idleLog = duel => recordFightLog(duel, { read: () => F.toInput(F.idleRecord()) }).wire;
function tampered(duel) {
  const log = F.parseInputLog(winLog(duel));
  for (let t = 0; t < log.tickCount; t++) log.sides[0].ticks[t] = { ...log.sides[0].ticks[t], moveX: -127, moveZ: 0 };
  return F.inputLogToWire(log);
}
const LIVE = { duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-8' };

let serial = 0;
/** A pilot with a strong ACE (wins with the scripted player), Buddy Units, and the spot's session pre-provisioned with SEED. */
async function world({ bots = [strong()], units = { light: 3, medium: 2, heavy: 1 }, enabled = true } = {}) {
  const db = fakeDb({ now: T0 }), uid = `wild_duel_${serial++}`;
  db.put(`users/${uid}`, { holosTokens: 0, buddyUnits: units, holobots: bots, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: bots.map(b => b.name.toLowerCase()) } });
  await City.provisionCityEncounter(db, uid, { schemaVersion: 'city-encounter-1', operation: 'provisionSpot', spotId: SPOT }, SEED, T0);
  let battle = 0, nextIds = [];
  const opts = (extra = {}) => ({ enabled, fightChase: true, fightAttrs: true, fightSeed: () => FIGHT_SEED, battleId: () => nextIds.shift() ?? `wd_${String(++battle).padStart(32, '0')}`, ...extra });
  const call = (body, now = T0, extra) => { db.clock.now = now; return Host.transactWildDuel(db, uid, { schemaVersion: 'wild-duel-1', ...body }, now, opts(extra)); };
  let req = 0;
  const issue = (tier = 'light', now = T0, extra = {}, body = {}) => call({ operation: 'issue', requestId: `req_${uid}_${++req}`, spotId: SPOT, tier, holobotId: 'ace', ...LIVE, ...body }, now, extra);
  const settle = (battleId, inputLog, now = LATER) => call({ operation: 'settle', battleId, inputLog }, now);
  const forfeit = (battleId, now = T0 + 5_000, leftBeforeFight) => call({ operation: 'forfeit', battleId, ...(leftBeforeFight === undefined ? {} : { leftBeforeFight }) }, now);
  const user = () => db.read(`users/${uid}`), state = () => db.read(`wildDuels/${uid}`), session = () => db.read(`wildEncounterSessions/${uid}`);
  return { db, uid, call, issue, settle, forfeit, user, state, session, useIds: ids => { nextIds = [...ids]; } };
}
/** Battle ids whose roll (session secret SEED, wild KUMA) lands at or above `min` and below `max`. */
function idsRolling(min, max, n = 1) {
  const out = [];
  for (let i = 1; out.length < n && i < 100000; i++) {
    const id = `wd_${i.toString(16).padStart(32, 'a')}`, r = W.wildDuelRoll01(SEED, WILD, id);
    if (r >= min && r < max) out.push(id);
  }
  return out;
}

test('chance table: Light 25 / Medium 45 / Heavy 100, +20 per failed win, the 4th win always joins', () => {
  assert.deepEqual(W.WILD_DUEL_BASE_CHANCE, { light: 0.25, medium: 0.45, heavy: 1 });
  assert.deepEqual([0, 1, 2, 3, 9].map(f => W.wildDuelChance01('light', f)), [0.25, 0.45, 0.65, 1, 1]);
  assert.deepEqual([0, 1, 2, 3].map(f => W.wildDuelChance01('medium', f)), [0.45, 0.65, 0.85, 1]);
  assert.deepEqual([0, 1, 2, 3].map(f => W.wildDuelChance01('heavy', f)), [1, 1, 1, 1]);
  assert.deepEqual(W.wildDuelChances(1), { light: 0.45, medium: 0.65, heavy: 1 });
  // the counter only climbs on a failed win and resets on a join; a roll of 0.99 still joins on the 4th win
  assert.deepEqual(W.wildDuelWinOutcome('light', 0, 0.3), { chance01: 0.25, joined: false, failedWinsAfter: 1, nextChance01: 0.45 });
  assert.deepEqual(W.wildDuelWinOutcome('light', 3, 0.999), { chance01: 1, joined: true, failedWinsAfter: 0, nextChance01: 0.25 });
  assert.equal(W.readFailedWins({ kuma: { failedWins: 2 } }, 'kuma'), 2);
  assert.equal(W.readFailedWins({ kuma: { failedWins: -1 } }, 'kuma'), 0);
  assert.equal(W.readFailedWins(null, 'kuma'), 0);
  // the roll: deterministic per (secret, Holobot, battle id), in [0, 1), different per battle
  const a = W.wildDuelRoll01(SEED, 'kuma', 'wd_' + '1'.repeat(32));
  assert.equal(a, W.wildDuelRoll01(SEED, 'kuma', 'wd_' + '1'.repeat(32)));
  assert.ok(a >= 0 && a < 1);
  assert.notEqual(a, W.wildDuelRoll01(SEED, 'kuma', 'wd_' + '2'.repeat(32)));
  assert.notEqual(a, W.wildDuelRoll01('ef'.repeat(32), 'kuma', 'wd_' + '1'.repeat(32)));
});

test('flag: off by default; ON only with HOLOCITY_WILD_DUEL=1 and HOLOCITY_FIGHT_REPLAY=1; off answers live_unavailable and writes nothing', async () => {
  assert.equal(Host.wildDuelEnabled({}), false);
  assert.equal(Host.wildDuelEnabled({ HOLOCITY_WILD_DUEL: '1' }), false);
  assert.equal(Host.wildDuelEnabled({ HOLOCITY_WILD_DUEL: '1', HOLOCITY_FIGHT_REPLAY: '1' }), true);
  const w = await world({ enabled: false }), before = dump(w.db);
  await assert.rejects(w.issue(), isCode('live_unavailable', { reason: 'wild_duel_off' }));
  await assert.rejects(w.call({ operation: 'quote', spotId: SPOT }), isCode('live_unavailable'));
  assert.equal(dump(w.db), before);
});

test('requests are strict: unknown spot / tier / fields, no live capability, unknown rules ask are invalid_request', async () => {
  const w = await world(), before = dump(w.db);
  const bad = [
    { operation: 'issue', requestId: 'req_bad_0001', spotId: 'nowhere', tier: 'light', holobotId: 'ace', ...LIVE },
    { operation: 'issue', requestId: 'req_bad_0001', spotId: SPOT, tier: 'mega', holobotId: 'ace', ...LIVE },
    { operation: 'issue', requestId: 'req_bad_0001', spotId: SPOT, tier: 'light', holobotId: 'ace', fightRules: 'duel-rules-8' },
    { operation: 'issue', requestId: 'req_bad_0001', spotId: SPOT, tier: 'light', holobotId: 'ace', ...LIVE, fightRules: 'duel-rules-9' },
    { operation: 'issue', requestId: 'req_bad_0001', spotId: SPOT, tier: 'light', holobotId: 'ace', ...LIVE, chance01: 1 },
    { operation: 'settle', battleId: 'wd_x', inputLog: 'x' },
    { operation: 'forfeit', battleId: 'wd_' + '0'.repeat(32), leftBeforeFight: 'yes' },
    { operation: 'quote', spotId: SPOT, holobotId: 'ace' },
  ];
  for (const b of bad) await assert.rejects(w.call(b), isCode('invalid_request'), JSON.stringify(b));
  assert.equal(dump(w.db), before);
});

test('quote: Units, chances and the failed-win count for that wild Holobot; the spot as provisionSpot serves it', async () => {
  const w = await world();
  const q = await w.call({ operation: 'quote', spotId: SPOT });
  assert.deepEqual([q.spotId, q.holobotId, q.resting, q.failedWins, q.openBattleId], [SPOT, WILD, false, 0, null]);
  assert.deepEqual(q.buddyUnits, { light: 3, medium: 2, heavy: 1 });
  assert.deepEqual(q.chances, { light: 0.25, medium: 0.45, heavy: 1 });
});

test('issue: one Unit taken, a live input-log duel against the wild Holobot at the fielded level, full HP, rules-8 ask honoured', async () => {
  const w = await world();
  const i = await w.issue('light');
  assert.match(i.battleId, /^wd_[0-9a-f]{32}$/);
  assert.deepEqual([i.holobotId, i.tier, i.fighterId, i.wildLevel, i.failedWins, i.chance01, i.alreadyProcessed], [WILD, 'light', 'ace', 21, 0, 0.25, false]);
  assert.deepEqual(i.buddyUnits, { light: 2, medium: 2, heavy: 1 });
  assert.deepEqual(w.user().buddyUnits, { light: 2, medium: 2, heavy: 1 });
  const d = i.duel;
  assert.equal(d.mode, 'input-log'); assert.equal(d.rulesId, `duel-rules-8:${i.battleId}`); assert.equal(d.seed, FIGHT_SEED);
  assert.deepEqual(d.player.roster, [{ fighterId: 'ace', holobotId: 'ace' }]);
  assert.deepEqual(d.cpu.roster, [{ fighterId: 'cpu-kuma', holobotId: 'kuma', profile: 'kuma' }]);
  const me = d.rules.fighters.find(f => f.side === 0);
  assert.equal(me.hp, me.maxHp, 'the player fights at full HP');
  assert.equal(w.state().open, i.battleId);
  // the rules ask steps exactly as on the other live hosts
  assert.match((await (await world()).issue('light', T0, {}, { fightRules: 'duel-rules-7' })).duel.rulesId, /^duel-rules-7:/);
  assert.match((await (await world()).issue('light', T0, {}, { fightRules: undefined })).duel.rulesId, /^duel-rules-5:/);
  // the same requestId replays the stored duel (no second Unit)
  const again = await w.call({ operation: 'issue', requestId: i.battleId ? `req_${w.uid}_1` : '', spotId: SPOT, tier: 'light', holobotId: 'ace', ...LIVE });
  assert.equal(again.battleId, i.battleId); assert.equal(again.alreadyProcessed, true);
  assert.equal(w.user().buddyUnits.light, 2);
  await assert.rejects(w.call({ operation: 'issue', requestId: `req_${w.uid}_1`, spotId: SPOT, tier: 'medium', holobotId: 'ace', ...LIVE }), isCode('request_conflict'));
});

test('issue refusals change nothing: no Unit of that tier, a Holobot outside the squad, a knocked-out Holobot, an Arena match open', async () => {
  const w = await world({ units: { light: 0, medium: 1, heavy: 0 } }), before = dump(w.db);
  await assert.rejects(w.issue('light'), isCode('no_buddy_units', { tier: 'light' }));
  await assert.rejects(w.issue('medium', T0, {}, { holobotId: 'kuma' }), isCode('invalid_request'));
  assert.equal(dump(w.db), before);
  const ko = await world();
  ko.db.put(`users/${ko.uid}`, { ...ko.user(), holobotVitals: { ace: { currentHealth: 0, maxHealth: 500, hpUpdatedAt: T0 } } });
  const koBefore = dump(ko.db);
  await assert.rejects(ko.issue('light'), isCode('holobot_ko'));
  assert.equal(dump(ko.db), koBefore);
  const arena = await world();
  arena.db.put(`arenaMatches/${arena.uid}`, { schemaVersion: 'arena-healing-1', recordSchemaVersion: 'arena-match-1', matchId: 'am_' + 'a'.repeat(32), open: true, issuedAtMs: T0, expiresAtMs: T0 + 1 });
  await assert.rejects(arena.issue('light'), isCode('activity_conflict'));
  assert.deepEqual(arena.user().buddyUnits, { light: 3, medium: 2, heavy: 1 });
});

test('a verified WIN with a roll under the chance: the wild Holobot joins (new Lv1 bot, travel squad), spot rests 30 min, receipt for the old readers', async () => {
  const w = await world();
  const [id] = idsRolling(0, 0.25);
  w.useIds([id]);
  const i = await w.issue('light');
  const log = winLog(i.duel), expected = verifyFightReplay(i.duel, log, { battleId: i.battleId });
  assert.equal(expected.receipt.winner, 'player', 'the pinned fight seed gives the scripted ACE a win');
  const s = await w.settle(i.battleId, log);
  assert.deepEqual([s.winner, s.joined, s.rolled, s.chance01, s.failedWins, s.ownershipOutcome, s.unitSpent, s.alreadyProcessed], ['player', true, true, 0.25, 0, 'added_to_squad', true, false]);
  assert.deepEqual(s.fightReceipt, expected.receipt);
  assert.equal('roll' in s, false, 'the roll stays host-side');
  const u = w.user();
  assert.ok(u.holobots.some(b => b.name === 'KUMA' && b.level === 1));
  assert.deepEqual(u.travelSquad.holobotIds, ['ace', 'kuma']);
  assert.deepEqual(u.buddyUnits, { light: 2, medium: 2, heavy: 1 }, 'only the Unit taken at issue');
  const pf = expected.receipt.playerFinal[0];
  assert.equal(u.holobotVitals.ace.currentHealth, Math.min(u.holobotVitals.ace.maxHealth, ledgerHealthAfterFight(pf.currentHealth, pf.maxHealth, { currentHealth: u.holobotVitals.ace.maxHealth, maxHealth: u.holobotVitals.ace.maxHealth })));
  // the spot's encounter ended and the roster records the capture; the capture receipt drives the 30 min rest
  const e = w.session().encounters.find(x => x.encounterId === 'city_spot_kuma_transit_1');
  assert.equal(e.ended, true);
  assert.ok(w.session().entries.some(x => x.holobotId === 'kuma' && x.availability === 'owned'));
  const receipt = w.db.read(`wildEncounterSessions/${w.uid}/receipts/wd_${i.battleId}`);
  assert.equal(receipt.reply.captureResult.captured, true); assert.equal(receipt.reply.captureResult.encounterId, 'city_spot_kuma_transit_1');
  const resting = await City.provisionCityEncounter(w.db, w.uid, { schemaVersion: 'city-encounter-1', operation: 'provisionSpot', spotId: SPOT }, SEED, LATER + 1000);
  assert.deepEqual([resting.linked, resting.readyAtMs], [true, LATER + Spots.CITY_SPOT_COOLDOWN_MS]);
  await assert.rejects(w.issue('light', LATER + 1000), isCode('spot_resting'));
  assert.equal(w.state().open, null); assert.equal(w.state().progress.kuma, undefined);
  // a resend replays the ruling and writes nothing
  const before = dump(w.db);
  const again = await w.settle(i.battleId, log, LATER + 5);
  assert.equal(again.alreadyProcessed, true); assert.equal(again.joined, true);
  assert.equal(dump(w.db), before);
});

test('failed wins climb +20 for THAT Holobot and the 4th win always joins (Light); a join of an owned Holobot pays blueprints', async () => {
  const w = await world({ bots: [strong(), weak('KUMA')], units: { light: 4, medium: 0, heavy: 0 } });
  // three wins whose rolls beat the chance each time (0.25, 0.45, 0.65), then a roll of ~0.99 on the 4th
  const ids = [...idsRolling(0.25, 1, 1), ...idsRolling(0.45, 1, 2).slice(1), ...idsRolling(0.65, 1, 3).slice(2), ...idsRolling(0.97, 1, 4).slice(3)];
  assert.equal(new Set(ids).size, 4);
  w.useIds(ids);
  const expectChance = [0.25, 0.45, 0.65, 1];
  let now = T0;
  for (let n = 0; n < 4; n++) {
    const i = await w.issue('light', now);
    assert.equal(i.chance01, expectChance[n], `quote on fight ${n + 1}`);
    const s = await w.settle(i.battleId, winLog(i.duel), now + 25_000);
    assert.equal(s.chance01, expectChance[n]);
    if (n < 3) {
      assert.deepEqual([s.joined, s.failedWins, s.nextChance01], [false, n + 1, expectChance[n + 1]], `fight ${n + 1}`);
      assert.equal(w.state().progress.kuma.failedWins, n + 1);
      // a quote at any spot of that species shows the stored bonus
      assert.equal((await w.call({ operation: 'quote', spotId: SPOT }, now + 26_000)).chances.light, expectChance[n + 1]);
    } else {
      assert.deepEqual([s.joined, s.ownershipOutcome, s.blueprintDelta], [true, 'blueprints', 5]);
      assert.equal(w.user().blueprints.kuma, 5);
      assert.equal(w.state().progress.kuma, undefined, 'the counter resets on a join');
    }
    now += 60_000;
  }
  assert.deepEqual(w.user().buddyUnits, { light: 0, medium: 0, heavy: 0 });
});

test('Heavy always joins on a win; a LOSS spends the Unit, never rolls and leaves the counter; a loss is never too fast', async () => {
  const h = await world();
  h.useIds(idsRolling(0.999, 1));
  const hi = await h.issue('heavy');
  assert.equal(hi.chance01, 1);
  assert.equal((await h.settle(hi.battleId, winLog(hi.duel))).joined, true);
  const w = await world({ bots: [weak()] });
  w.db.put(`wildDuels/${w.uid}`, { schemaVersion: 'wild-duel-state-1', open: null, progress: { kuma: { failedWins: 2, lastBattleId: 'x', updatedAtMs: T0 } } });
  const i = await w.issue('medium');
  assert.equal(i.chance01, 0.85);
  const s = await w.settle(i.battleId, idleLog(i.duel), T0 + 2_000);
  assert.notEqual(s.winner, 'player');
  assert.deepEqual([s.joined, s.rolled, s.failedWins], [false, false, 2]);
  assert.equal(w.user().buddyUnits.medium, 1, 'spent');
  assert.equal(w.state().progress.kuma.failedWins, 2);
  assert.equal(w.db.read(`wildDuels/${w.uid}/duels/${i.battleId}`).result.roll, undefined);
});

test('too_fast: a verified win sooner than 20 s after issue writes nothing; the same log later settles', async () => {
  const w = await world(), i = await w.issue('light'), log = winLog(i.duel), before = dump(w.db);
  await assert.rejects(w.settle(i.battleId, log, T0 + 5_000), e => e.code === 'too_fast' && e.retryAfterMs === 15_000);
  assert.equal(dump(w.db), before);
  assert.equal((await w.settle(i.battleId, log, T0 + 20_000)).winner, 'player');
});

test('a log that fails replay closes the duel (no roll, Unit spent, counter untouched); an undecodable log changes nothing', async () => {
  const w = await world(), i = await w.issue('light');
  const before = dump(w.db);
  await assert.rejects(w.settle(i.battleId, 'not a log'), isCode('invalid_request'));
  assert.equal(dump(w.db), before);
  await assert.rejects(w.settle(i.battleId, tampered(i.duel)), isCode('replay_mismatch'));
  const d = w.db.read(`wildDuels/${w.uid}/duels/${i.battleId}`);
  assert.deepEqual([d.state, d.closedBy, d.result], ['closed', 'replay_mismatch', undefined]);
  assert.equal(w.state().open, null);
  assert.equal(w.user().buddyUnits.light, 2);
  await assert.rejects(w.settle(i.battleId, winLog(i.duel)), isCode('duel_closed', { closedBy: 'replay_mismatch' }));
});

test('leave before FIGHT returns the Unit; after the window (or without the claim) it is a forfeit and the Unit stays spent', async () => {
  const w = await world(), i = await w.issue('medium');
  assert.equal(w.user().buddyUnits.medium, 1);
  const c = await w.forfeit(i.battleId, T0 + 3_000, true);
  assert.deepEqual([c.closedBy, c.unitSpent, c.alreadyProcessed], ['left_before_fight', false, false]);
  assert.equal(w.user().buddyUnits.medium, 2, 'the Unit came back');
  assert.equal(w.state().open, null);
  const again = await w.forfeit(i.battleId, T0 + 4_000, true);
  assert.equal(again.alreadyProcessed, true); assert.equal(w.user().buddyUnits.medium, 2, 'given back once');
  const late = await w.issue('medium', T0 + 10_000);
  const f = await w.forfeit(late.battleId, T0 + 10_000 + 61_000, true);
  assert.deepEqual([f.closedBy, f.unitSpent], ['forfeit', true]);
  assert.equal(w.user().buddyUnits.medium, 1);
  const plain = await w.issue('light', T0 + 200_000);
  assert.equal((await w.forfeit(plain.battleId, T0 + 201_000)).closedBy, 'forfeit');
  assert.equal(w.user().buddyUnits.light, 2);
  await assert.rejects(w.settle(plain.battleId, winLog(plain.duel), T0 + 230_000), isCode('duel_closed', { closedBy: 'forfeit' }));
});

test('one open duel: a new issue replaces the open one (Unit back if it never started, spent if it did); an expired duel closes as a loss', async () => {
  const w = await world(), a = await w.issue('light');
  // ruling 6: replaced within the leave-before-FIGHT window = never started (lost issue reply): its Unit comes back
  const b = await w.issue('light', T0 + 1_000);
  assert.notEqual(a.battleId, b.battleId);
  const sa = w.db.read(`wildDuels/${w.uid}/duels/${a.battleId}`);
  assert.deepEqual([sa.closedBy, sa.unitReturned], ['superseded', true]);
  assert.equal(w.state().open, b.battleId);
  assert.equal(w.user().buddyUnits.light, 2, 'one Unit out (the open fight), the replaced one back');
  // replaced after the window: it counts as started, its Unit stays spent
  const c = await w.issue('medium', T0 + 1_000 + 61_000);
  assert.equal(w.db.read(`wildDuels/${w.uid}/duels/${b.battleId}`).unitReturned, undefined);
  assert.deepEqual(w.user().buddyUnits, { light: 2, medium: 1, heavy: 1 }, 'b\'s light Unit stays spent, c took a medium');
  const bForLater = b; const b2 = c;
  void bForLater;
  const late = T0 + 62_000 + W.WILD_DUEL_TTL_MS + 1;
  await w.call({ operation: 'quote', spotId: SPOT }, late);
  await assert.rejects(w.settle(b2.battleId, winLog(b2.duel), late), isCode('duel_expired'));
  assert.equal(w.db.read(`wildDuels/${w.uid}/duels/${b2.battleId}`).closedBy, 'expired');
  assert.equal(w.state().open, null);
});

test('old path unchanged: the Link (provisionSpot + offerToy + capture) still captures for shipped builds and Unity', async () => {
  const w = await world({ units: { light: 0, medium: 0, heavy: 1 } });
  const cap = await Store.transactWildEncounter(w.db, w.uid, { operation: 'capture', intent: { schemaVersion: 'acquisition-2', requestId: 'cap_old_1', encounterId: 'city_spot_kuma_transit_1', toyId: 'buddy_heavy', observedHealth01: 1 } });
  assert.equal(cap.captureResult.captured, true);
  assert.deepEqual(w.user().buddyUnits, { light: 0, medium: 0, heavy: 0 });
  // the duel then sees the spot resting (the same encounter cycle), with nothing taken
  await assert.rejects(w.issue('heavy', T0 + 1000), isCode('spot_resting'));
});

test('ruling 2: a verified win pays the town rival win EXP (first win of the day x2, then x1), no Holos; a loss pays nothing', async () => {
  const LB = require('../lib/lib/battleProgression.js'), LW = require('../lib/lib/liveWinRewards.js'), RL = require('../lib/lib/rivalLadder.js');
  const w = await world({ units: { light: 4, medium: 0, heavy: 0 } });
  w.useIds(idsRolling(0.25, 1, 2));
  const i = await w.issue('light');
  const log = winLog(i.duel), receipt = verifyFightReplay(i.duel, log, { battleId: i.battleId }).receipt;
  const before = w.user();
  const expect1 = LB.awardBattleExperienceRaw(before, ['ace'], { kind: 'rival', tier: RL.tierForWins(0), didWin: true, ...LW.livePerformanceFromReceipt(receipt) }, LATER, { bonusCap: LW.LIVE_WIN_BONUS_CAP, expMultiplier: 2 });
  const s = await w.settle(i.battleId, log);
  assert.equal(s.joined, false);
  assert.ok(expect1.expPerHolobot > 0);
  assert.deepEqual(s.progression, expect1.progression, 'the rival table EXP, doubled as the first live win today');
  assert.equal(s.firstWinOfDay.expMultiplier, 2); assert.equal(s.holosGranted, 0);
  assert.equal(w.user().holosTokens, before.holosTokens, 'no Holos');
  assert.equal(w.db.read(`firstWinOfDay/${w.uid}`).source, 'wild');
  const ace = w.user().holobots.find(b => b.name === 'ACE');
  assert.equal(ace.experience, expect1.holobots[0].experience);
  // the second win today pays x1
  const j = await w.issue('light', LATER + 60_000);
  const s2 = await w.settle(j.battleId, winLog(j.duel), LATER + 90_000);
  assert.equal(s2.firstWinOfDay, undefined);
  assert.ok(s2.progression[0].expGained > 0 && s2.progression[0].expGained < s.progression[0].expGained);
  // a resend replays the same EXP and writes nothing
  const snap = dump(w.db);
  assert.deepEqual((await w.settle(j.battleId, winLog(j.duel), LATER + 95_000)).progression, s2.progression);
  assert.equal(dump(w.db), snap);
  // a loss pays nothing
  const l = await (await world({ bots: [weak()] })), li = await l.issue('light'), xp0 = l.user().holobots[0].experience;
  const ls = await l.settle(li.battleId, idleLog(li.duel), T0 + 2_000);
  assert.deepEqual([ls.winner === 'player', ls.progression, ls.holosGranted], [false, [], 0]);
  assert.equal(l.user().holobots[0].experience, xp0);
});

test('ruling 5: the Research Garden KURAI (and its Mission Board posting) is fought too: once joined it is gone for good', async () => {
  const w = await world();
  const q = await w.call({ operation: 'quote', spotId: 'kurai_garden' });
  assert.deepEqual([q.holobotId, q.resting, q.gone], ['kurai', false, undefined]);
  w.useIds(idsRolling(0, 1).map(() => 'wd_' + 'b'.repeat(32)));
  const i = await w.issue('heavy', T0, {}, { spotId: 'kurai_garden' });
  assert.equal(i.holobotId, 'kurai'); assert.equal(i.duel.cpu.roster[0].holobotId, 'kurai');
  const s = await w.settle(i.battleId, winLog(i.duel));
  assert.equal(s.joined, true);
  assert.ok(w.user().holobots.some(b => b.name === 'KURAI'));
  const e = w.session().encounters.find(x => x.encounterId === 'city_kurai_garden');
  assert.equal(e.ended, true);
  assert.equal(w.db.read(`wildEncounterSessions/${w.uid}/receipts/wd_${i.battleId}`).reply.captureResult.encounterId, 'city_kurai_garden', 'the Mission Board kurai_garden posting reads this receipt');
  const after = await w.call({ operation: 'quote', spotId: 'kurai_garden' }, LATER + 1);
  assert.deepEqual([after.resting, after.gone], [true, true]);
  await assert.rejects(w.issue('light', LATER + 2, {}, { spotId: 'kurai_garden' }), isCode('spot_gone'));
});
