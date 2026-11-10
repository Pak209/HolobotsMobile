// DECISIONS #46 intro quest domain tests (pure module).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Q = require('../lib/lib/introQuests.js');
const T0 = Date.UTC(2026, 9, 3, 12, 0, 0);
const inv = (light = 0, medium = 0, heavy = 0) => ({ light, medium, heavy });
const claim = (stepId, requestId = `req_${stepId}`, destinationId) => ({ operation: 'claim', stepId, requestId, ...(destinationId === undefined ? {} : { destinationId }) });
const DEST = Object.fromEntries(Q.INTRO_QUEST_STEPS.map(s => [s.stepId, s.destinationId]));
const yes = { captured: () => true, arenaWonSinceStepStart: true }, no = { captured: () => false, arenaWonSinceStepStart: false };
/** Claim `stepId` against (state, profile), applying writes like the store. */
function step(ctx, stepId, opts = {}) {
  const cmd = Q.validateIntroCommand(claim(stepId, opts.requestId, opts.destinationId ?? DEST[stepId]));
  const r = Q.claimIntroStep(ctx.state, ctx.profile, cmd, opts.now ?? T0, opts.verify ?? yes);
  Object.assign(ctx.profile, r.userUpdates); if (r.state) ctx.state = r.state;
  return r;
}
const fresh = (profile = { holosTokens: 0, gachaTickets: 0, buddyUnits: inv(0) }) => ({ profile, state: Q.readIntroQuestState(undefined, T0, 0).state });

test('reward table: 8 steps in order, 50–150 Holos each, totals 750 Holos / 3 Gacha Tickets / 1 Light Unit', () => {
  assert.deepEqual(Q.INTRO_QUEST_STEPS.map(s => s.stepId), ['visit_mission_board', 'visit_marketplace', 'visit_workshop', 'capture_buddy', 'win_rival_battle', 'win_arena_battle', 'visit_portal', 'chain_complete']);
  assert.deepEqual(Q.INTRO_QUEST_STEPS.map(s => [s.reward.holos, s.reward.gachaTickets, s.reward.buddyUnitsLight]), [[50, 0, 0], [50, 1, 0], [75, 0, 0], [100, 0, 1], [100, 1, 0], [150, 0, 0], [75, 0, 0], [150, 1, 0]]);
  for (const s of Q.INTRO_QUEST_STEPS) assert.ok(s.reward.holos >= 50 && s.reward.holos <= 150, s.stepId);
  assert.deepEqual(Q.introQuestTotals(), { holos: 750, gachaTickets: 3, buddyUnitsLight: 1 });
  const arena = Q.INTRO_QUEST_STEPS.find(s => s.stepId === 'win_arena_battle'); assert.equal(arena.kind, 'arena'); assert.equal(arena.destinationId, ''); assert.equal(arena.holobotId, '');
  assert.deepEqual(Q.INTRO_QUEST_STEPS.filter(s => s.kind === 'visit').map(s => s.destinationId), ['mission_board', 'marketplace', 'workshop', 'portal_terminal']);
  assert.equal(Q.INTRO_QUEST_STEPS.find(s => s.kind === 'capture').holobotId, 'hare');
});

test('ordering: only the current step is claimable; later steps are out_of_order, nothing written', () => {
  const ctx = fresh();
  for (const id of ['visit_marketplace', 'capture_buddy', 'win_rival_battle', 'chain_complete']) assert.throws(() => step(ctx, id), /out_of_order/);
  assert.equal(ctx.state.currentIndex, 0); assert.equal(ctx.profile.holosTokens, 0);
  step(ctx, 'visit_mission_board');
  assert.throws(() => step(ctx, 'visit_workshop'), /out_of_order/);
  assert.equal(step(ctx, 'visit_marketplace').reply.status.currentStepId, 'visit_workshop');
});

