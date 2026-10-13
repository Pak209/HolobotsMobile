// R4: actual Firestore transactions, exact pinned legacy known-bads and adversarial candidate matrix.
// Never permits a production project or non-loopback database endpoint.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadLegacyCallable } from '../../Documentation/QA/2026-10-12-r4-arena-host/fixtures/load-legacy-callables.mjs';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) {
  throw new Error('Loopback demo Firestore emulator required; production is forbidden');
}
const { db } = require('../lib/admin.js');
const { transactArenaMatch } = require('../lib/arena/arenaMatchStore.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { transactHoloZoneRun } = require('../lib/holozone/holoZoneStore.js');
const { transactDesktopItems } = require('../lib/vendors/desktopItemsHost.js');
const { chargeArenaEntry } = require('../lib/arena/chargeArenaEntry.js');
const { settleArenaBattle } = require('../lib/arena/settleArenaBattle.js');
const legacyCharge = loadLegacyCallable('chargeArenaEntry');
const legacySettle = loadLegacyCallable('settleArenaBattle');
const T0 = Date.UTC(2026, 9, 12, 22, 0, 0);
const HEALTH = 'rival-health-1';
let serial = 0;
let emulatorTransportRetries = 0;
after(() => console.log(`R4 measured bounded emulator transport retries: ${emulatorTransportRetries}`));
const bot = () => ({ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, rank: 'Starter', attributePoints: 1, boostedAttributes: { attack: 3 } });
async function setup(extra = {}) {
  const uid = `arena_r4_${Date.now()}_${serial++}`;
  await db.doc(`users/${uid}`).set({
    holobots: [bot(), { name: 'KUMA', level: 1, experience: 350, nextLevelExp: 400, attributePoints: 0 }],
    travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] },
    buddyUnits: { light: 0, medium: 0, heavy: 0 }, arenaPassses: 3,
    holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0, emergencyPatches: 3,
    holobotVitals: { ace: { currentHealth: 60, maxHealth: 172 } }, ...extra,
  });
  return uid;
}
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const doc = async path => (await db.doc(path).get()).data();
async function tree(collection) {
  const result = {};
  for (const snapshot of (await db.collection(collection).get()).docs) result[snapshot.id] = snapshot.data();
  return result;
}
async function state(uid) {
  return {
    user: await user(uid), arena: await doc(`arenaMatches/${uid}`),
    matches: await tree(`arenaMatches/${uid}/matches`), requests: await tree(`arenaMatches/${uid}/requests`),
    arenaReceipts: await tree(`arenaMatches/${uid}/receipts`),
    rivals: await doc(`rivalBattles/${uid}`), rivalBattles: await tree(`rivalBattles/${uid}/battles`),
    zones: await doc(`holoZoneRuns/${uid}`), items: await doc(`itemInventories/${uid}`),
    itemReceipts: await tree(`itemInventories/${uid}/receipts`),
  };
}
async function refused(uid, action, expected, label = 'rejection') {
  const before = await state(uid);
  await assert.rejects(action, expected, label);
  assert.deepEqual(await state(uid), before, `${label} must not partially mutate any relevant document`);
}
const oldRequest = battleId => ({ battleId, holobotName: 'ACE', tierId: 'rookie', didWin: true, opponentName: 'HARE', combosCompleted: 0, perfectDefenses: 0 });

// These tests intentionally prove vulnerable original behavior. Candidate rejection cases follow.
test('KNOWN-BAD exact old callable: unpaid settlement mints 100 Holos and a win', async () => {
  const uid = await setup();
  const before = await user(uid);
  const reply = await legacySettle.run({ auth: { uid }, data: oldRequest('unpaid_a') });
  assert.equal(reply.alreadyProcessed, false);
  assert.equal((await user(uid)).holosTokens - before.holosTokens, 100);
  assert.equal((await user(uid)).wins - before.wins, 1);
  assert.equal(await doc(`arenaMatches/${uid}`), undefined);
});

test('KNOWN-BAD exact old callable: client IDs A → B → A pay all three times', async () => {
  const uid = await setup();
  for (const id of ['forged_a', 'forged_b', 'forged_a']) {
    assert.equal((await legacySettle.run({ auth: { uid }, data: oldRequest(id) })).alreadyProcessed, false);
  }
  assert.equal((await user(uid)).holosTokens, 1300);
  assert.equal((await user(uid)).wins, 3);
});

test('KNOWN-BAD exact old callable: lost entry reply and retry charge twice', async () => {
  const uid = await setup();
  for (let n = 0; n < 2; n++) await legacyCharge.run({ auth: { uid }, data: { tierId: 'rookie', paymentMethod: 'tokens' } });
  assert.equal((await user(uid)).holosTokens, 900);
  assert.equal(await doc(`arenaMatches/${uid}`), undefined);
});

const call = (uid, data, now = T0) => transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', ...data }, now);
const issueData = (requestId = 'arena_issue_1', overrides = {}) => ({ operation: 'issue', requestId, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...overrides });
async function issue(uid, requestId = 'arena_issue_1', overrides = {}, now = T0) {
  const before = Object.keys(await tree(`arenaMatches/${uid}/matches`));
  const reply = await call(uid, issueData(requestId, overrides), now);
  const matches = await tree(`arenaMatches/${uid}/matches`);
  const newIds = Object.keys(matches).filter(id => !before.includes(id));
  assert.equal(newIds.length, 1, 'one durable match must be created');
  return { reply, matchId: newIds[0], record: matches[newIds[0]] };
}
const rival = (uid, data, now = T0) => transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', ...data }, now);
const zone = (uid, data, now = T0) => transactHoloZoneRun(db, uid, { schemaVersion: 'holozone-run-2', ...data }, now);
const patch = (uid, requestId = 'patch_1', now = T0) => transactDesktopItems(db, uid, { schemaVersion: 'desktop-items-2', operation: 'use', itemId: 'item.emergency_patch', requestId, holobotId: 'ace' }, now);

