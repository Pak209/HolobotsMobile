// mission-board-1 store tests against an in-memory Firestore double (no emulator): intro-first ordering, intro claim
// forwarding, board creation / persistence, fact reads from the existing records, and transaction read-before-write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../lib/missionBoard/missionBoardStore.js');
const M = require('../lib/lib/missionBoard.js');
const Q = require('../lib/lib/introQuests.js');

import { fakeDb as makeFakeDb } from './lib/fake-firestore.mjs';
const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const fakeDb = (clock = { now: T0 }) => makeFakeDb(clock);
const SEED = 'abcdef0123456789abcdef0123456789';
const UID = 'pilot_store';

const baseUser = (extra = {}) => ({ holosTokens: 0, gachaTickets: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, holobots: [{ name: 'ACE', level: 1, experience: 0, nextLevelExp: 100 }], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] }, ...extra });
/** An intro chain stored as complete (every step claimed). */
const completeIntro = () => ({
  schemaVersion: Q.INTRO_QUEST_SCHEMA, currentIndex: Q.INTRO_QUEST_STEPS.length, stepStartedAtMs: T0 - 1, rivalWinsAtStepStart: 0,
  claims: Object.fromEntries(Q.INTRO_QUEST_STEPS.map((s, i) => [s.stepId, { requestId: `intro_${i}`, claimedAtMs: T0 - 100, reward: { ...s.reward } }])),
});
const ALL_SPOTS = ['hare_harbor', 'tora_plaza', 'era_market', 'ken_gardens', 'kuma_transit', 'kurai_missionboard', 'shadow_plazaedge', 'tsuin_arenagate', 'wolf_workshop', 'wake_quay', 'gama_courtside'];
const call = (db, data, now = db.clock.now) => S.transactMissionBoard(db, UID, data, now, SEED);
const status = (db, now) => call(db, { operation: 'status' }, now);
const rejects = (p, code) => assert.rejects(p, e => e instanceof M.MissionBoardError && e.code === code, code);

test('intro alongside: while the intro chain is incomplete, status returns the intro steps AND the 3 postings; postings are claimable', async () => {
  const db = fakeDb();
  db.put(`users/${UID}`, baseUser());
  const st = await status(db);
  assert.equal(st.schemaVersion, 'mission-board-1');
  assert.equal(st.introPending, true);
  assert.equal(st.intro.currentStepId, 'visit_mission_board');
  assert.deepEqual(st.intro.steps.map(s => s.stepId), Q.INTRO_QUEST_STEPS.map(s => s.stepId));
  assert.equal(st.postings.length, 3, 'postings from day one');
  assert.ok(db.read(`missionBoards/${UID}`), 'the board is issued with the intro chain still open');
  assert.equal(db.read(`introQuests/${UID}`), undefined, 'status never writes intro state');
  // A posting claim during the intro is ruled on its own (no intro_pending): a visit posting pays.
  const board = db.read(`missionBoards/${UID}`);
  const visit = M.generatePosting(UID, SEED, 90, ['beast', 'rival', 'capture'], { citizens: [], captureTargets: ALL_SPOTS }, T0);
  assert.equal(visit.kind, 'visit');
  board.slots[0] = { posting: { ...visit, serial: 0 }, refillAtMs: null };
  db.put(`missionBoards/${UID}`, board);
  const r = await call(db, { operation: 'claim', postingId: visit.postingId, requestId: 'p1', destinationId: visit.target });
  assert.equal(r.source, 'posting'); assert.equal(r.granted.holos, visit.reward.holos);
  assert.equal(db.read(`users/${UID}`).holosTokens, visit.reward.holos);
  // The intro chain is unaffected and still first in the status.
  const after = await status(db, T0 + 10);
  assert.equal(after.intro.currentStepId, 'visit_mission_board'); assert.equal(after.postings[0].state, 'claimed');
});