test('once-only: a claimed step is already_claimed with a new requestId; the same requestId replays without paying', () => {
  const ctx = fresh();
  const first = step(ctx, 'visit_mission_board', { requestId: 'a1' });
  assert.equal(first.reply.alreadyProcessed, false); assert.equal(ctx.profile.holosTokens, 50);
  assert.throws(() => step(ctx, 'visit_mission_board', { requestId: 'a2' }), /already_claimed/);
  const replay = step(ctx, 'visit_mission_board', { requestId: 'a1' });
  assert.equal(replay.reply.alreadyProcessed, true); assert.equal(replay.state, null); assert.deepEqual(replay.userUpdates, {});
  assert.deepEqual(replay.reply.reward, first.reply.reward); assert.equal(ctx.profile.holosTokens, 50);
  // A requestId already used for another step can't claim a new one.
  assert.throws(() => step(ctx, 'visit_marketplace', { requestId: 'a1' }), /invalid_request/);
});

test('visit steps need their destination id; a wrong or missing destination is invalid_request', () => {
  const ctx = fresh();
  assert.throws(() => step(ctx, 'visit_mission_board', { destinationId: 'marketplace' }), /invalid_request/);
  assert.throws(() => step(ctx, 'visit_mission_board', { destinationId: '' }), /invalid_request/);
  assert.equal(step(ctx, 'visit_mission_board').reply.reward.holos, 50);
});

test('verified steps reject unmet claims (not_met, nothing written) and pay once met', () => {
  const ctx = fresh({ holosTokens: 10, gachaTickets: 0, buddyUnits: inv(0), rivalWins: 4 });
  for (const id of ['visit_mission_board', 'visit_marketplace', 'visit_workshop']) step(ctx, id);
  const before = structuredClone(ctx);
  assert.throws(() => step(ctx, 'capture_buddy', { verify: no }), /not_met/);
  assert.deepEqual(ctx, before);
  const cap = step(ctx, 'capture_buddy');
  assert.deepEqual(cap.reply.reward, { holos: 100, gachaTickets: 0, buddyUnitsLight: 1 }); assert.deepEqual(ctx.profile.buddyUnits, inv(1));
  // win_rival_battle: baseline = rivalWins when the step became current (4).
  assert.equal(ctx.state.rivalWinsAtStepStart, 4);
  assert.throws(() => step(ctx, 'win_rival_battle'), /not_met/);
  ctx.profile.rivalWins = 5;
  assert.equal(step(ctx, 'win_rival_battle').reply.reward.gachaTickets, 1);
  // win_arena_battle: needs a verified Arena win; nothing written until then.
  const beforeArena = structuredClone(ctx);
  assert.throws(() => step(ctx, 'win_arena_battle', { verify: no }), /not_met/);
  assert.deepEqual(ctx, beforeArena);
  assert.deepEqual(step(ctx, 'win_arena_battle').reply.reward, { holos: 150, gachaTickets: 0, buddyUnitsLight: 0 });
  assert.equal(ctx.state.claims.win_arena_battle.reward.holos, 150);
});

test('reward amounts: the full chain pays exactly 750 Holos, 3 Gacha Tickets and 1 Light Unit on top of existing balances', () => {
  const ctx = fresh({ holosTokens: 37.5, gachaTickets: 2, buddyUnits: inv(0, 2, 1), rivalWins: 0 });
  for (const s of Q.INTRO_QUEST_STEPS) {
    if (s.kind === 'rival') ctx.profile.rivalWins += 1;
    step(ctx, s.stepId);
  }
  assert.equal(ctx.profile.holosTokens, 787.5); assert.equal(ctx.profile.gachaTickets, 5); assert.deepEqual(ctx.profile.buddyUnits, inv(1, 2, 1));
  const st = Q.introStatus(ctx.state); assert.equal(st.complete, true); assert.equal(st.currentStepId, ''); assert.ok(st.steps.every(s => s.claimed));
  assert.throws(() => step(ctx, 'chain_complete', { requestId: 'again' }), /already_claimed/);
});

test('Light Unit reward migrates a #43 integer and grants the starter for a missing field (both exactly once, persisted with the reward)', () => {
  const run = profile => { const ctx = fresh(profile); for (const id of ['visit_mission_board', 'visit_marketplace', 'visit_workshop']) step(ctx, id); return [ctx, step(ctx, 'capture_buddy')]; };
  const [a] = run({ buddyUnits: 3 }); assert.deepEqual(a.profile.buddyUnits, inv(4));
  const [b] = run({}); assert.deepEqual(b.profile.buddyUnits, inv(2), 'starter 1 + quest 1');
});