test('candidate legacy entry and unissued payout requests fail closed without partial writes', async () => {
  const uid = await setup();
  await refused(uid, () => chargeArenaEntry.run({ auth: { uid }, data: { tierId: 'rookie', paymentMethod: 'tokens' } }), /invalid|upgrade|schema|match/i);
  await refused(uid, () => settleArenaBattle.run({ auth: { uid }, data: oldRequest('unpaid_candidate') }), /invalid|upgrade|schema|match/i);
  await refused(uid, () => call(uid, { operation: 'settle', matchId: 'am_000000000000000000000000' }), /invalid|unknown/i);
});

test('five concurrent duplicate issue requests create one server match and debit once', async () => {
  const uid = await setup();
  const replies = await Promise.all(Array.from({ length: 5 }, () => call(uid, issueData())));
  assert.equal(Object.keys(await tree(`arenaMatches/${uid}/matches`)).length, 1);
  assert.equal((await user(uid)).holosTokens, 950);
  assert.equal((await doc(`arenaMatches/${uid}`)).open, true);
  assert.equal(new Set(replies.map(r => r.matchId)).size, 1);
  assert.ok(replies[0].matchId, 'server match id must be returned to the client');
  await refused(uid, () => call(uid, issueData('arena_issue_1', { tierId: 'challenger', opponentName: 'KUMA' })), /conflict/);
  await refused(uid, () => call(uid, issueData('arena_issue_2')), /activity_conflict|open_match/);
});

test('pass entry debits one pass and cannot substitute a different payment under the same request key', async () => {
  const uid = await setup();
  await issue(uid, 'pass_req_1', { paymentMethod: 'pass' });
  await call(uid, issueData('pass_req_1', { paymentMethod: 'pass' }), T0 + 1);
  assert.equal((await user(uid)).arenaPassses, 2);
  assert.equal((await user(uid)).holosTokens, 1000);
  await refused(uid, () => call(uid, issueData('pass_req_1')), /conflict/);
});

test('invalid issue identities, affordability, KO and malformed vitals never debit or create a lease', async () => {
  const cases = [
    [{}, { holobotId: 'wolf' }, /invalid|unavailable|not_owned/],
    [{ holobots: [bot(), bot()] }, {}, /invalid|unavailable|ambiguous/],
    [{ holobotVitals: { ace: { currentHealth: 0, maxHealth: 172 } } }, {}, /holobot_ko/],
    [{ holobotVitals: { ace: { currentHealth: -1, maxHealth: 172 } } }, {}, /unavailable|invalid/],
    [{ holobotVitals: { ace: { currentHealth: 173, maxHealth: 172 } } }, {}, /unavailable|invalid/],
    [{ holosTokens: 49 }, {}, /insufficient|afford|funds/],
    [{ arenaPassses: 0 }, { paymentMethod: 'pass' }, /insufficient|afford|passes/],
    [{}, { tierId: 'invented' }, /invalid/],
    [{}, { opponentName: 'WOLF' }, /invalid/],
    [{}, { paymentMethod: 'free' }, /invalid/],
    [{}, { requestId: '../outside' }, /invalid/],
    [{}, { didWin: true }, /invalid/],
  ];
  for (const [profile, command, rejection] of cases) {
    const uid = await setup(profile);
    await refused(uid, () => call(uid, issueData('bad_issue', command)), rejection);
  }
});

test('Arena lease blocks every Rival issue version with health flag on and off', async () => {
  const uid = await setup(); await issue(uid);
  for (const schemaVersion of [undefined, 'rival-battle-1', 'rival-battle-2', 'rival-battle-3']) {
    for (const healthSchema of [undefined, HEALTH]) {
      await refused(uid, () => transactRivalBattle(db, uid, { operation: 'issue', ...(schemaVersion ? { schemaVersion } : {}), ...(healthSchema ? { healthSchema } : {}) }, T0 + 1), /activity_conflict/);
    }
  }
});

test('Arena lease blocks every Zone issue version with health flag on and off', async () => {
  const uid = await setup(); await issue(uid);
  for (const schemaVersion of [undefined, 'holozone-run-1', 'holozone-run-2']) {
    for (const healthSchema of [undefined, HEALTH]) {
      await refused(uid, () => transactHoloZoneRun(db, uid, { operation: 'issue', zoneId: 'neonforest', ...(schemaVersion ? { schemaVersion } : {}), ...(healthSchema ? { healthSchema } : {}) }, T0 + 1), /activity_conflict/);
    }
  }
});

test('preexisting Rival and Zone records block Arena before debit, regardless of health flag', async () => {
  for (const kind of ['rival', 'zone']) for (const healthSchema of [undefined, HEALTH]) {
    const uid = await setup();
    const health = healthSchema ? { healthSchema } : {};
    if (kind === 'rival') await rival(uid, { operation: 'issue', ...health });
    else await zone(uid, { operation: 'issue', zoneId: 'neonforest', ...health });
    await refused(uid, () => call(uid, issueData()), /activity_conflict/);
  }
});

test('repair during open Arena never consumes inventory, heals, or writes a receipt', async () => {
  const uid = await setup(); await issue(uid);
  await refused(uid, () => patch(uid, 'repair_during_arena'), /arena_no_heal/);
});

const start = (uid, matchId, now = T0 + 1) => call(uid, { operation: 'start', matchId }, now);
const settleData = (matchId, overrides = {}) => ({ operation: 'settle', matchId, playerFinalHealth: 30, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0, ...overrides });
const settle = (uid, matchId, overrides = {}, now = T0 + 2000) => call(uid, settleData(matchId, overrides), now);
const match = (uid, matchId) => doc(`arenaMatches/${uid}/matches/${matchId}`);

