// auto-heal-1 (Pak 2026-11-12: "6 hours, gradually"): a damaged Holobot regenerates HP lazily from its ledger row's hpUpdatedAt
// (server ms) and is full 6 h after 0 HP. Unit tests for lib/autoHeal.ts, the ledger reads (rivalHealth), the item use
// (repairItems / desktopItems) and the read API, plus host integration on the in-memory Firestore double: the next fight issue
// carries the regenerated HP, a repair after a wait adds to it, and full-HP issue bytes are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
const require = createRequire(import.meta.url);
const AH = require('../lib/lib/autoHeal.js');
const H = require('../lib/lib/rivalHealth.js');
const R = require('../lib/lib/repairItems.js');
const I = require('../lib/lib/desktopItems.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const { buildPlayerCombatants } = require('../lib/lib/rivalLadder.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { transactDesktopItems } = require('../lib/vendors/desktopItemsHost.js');
const A = require('../lib/arena/arenaMatchStore.js');
const WS = require('../lib/workshop/workshopHealHost.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');
const { expeditionRejection } = require('../lib/holozone/expeditionErrors.js');

const HOUR = 3_600_000, FULL = AH.AUTO_HEAL_FULL_MS;
const T0 = Date.UTC(2026, 10, 12, 9);
const row = (currentHealth, maxHealth, hpUpdatedAt) => ({ currentHealth, maxHealth, ...(hpUpdatedAt === undefined ? {} : { hpUpdatedAt }) });

test('the one constant: AUTO_HEAL_FULL_MS is 6 hours', () => {
  assert.equal(FULL, 6 * HOUR);
});

test('regen: 0 -> 50 % at 3 h -> 100 % at 6 h; floor of whole points; capped at max', () => {
  const r = row(0, 200, T0);
  assert.equal(AH.effectiveHealth(r, T0), 0);
  assert.equal(AH.effectiveHealth(r, T0 + 3 * HOUR), 100);
  assert.equal(AH.effectiveHealth(r, T0 + 6 * HOUR), 200);
  assert.equal(AH.effectiveHealth(r, T0 + 60 * HOUR), 200, 'never above max');
  // 200 HP over 6 h = one point per 108 s: 107.999 s is still 0 points.
  assert.equal(AH.effectiveHealth(r, T0 + 107_999), 0);
  assert.equal(AH.effectiveHealth(r, T0 + 108_000), 1);
});

test('partial: a bot at 150/200 is full after 1.5 h; a fractional stored HP keeps its fraction', () => {
  assert.equal(AH.effectiveHealth(row(150, 200, T0), T0 + HOUR), 150 + Math.floor(200 * HOUR / FULL));
  assert.equal(AH.effectiveHealth(row(150, 200, T0), T0 + 1.5 * HOUR), 200);
  assert.equal(AH.effectiveHealth(row(124.8, 192, T0), T0 + HOUR), 124.8 + 32);
  assert.equal(AH.effectiveHealth(row(124.8, 192, T0), T0 + 6 * HOUR), 192);
});

test('no timestamp = full (rows written before auto-heal); a full row is full whatever it carries', () => {
  assert.equal(AH.effectiveHealth(row(10, 200), T0), 200);
  assert.equal(AH.effectiveHealth({ currentHealth: 10, maxHealth: 200, hpUpdatedAt: 'x' }, T0), 200, 'a non-number stamp is no stamp');
  assert.equal(AH.fullAtMs(row(10, 200), T0), null);
  assert.equal(AH.effectiveHealth(row(200, 200, T0), T0 + HOUR), 200);
});

test('clock going backwards is clamped: no negative regen, the stored HP holds', () => {
  assert.equal(AH.effectiveHealth(row(50, 200, T0), T0 - HOUR), 50);
  assert.equal(AH.fullAtMs(row(50, 200, T0), T0 - HOUR), T0 + Math.ceil(150 * FULL / 200));
  assert.equal(AH.effectiveHealth(row(50, 200, T0), NaN), 50, 'a non-finite now never inflates');
});

test('fullAtMs: the first ms regen alone reaches max (null when full); it agrees with effectiveHealth', () => {
  for (const [cur, max] of [[0, 200], [1, 331], [124.8, 192], [99, 100]]) {
    const r = row(cur, max, T0), at = AH.fullAtMs(r, T0);
    assert.equal(AH.effectiveHealth(r, at), max, `${cur}/${max} full at fullAtMs`);
    assert.ok(AH.effectiveHealth(r, at - 1) < max, `${cur}/${max} not full 1 ms earlier`);
  }
  assert.equal(AH.fullAtMs(row(0, 200, T0), T0), T0 + FULL);
  assert.equal(AH.fullAtMs(row(0, 200, T0), T0 + FULL), null);
  assert.deepEqual(AH.autoHealStatus(row(0, 200, T0), T0 + 3 * HOUR), { currentHealth: 100, maxHealth: 200, fullAtMs: T0 + FULL });
});

test('commitVitals: changed rows are stamped now; full rows carry no stamp; untouched rows keep their stored value and stamp', () => {
  const stored = { ace: row(50, 200, T0), kuma: row(10, 100), tora: row(300, 300) };
  const now = T0 + HOUR;
  const eff = AH.effectiveVitals(stored, now);
  assert.deepEqual(eff, { ace: row(83, 200), kuma: row(100, 100), tora: row(300, 300) });
  const out = AH.commitVitals(stored, { ...eff, ace: row(20, 200) }, now);
  assert.deepEqual(out.ace, row(20, 200, now), 'changed: stamped now');
  assert.deepEqual(out.kuma, row(100, 100), 'legacy unstamped row written as full, no stamp');
  assert.deepEqual(out.tora, row(300, 300), 'full stays unstamped');
  // an untouched damaged row re-written at its effective value keeps its own stamp (no rounding lost)
  assert.deepEqual(AH.commitVitals(stored, eff, now).ace, row(50, 200, T0));
  // a stored row spread back as it is stays as it is
  assert.deepEqual(AH.commitVitals(stored, { ...stored }, now).ace, row(50, 200, T0));
  // a plain row whose value equals the stored (not effective) value is a change made now
  assert.deepEqual(AH.commitVitals(stored, { ace: row(50, 200) }, now).ace, row(50, 200, now));
  // a heal to full drops the stamp
  assert.deepEqual(AH.commitVitals(stored, { ace: row(200, 200) }, now).ace, row(200, 200));
});

test('ledger reads: issueVitals / settleVitals / requireLivingVitals see the regenerated HP; settle applies regen first', () => {
  const profile = { holobotVitals: { ace: row(0, 200, T0), kuma: row(150, 300, T0) } };
  const players = [{ holobotId: 'ace', maxHealth: 200 }, { holobotId: 'kuma', maxHealth: 300 }];
  // ko-return-25: admission needs 25 % (50/200 = 1.5 h of regen from 0); no 40 % floor at issue any more
  assert.throws(() => H.requireLivingVitals(profile, ['ace'], T0), /holobot_ko/);
  assert.throws(() => H.requireLivingVitals(profile, ['ace'], T0 + HOUR), /holobot_ko/);
  H.requireLivingVitals(profile, ['ace'], T0 + 1.5 * HOUR);
  assert.equal(H.issueVitals(profile, players, T0 + 1.5 * HOUR).ace.currentHealth, 50, 'enters at its regenerated HP, no floor');
  assert.equal(H.issueVitals(profile, players, T0 + 3 * HOUR).ace.currentHealth, 100);
  assert.equal(H.issueVitals(profile, players, T0 + 3 * HOUR).kuma.currentHealth, 300);
  assert.equal(H.issueVitals(profile, players, T0 + HOUR).kuma.currentHealth, 200);
  // settle at 3 h: kuma regenerated to 300; a report of 120 lands at 120; an untouched row is the effective value
  const settled = H.settleVitals(profile, { kuma: row(300, 300) }, [{ holobotId: 'kuma', currentHealth: 120 }], T0 + 3 * HOUR);
  assert.deepEqual(settled, { ace: row(100, 200), kuma: row(120, 300) });
  const written = AH.commitVitals(profile.holobotVitals, settled, T0 + 3 * HOUR);
  assert.deepEqual(written, { ace: row(0, 200, T0), kuma: row(120, 300, T0 + 3 * HOUR) }, 'settle stamps the fighter at the settle; the bench keeps counting');
  assert.throws(() => H.settleVitals({ holobotVitals: { ace: { currentHealth: 1, maxHealth: 2, hpUpdatedAt: 'x' } } }, {}, [], T0), /unavailable/, 'a malformed stamp fails closed');
});

test('ko-return-25: the 25 % line, readyAtMs and the refusal detail', () => {
  assert.equal(AH.KO_RETURN_FRACTION, 0.25);
  const r = row(0, 200, T0);
  assert.equal(AH.fightReady(r, T0 + 1.5 * HOUR - 1), false);
  assert.equal(AH.fightReady(r, T0 + 1.5 * HOUR), true);
  assert.equal(AH.readyAtMs(r, T0), T0 + 1.5 * HOUR);
  assert.equal(AH.readyAtMs(r, T0 + 1.5 * HOUR), null);
  for (const [cur, max] of [[0, 331], [10, 192], [47.9, 192]]) {
    const x = row(cur, max, T0), at = AH.readyAtMs(x, T0);
    assert.equal(AH.fightReady(x, at), true, `${cur}/${max} ready at readyAtMs`);
    assert.equal(AH.fightReady(x, at - 1), false, `${cur}/${max} not ready 1 ms earlier`);
  }
  assert.equal(AH.fightReady(row(49, 200, T0), T0), false, '24.5 % is below the line');
  assert.equal(AH.fightReady(row(50, 200, T0), T0), true, 'exactly 25 % fights');
  assert.equal(AH.fightReady(row(0, 200), T0), true, 'no stamp = full');
  const d = AH.koRefusalDetail('ace', r, T0 + 8 * 60_000);
  assert.deepEqual(d, { holobotId: 'ace', currentHealth: 4, maxHealth: 200, minHealthFraction: 0.25, readyAtMs: T0 + 1.5 * HOUR, readyInMs: 1.5 * HOUR - 8 * 60_000,
    fullAtMs: T0 + FULL, fullInMs: FULL - 8 * 60_000, message: 'ACE is still repairing. Ready to fight in 1h 22m.' });
  // the gate names the bot that is ready LAST
  const both = { holobotVitals: { ace: row(40, 200, T0), kuma: row(0, 300, T0) } };
  assert.throws(() => H.requireLivingVitals(both, ['ace', 'kuma'], T0), e => e.message === 'holobot_ko' && e.detail.holobotId === 'kuma');
  H.requireLivingVitals(both, ['tora'], T0); // no row = fresh
});

test('repairUse applies the item on top of the regenerated HP (KO floor included) and stamps the row', () => {
  const p = (vitals, extra = {}) => ({ travelSquad: { holobotIds: ['ace'] }, emergencyPatches: 1, itemStocks: { repair_kit: 1, full_restore: 1 }, holobotVitals: vitals, ...extra });
  // 0 HP three hours ago = 100/200 now; a Patch (+25 % of max) -> 150
  const r = R.repairUse(p({ ace: row(0, 200, T0) }), 'ace', 'item.emergency_patch', T0 + 3 * HOUR);
  assert.equal(r.result.currentHealth, 150);
  assert.deepEqual(r.updates.holobotVitals.ace, row(150, 200, T0 + 3 * HOUR));
  // right after a KO the floor still applies: max(0, 40 %) + 25 % = 65 %
  assert.equal(R.repairUse(p({ ace: row(0, 200, T0) }), 'ace', 'item.emergency_patch', T0).result.currentHealth, 130);
  // a Kit after 1 h on 20/200: regen 33 -> 53, floor 80, +100 -> 180
  assert.equal(R.repairUse(p({ ace: row(20, 200, T0) }), 'ace', 'item.repair_kit', T0 + HOUR).result.currentHealth, 180);
  // regenerated to full: already_full (no item spent)
  assert.throws(() => R.repairUse(p({ ace: row(0, 200, T0) }), 'ace', 'item.emergency_patch', T0 + FULL), e => e.code === 'already_full');
  // a full restore writes a full row: no stamp
  assert.deepEqual(R.repairUse(p({ ace: row(0, 200, T0) }), 'ace', 'item.full_restore', T0 + HOUR).updates.holobotVitals.ace, row(200, 200));
});

test('items read: vitals are effective with fullAtMs / fullInMs; repairTargets follow the regen; no ledger = the reply as before', () => {
  const profile = { holosTokens: 0, emergencyPatches: 1, travelSquad: { holobotIds: ['ace', 'kuma'] }, holobotVitals: { ace: row(0, 200, T0), kuma: row(250, 300, T0 - 2 * HOUR) } };
  const s = I.itemSnapshot(profile, null, T0 + 3 * HOUR);
  assert.deepEqual(s.vitals.ace, { currentHealth: 100, maxHealth: 200, fullAtMs: T0 + FULL, fullInMs: 3 * HOUR });
  assert.deepEqual(s.vitals.kuma, { currentHealth: 300, maxHealth: 300, fullAtMs: null, fullInMs: null });
  assert.deepEqual(s.repairTargets, ['ace']);
  const bare = I.itemSnapshot({ holosTokens: 0 }, null, T0);
  assert.deepEqual(bare.vitals, {}); assert.equal('serverNowMs' in bare, false);
  assert.deepEqual(Object.keys(bare), ['schemaVersion', 'repairTargets', 'vitals', 'favoriteId', 'holosTokens', 'items', 'cachePacks', 'result'], 'reply keys unchanged');
});

// ---------------------------------------------------------------- hosts (in-memory Firestore)

const bot = (name, level = 20) => ({ name, level, experience: 0, nextLevelExp: 400, attributePoints: 0 });
const SEED = '3e'.repeat(32);
const RIVAL = { fightReplay: true, issueLegacy: false, allowLegacySettlement: false, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
const squad = ids => ({ schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ids });
function rivalIssue(vitals, now, ask = 'duel-rules-8') {
  const db = fakeDb({ now }), uid = 'ah_rival';
  db.put(`users/${uid}`, { holobots: [bot('ACE')], holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, travelSquad: squad(['ace']), ...(vitals ? { holobotVitals: vitals } : {}) });
  return transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', operation: 'issue', duelInputs: 'duel-inputs-2', fightRules: ask }, now, () => 0.4, RIVAL)
    .then(reply => ({ reply, db, user: db.read(`users/${uid}`), battle: db.read(`rivalBattles/${uid}/battles/${reply.battleId}`) }));
}
const aceMax = buildPlayerCombatants({ holobots: [bot('ACE')] }, ['ace'])[0].maxHealth;

test('integration: a damaged Holobot\'s next rival fight issue uses the regenerated HP (and the ledger is stamped at the issue)', async () => {
  const low = Math.floor(aceMax / 2);
  const now = T0 + 1.5 * HOUR; // +25 % of max regenerated
  const r = await rivalIssue({ ace: row(low, aceMax, T0) }, now);
  const want = Math.min(aceMax, low + Math.floor(aceMax * 1.5 * HOUR / FULL));
  assert.ok(want > low && want < aceMax);
  assert.equal(r.battle.issuedVitals.ace.currentHealth, want, 'the issue pins the regenerated HP');
  assert.deepEqual(r.battle.issuedVitals.ace, { currentHealth: want, maxHealth: aceMax }, 'issued rows keep their plain shape');
  assert.deepEqual(r.user.holobotVitals.ace, { currentHealth: low, maxHealth: aceMax, hpUpdatedAt: T0 }, 'the ledger row is untouched: regen keeps counting from its own stamp');
  // six hours later the same bot enters at full
  const full = await rivalIssue({ ace: row(0, aceMax, T0) }, T0 + FULL);
  assert.equal(full.battle.issuedVitals.ace.currentHealth, aceMax);
});

test('integration: duel-rules-7 / -8 issue bytes for a full-HP Holobot are unchanged (no ledger, a full row, a row regenerated to full)', async () => {
  for (const ask of ['duel-rules-7', 'duel-rules-8']) {
    const fresh = await rivalIssue(undefined, T0 + FULL, ask);
    const fullRow = await rivalIssue({ ace: row(aceMax, aceMax) }, T0 + FULL, ask);
    const healed = await rivalIssue({ ace: row(0, aceMax, T0) }, T0 + FULL, ask);
    const bytes = x => JSON.stringify(x.reply).split(x.reply.battleId).join('<battleId>'); // the random battle id is the only per-call value
    assert.equal(bytes(fullRow), bytes(fresh), `${ask}: full row = fresh`);
    assert.equal(bytes(healed), bytes(fresh), `${ask}: regenerated to full = fresh`);
    assert.equal(JSON.stringify(healed.reply.duel.rules), JSON.stringify(fresh.reply.duel.rules), `${ask}: the rules document`);
    assert.deepEqual(healed.user.holobotVitals.ace, { currentHealth: aceMax, maxHealth: aceMax }, `${ask}: the ledger is written full with no stamp`);
    assert.deepEqual(fullRow.user.holobotVitals.ace, { currentHealth: aceMax, maxHealth: aceMax });
  }
});

test('integration: a Guild Court issue serves the regenerated HP', () => {
  const profile = { holobots: [bot('ACE')], travelSquad: squad(['ace']), holobotVitals: { ace: row(0, aceMax, T0) } };
  const i = Z.issueHoloZoneRun([], 'neonforest', ['ace'], '11111111-1111-4111-8111-111111111111', T0 + 3 * HOUR, { profile });
  assert.equal(i.reply.playerCombatants[0].currentHealth, Math.floor(aceMax * 3 * HOUR / FULL));
});

function itemsWorld(vitals, extra = {}) {
  const db = fakeDb({ now: T0 }), uid = 'ah_items';
  db.put(`users/${uid}`, { holosTokens: 0, emergencyPatches: 2, itemStocks: { repair_kit: 1, full_restore: 0 }, travelSquad: squad(['ace']), holobotVitals: vitals, ...extra });
  return { db, uid, user: () => db.read(`users/${uid}`),
    use: (itemId, now, requestId = `ah_${now}`) => transactDesktopItems(db, uid, { schemaVersion: 'desktop-items-2', operation: 'use', itemId, holobotId: 'ace', requestId }, now),
    read: now => transactDesktopItems(db, uid, { schemaVersion: 'desktop-items-2', operation: 'read' }, now) };
}

test('integration: a repair after a wait adds to the regenerated value; the countdown restarts from the new HP', async () => {
  const w = itemsWorld({ ace: row(0, 200, T0) });
  const before = await w.read(T0 + 3 * HOUR);
  assert.deepEqual(before.vitals.ace, { currentHealth: 100, maxHealth: 200, fullAtMs: T0 + FULL, fullInMs: 3 * HOUR });
  const used = await w.use('item.emergency_patch', T0 + 3 * HOUR);
  assert.equal(used.result.currentHealth, 150, '100 regenerated + 25 % patch');
  assert.deepEqual(w.user().holobotVitals.ace, row(150, 200, T0 + 3 * HOUR));
  assert.equal(w.user().emergencyPatches, 1);
  assert.deepEqual(used.vitals.ace, { currentHealth: 150, maxHealth: 200, fullAtMs: T0 + 3 * HOUR + 1.5 * HOUR, fullInMs: 1.5 * HOUR });
  // 30 min later: 150 + 16 regenerated; a Kit from there -> full
  const later = await w.read(T0 + 3.5 * HOUR);
  assert.equal(later.vitals.ace.currentHealth, 150 + Math.floor(200 * 0.5 * HOUR / FULL));
  const kit = await w.use('item.repair_kit', T0 + 3.5 * HOUR);
  assert.equal(kit.result.currentHealth, 200);
  assert.deepEqual(w.user().holobotVitals.ace, row(200, 200), 'healed to full: no stamp');
  // regenerated to full: the patch refuses already_full and nothing is spent
  const w2 = itemsWorld({ ace: row(0, 200, T0) });
  await assert.rejects(w2.use('item.emergency_patch', T0 + FULL), /already_full/);
  assert.equal(w2.user().emergencyPatches, 2);
});

// ---------------------------------------------------------------- ko-return-25 at every fight door

const koDetail = (e, id) => e.detail?.holobotId === id && e.detail.readyInMs > 0 && /Ready to fight in/.test(e.detail.message) && 'fullAtMs' in e.detail;

test('ko-return-25 rival: a squad bot under 25 % refuses the issue with holobot_ko + readiness detail; at 25 % it enters at its regenerated HP', async () => {
  const quarter = Math.ceil(aceMax / 4);
  await assert.rejects(rivalIssue({ ace: row(quarter - 1, aceMax, T0) }, T0), e => e.code === 'holobot_ko' && koDetail(e, 'ace'));
  const ok = await rivalIssue({ ace: row(quarter, aceMax, T0) }, T0);
  assert.equal(ok.battle.issuedVitals.ace.currentHealth, quarter, 'no 40 % floor: the issue pins the real HP');
  // a KO'd bot is refused until regen reaches 25 % (1.5 h), then fights with exactly what it regenerated
  await assert.rejects(rivalIssue({ ace: row(0, aceMax, T0) }, T0 + HOUR), /holobot_ko/);
  const back = await rivalIssue({ ace: row(0, aceMax, T0) }, T0 + 1.5 * HOUR);
  assert.equal(back.battle.issuedVitals.ace.currentHealth, Math.floor(aceMax * 1.5 * HOUR / FULL));
  assert.ok(back.battle.issuedVitals.ace.currentHealth >= aceMax / 4);
});

test('ko-return-25 Arena: an entrant under 25 % is refused before the fee; the live fight still starts at full HP above it', async () => {
  const arenaWorld = async vitals => {
    const db = fakeDb({ now: T0 }), uid = 'ah_arena';
    await db.doc(`users/${uid}`).set({ holobots: [bot('ACE', 4)], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 },
      storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false }, holobotVitals: vitals });
    const issue = () => A.transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', operation: 'issue', requestId: 'req_ah_' + Object.keys(vitals).length + JSON.stringify(vitals).length, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-8' }, T0,
      { arenaFightReplay: true, fightChase: true, fightAttrs: true, fightSeed: () => SEED });
    return { db, uid, issue };
  };
  const max = buildPlayerCombatants({ holobots: [bot('ACE', 4)] }, ['ace'])[0].maxHealth;
  const low = await arenaWorld({ ace: row(Math.ceil(max / 4) - 1, max, T0) });
  await assert.rejects(low.issue(), e => e.code === 'holobot_ko' && koDetail(e, 'ace'));
  assert.equal(low.db.read(`users/${low.uid}`).holosTokens, 1000, 'no fee taken');
  const ok = await arenaWorld({ ace: row(Math.ceil(max / 4), max, T0) });
  const m = await ok.issue();
  const p = m.duel.rules.fighters.find(f => f.side === 0);
  assert.equal(p.hp, p.maxHp, 'live-tuning-1: the live fight is at full HP');
});