test('state: absent doc = fresh chain; a present but malformed doc fails closed (never reset, never re-paid)', () => {
  const { state, fresh: isFresh } = Q.readIntroQuestState(undefined, T0, 3);
  assert.equal(isFresh, true); assert.equal(state.currentIndex, 0); assert.equal(state.rivalWinsAtStepStart, 3);
  const ctx = fresh(); step(ctx, 'visit_mission_board'); step(ctx, 'visit_marketplace');
  assert.equal(Q.readIntroQuestState(structuredClone(ctx.state), T0, 0).fresh, false);
  const bad = [null, {}, [], 'x', { ...ctx.state, schemaVersion: 'intro-quest-0' }, { ...ctx.state, currentIndex: 9 }, { ...ctx.state, currentIndex: 8 }, { ...ctx.state, currentIndex: 0 }, { ...ctx.state, currentIndex: 1 },
    { ...ctx.state, currentIndex: 3 }, { ...ctx.state, claims: {} }, { ...ctx.state, claims: { ...ctx.state.claims, visit_portal: ctx.state.claims.visit_marketplace } },
    { ...ctx.state, stepStartedAtMs: -1 }, { ...ctx.state, rivalWinsAtStepStart: 1.5 },
    { ...ctx.state, claims: { ...ctx.state.claims, visit_marketplace: { ...ctx.state.claims.visit_marketplace, requestId: ctx.state.claims.visit_mission_board.requestId } } },
    { ...ctx.state, claims: { ...ctx.state.claims, visit_marketplace: { ...ctx.state.claims.visit_marketplace, reward: { holos: -1, gachaTickets: 0, buddyUnitsLight: 0 } } } }];
  for (const b of bad) assert.throws(() => Q.readIntroQuestState(b, T0, 0), /unavailable/, JSON.stringify(b));
});

test('malformed balances fail closed; commands are validated', () => {
  const ctx = fresh({ holosTokens: '50' });
  assert.throws(() => step(ctx, 'visit_mission_board'), /unavailable/);
  for (const p of [{ holosTokens: -1 }, { gachaTickets: NaN }, { buddyUnits: { light: 1 } }, { rivalWins: -2 }]) assert.throws(() => Q.introStatusReply(fresh().state, p) && step(fresh(p), 'visit_mission_board'), /unavailable/);
  for (const bad of [null, {}, { operation: 'grant' }, claim('nope'), { operation: 'claim', stepId: 'visit_portal' }, claim('visit_portal', 'bad id'), claim('visit_portal', 'r', 7), claim('visit_portal', 'r', 'x'.repeat(129))]) assert.throws(() => Q.validateIntroCommand(bad), /invalid_request/);
  assert.deepEqual(Q.validateIntroCommand({ operation: 'status', extra: 1 }), { operation: 'status' });
});

test('status: current step, claimed flags, reward previews and destination ids', () => {
  const ctx = fresh(); step(ctx, 'visit_mission_board', { now: T0 + 5 });
  const r = Q.introStatusReply(ctx.state, ctx.profile);
  assert.equal(r.schemaVersion, 'intro-quest-1'); assert.equal(r.status.currentStepId, 'visit_marketplace'); assert.equal(r.status.complete, false);
  assert.deepEqual(r.status.steps[0], { stepId: 'visit_mission_board', index: 0, kind: 'visit', destinationId: 'mission_board', claimed: true, claimedAtMs: T0 + 5, current: false, reward: { holos: 50, gachaTickets: 0, buddyUnitsLight: 0 } });
  assert.equal(r.status.steps[1].current, true); assert.equal(r.status.steps[3].destinationId, ''); assert.deepEqual(r.balances, { holosTokens: 50, gachaTickets: 0, buddyUnits: inv(0) });
  assert.deepEqual(r.status.totalReward, { holos: 750, gachaTickets: 3, buddyUnitsLight: 1 });
});