test('intro step claims are forwarded to the ONE intro quest store (its rules, rewards and doc)', async () => {
  const db = fakeDb();
  db.put(`users/${UID}`, baseUser());
  await rejects(call(db, { operation: 'claim', postingId: 'visit_marketplace', requestId: 'i0', destinationId: 'marketplace' }), 'out_of_order');
  await rejects(call(db, { operation: 'claim', postingId: 'visit_mission_board', requestId: 'i1', destinationId: 'workshop' }), 'invalid_request');
  const r = await call(db, { operation: 'claim', postingId: 'visit_mission_board', requestId: 'i1', destinationId: 'mission_board' });
  assert.equal(r.source, 'intro'); assert.equal(r.alreadyProcessed, false); assert.equal(r.intro.reward.holos, 50);
  assert.equal(db.read(`users/${UID}`).holosTokens, 50);
  assert.equal(db.read(`introQuests/${UID}`).currentIndex, 1);
  const again = await call(db, { operation: 'claim', postingId: 'visit_mission_board', requestId: 'i1', destinationId: 'mission_board' });
  assert.equal(again.alreadyProcessed, true); assert.equal(db.read(`users/${UID}`).holosTokens, 50);
  await rejects(call(db, { operation: 'claim', postingId: 'visit_mission_board', requestId: 'i2', destinationId: 'mission_board' }), 'already_claimed');
  // capture_buddy unmet maps to the board's not_complete.
  await call(db, { operation: 'claim', postingId: 'visit_marketplace', requestId: 'i3', destinationId: 'marketplace' });
  await call(db, { operation: 'claim', postingId: 'visit_workshop', requestId: 'i4', destinationId: 'workshop' });
  await rejects(call(db, { operation: 'claim', postingId: 'capture_buddy', requestId: 'i5' }), 'not_complete');
});

test('Arena intro step through the board: forwarded, unmet maps to not_complete; a pre-Arena doc at old index 5 lands on it; a finished 7-step doc is complete', async () => {
  const oldDoc = n => ({ schemaVersion: Q.INTRO_QUEST_SCHEMA, currentIndex: n, stepStartedAtMs: T0, rivalWinsAtStepStart: 0,
    claims: Object.fromEntries(Q.INTRO_QUEST_STEPS.filter(s => s.stepId !== 'win_arena_battle').slice(0, n).map((s, i) => [s.stepId, { requestId: `intro_${i}`, claimedAtMs: T0 - 100, reward: { ...s.reward } }])) });
  const db = fakeDb();
  db.put(`users/${UID}`, baseUser());
  db.put(`introQuests/${UID}`, oldDoc(5));
  const st = await status(db);
  assert.equal(st.introPending, true); assert.equal(st.intro.currentStepId, 'win_arena_battle');
  assert.equal(st.intro.steps.find(s => s.stepId === 'win_arena_battle').kind, 'arena');
  await rejects(call(db, { operation: 'claim', postingId: 'win_arena_battle', requestId: 'ia1' }), 'not_complete');
  await rejects(call(db, { operation: 'claim', postingId: 'visit_portal', requestId: 'ia2', destinationId: 'portal_terminal' }), 'out_of_order');
  const done = fakeDb();
  done.put(`users/${UID}`, baseUser());
  done.put(`introQuests/${UID}`, oldDoc(7));
  const finished = await status(done);
  assert.equal(finished.introPending, false); assert.equal(finished.intro, null);
  assert.deepEqual(done.read(`introQuests/${UID}`), oldDoc(7), 'status leaves the old doc as stored');
});

test('after the intro chain: the first status issues three postings and persists them; later statuses keep them', async () => {
  const db = fakeDb();
  db.put(`users/${UID}`, baseUser());
  db.put(`introQuests/${UID}`, completeIntro());
  const st = await status(db);
  assert.equal(st.introPending, false); assert.equal(st.intro, null); assert.equal(st.rivalTier, 0);
  assert.equal(st.postings.length, 3);
  assert.ok(st.postings.every(p => p.state === 'open' && p.issuedAtMs === T0 && p.refillAtMs === null));
  assert.equal(st.hostFlags.new_posting, true);
  const stored = db.read(`missionBoards/${UID}`);
  assert.deepEqual(stored.slots.map(s => s.posting.postingId), st.postings.map(p => p.postingId));
  assert.equal(stored.seed, SEED); assert.equal(stored.seenThroughMs, T0);
  // Without a session: the 11 repeatable spots plus the Research Garden KURAI.
  const expected = M.freshBoard(UID, SEED, { citizens: [], captureTargets: ALL_SPOTS }, T0);
  assert.deepEqual(st.postings.map(p => p.postingId), expected.slots.map(s => s.posting.postingId));
  const again = await status(db, T0 + 1000);
  assert.deepEqual(again.postings.map(p => p.postingId), st.postings.map(p => p.postingId));
  assert.equal(again.hostFlags.new_posting, false, 'already seen');
  assert.deepEqual(st.balances, { holosTokens: 0, blueprintFragments: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 } });
});