test('ko-return-25 Guild Court and expedition: under 25 % refuses with the readiness detail in the callable details', () => {
  const profile = { holobots: [bot('ACE')], travelSquad: squad(['ace']), holobotVitals: { ace: row(Math.ceil(aceMax / 4) - 1, aceMax, T0) } };
  assert.throws(() => Z.issueHoloZoneRun([], 'guild_court', ['ace'], '11111111-1111-4111-8111-111111111112', T0, { profile }), e => e.code === 'holobot_ko' && koDetail(e, 'ace'));
  assert.throws(() => Z.issueHoloZoneRun([], 'guild_court', ['ace'], '11111111-1111-4111-8111-111111111113', T0, { profile, includeHealth: false }), /holobot_ko/, 'admission without the health block too');
  // expedition admission throws the HealthError itself; its callable mapping carries the detail
  let thrown; try { H.requireLivingVitals(profile, ['ace'], T0); } catch (e) { thrown = e; }
  const rejection = expeditionRejection(thrown);
  assert.equal(rejection.message, 'holobot_ko');
  assert.equal(rejection.details.rejectionCode, 'holobot_ko');
  assert.equal(rejection.details.holobotId, 'ace');
  assert.ok(rejection.details.readyInMs > 0);
});

// ---------------------------------------------------------------- workshop-daily-1