// ---- Docs written before win_arena_battle existed (7-step chain, positions 0..7) ----
const OLD_CHAIN = [['visit_mission_board', 50, 0, 0], ['visit_marketplace', 50, 1, 0], ['visit_workshop', 75, 0, 0], ['capture_buddy', 100, 0, 1], ['win_rival_battle', 100, 1, 0], ['visit_portal', 75, 0, 0], ['chain_complete', 150, 1, 0]];
const oldClaims = n => Object.fromEntries(OLD_CHAIN.slice(0, n).map(([id, holos, gachaTickets, buddyUnitsLight], i) => [id, { requestId: `old_${i}`, claimedAtMs: T0 + i, reward: { holos, gachaTickets, buddyUnitsLight } }]));
const oldDoc = n => ({ schemaVersion: 'intro-quest-1', currentIndex: n, claims: oldClaims(n), stepStartedAtMs: T0 + n, rivalWinsAtStepStart: 2 });
/** Holos a pilot at old index n has already been paid. */
const oldPaid = n => OLD_CHAIN.slice(0, n).reduce((t, x) => t + x[1], 0);
const CURRENT_AFTER_UPGRADE = ['visit_mission_board', 'visit_marketplace', 'visit_workshop', 'capture_buddy', 'win_rival_battle', 'win_arena_battle', 'chain_complete', ''];
const profileFor = () => ({ holosTokens: 1000, gachaTickets: 0, buddyUnits: inv(0), rivalWins: 5 });
const loadOld = n => ({ profile: profileFor(), state: Q.readIntroQuestState(oldDoc(n), T0 + 100, 5).state });

for (let n = 0; n <= 7; n++) {
  test(`old doc at index ${n}: reads, points at the right step, and finishing the chain repays nothing`, () => {
    const { state, fresh: isFresh } = Q.readIntroQuestState(oldDoc(n), T0 + 100, 5);
    assert.equal(isFresh, false);
    assert.equal(Q.introStatus(state).currentStepId, CURRENT_AFTER_UPGRADE[n]);
    // Old-chain claims stay claimed under their original requestIds and amounts.
    for (const [id] of OLD_CHAIN.slice(0, n)) assert.deepEqual(state.claims[id], oldClaims(n)[id]);
    // Status alone is a pure read of the stored doc.
    assert.deepEqual(Q.readIntroQuestState(oldDoc(n), T0 + 100, 5).state, state);

    const ctx = { profile: profileFor(), state };
    // A claimed step can never pay again, whatever the new requestId.
    for (const [id] of OLD_CHAIN.slice(0, n)) assert.throws(() => step(ctx, id, { requestId: 'fresh_id' }), /already_claimed/, id);
    assert.equal(ctx.profile.holosTokens, 1000);
    // Finish whatever is left; each remaining step pays its table reward exactly once.
    let paidNow = 0;
    for (const s of Q.INTRO_QUEST_STEPS.slice(state.currentIndex)) {
      if (s.kind === 'rival') ctx.profile.rivalWins += 1;
      paidNow += step(ctx, s.stepId, { now: T0 + 200 }).reply.reward.holos;
    }
    const status = Q.introStatus(ctx.state);
    assert.equal(status.complete, true); assert.ok(status.steps.every(x => x.claimed));
    assert.equal(ctx.profile.holosTokens, 1000 + paidNow);
    // Chain total: a pilot not yet past visit_portal can still earn the new step; one past it finishes on the old 600.
    assert.equal(oldPaid(n) + paidNow, n <= 5 ? 750 : 600);
    assert.equal(status.totalReward.holos, n <= 5 ? 750 : 600);
    assert.deepEqual(Q.readIntroQuestState(structuredClone(ctx.state), T0 + 300, 9).state, ctx.state, 'the finished doc reads back unchanged');
  });
}

test('old doc at index 5: the Arena step comes before the Portal and needs a win; the Portal is out_of_order until then', () => {
  const ctx = loadOld(5);
  assert.throws(() => step(ctx, 'visit_portal'), /out_of_order/);
  assert.throws(() => step(ctx, 'win_arena_battle', { verify: no }), /not_met/);
  assert.equal(ctx.profile.holosTokens, 1000);
  assert.equal(step(ctx, 'win_arena_battle').reply.reward.holos, 150);
  assert.equal(step(ctx, 'visit_portal').reply.status.currentStepId, 'chain_complete');
});