test('valid issue binds cost, entrant and opponent; start/settle writes stable receipt and downward HP', async () => {
  const uid = await setup(); const issued = await issue(uid);
  assert.match(issued.matchId, /^am_[a-f0-9]{32}$/);
  assert.equal(issued.reply.matchId, issued.matchId);
  assert.equal(issued.record.state, 'issued');
  assert.equal(issued.record.entrant.holobotId, 'ace');
  assert.equal(issued.record.entrant.currentHealth, 60);
  assert.equal(issued.record.opponent.name, 'HARE');
  assert.equal(issued.record.entryReceipt.method, 'tokens');
  assert.equal(issued.record.entryReceipt.amount, 50);
  assert.equal((await user(uid)).holosTokens, 950);
  await start(uid, issued.matchId);
  const reply = await settle(uid, issued.matchId);
  assert.equal(reply.match.state, 'settled');
  assert.ok(reply.match.settlementReceipt);
  assert.equal((await user(uid)).holosTokens, 1050);
  assert.equal((await user(uid)).wins, 1);
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 30);
  assert.equal((await doc(`arenaMatches/${uid}`)).open, false);
  assert.deepEqual((await match(uid, issued.matchId)).settlementReceipt, reply.match.settlementReceipt);
});

test('five concurrent settlements award once and every retry returns the durable receipt', async () => {
  const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
  const results = await Promise.all(Array.from({ length: 5 }, () => settle(uid, issued.matchId)));
  assert.equal(results.filter(r => !r.alreadyProcessed).length, 1);
  assert.equal((await user(uid)).holosTokens, 1050);
  assert.equal((await user(uid)).wins, 1);
  for (const reply of results) assert.deepEqual(reply.match.settlementReceipt, results[0].match.settlementReceipt);
  const before = await state(uid);
  const replay = await settle(uid, issued.matchId, {}, T0 + 6000);
  assert.equal(replay.alreadyProcessed, true);
  assert.deepEqual(replay.match.settlementReceipt, results[0].match.settlementReceipt);
  assert.deepEqual(await state(uid), before);
});

test('paid A → paid B → A replay cannot repay A, overwrite B lease, or erase A receipt', async () => {
  const uid = await setup(); const a = await issue(uid, 'paid_match_a'); await start(uid, a.matchId);
  const first = await settle(uid, a.matchId);
  const b = await issue(uid, 'paid_match_b', {}, T0 + 3000);
  const before = await state(uid);
  const replay = await settle(uid, a.matchId, {}, T0 + 4000);
  assert.equal(replay.alreadyProcessed, true);
  assert.deepEqual(replay.match.settlementReceipt, first.match.settlementReceipt);
  assert.deepEqual(await state(uid), before);
  assert.equal((await doc(`arenaMatches/${uid}`)).matchId, b.matchId);
  const resume = await call(uid, { operation: 'resume', matchId: a.matchId }, T0 + 5000);
  assert.deepEqual(resume.match.settlementReceipt, first.match.settlementReceipt);
  assert.deepEqual(await state(uid), before);
});

test('settlement requires started server match, owner, minimum elapsed time and original binding', async () => {
  const uid = await setup(), foreign = await setup(); const issued = await issue(uid);
  await refused(uid, () => settle(uid, issued.matchId), /invalid_state/);
  await refused(foreign, () => settle(foreign, issued.matchId), /unknown_match/);
  await refused(foreign, () => start(foreign, issued.matchId), /unknown_match/);
  await refused(foreign, () => call(foreign, { operation: 'cancel', matchId: issued.matchId }), /unknown_match/);
  await refused(foreign, () => call(foreign, { operation: 'resume', matchId: issued.matchId }), /unknown_match/);
  await start(uid, issued.matchId);
  await refused(uid, () => settle(uid, issued.matchId, {}, T0 + 500), /too_fast/);
  for (const injected of [{ tierId: 'legend' }, { holobotId: 'kuma' }, { reward: 1000000 }, { didWin: true }, { opponentName: 'WOLF' }, { paymentMethod: 'pass' }]) {
    await refused(uid, () => settle(uid, issued.matchId, injected), /invalid_request/);
  }
});

test('negative, inflated, nonfinite, ambiguous terminal and overbound performance reports write nothing', async () => {
  const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
  const bads = [
    { playerFinalHealth: 61 }, { playerFinalHealth: -1 }, { playerFinalHealth: NaN }, { playerFinalHealth: Infinity },
    { opponentFinalHealth: -1 }, { opponentFinalHealth: NaN }, { opponentFinalHealth: Infinity },
    { playerFinalHealth: 1, opponentFinalHealth: 1 }, { playerFinalHealth: 0, opponentFinalHealth: 0 },
    { playerFinalHealth: 0, opponentFinalHealth: issued.record.opponent.maxHealth + 1 },
    { combosCompleted: -1 }, { combosCompleted: 26 }, { combosCompleted: 0.5 }, { combosCompleted: NaN },
    { perfectDefenses: -1 }, { perfectDefenses: 26 }, { perfectDefenses: 0.5 }, { perfectDefenses: Infinity },
    { playerFinalHealth: '30' }, { currentHealth: 30 },
  ];
  for (const bad of bads) await refused(uid, () => settle(uid, issued.matchId, bad), /invalid_request/);
});

test('settlement preserves lower persistent HP and never duplicates XP onto another owned species', async () => {
  const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
  await db.doc(`users/${uid}`).update({ 'holobotVitals.ace.currentHealth': 20 });
  const beforeKuma = (await user(uid)).holobots[1];
  await settle(uid, issued.matchId, { playerFinalHealth: 30 });
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 20);
  assert.deepEqual((await user(uid)).holobots[1], beforeKuma);
});