function workshopWorld(vitals) {
  const db = fakeDb({ now: T0 }), uid = 'ah_ws';
  db.put(`users/${uid}`, { holobots: [bot('ACE')], holosTokens: 0, travelSquad: squad(['ace']), holobotVitals: vitals });
  return { db, uid, user: () => db.read(`users/${uid}`), daily: () => db.read(`workshopHeals/${uid}`),
    heal: (now, requestId = `ws_${now}`) => WS.transactWorkshopHeal(db, uid, { schemaVersion: 'healing-workshop-1', operation: 'heal', requestId }, now) };
}

test('workshop heal is once per UTC day: the second use refuses workshop_daily_used with nextFreeAtMs / nextFreeInMs and a game-voice message', async () => {
  const w = workshopWorld({ ace: row(0, aceMax, T0) });
  const first = await w.heal(T0);                                       // 09:00 UTC
  assert.deepEqual(w.user().holobotVitals.ace, row(aceMax, aceMax));
  const midnight = Date.UTC(2026, 10, 13);
  assert.equal(first.nextFreeAtMs, midnight); assert.equal(first.nextFreeInMs, midnight - T0);
  assert.deepEqual(w.daily(), { schemaVersion: 'workshop-heal-daily-1', day: '2026-11-12', usedAtMs: T0, requestId: `ws_${T0}` });
  // a replay of the same request stays free and identical
  assert.deepEqual(await w.heal(T0 + 5, `ws_${T0}`), { ...first, alreadyProcessed: true });
  // damage again, then a NEW heal the same day: refused, nothing written
  w.db.put(`users/${w.uid}`, { ...w.user(), holobotVitals: { ace: row(10, aceMax, T0 + HOUR) } });
  const at = T0 + 9 * HOUR + 48 * 60_000;                                // 18:48 UTC: next free in 5h 12m
  await assert.rejects(w.heal(at), e => e.code === 'workshop_daily_used' && e.detail.nextFreeAtMs === midnight && e.detail.nextFreeInMs === midnight - at
    && e.detail.message === 'The workshop crew already patched your squad today. Next free repair in 5h 12m.');
  assert.deepEqual(w.user().holobotVitals.ace, row(10, aceMax, T0 + HOUR));
  // the next UTC day it works again
  const next = await w.heal(midnight + 1);
  assert.equal(next.alreadyProcessed, false);
  assert.equal(w.daily().day, '2026-11-13');
  // a refusal for another reason (empty squad) does not spend the day
  const w2 = workshopWorld({ ace: row(0, aceMax, T0) });
  w2.db.put(`users/${w2.uid}`, { ...w2.user(), travelSquad: squad([]) });
  await assert.rejects(w2.heal(T0), /no_squad/);
  assert.equal(w2.daily(), undefined);
});