test('candidates: citizens only after the Arena gathering; the 11 spots always; the garden KURAI never issued; none for a disabled session', () => {
  const p0 = baseUser();
  assert.deepEqual(S.boardCandidates(UID, p0, undefined, false), { citizens: [], captureTargets: ALL_SPOTS });
  assert.equal(S.boardCandidates(UID, baseUser({ storyFlags: { arenaGatheringSeen: true } }), undefined, false).citizens.length, 8);
  const session = (ended) => ({ enabled: true, encounters: [{ encounterId: 'city_kurai_garden', holobotId: 'kurai', ended, captureOpen: true }] });
  assert.deepEqual(S.boardCandidates(UID, p0, session(false), true).captureTargets, ALL_SPOTS, 'the Research Garden KURAI is no longer issued');
  assert.deepEqual(S.boardCandidates(UID, p0, session(true), true).captureTargets, ALL_SPOTS);
  assert.ok(ALL_SPOTS.includes('kurai_missionboard'), 'KURAI stays a repeatable wild spot');
  assert.deepEqual(S.boardCandidates(UID, p0, { ...session(false), enabled: false }, true).captureTargets, []);
  assert.throws(() => S.boardCandidates(UID, baseUser({ storyFlags: 'bad' }), undefined, false), /unavailable/);
  // Capture receipts are read for the spot's current cycle and the two before it.
  const spotSession = { enabled: true, encounters: [{ encounterId: 'city_spot_wolf_workshop_4', holobotId: 'wolf', ended: false }] };
  assert.deepEqual(S.captureEncounterIds(spotSession, 'wolf_workshop'), ['city_spot_wolf_workshop_4', 'city_spot_wolf_workshop_3', 'city_spot_wolf_workshop_2']);
  assert.deepEqual(S.captureEncounterIds(spotSession, 'tora_plaza'), []);
  assert.deepEqual(S.captureEncounterIds(spotSession, 'kurai_garden'), ['city_kurai_garden']);
});

/** A completed-intro pilot whose board's slot 0 is replaced by a posting of `kind`/`target` issued at T0. */
async function boardWithPosting(db, kind, target, extraPosting = {}) {
  db.put(`users/${UID}`, baseUser({ holosTokens: 5 }));
  db.put(`introQuests/${UID}`, completeIntro());
  await status(db, T0);
  const board = db.read(`missionBoards/${UID}`);
  let serial = 50, p;
  do p = M.generatePosting(UID, SEED, serial++, [], { citizens: [], captureTargets: ALL_SPOTS }, T0); while (p.kind !== kind);
  p = { ...p, serial: 1, target, issuedAtMs: T0, ...extraPosting };
  board.slots[0] = { posting: p, refillAtMs: null };
  db.put(`missionBoards/${UID}`, board);
  return p.postingId;
}

