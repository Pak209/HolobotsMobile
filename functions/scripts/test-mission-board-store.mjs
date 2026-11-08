// mission-board-1 store tests against an in-memory Firestore double (no emulator): intro-first ordering, intro claim
// forwarding, board creation / persistence, fact reads from the existing records, and transaction read-before-write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../lib/missionBoard/missionBoardStore.js');
const M = require('../lib/lib/missionBoard.js');
const Q = require('../lib/lib/introQuests.js');

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const SEED = 'abcdef0123456789abcdef0123456789';
const UID = 'pilot_store';

/** Minimal Firestore double: docs by path, direct-child collection queries (==, >, orderBy, limit), buffered transactions. */
function fakeDb(clock = { now: T0 }) {
  const docs = new Map();
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const snap = (path) => {
    const row = docs.get(path);
    return { id: path.split('/').pop(), exists: !!row, data: () => (row ? structuredClone(row.data) : undefined), createTime: row ? { toMillis: () => row.createdAtMs } : undefined };
  };
  const docRef = (path) => ({ kind: 'doc', path, collection: (c) => collRef(`${path}/${c}`) });
  const collRef = (path, filters = [], order = null, lim = Infinity) => ({
    kind: 'query', path,
    doc: (id) => docRef(`${path}/${id}`),
    where: (f, op, v) => collRef(path, [...filters, [f, op, v]], order, lim),
    orderBy: (f) => collRef(path, filters, f, lim),
    limit: (n) => collRef(path, filters, order, n),
    run() {
      let rows = [...docs.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(snap);
      for (const [f, op, v] of filters) rows = rows.filter(s => { const x = get(s.data(), f); return op === '==' ? x === v : op === '>' ? typeof x === 'number' && x > v : false; });
      if (order) rows.sort((a, b) => get(a.data(), order) - get(b.data(), order));
      rows = rows.slice(0, lim);
      return { docs: rows, empty: rows.length === 0, size: rows.length };
    },
  });
  const db = {
    docs, clock,
    doc: docRef, collection: (p) => collRef(p),
    put(path, data, createdAtMs = clock.now) { docs.set(path, { data: structuredClone(data), createdAtMs }); },
    read(path) { return docs.get(path)?.data; },
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        async get(ref) { if (writes.length) throw new Error(`read after write: ${ref.path}`); return ref.kind === 'doc' ? snap(ref.path) : ref.run(); },
        set(ref, data) { writes.push(() => docs.set(ref.path, { data: structuredClone(data), createdAtMs: docs.get(ref.path)?.createdAtMs ?? clock.now })); },
        create(ref, data) { if (docs.has(ref.path)) throw new Error('exists'); writes.push(() => docs.set(ref.path, { data: structuredClone(data), createdAtMs: clock.now })); },
        update(ref, data) { if (!docs.has(ref.path)) throw new Error('missing'); writes.push(() => { const row = docs.get(ref.path); row.data = { ...row.data, ...structuredClone(data) }; }); },
      };
      const out = await fn(tx);
      for (const w of writes) w();
      return out;
    },
  };
  return db;
}
const baseUser = (extra = {}) => ({ holosTokens: 0, gachaTickets: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 }, holobots: [{ name: 'ACE', level: 1, experience: 0, nextLevelExp: 100 }], travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] }, ...extra });
/** An intro chain stored as complete (every step claimed). */
const completeIntro = () => ({
  schemaVersion: Q.INTRO_QUEST_SCHEMA, currentIndex: Q.INTRO_QUEST_STEPS.length, stepStartedAtMs: T0 - 1, rivalWinsAtStepStart: 0,
  claims: Object.fromEntries(Q.INTRO_QUEST_STEPS.map((s, i) => [s.stepId, { requestId: `intro_${i}`, claimedAtMs: T0 - 100, reward: { ...s.reward } }])),
});
const call = (db, data, now = db.clock.now) => S.transactMissionBoard(db, UID, data, now, SEED);
const status = (db, now) => call(db, { operation: 'status' }, now);
const rejects = (p, code) => assert.rejects(p, e => e instanceof M.MissionBoardError && e.code === code, code);

