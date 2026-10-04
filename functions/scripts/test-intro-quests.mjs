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
const yes = { captured: () => true }, no = { captured: () => false };
/** Claim `stepId` against (state, profile), applying writes like the store. */
function step(ctx, stepId, opts = {}) {
  const cmd = Q.validateIntroCommand(claim(stepId, opts.requestId, opts.destinationId ?? DEST[stepId]));
  const r = Q.claimIntroStep(ctx.state, ctx.profile, cmd, opts.now ?? T0, opts.verify ?? yes);
  Object.assign(ctx.profile, r.userUpdates); if (r.state) ctx.state = r.state;
  return r;
}
const fresh = (profile = { holosTokens: 0, gachaTickets: 0, buddyUnits: inv(0) }) => ({ profile, state: Q.readIntroQuestState(undefined, T0, 0).state });

test('reward table: 7 steps in order, 50–150 Holos each, totals 600 Holos / 3 Gacha Tickets / 1 Light Unit', () => {
  assert.deepEqual(Q.INTRO_QUEST_STEPS.map(s => s.stepId), ['visit_mission_board', 'visit_marketplace', 'visit_workshop', 'capture_buddy', 'win_rival_battle', 'visit_portal', 'chain_complete']);
  assert.deepEqual(Q.INTRO_QUEST_STEPS.map(s => [s.reward.holos, s.reward.gachaTickets, s.reward.buddyUnitsLight]), [[50, 0, 0], [50, 1, 0], [75, 0, 0], [100, 0, 1], [100, 1, 0], [75, 0, 0], [150, 1, 0]]);
  for (const s of Q.INTRO_QUEST_STEPS) assert.ok(s.reward.holos >= 50 && s.reward.holos <= 150, s.stepId);
  assert.deepEqual(Q.introQuestTotals(), { holos: 600, gachaTickets: 3, buddyUnitsLight: 1 });
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
});

test('reward amounts: the full chain pays exactly 600 Holos, 3 Gacha Tickets and 1 Light Unit on top of existing balances', () => {
  const ctx = fresh({ holosTokens: 37.5, gachaTickets: 2, buddyUnits: inv(0, 2, 1), rivalWins: 0 });
  for (const s of Q.INTRO_QUEST_STEPS) {
    if (s.kind === 'rival') ctx.profile.rivalWins += 1;
    step(ctx, s.stepId);
  }
  assert.equal(ctx.profile.holosTokens, 637.5); assert.equal(ctx.profile.gachaTickets, 5); assert.deepEqual(ctx.profile.buddyUnits, inv(1, 2, 1));
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
  const bad = [null, {}, [], 'x', { ...ctx.state, schemaVersion: 'intro-quest-0' }, { ...ctx.state, currentIndex: 8 }, { ...ctx.state, currentIndex: 0 }, { ...ctx.state, currentIndex: 1 },
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
  assert.deepEqual(r.status.totalReward, { holos: 600, gachaTickets: 3, buddyUnitsLight: 1 });
});