test('loss persists KO without Arena recovery; next issue refuses until an explicit repair', async () => {
  const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
  await settle(uid, issued.matchId, { playerFinalHealth: 0, opponentFinalHealth: 1 });
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 0);
  assert.equal((await user(uid)).wins, 0); assert.equal((await user(uid)).losses, 1);
  assert.equal((await user(uid)).holosTokens, 950);
  await refused(uid, () => call(uid, issueData('after_ko_1')), /holobot_ko/);
  await patch(uid, 'after_ko_repair', T0 + 3000);
  const repaired = (await user(uid)).holobotVitals.ace.currentHealth;
  assert.ok(repaired > 0);
  const next = await issue(uid, 'after_ko_2', {}, T0 + 4000);
  assert.equal(next.record.entrant.currentHealth, repaired);
});

test('lost issue/start replies recover one paid match; repeated resume is read-only', async () => {
  const uid = await setup(); const issued = await issue(uid, 'lost_issue_1');
  const replay = await call(uid, issueData('lost_issue_1'), T0 + 10);
  assert.equal(replay.matchId, issued.matchId);
  assert.equal((await user(uid)).holosTokens, 950);
  await start(uid, issued.matchId);
  const before = await state(uid);
  const again = await start(uid, issued.matchId, T0 + 10);
  assert.equal(again.matchId, issued.matchId);
  for (let n = 0; n < 3; n++) {
    const resumed = await call(uid, { operation: 'resume', matchId: issued.matchId }, T0 + 20 + n);
    assert.equal(resumed.match.state, 'active');
    assert.equal(resumed.match.entryReceipt.amount, 50);
  }
  assert.deepEqual(await state(uid), before);
});

test('unstarted cancellation refunds the original token/pass once and receipt survives retries', async () => {
  for (const paymentMethod of ['tokens', 'pass']) {
    const uid = await setup(); const issued = await issue(uid, 'cancel_before_start', { paymentMethod });
    const results = await Promise.all(Array.from({ length: 5 }, () => call(uid, { operation: 'cancel', matchId: issued.matchId }, T0 + 1)));
    assert.equal(results.filter(r => !r.alreadyProcessed).length, 1);
    assert.equal((await user(uid)).holosTokens, 1000); assert.equal((await user(uid)).arenaPassses, 3);
    assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 60);
    assert.equal((await doc(`arenaMatches/${uid}`)).open, false);
    assert.equal((await match(uid, issued.matchId)).state, 'cancelled');
    const before = await state(uid);
    await call(uid, { operation: 'cancel', matchId: issued.matchId }, T0 + 2);
    assert.deepEqual(await state(uid), before);
  }
});

test('started cancellation requires downward HP, gives no refund/reward, and closes once', async () => {
  const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
  await refused(uid, () => call(uid, { operation: 'cancel', matchId: issued.matchId }, T0 + 2000), /invalid_request/);
  await refused(uid, () => call(uid, { operation: 'cancel', matchId: issued.matchId, playerFinalHealth: 61 }, T0 + 2000), /invalid_request/);
  const reply = await call(uid, { operation: 'cancel', matchId: issued.matchId, playerFinalHealth: 23 }, T0 + 2000);
  assert.equal(reply.match.state, 'cancelled');
  assert.equal((await user(uid)).holosTokens, 950);
  assert.equal((await user(uid)).wins, 0); assert.equal((await user(uid)).losses, 0);
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 23);
  assert.equal((await doc(`arenaMatches/${uid}`)).open, false);
});

test('expired unresolved match remains leased until explicit cancellation, with no timeout healing', async () => {
  for (const active of [false, true]) {
    const uid = await setup(); const issued = await issue(uid);
    if (active) await start(uid, issued.matchId);
    const afterExpiry = issued.record.expiresAtMs + 1;
    assert.ok(Number.isFinite(afterExpiry));
    const before = await state(uid);
    await call(uid, { operation: 'resume', matchId: issued.matchId }, afterExpiry);
    assert.deepEqual(await state(uid), before);
    await refused(uid, () => call(uid, issueData('after_expire_1'), afterExpiry), /activity_conflict/);
    await refused(uid, () => rival(uid, { operation: 'issue' }, afterExpiry), /activity_conflict/);
    await refused(uid, () => zone(uid, { operation: 'issue', zoneId: 'neonforest' }, afterExpiry), /activity_conflict/);
    await refused(uid, () => patch(uid, 'expired_repair', afterExpiry), /between_battles_only|arena_no_heal/);
    await refused(uid, () => (active ? settle(uid, issued.matchId, {}, afterExpiry) : start(uid, issued.matchId, afterExpiry)), /match_expired/);
    const cancelled = await call(uid, { operation: 'cancel', matchId: issued.matchId, ...(active ? { playerFinalHealth: 25 } : {}) }, afterExpiry);
    assert.ok(['cancelled', 'expired'].includes(cancelled.match.state));
    assert.equal((await doc(`arenaMatches/${uid}`)).open, false);
    assert.equal((await user(uid)).holosTokens, active ? 950 : 1000);
    assert.equal((await user(uid)).holobotVitals.ace.currentHealth, active ? 25 : 60);
  }
});