test('intro first: while the intro chain is incomplete, status returns the intro steps and no postings; posting claims are intro_pending', async () => {
  const db = fakeDb();
  db.put(`users/${UID}`, baseUser());
  const st = await status(db);
  assert.equal(st.schemaVersion, 'mission-board-1');
  assert.equal(st.introPending, true);
  assert.deepEqual(st.postings, []);
  assert.equal(st.intro.currentStepId, 'visit_mission_board');
  assert.deepEqual(st.intro.steps.map(s => s.stepId), Q.INTRO_QUEST_STEPS.map(s => s.stepId));
  assert.equal(db.read(`missionBoards/${UID}`), undefined, 'no board is issued before the intro chain ends');
  await rejects(call(db, { operation: 'claim', postingId: 'mbp_0_000000000000', requestId: 'x1' }), 'intro_pending');
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

test('after the intro chain: the first status issues three postings and persists them; later statuses keep them', async () => {
  const db = fakeDb();
  db.put(`users/${UID}`, baseUser());
  db.put(`introQuests/${UID}`, completeIntro());
  const st = await status(db);
  assert.equal(st.introPending, false); assert.equal(st.intro, null);
  assert.equal(st.postings.length, 3);
  assert.ok(st.postings.every(p => p.state === 'open' && p.issuedAtMs === T0 && p.refillAtMs === null));
  assert.equal(st.hostFlags.new_posting, true);
  const stored = db.read(`missionBoards/${UID}`);
  assert.deepEqual(stored.slots.map(s => s.posting.postingId), st.postings.map(p => p.postingId));
  assert.equal(stored.seed, SEED); assert.equal(stored.seenThroughMs, T0);
  // KURAI is a capture candidate until its city encounter exists; without a session that is the only capture target.
  const expected = M.freshBoard(UID, SEED, { citizens: [], captureTargets: ['kurai'] }, T0);
  assert.deepEqual(st.postings.map(p => p.postingId), expected.slots.map(s => s.posting.postingId));
  const again = await status(db, T0 + 1000);
  assert.deepEqual(again.postings.map(p => p.postingId), st.postings.map(p => p.postingId));
  assert.equal(again.hostFlags.new_posting, false, 'already seen');
  assert.deepEqual(st.balances, { holosTokens: 0, blueprintFragments: 0 });
});

test('candidates: citizens only after the Arena gathering; ended / closed encounters and a linked KURAI are not offered', () => {
  const p0 = baseUser();
  assert.deepEqual(S.boardCandidates(UID, p0, undefined, false), { citizens: [], captureTargets: ['kurai'] });
  const seen = S.boardCandidates(UID, baseUser({ storyFlags: { arenaGatheringSeen: true } }), undefined, false);
  assert.equal(seen.citizens.length, 8);
  const session = { enabled: true, encounters: [
    { encounterId: 'city_kurai_garden', holobotId: 'kurai', ended: true, captureOpen: true },
    { encounterId: 'harbor_hare', holobotId: 'hare', ended: false, captureOpen: true },
    { encounterId: 'shut', holobotId: 'wake', ended: false, captureOpen: false },
  ] };
  assert.deepEqual(S.boardCandidates(UID, p0, session, true).captureTargets, ['hare']);
  assert.deepEqual(S.boardCandidates(UID, p0, { ...session, enabled: false }, true).captureTargets, []);
  assert.throws(() => S.boardCandidates(UID, baseUser({ storyFlags: 'bad' }), undefined, false), /unavailable/);
});

/** A completed-intro pilot whose board's slot 0 is replaced by a posting of `kind`/`target` issued at T0. */
async function boardWithPosting(db, kind, target, extraPosting = {}) {
  db.put(`users/${UID}`, baseUser({ holosTokens: 5 }));
  db.put(`introQuests/${UID}`, completeIntro());
  await status(db, T0);
  const board = db.read(`missionBoards/${UID}`);
  let serial = 50, p;
  do p = M.generatePosting(UID, SEED, serial++, [], { citizens: [], captureTargets: ['kurai'] }, T0); while (p.kind !== kind);
  p = { ...p, serial: 1, target, issuedAtMs: T0, ...extraPosting };
  board.slots[0] = { posting: p, refillAtMs: null };
  db.put(`missionBoards/${UID}`, board);
  return p.postingId;
}

test('beast claim reads holoZoneRuns/{uid}: an earlier win is refused, a later win pays once and schedules the refill', async () => {
  const db = fakeDb();
  const id = await boardWithPosting(db, 'beast', 'guild_court', { reward: { holos: 100, exp: 95 } });
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

test('capture claim reads wildEncounterSessions/{uid}/receipts: a captured receipt created after issue', async () => {
  const db = fakeDb();
  const id = await boardWithPosting(db, 'capture', 'kurai');
  db.put(`wildEncounterSessions/${UID}`, { enabled: true, revision: 3, rosterRevision: 1, encounters: [{ encounterId: 'city_kurai_garden', holobotId: 'kurai', ended: false, captureOpen: true }], entries: [] });
  const receipt = (holobotId, captured) => ({ digest: 'd', reply: { captureResult: { holobotId, captured } } });
  db.put(`wildEncounterSessions/${UID}/receipts/old`, receipt('kurai', true), T0 - 5);
  db.put(`wildEncounterSessions/${UID}/receipts/miss`, receipt('kurai', false), T0 + 5);
  db.put(`wildEncounterSessions/${UID}/receipts/hare`, receipt('hare', true), T0 + 6);
  await rejects(call(db, { operation: 'claim', postingId: id, requestId: 'c1' }, T0 + 100), 'not_complete');
  db.put(`wildEncounterSessions/${UID}/receipts/new`, receipt('kurai', true), T0 + 50);
  const r = await call(db, { operation: 'claim', postingId: id, requestId: 'c1' }, T0 + 100);
  assert.equal(r.kind, 'capture'); assert.equal(r.granted.holos, 100);
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