test('beast claim reads holoZoneRuns/{uid}: an earlier win is refused, a later win pays once and schedules the refill', async () => {
  const db = fakeDb();
  const id = await boardWithPosting(db, 'beast', 'guild_court', { reward: { holos: 100 } });
  const run = (runId, settledAtMs, didWin = true) => ({ runId, zoneId: 'guild_court', tier: 0, squad: ['ace'], issuedAtMs: settledAtMs - 30_000, expiresAtMs: settledAtMs + 1e7, closedAtMs: null, progression: [],
    settlement: { kind: 'beast', zoneId: 'guild_court', tier: 0, kills: 2, bossDefeated: false, fielded: ['ace'], didWin, combosCompleted: 2, perfectDefenses: 0, tableExp: 114, expPerHolobot: 114, expWithheld: false, settledAtMs } });
  db.put(`holoZoneRuns/${UID}`, { schemaVersion: 'holozone-runs-1', runs: [run('11111111-1111-4111-8111-111111111111', T0 - 1000), run('22222222-2222-4222-8222-222222222222', T0 + 500, false)] });
  await rejects(call(db, { operation: 'claim', postingId: id, requestId: 'b1' }, T0 + 1000), 'not_complete');
  db.put(`holoZoneRuns/${UID}`, { schemaVersion: 'holozone-runs-1', runs: [run('11111111-1111-4111-8111-111111111111', T0 - 1000), run('33333333-3333-4333-8333-333333333333', T0 + 900)] });
  assert.equal((await status(db, T0 + 950)).postings[0].state, 'complete');
  const r = await call(db, { operation: 'claim', postingId: id, requestId: 'b1' }, T0 + 1000);
  assert.equal(r.alreadyProcessed, false); assert.equal(r.granted.holos, 100); assert.equal(r.granted.expPerHolobot, 95);
  const user = db.read(`users/${UID}`);
  assert.equal(user.holosTokens, 105); assert.equal(user.holobots[0].experience, 95);
  const slot = db.read(`missionBoards/${UID}`).slots[0];
  assert.equal(slot.posting.claim.requestId, 'b1'); assert.equal(slot.refillAtMs, T0 + 1000 + M.MISSION_BOARD_REFILL_MS);
  const replay = await call(db, { operation: 'claim', postingId: id, requestId: 'b1' }, T0 + 2000);
  assert.equal(replay.alreadyProcessed, true); assert.equal(db.read(`users/${UID}`).holosTokens, 105);
  await rejects(call(db, { operation: 'claim', postingId: id, requestId: 'b2' }, T0 + 2000), 'already_claimed');
  // Refill: still claimed just before the cooldown; a new posting after it.
  assert.equal((await status(db, T0 + 1000 + M.MISSION_BOARD_REFILL_MS - 1)).postings[0].state, 'claimed');
  const after = await status(db, T0 + 1000 + M.MISSION_BOARD_REFILL_MS);
  assert.equal(after.postings[0].state, 'open'); assert.notEqual(after.postings[0].postingId, id);
  assert.equal(after.postings[0].issuedAtMs, T0 + 1000 + M.MISSION_BOARD_REFILL_MS); assert.equal(after.hostFlags.new_posting, true);
});

test('rival claim reads rivalBattles/{uid}/battles: the target pilot\'s settled win after issue', async () => {
  const db = fakeDb();
  const citizen = 'CV1_HB_CITIZEN3_StallLinen_13';
  const id = await boardWithPosting(db, 'rival', citizen);
  const battle = (pilotId, didWin, settledAtMs) => ({ battleId: `rb_${pilotId}_${settledAtMs}`, issuedAtMs: settledAtMs - 60_000, lineup: { opponentPilot: { pilotId, displayName: 'x', tier: 'Rookie' }, opponentSquad: [] }, settlement: { didWin, settledAtMs } });
  db.put(`rivalBattles/${UID}/battles/a`, battle(citizen, true, T0 - 10));
  db.put(`rivalBattles/${UID}/battles/b`, battle('rival_tier_0', true, T0 + 10));
  db.put(`rivalBattles/${UID}/battles/c`, battle(citizen, false, T0 + 20));
  db.put(`rivalBattles/${UID}/battles/d`, { battleId: 'open', issuedAtMs: T0, lineup: { opponentPilot: { pilotId: citizen } }, settlement: null });
  await rejects(call(db, { operation: 'claim', postingId: id, requestId: 'r1' }, T0 + 100), 'not_complete');
  db.put(`rivalBattles/${UID}/battles/e`, battle(citizen, true, T0 + 30));
  const r = await call(db, { operation: 'claim', postingId: id, requestId: 'r1' }, T0 + 100);
  assert.equal(r.kind, 'rival'); assert.equal(db.read(`users/${UID}`).holosTokens, 105);
});

test('a kurai_garden posting already on a board still reads and completes, though no new one is issued', async () => {
  const db = fakeDb();
  const id = await boardWithPosting(db, 'capture', 'kurai_garden', { holobotId: 'kurai' });
  db.put(`wildEncounterSessions/${UID}`, { enabled: true, revision: 3, rosterRevision: 1, encounters: [{ encounterId: 'city_kurai_garden', holobotId: 'kurai', ended: true, captureOpen: false }], entries: [] });
  assert.equal((await status(db, T0 + 20)).postings[0].target, 'kurai_garden');
  await rejects(call(db, { operation: 'claim', postingId: id, requestId: 'k0' }, T0 + 100), 'not_complete');
  db.put(`wildEncounterSessions/${UID}/receipts/garden`, { digest: 'd', reply: { captureResult: { encounterId: 'city_kurai_garden', holobotId: 'kurai', captured: true } } }, T0 + 50);
  assert.equal((await status(db, T0 + 95)).postings[0].state, 'complete');
  assert.equal((await call(db, { operation: 'claim', postingId: id, requestId: 'k1' }, T0 + 100)).kind, 'capture');
});