test('workshop-status-1: a read-only status says up front whether today\'s free heal is used, and writes nothing', async () => {
  const w = workshopWorld({ ace: row(0, aceMax, T0) });
  const midnight = Date.UTC(2026, 10, 13);
  assert.deepEqual(await WS.readWorkshopHealStatus(w.db, w.uid, T0),
    { schemaVersion: 'healing-workshop-1', operation: 'status', available: true, nextFreeAtMs: null, nextFreeInMs: null });
  assert.equal(w.daily(), undefined);                                    // reading spends nothing
  await w.heal(T0);
  const at = T0 + 2 * HOUR;
  assert.deepEqual(await WS.readWorkshopHealStatus(w.db, w.uid, at),
    { schemaVersion: 'healing-workshop-1', operation: 'status', available: false, nextFreeAtMs: midnight, nextFreeInMs: midnight - at });
  assert.equal((await WS.readWorkshopHealStatus(w.db, w.uid, midnight)).available, true);   // the next UTC day
  // request shape: only {schemaVersion, operation:'status'}; anything else goes to the heal path (and its own validation)
  assert.equal(WS.isWorkshopStatusRequest({ schemaVersion: 'healing-workshop-1', operation: 'status' }), true);
  assert.equal(WS.isWorkshopStatusRequest({ schemaVersion: 'healing-workshop-1', operation: 'status', requestId: 'x' }), false);
  assert.equal(WS.isWorkshopStatusRequest({ schemaVersion: 'healing-workshop-0', operation: 'status' }), false);
  assert.equal(WS.isWorkshopStatusRequest({ schemaVersion: 'healing-workshop-1', operation: 'heal', requestId: 'x' }), false);
  assert.equal(WS.isWorkshopStatusRequest(null), false);
  // the heal path still refuses a status-shaped request it receives directly
  await assert.rejects(WS.transactWorkshopHeal(w.db, w.uid, { schemaVersion: 'healing-workshop-1', operation: 'status' }, at), /invalid_request/);
});