test('old doc past the Portal (6, 7): the Arena step is closed at zero, cannot be claimed, and replays stay honest', () => {
  for (const n of [6, 7]) {
    const ctx = loadOld(n);
    assert.equal(ctx.state.currentIndex, n + 1);
    const view = Q.introStatus(ctx.state).steps.find(s => s.stepId === 'win_arena_battle');
    assert.equal(view.claimed, true); assert.equal(view.claimedAtMs, 0); assert.deepEqual(view.reward, { holos: 0, gachaTickets: 0, buddyUnitsLight: 0 });
    assert.throws(() => step(ctx, 'win_arena_battle', { requestId: 'new_try' }), /already_claimed/);
    const waived = step(ctx, 'win_arena_battle', { requestId: Q.ARENA_STEP_WAIVED_REQUEST_ID });
    assert.equal(waived.state, null); assert.equal(waived.reply.alreadyProcessed, true); assert.equal(waived.reply.reward.holos, 0);
    // A retry of the original Portal claim still replays its ruling under the upgraded doc.
    const replay = step(ctx, 'visit_portal', { requestId: 'old_5' });
    assert.equal(replay.state, null); assert.equal(replay.reply.alreadyProcessed, true); assert.equal(replay.reply.reward.holos, 75);
    assert.throws(() => step(ctx, 'visit_marketplace', { requestId: Q.ARENA_STEP_WAIVED_REQUEST_ID }), /invalid_request/);
    assert.equal(ctx.profile.holosTokens, 1000);
  }
  // The bonus still pays once from old index 6, and the persisted doc is the new shape.
  const six = loadOld(6);
  assert.equal(step(six, 'chain_complete').reply.reward.holos, 150);
  assert.equal(six.state.currentIndex, 8); assert.equal(six.state.claims.win_arena_battle.requestId, Q.ARENA_STEP_WAIVED_REQUEST_ID);
  assert.deepEqual(Q.readIntroQuestState(structuredClone(six.state), T0, 0).state, six.state);
});

test('new-chain docs at every index read back unchanged (never mistaken for old docs)', () => {
  const claims = n => Object.fromEntries(Q.INTRO_QUEST_STEPS.slice(0, n).map((s, i) => [s.stepId, { requestId: `new_${i}`, claimedAtMs: T0 + i, reward: { ...s.reward } }]));
  for (let n = 0; n <= Q.INTRO_QUEST_STEPS.length; n++) {
    const doc = { schemaVersion: Q.INTRO_QUEST_SCHEMA, currentIndex: n, claims: claims(n), stepStartedAtMs: T0, rivalWinsAtStepStart: 0 };
    assert.deepEqual(Q.readIntroQuestState(structuredClone(doc), T0, 0).state, doc, `index ${n}`);
  }
});

test('near-misses of the old shape still fail closed', () => {
  const { visit_portal, ...noPortal } = oldClaims(6);
  const { chain_complete, ...noBonus } = oldClaims(7);
  const bad = [{ ...oldDoc(6), claims: noPortal }, { ...oldDoc(7), claims: noBonus }, { ...oldDoc(6), claims: oldClaims(7) }, { ...oldDoc(7), claims: oldClaims(6) },
    { ...oldDoc(6), claims: { ...oldClaims(6), win_arena_battle: { requestId: 'x1', claimedAtMs: T0, reward: { holos: 100, gachaTickets: 0, buddyUnitsLight: 0 } } } },
    { ...oldDoc(6), claims: { ...oldClaims(6), visit_portal: { ...oldClaims(6).visit_portal, reward: { holos: -1, gachaTickets: 0, buddyUnitsLight: 0 } } } },
    { ...oldDoc(7), schemaVersion: 'intro-quest-0' }];
  for (const b of bad) assert.throws(() => Q.readIntroQuestState(b, T0, 0), /unavailable/, JSON.stringify(b).slice(0, 120));
});