test('capture claim reads wildEncounterSessions/{uid}/receipts for the target spot\'s cycles: a captured receipt created after issue', async () => {
  const db = fakeDb();
  const id = await boardWithPosting(db, 'capture', 'hare_harbor', { holobotId: 'hare' });
  await rejects(call(db, { operation: 'claim', postingId: id, requestId: 'c0' }, T0 + 100), 'not_complete');
  db.put(`wildEncounterSessions/${UID}`, { enabled: true, revision: 3, rosterRevision: 1, encounters: [{ encounterId: 'city_spot_hare_harbor_2', holobotId: 'hare', ended: false, captureOpen: true }], entries: [] });
  const receipt = (encounterId, captured) => ({ digest: 'd', reply: { captureResult: { encounterId, holobotId: 'hare', captured } } });
  db.put(`wildEncounterSessions/${UID}/receipts/old`, receipt('city_spot_hare_harbor_1', true), T0 - 5);
  db.put(`wildEncounterSessions/${UID}/receipts/miss`, receipt('city_spot_hare_harbor_2', false), T0 + 5);
  db.put(`wildEncounterSessions/${UID}/receipts/other`, receipt('harbor_hare_admin', true), T0 + 6);
  await rejects(call(db, { operation: 'claim', postingId: id, requestId: 'c1' }, T0 + 100), 'not_complete');
  assert.equal((await status(db, T0 + 90)).postings[0].state, 'open');
  // A capture of an EARLIER cycle after the posting went up counts (the spot was re-provisioned since).
  db.put(`wildEncounterSessions/${UID}/receipts/new`, receipt('city_spot_hare_harbor_1', true), T0 + 50);
  assert.equal((await status(db, T0 + 95)).postings[0].state, 'complete');
  const r = await call(db, { operation: 'claim', postingId: id, requestId: 'c1' }, T0 + 100);
  assert.equal(r.kind, 'capture'); assert.equal(r.granted.holos, 50);
  assert.deepEqual(db.read(`users/${UID}`).buddyUnits, { light: 1, medium: 0, heavy: 0 }, 'a Light Unit through the Buddy inventory');
  assert.equal(db.read(`users/${UID}`).holosTokens, 55);
});

test('EXP at the pilot\'s current rival tier (users.rivalWins): 25 wins = tier 2 = 180 EXP; Holos stay 100', async () => {
  const db = fakeDb();
  const id = await boardWithPosting(db, 'rival', 'any');
  const u = db.read(`users/${UID}`); db.put(`users/${UID}`, { ...u, rivalWins: 25 });
  db.put(`rivalBattles/${UID}/battles/w`, { lineup: { opponentPilot: { pilotId: 'zell' } }, settlement: { didWin: true, settledAtMs: T0 + 5 } });
  const st = await status(db, T0 + 10);
  assert.equal(st.rivalTier, 2); assert.equal(st.postings[0].reward.exp, 180);
  const r = await call(db, { operation: 'claim', postingId: id, requestId: 't1' }, T0 + 20);
  assert.deepEqual([r.granted.holos, r.granted.expPerHolobot, r.granted.expTier], [100, 180, 2]);
  assert.equal(db.read(`users/${UID}`).holobots[0].experience, 180);
  db.put(`users/${UID}`, { ...db.read(`users/${UID}`), rivalWins: -1 });
  await rejects(status(db, T0 + 30), 'unavailable');
});

test('visit claim + refusals: unknown posting, missing user, malformed board fail as documented', async () => {
  const db = fakeDb();
  const id = await boardWithPosting(db, 'visit', 'workshop', { reward: { holos: 75 } });
  await rejects(call(db, { operation: 'claim', postingId: id, requestId: 'v1', destinationId: 'marketplace' }), 'not_complete');
  const r = await call(db, { operation: 'claim', postingId: id, requestId: 'v1', destinationId: 'workshop' });
  assert.equal(r.granted.holos, 75); assert.equal(db.read(`users/${UID}`).holosTokens, 80);
  await rejects(call(db, { operation: 'claim', postingId: 'mbp_77_aaaaaaaaaaaa', requestId: 'v2' }), 'unknown_posting');
  await rejects(call(db, { operation: 'nope' }), 'invalid_request');
  db.put(`missionBoards/${UID}`, { schemaVersion: 'mission-board-1', slots: [] });
  await rejects(status(db), 'unavailable');
  await rejects(S.transactMissionBoard(db, 'ghost', { operation: 'status' }, T0, SEED), 'unavailable');
});