test('workshop daily doc: deleteUserData removes workshopHeals/{uid} (the day marker and its receipts)', async () => {
  const deleted = [];
  const stub = { recursiveDelete: async ref => { deleted.push(ref.path); }, doc: path => ({ path }),
    collection: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }),
    runTransaction: async fn => fn({ get: async () => ({ exists: false }), set: () => {} }) };
  await deleteUserData(stub, 'u1');
  assert.ok(deleted.includes('workshopHeals/u1'));
});

// active-lead-ko-1 (QA retest 2026-11-12): a KO'd squad mate sits a City rival duel out; the lead always stays (and is still refused).
test('fightReadySquad keeps the lead and drops only KO squad mates', () => {
  const now = 1_800_000_000_000;
  const profile = { holobotVitals: { tora: { currentHealth: 0, maxHealth: 200, hpUpdatedAt: now }, kuma: { currentHealth: 150, maxHealth: 200, hpUpdatedAt: now } } };
  assert.deepEqual(H.fightReadySquad(profile, ['ace', 'tora', 'kuma'], now), ['ace', 'kuma']);
  assert.deepEqual(H.fightReadySquad(profile, ['tora', 'ace'], now), ['tora', 'ace']);
  assert.throws(() => H.requireLivingVitals(profile, H.fightReadySquad(profile, ['tora', 'ace'], now), now), /holobot_ko/);
  assert.doesNotThrow(() => H.requireLivingVitals(profile, H.fightReadySquad(profile, ['ace', 'tora'], now), now));
  assert.deepEqual(H.fightReadySquad({}, ['ace'], now), ['ace']);
});