test('distinct Arena request IDs racing cannot double-debit or create overlapping matches', async () => {
  const uid = await setup();
  const results = await Promise.allSettled(['race_issue_a', 'race_issue_b'].map(id => call(uid, issueData(id))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(results.find(r => r.status === 'rejected').reason.message, /activity_conflict/);
  assert.equal((await user(uid)).holosTokens, 950);
  assert.equal(Object.keys(await tree(`arenaMatches/${uid}/matches`)).length, 1);
});

test('Arena issue races against Rival and Zone admit exactly one activity for both health modes', async () => {
  for (const kind of ['rival', 'zone']) for (const flagged of [false, true]) {
    const uid = await setup(); const health = flagged ? { healthSchema: HEALTH } : {};
    const arenaRequest = issueData();
    const otherRequest = kind === 'rival' ? { operation: 'issue', ...health } : { operation: 'issue', zoneId: 'neonforest', ...health };
    const actions = [
      () => call(uid, arenaRequest, T0),
      () => kind === 'rival' ? rival(uid, otherRequest, T0) : zone(uid, otherRequest, T0),
    ];
    const results = await Promise.allSettled(actions.map(action => action()));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1, `${kind}, health=${flagged}`);
    const loser = results.findIndex(r => r.status === 'rejected');
    const error = results[loser].reason;
    if (error.code === 3 && error.message === '3 INVALID_ARGUMENT: Transaction is invalid or closed.') {
      // The emulator occasionally expires a contending transaction rather than
      // allowing the SDK retry. One SAME-INTENT client retry is explicit evidence,
      // never a blanket retry or accepted domain rejection. The winner is already
      // committed; the losing intent MUST now return activity_conflict and write zero.
      await refused(uid, actions[loser], e => e.code === 'activity_conflict', `one bounded ${kind}/Arena transport retry`);
      emulatorTransportRetries++;
      console.log(`R4 emulator transport retry ${emulatorTransportRetries}: ${kind}, health=${flagged}, losing=${loser === 0 ? 'Arena' : kind}; same uid/body/time; activity_conflict and zero writes verified`);
    } else {
      assert.equal(error.code, 'activity_conflict');
    }
    if (results[0].status === 'fulfilled') {
      assert.equal((await user(uid)).holosTokens, 950);
      assert.equal(Object.keys(await tree(`rivalBattles/${uid}/battles`)).length, 0);
      assert.equal(await doc(`holoZoneRuns/${uid}`), undefined);
    } else {
      assert.equal((await user(uid)).holosTokens, 1000);
      assert.equal(await doc(`arenaMatches/${uid}`), undefined);
      assert.equal(Object.keys(await tree(`arenaMatches/${uid}/matches`)).length, 0);
    }
  }
});

test('Arena issue versus repair is serializable: repaired snapshot or untouched stock on refusal', async () => {
  for (let repeat = 0; repeat < 4; repeat++) {
    const uid = await setup();
    const [arenaResult, repairResult] = await Promise.allSettled([call(uid, issueData()), patch(uid, 'race_repair_1')]);
    assert.equal(arenaResult.status, 'fulfilled');
    const snapshot = arenaResult.value.match.entrant.currentHealth;
    const profile = await user(uid);
    assert.equal(snapshot, profile.holobotVitals.ace.currentHealth);
    if (repairResult.status === 'fulfilled') {
      assert.ok(snapshot > 60); assert.equal(profile.emergencyPatches, 2);
      assert.equal(Object.keys(await tree(`itemInventories/${uid}/receipts`)).length, 1);
    } else {
      assert.match(repairResult.reason.message, /arena_no_heal/);
      assert.equal(snapshot, 60); assert.equal(profile.emergencyPatches, 3);
      assert.equal(Object.keys(await tree(`itemInventories/${uid}/receipts`)).length, 0);
    }
  }
});

test('cancel versus start cannot both refund and begin a playable match', async () => {
  for (let repeat = 0; repeat < 3; repeat++) {
    const uid = await setup(); const issued = await issue(uid);
    const results = await Promise.allSettled([
      start(uid, issued.matchId),
      call(uid, { operation: 'cancel', matchId: issued.matchId }, T0 + 1),
    ]);
    let record = await match(uid, issued.matchId), profile = await user(uid);
    if (record.state === 'cancelled') {
      assert.equal(profile.holosTokens, 1000);
      assert.equal(profile.holobotVitals.ace.currentHealth, 60);
      assert.equal(results[1].status, 'fulfilled');
      if (results[0].status === 'fulfilled') assert.equal(results[0].value.match.state, 'cancelled', 'start replay must not revive a refunded match');
    } else {
      assert.equal(record.state, 'active'); assert.equal(profile.holosTokens, 950);
      assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
      assert.match(results[1].reason.message, /invalid_request/);
      await call(uid, { operation: 'cancel', matchId: issued.matchId, playerFinalHealth: 20 }, T0 + 2);
      record = await match(uid, issued.matchId); profile = await user(uid);
      assert.equal(profile.holosTokens, 950); assert.equal(profile.holobotVitals.ace.currentHealth, 20);
    }
    assert.equal(record.state, 'cancelled'); assert.equal((await doc(`arenaMatches/${uid}`)).open, false);
    assert.equal(profile.wins, 0); assert.equal(profile.losses, 0);
  }
});

test('settle versus cancel commits one terminal ruling, payout and HP result', async () => {
  for (let repeat = 0; repeat < 3; repeat++) {
    const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
    const results = await Promise.allSettled([
      settle(uid, issued.matchId),
      call(uid, { operation: 'cancel', matchId: issued.matchId, playerFinalHealth: 20 }, T0 + 2000),
    ]);
    assert.ok(results.some(r => r.status === 'fulfilled'));
    const record = await match(uid, issued.matchId), profile = await user(uid);
    assert.equal((await doc(`arenaMatches/${uid}`)).open, false);
    if (record.state === 'settled') {
      assert.equal(profile.holosTokens, 1050); assert.equal(profile.wins, 1);
      assert.equal(profile.holobotVitals.ace.currentHealth, 30);
    } else {
      assert.equal(record.state, 'cancelled'); assert.equal(profile.holosTokens, 950); assert.equal(profile.wins, 0);
      assert.equal(profile.holobotVitals.ace.currentHealth, 20);
    }
    assert.equal(profile.losses, 0);
  }
});

test('late first Rival/Zone settlement cannot mutate health or rewards during an Arena lease', async () => {
  for (const kind of ['rival', 'zone']) for (const flagged of [false, true]) {
    const uid = await setup(); const health = flagged ? { healthSchema: HEALTH } : {};
    const old = kind === 'rival' ? await rival(uid, { operation: 'issue', ...health }) : await zone(uid, { operation: 'issue', zoneId: 'neonforest', ...health });
    const oldPath = kind === 'rival' ? `rivalBattles/${uid}` : `holoZoneRuns/${uid}`;
    const oldLedger = await doc(oldPath);
    // Test-only database fixture models an already-issued legacy record arriving after
    // an activity migration. It is never a production mutation or candidate bypass.
    await db.doc(oldPath).delete();
    await issue(uid, 'delayed_old_settle');
    await db.doc(oldPath).set(oldLedger);
    if (kind === 'rival') {
      await refused(uid, () => rival(uid, { operation: 'settle', battleId: old.battleId, didWin: false, fielded: ['ace'], ...health, ...(flagged ? { health: [{ holobotId: 'ace', currentHealth: 10 }] } : {}) }, T0 + 30000), /activity_conflict/);
    } else {
      await refused(uid, () => zone(uid, { operation: 'settle', runId: old.runId, kills: 1, bossDefeated: false, fielded: ['ace'], ...health, ...(flagged ? { health: [{ holobotId: 'ace', currentHealth: 10 }] } : {}) }, T0 + 30000), /activity_conflict/);
    }
  }
});

test('previously settled Rival/Zone and consumed-item receipt replays stay read-only during Arena', async () => {
  for (const kind of ['rival', 'zone', 'item']) {
    const uid = await setup(); let replay;
    if (kind === 'rival') {
      const r = await rival(uid, { operation: 'issue', healthSchema: HEALTH });
      const request = { operation: 'settle', battleId: r.battleId, didWin: false, fielded: ['ace'], healthSchema: HEALTH, health: [{ holobotId: 'ace', currentHealth: 50 }] };
      await rival(uid, request, T0 + 30000); replay = () => rival(uid, request, T0 + 31000);
    } else if (kind === 'zone') {
      const r = await zone(uid, { operation: 'issue', zoneId: 'neonforest', healthSchema: HEALTH });
      const request = { operation: 'settle', runId: r.runId, kills: 1, bossDefeated: false, fielded: ['ace'], healthSchema: HEALTH, health: [{ holobotId: 'ace', currentHealth: 50 }] };
      await zone(uid, request, T0 + 30000); replay = () => zone(uid, request, T0 + 31000);
    } else {
      await patch(uid, 'old_item_receipt', T0); replay = () => patch(uid, 'old_item_receipt', T0 + 31000);
    }
    await issue(uid, 'after_old_receipt', {}, T0 + 30500);
    const before = await state(uid);
    const reply = await replay(); assert.equal(reply.alreadyProcessed, true);
    assert.deepEqual(await state(uid), before);
  }
});

test('malformed Arena lease fails closed across Arena, Rival, Zone and repair', async () => {
  const malformed = [
    { schemaVersion: 'arena-healing-1', open: 'true' },
    { schemaVersion: 'invented', open: true, matchId: 'am_00000000000000000000000000000000' },
    { schemaVersion: 'arena-healing-1', open: true },
    { schemaVersion: 'arena-healing-1', open: true, matchId: 42 },
  ];
  for (const lease of malformed) {
    const uid = await setup(); await db.doc(`arenaMatches/${uid}`).set(lease);
    await refused(uid, () => call(uid, issueData()), /unavailable/);
    await refused(uid, () => rival(uid, { operation: 'issue' }), /unavailable/);
    await refused(uid, () => zone(uid, { operation: 'issue', zoneId: 'neonforest' }), /unavailable/);
    await refused(uid, () => patch(uid, 'bad_lease_patch'), /unavailable/);
  }
});

test('operation arrays, objects, null and missing schema cannot coerce into a lifecycle operation', async () => {
  const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
  for (const operation of [['cancel'], ['issue'], ['settle'], ['start'], ['resume'], {}, { toString: 'cancel' }, null, 42]) {
    await refused(uid, () => call(uid, { operation, matchId: issued.matchId, playerFinalHealth: 10 }), /invalid_request/);
  }
  await refused(uid, () => transactArenaMatch(db, uid, { operation: 'resume', matchId: issued.matchId }, T0), /invalid_request/);
  await refused(uid, () => call(uid, { schemaVersion: 'arena-match-99', operation: 'resume', matchId: issued.matchId }), /invalid_request/);
});

test('Arena callable authenticates every lifecycle entrypoint and closes both old anonymous bypasses', async () => {
  const { arenaMatchHost } = require('../lib/arena/arenaMatchHost.js');
  for (const operation of ['issue', 'start', 'resume', 'settle', 'cancel']) {
    await assert.rejects(() => arenaMatchHost.run({ data: { schemaVersion: 'arena-match-1', operation } }), e => e.code === 'unauthenticated');
  }
  await assert.rejects(() => chargeArenaEntry.run({ data: { tierId: 'rookie', paymentMethod: 'tokens' } }), e => e.code === 'unauthenticated');
  await assert.rejects(() => settleArenaBattle.run({ data: oldRequest('anonymous') }), e => e.code === 'unauthenticated');
  const uid = await setup();
  await refused(uid, () => arenaMatchHost.run({ auth: { uid }, data: { schemaVersion: 'arena-match-1', operation: 'issue', ...oldRequest('old_client') } }), e => e.code === 'invalid-argument' && e.details?.rejectionCode === 'invalid_request');
});

test('admission numeric quote remains binding after a later tier fee/reward table change', async () => {
  const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
  const economy = require('../lib/lib/arenaEconomy.js');
  const tier = economy.ARENA_TIERS.find(t => t.id === 'rookie');
  const originalFee = tier.entryFeeHolos, originalRewards = economy.getArenaBaseRewards;
  try {
    // Test-only in-process release-table mutation. Persisted rules must carry the
    // admission quote; no deployed source or Firestore receipt is modified here.
    tier.entryFeeHolos = 50000;
    economy.getArenaBaseRewards = () => ({ exp: 9999999, holos: 9999999, syncPoints: 9999999 });
    const reply = await settle(uid, issued.matchId);
    assert.equal(reply.match.entryReceipt.amount, 50);
    assert.equal(reply.match.settlementReceipt.settlement.holos, issued.record.rules.holos);
    assert.equal(reply.match.settlementReceipt.settlement.exp, issued.record.rules.exp);
    assert.equal(reply.match.settlementReceipt.settlement.syncPoints, issued.record.rules.syncPoints);
    assert.equal((await user(uid)).holosTokens, 1050);
  } finally {
    tier.entryFeeHolos = originalFee; economy.getArenaBaseRewards = originalRewards;
  }
});

test('minimum elapsed and performance upper bounds accept their exact legal boundary', async () => {
  const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
  await refused(uid, () => settle(uid, issued.matchId, {}, T0 + 1000), /too_fast/);
  const reply = await settle(uid, issued.matchId, { combosCompleted: 25, perfectDefenses: 25 }, T0 + 1001);
  assert.equal(reply.match.settlementReceipt.report.combosCompleted, 25);
  assert.equal(reply.match.settlementReceipt.report.perfectDefenses, 25);
  assert.equal(reply.match.state, 'settled');
});

test('corrupted persisted quote, charge binding, entrant, opponent or timestamps fail closed before writes', async () => {
  const corruptions = [
    ['string payout', m => { m.rules.holos = '100'; }],
    ['negative payout', m => { m.rules.holos = -1; }],
    ['string XP', m => { m.rules.exp = '20'; }],
    ['nonfinite XP', m => { m.rules.exp = NaN; }],
    ['negative sync', m => { m.rules.syncPoints = -1; }],
    ['string blueprint amount', m => { m.rules.blueprints = '5'; }],
    ['invalid loss fraction', m => { m.rules.lossExpFraction = 1.5; }],
    ['negative combo fraction', m => { m.rules.comboBonus = -0.1; }],
    ['entry foreign match', m => { m.entryReceipt.matchId = 'am_00000000000000000000000000000000'; }],
    ['entry zero charge', m => { m.entryReceipt.amount = 0; }],
    ['entry fractional charge', m => { m.entryReceipt.amount = 50.5; }],
    ['entry changed token quote', m => { m.entryReceipt.amount = 51; m.entryReceipt.balanceAfter = 949; }],
    ['entry balance delta mismatch', m => { m.entryReceipt.balanceAfter = 949; }],
    ['entry negative balance', m => { m.entryReceipt.balanceBefore = -1; }],
    ['missing opponent name', m => { delete m.opponent.name; }],
    ['foreign opponent identity', m => { m.opponent.holobotId = 'wolf'; }],
    ['foreign entrant name', m => { m.entrant.name = 'KUMA'; }],
    ['entrant HP exceeds max', m => { m.entrant.currentHealth = m.entrant.maxHealth + 1; }],
    ['nonfinite entrant HP', m => { m.entrant.currentHealth = NaN; }],
    ['missing active start', m => { m.startedAtMs = null; }],
    ['start before admission', m => { m.startedAtMs = m.issuedAtMs - 1; }],
    ['terminal without receipt', m => { m.state = 'settled'; m.settlementReceipt = null; }],
  ];
  for (const [label, corrupt] of corruptions) {
    const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
    const record = await match(uid, issued.matchId); corrupt(record);
    await db.doc(`arenaMatches/${uid}/matches/${issued.matchId}`).set(record);
    await refused(uid, () => settle(uid, issued.matchId), /unavailable/, label);
    await refused(uid, () => call(uid, { operation: 'resume', matchId: issued.matchId }), /unavailable/, label);
  }
  const uid = await setup(); const issued = await issue(uid, 'corrupt_pass_cost', { paymentMethod: 'pass' });
  const record = await match(uid, issued.matchId); record.entryReceipt.amount = 2; record.entryReceipt.balanceAfter = 1;
  await db.doc(`arenaMatches/${uid}/matches/${issued.matchId}`).set(record);
  await refused(uid, () => call(uid, { operation: 'cancel', matchId: issued.matchId }), /unavailable/);
});

test('malformed current entrant progression fails before the XP loop or any settlement write', async () => {
  // Only run against the candidate pre-progression guard. Infinite inputs are NEVER
  // executed through the pinned legacy progression loop.
  const corruptions = [
    { experience: Infinity }, { experience: '1e309' }, { experience: -1 }, { experience: 1e300 },
    { experience: 2500 }, { level: Infinity }, { level: '4' }, { level: -1 },
    { nextLevelExp: Infinity }, { nextLevelExp: '2500' }, { nextLevelExp: 1 },
    { attributePoints: Infinity }, { boostedAttributes: { attack: -1 } },
  ];
  for (const fields of corruptions) {
    const uid = await setup(); const issued = await issue(uid); await start(uid, issued.matchId);
    const profile = await user(uid);
    await db.doc(`users/${uid}`).update({ holobots: [{ ...profile.holobots[0], ...fields }, profile.holobots[1]] });
    await refused(uid, () => settle(uid, issued.matchId), /unavailable|invalid_request/);
  }
  const uid = await setup({ holobots: [{ name: 'UNRECOGNIZED_SPECIES', level: 1, experience: 0, nextLevelExp: 400, attributePoints: 0 }], holobotVitals: {} });
  await refused(uid, () => call(uid, issueData('unknown_owned_species', { holobotId: 'unrecognized_species' })), /invalid_request|unavailable/);
});

test('altered valid-shaped terminal report replays the original ruling without touching a newer lease', async () => {
  const uid = await setup(); const a = await issue(uid, 'terminal_report_a'); await start(uid, a.matchId);
  const original = await settle(uid, a.matchId);
  const b = await issue(uid, 'terminal_report_b', {}, T0 + 3000);
  const before = await state(uid);
  const changed = await settle(uid, a.matchId, { playerFinalHealth: 0, opponentFinalHealth: 1, combosCompleted: 25, perfectDefenses: 25 }, T0 + 4000);
  assert.equal(changed.alreadyProcessed, true);
  assert.equal(changed.match.settlementReceipt.outcome, 'win');
  assert.deepEqual(changed.match.settlementReceipt, original.match.settlementReceipt);
  assert.deepEqual(await state(uid), before);
  assert.equal((await doc(`arenaMatches/${uid}`)).matchId, b.matchId);
  const paidRetry = await call(uid, issueData('terminal_report_a'), T0 + 5000);
  assert.equal(paidRetry.matchId, a.matchId); assert.equal(paidRetry.match.state, 'settled');
  assert.deepEqual(await state(uid), before, 'lost old issue reply cannot spend again after a later match');
});

test('fresh-client resume without IDs discovers absent, open, expired and latest terminal match read-only', async () => {
  const uid = await setup();
  async function discover(now, expectedId, expectedState) {
    const before = await state(uid);
    const reply = await call(uid, { operation: 'resume' }, now);
    assert.equal(reply.schemaVersion, 'arena-match-1'); assert.equal(reply.alreadyProcessed, true);
    assert.equal(reply.matchId, expectedId);
    if (expectedId === null) assert.equal(reply.match, null);
    else assert.equal(reply.match.state, expectedState);
    assert.deepEqual(await state(uid), before, 'account-based discovery is read-only');
    return reply;
  }
  await discover(T0, null, null);
  const a = await issue(uid, 'discovery_match_a');
  await discover(T0 + 1, a.matchId, 'issued');
  await start(uid, a.matchId, T0 + 2);
  await discover(T0 + 3, a.matchId, 'active');
  const expired = a.record.expiresAtMs + 1;
  await discover(expired, a.matchId, 'active');
  const cancelled = await call(uid, { operation: 'cancel', matchId: a.matchId, playerFinalHealth: 25 }, expired);
  const terminal = await discover(expired + 1, a.matchId, 'expired');
  assert.deepEqual(terminal.match.settlementReceipt, cancelled.match.settlementReceipt);
  const b = await issue(uid, 'discovery_match_b', {}, expired + 2);
  await discover(expired + 3, b.matchId, 'issued');
  await start(uid, b.matchId, expired + 4);
  const settled = await settle(uid, b.matchId, { playerFinalHealth: 20 }, expired + 2000);
  const latest = await discover(expired + 2001, b.matchId, 'settled');
  assert.deepEqual(latest.match.settlementReceipt, settled.match.settlementReceipt);

  for (const lease of [
    { schemaVersion: 'invented', open: true, matchId: 'am_00000000000000000000000000000000' },
    { schemaVersion: 'arena-healing-1', open: true },
    { schemaVersion: 'arena-healing-1', open: true, matchId: 42 },
    { schemaVersion: 'arena-healing-1', open: false, matchId: 'legacy_match' },
    { schemaVersion: 'arena-healing-1', recordSchemaVersion: 'arena-match-1', open: false, matchId: 'am_00000000000000000000000000000000' },
  ]) {
    const malformed = await setup(); await db.doc(`arenaMatches/${malformed}`).set(lease);
    await refused(malformed, () => call(malformed, { operation: 'resume' }), /unavailable/);
  }
  for (const terminalChild of [false, true]) {
    const inconsistent = await setup(); const issued = await issue(inconsistent, 'inconsistent_parent');
    if (terminalChild) await call(inconsistent, { operation: 'cancel', matchId: issued.matchId }, T0 + 1);
    const parent = await doc(`arenaMatches/${inconsistent}`);
    await db.doc(`arenaMatches/${inconsistent}`).set({ ...parent, open: !parent.open });
    await refused(inconsistent, () => call(inconsistent, { operation: 'resume' }), /unavailable/, 'parent/child lifecycle mismatch');
  }

});

// PR #78 merge (rule 2): #72's rank-tier Repair Kit now rides the durable settle, not the closed legacy callable.
const { calculateExperience } = require('../lib/lib/progression.js');
async function settledKits(level) {
  const exp = calculateExperience(level + 1);
  const uid = await setup({ holobots: [{ name: 'ACE', level, experience: exp - 1, nextLevelExp: exp, rank: 'Starter', attributePoints: 0 }], itemStocks: { repair_kit: 1 } });
  const { matchId } = await issue(uid, `rank_kit_${level}`);
  await call(uid, { operation: 'start', matchId }, T0 + 1);
  await call(uid, { operation: 'settle', matchId, playerFinalHealth: 10, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0 }, T0 + 5000);
  const after = await user(uid);
  return { level: after.holobots[0].level, kits: after.itemStocks.repair_kit };
}
test('durable settle crossing a rank tier (10 -> 11) grants exactly one Repair Kit', async () => {
  const r = await settledKits(10);
  assert.ok(r.level >= 11 && r.level < 21);
  assert.equal(r.kits, 2);
});
test('KNOWN-BAD control: durable settle levelling inside one tier (12 -> 13+) grants no Kit', async () => {
  const r = await settledKits(12);
  assert.ok(r.level > 12 && r.level < 21);
  assert.equal(r.kits, 1);
});
// PR #78 merge (rule 1): the shared lease refuses rival / zone issue while a duel-healing run is open.
test('open duel-healing run refuses rival and zone issue with no write', async () => {
  const uid = await setup();
  await db.doc(`duelHealingRuns/${uid}`).set({ schemaVersion: 'duel-healing-1', runId: 'duel', open: true });
  await refused(uid, () => rival(uid, { operation: 'issue' }, T0 + 1), /too_many_open/);
  await refused(uid, () => zone(uid, { operation: 'issue', zoneId: 'neonforest' }, T0 + 1), /unavailable/);
  await refused(uid, () => call(uid, issueData('duel_blocks_arena'), T0 + 1), /activity_conflict/);
});
