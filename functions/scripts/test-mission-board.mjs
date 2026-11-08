// mission-board-1 domain tests (pure module lib/missionBoard.ts): generation, refill, verification, rewards, idempotency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../lib/lib/missionBoard.js');
const B = require('../lib/lib/battleSettlement.js');
const Z = require('../lib/lib/holoZoneRuns.js');

const T0 = Date.UTC(2026, 10, 7, 12, 0, 0);
const UID = 'pilot_a';
const SEED = '0123456789abcdef0123456789abcdef';
const C = { citizens: [{ citizenId: 'CV1_HB_CITIZEN1_FerryOlive_01', pilotName: 'Ferry Olive' }], captureTargets: ['hare_harbor', 'kurai_garden'] };
const NO_CAPTURE = { citizens: [], captureTargets: [] };
const profile = (extra = {}) => ({ holosTokens: 10, holobots: [{ name: 'ACE', level: 1, experience: 0, nextLevelExp: 100 }, { name: 'KUMA', level: 3, experience: 400, nextLevelExp: 900 }], itemStocks: { blueprint_fragment: 2 }, ...extra });
const SQUAD = ['ace', 'kuma'];
const facts = (f = {}) => ({ ...M.NO_FACTS, ...f });
const claimCmd = (postingId, requestId = `req_${postingId}`, destinationId) => M.validateMissionBoardCommand({ operation: 'claim', postingId, requestId, ...(destinationId === undefined ? {} : { destinationId }) });
/** A board whose slot 0 holds a posting of `kind` with `target` (other fields from the generator). */
function boardWith(kind, target, overrides = {}) {
  const board = M.freshBoard(UID, SEED, C, T0);
  let serial = 100;
  let p;
  do p = M.generatePosting(UID, SEED, serial++, [], C, T0); while (p.kind !== kind);
  board.slots[0] = { posting: { ...p, target, ...overrides }, refillAtMs: null };
  return board;
}
const battleExp = B.computeBattleSettlement({ kind: 'beast', tier: 0, didWin: true }).exp;
const S = require('../lib/city/cityWildSpots.js');
const D = require('../lib/lib/cityDistricts.js');

test('constants: three slots, one 10-minute refill constant, battle postings pay the Guild Court win (100 Holos + table EXP at the rival tier)', () => {
  assert.equal(M.MISSION_BOARD_SLOTS, 3);
  assert.equal(M.MISSION_BOARD_REFILL_MS, 10 * 60 * 1000);
  assert.equal(M.MISSION_BOARD_BATTLE_HOLOS, 100);
  assert.equal(battleExp, 95);
  assert.deepEqual([0, 1, 2, 5].map(M.missionBoardExp), [95, 137, 180, 308]);
  for (const t of [0, 1, 2, 5]) assert.equal(M.missionBoardExp(t), B.computeBattleSettlement({ kind: 'rival', tier: t, didWin: true }).exp);
  assert.deepEqual(M.VISIT_TARGETS.map(v => [v.destinationId, v.holos]), [['mission_board', 50], ['marketplace', 50], ['workshop', 75], ['harbor', 75], ['portal_terminal', 75]]);
  assert.deepEqual(M.BEAST_TARGETS.map(b => b.zoneId), ['guild_court']);
  assert.equal(Z.holoZoneTier('guild_court'), 0, 'beast targets are real zones the run host issues');
});

test('generation is deterministic per (uid, seed, serial) and never touches Math.random', () => {
  const real = Math.random;
  Math.random = () => { throw new Error('Math.random used'); };
  try {
    const a = M.freshBoard(UID, SEED, C, T0), b = M.freshBoard(UID, SEED, C, T0);
    assert.deepEqual(a, b);
    assert.deepEqual(M.generatePosting(UID, SEED, 7, ['beast'], C, T0), M.generatePosting(UID, SEED, 7, ['beast'], C, T0));
    assert.notDeepEqual(M.freshBoard('pilot_b', SEED, C, T0).slots.map(s => s.posting.postingId), a.slots.map(s => s.posting.postingId));
    assert.notDeepEqual(M.freshBoard(UID, 'f'.repeat(32), C, T0).slots.map(s => s.posting.postingId), a.slots.map(s => s.posting.postingId));
    assert.equal(a.nextSerial, 3); assert.deepEqual(a.slots.map(s => s.posting.serial), [0, 1, 2]);
    assert.ok(a.slots.every(s => s.posting.claim === null && s.refillAtMs === null && s.posting.issuedAtMs === T0));
  } finally { Math.random = real; }
});

test('generation: the three open slots never share a kind; targets and rewards come from the server tables', () => {
  let fragments = 0, battles = 0;
  const kindsSeen = new Set(), rivalTargets = new Set();
  for (let i = 0; i < 300; i++) {
    const uid = `pilot_${i}`;
    for (const c of [C, NO_CAPTURE]) {
      const board = M.freshBoard(uid, SEED, c, T0);
      const kinds = board.slots.map(s => s.posting.kind);
      assert.equal(new Set(kinds).size, 3, `${uid}: ${kinds}`);
      if (!c.captureTargets.length) assert.ok(!kinds.includes('capture'), 'no capture posting without a capturable target');
      for (const { posting: p } of board.slots) {
        kindsSeen.add(p.kind);
        assert.match(p.postingId, M.POSTING_ID);
        if (p.kind === 'visit') {
          const v = M.VISIT_TARGETS.find(x => x.destinationId === p.target);
          assert.ok(v); assert.deepEqual(p.reward, { holos: v.holos }); assert.equal(p.districtId, v.districtId);
          continue;
        }
        battles++;
        assert.equal(p.reward.holos, 100); assert.equal(p.reward.exp, undefined, 'EXP is not stored: the view rules it at the current tier');
        if (p.reward.items) { fragments++; assert.deepEqual(p.reward.items, [{ itemId: 'blueprint_fragment', quantity: 1 }]); }
        if (p.kind === 'beast') assert.equal(p.target, 'guild_court');
        if (p.kind === 'capture') {
          assert.ok(['hare_harbor', 'kurai_garden'].includes(p.target));
          assert.equal(p.holobotId, p.target === 'hare_harbor' ? 'hare' : 'kurai');
          assert.equal(p.districtId, p.target === 'hare_harbor' ? 'D02' : 'D06');
        } else assert.equal(p.holobotId, '');
        if (p.kind === 'rival') { rivalTargets.add(p.target); assert.ok(['town_rival', 'any', ...c.citizens.map(x => x.citizenId)].includes(p.target)); }
      }
    }
  }
  assert.deepEqual([...kindsSeen].sort(), ['beast', 'capture', 'rival', 'visit']);
  assert.deepEqual([...rivalTargets].sort(), ['CV1_HB_CITIZEN1_FerryOlive_01', 'any', 'town_rival']);
  assert.ok(fragments / battles > 0.2 && fragments / battles < 0.45, `"sometimes" a fragment: ${fragments}/${battles}`);
});

test('refill: a claimed slot shows state claimed + refillAtMs until the 10-minute cooldown, then a new posting goes up', () => {
  const board = boardWith('visit', 'workshop');
  const id = board.slots[0].posting.postingId;
  const T1 = T0 + 60_000;
  const r = M.claimPosting(board, profile(), claimCmd(id, 'r1', 'workshop'), facts(), [], T1, 0);
  assert.equal(r.board.slots[0].refillAtMs, T1 + M.MISSION_BOARD_REFILL_MS);
  const view = M.boardView(r.board, facts(), T1, 0);
  assert.equal(view.postings[0].state, 'claimed'); assert.equal(view.postings[0].refillAtMs, T1 + 600_000); assert.equal(view.refillAtMs, T1 + 600_000);
  assert.ok(view.postings.slice(1).every(p => p.refillAtMs === null));
  const early = M.refillBoard(r.board, UID, C, T1 + 600_000 - 1);
  assert.equal(early.changed, false); assert.equal(early.board, r.board);
  const due = M.refillBoard(r.board, UID, C, T1 + 600_000);
  assert.equal(due.changed, true);
  const fresh = due.board.slots[0];
  assert.equal(fresh.refillAtMs, null); assert.equal(fresh.posting.claim, null); assert.equal(fresh.posting.serial, board.nextSerial);
  assert.equal(fresh.posting.issuedAtMs, T1 + 600_000);
  assert.notEqual(fresh.posting.postingId, id);
  assert.equal(due.board.nextSerial, board.nextSerial + 1);
  assert.ok(!due.board.slots.slice(1).map(s => s.posting.kind).includes(fresh.posting.kind), 'refill avoids the other open kinds');
  assert.deepEqual(M.refillBoard(r.board, UID, C, T1 + 600_000).board, due.board, 'refill is deterministic');
  assert.deepEqual(due.board.slots.slice(1), r.board.slots.slice(1), 'other slots untouched');
  // The claimed posting is gone from the slots but its ledger row remains: a re-claim is already_claimed, the old requestId replays.
  assert.throws(() => M.claimPosting(due.board, profile(), claimCmd(id, 'r2', 'workshop'), facts(), [], T1 + 600_001, 0), /already_claimed/);
  assert.equal(M.claimPosting(due.board, profile(), claimCmd(id, 'r1', 'workshop'), facts(), [], T1 + 600_001, 0).reply.alreadyProcessed, true);
});

test('visit: the client-sent destinationId must equal the target (low-stakes trust); pays the intro visit Holos, no EXP', () => {
  const board = boardWith('visit', 'marketplace', { reward: { holos: 50 } });
  const id = board.slots[0].posting.postingId;
  for (const d of [undefined, '', 'workshop', 'MARKETPLACE']) assert.throws(() => M.claimPosting(board, profile(), claimCmd(id, 'v1', d), facts(), SQUAD, T0 + 1, 0), /not_complete/);
  const r = M.claimPosting(board, profile(), claimCmd(id, 'v1', 'marketplace'), facts(), SQUAD, T0 + 1, 0);
  assert.deepEqual(r.userUpdates, { holosTokens: 60 });
  assert.deepEqual(r.reply.granted, { holos: 50, expPerHolobot: 0, expTier: 0, items: [] });
  assert.deepEqual(r.reply.progression, []);
  assert.deepEqual(r.reply.balances, { holosTokens: 60, blueprintFragments: 2 });
});

test('beast: only a settled WIN of the target zone after issuedAtMs counts (not before / at issue, not a loss, not a withheld run, not another zone)', () => {
  const board = boardWith('beast', 'guild_court', { issuedAtMs: T0 });
  const id = board.slots[0].posting.postingId;
  const s = (o) => ({ zoneId: 'guild_court', didWin: true, expWithheld: false, settledAtMs: T0 + 5000, ...o });
  for (const bad of [s({ settledAtMs: T0 - 1 }), s({ settledAtMs: T0 }), s({ didWin: false }), s({ expWithheld: true }), s({ zoneId: 'neonforest' })]) {
    assert.throws(() => M.claimPosting(board, profile(), claimCmd(id), facts({ zoneSettles: [bad] }), SQUAD, T0 + 9000, 0), /not_complete/, JSON.stringify(bad));
    assert.equal(M.boardView(board, facts({ zoneSettles: [bad] }), T0, 0).postings[0].state, 'open');
  }
  assert.throws(() => M.claimPosting(board, profile(), claimCmd(id), facts({ rivalSettles: [{ pilotId: 'x', didWin: true, settledAtMs: T0 + 1 }] }), SQUAD, T0 + 9000, 0), /not_complete/, 'another kind of record never counts');
  const good = facts({ zoneSettles: [s({ settledAtMs: T0 - 50 }), s()] });
  assert.equal(M.boardView(board, good, T0, 0).postings[0].state, 'complete');
  assert.equal(M.claimPosting(board, profile(), claimCmd(id), good, SQUAD, T0 + 9000, 0).reply.alreadyProcessed, false);
});

test('rival: a settled win against the target pilot after issuedAtMs; town_rival = rival_tier_N; any = any pilot', () => {
  const citizen = 'CV1_HB_CITIZEN1_FerryOlive_01';
  const win = (pilotId, o = {}) => ({ pilotId, didWin: true, settledAtMs: T0 + 1000, ...o });
  const cases = [
    [citizen, [win(citizen)], true], [citizen, [win('rival_tier_0')], false], [citizen, [win(citizen, { didWin: false })], false],
    [citizen, [win(citizen, { settledAtMs: T0 - 1 })], false], [citizen, [win(citizen, { settledAtMs: T0 })], false],
    ['town_rival', [win('rival_tier_0')], true], ['town_rival', [win('rival_tier_3')], true], ['town_rival', [win(citizen)], false], ['town_rival', [win('zell')], false],
    ['any', [win('zell')], true], ['any', [win(citizen)], true], ['any', [win('rival_tier_1', { didWin: false })], false], ['any', [], false],
  ];
  for (const [target, rivalSettles, ok] of cases) {
    const board = boardWith('rival', target, { issuedAtMs: T0 });
    const id = board.slots[0].posting.postingId;
    const run = () => M.claimPosting(board, profile(), claimCmd(id), facts({ rivalSettles }), SQUAD, T0 + 2000, 0);
    if (ok) assert.equal(run().reply.kind, 'rival', `${target} ${JSON.stringify(rivalSettles)}`);
    else assert.throws(run, /not_complete/, `${target} ${JSON.stringify(rivalSettles)}`);
  }
});

test('capture: a successful capture at the target spot (any cycle) after issuedAtMs (receipt create time)', () => {
  const board = boardWith('capture', 'hare_harbor', { holobotId: 'hare', issuedAtMs: T0 });
  const id = board.slots[0].posting.postingId;
  for (const bad of [[{ encounterId: 'city_spot_hare_harbor_2', capturedAtMs: T0 - 10 }], [{ encounterId: 'city_spot_hare_harbor_2', capturedAtMs: T0 }],
    [{ encounterId: 'city_spot_wake_quay_1', capturedAtMs: T0 + 10 }], [{ encounterId: 'city_spot_hare_harbor_x', capturedAtMs: T0 + 10 }], [{ encounterId: 'harbor_hare', capturedAtMs: T0 + 10 }], []]) {
    assert.throws(() => M.claimPosting(board, profile(), claimCmd(id), facts({ captures: bad }), SQUAD, T0 + 20, 0), /not_complete/, JSON.stringify(bad));
  }
  const r = M.claimPosting(board, profile(), claimCmd(id), facts({ captures: [{ encounterId: 'city_spot_hare_harbor_3', capturedAtMs: T0 + 10 }] }), SQUAD, T0 + 20, 0);
  assert.equal(r.reply.kind, 'capture'); assert.equal(r.reply.granted.holos, 100);
  // The once-only Research Garden KURAI keeps its own encounter id.
  const garden = boardWith('capture', 'kurai_garden', { holobotId: 'kurai', issuedAtMs: T0 });
  const gid = garden.slots[0].posting.postingId;
  assert.throws(() => M.claimPosting(garden, profile(), claimCmd(gid), facts({ captures: [{ encounterId: 'city_spot_kurai_missionboard_1', capturedAtMs: T0 + 10 }] }), SQUAD, T0 + 20, 0), /not_complete/);
  assert.equal(M.claimPosting(garden, profile(), claimCmd(gid), facts({ captures: [{ encounterId: 'city_kurai_garden', capturedAtMs: T0 + 10 }] }), SQUAD, T0 + 20, 0).reply.kind, 'capture');
  assert.equal(M.captureSpotMatches('kurai_missionboard', 'city_spot_kurai_missionboard_12'), true);
  assert.equal(M.captureSpotMatches('kurai_missionboard', 'city_kurai_garden'), false);
});

test('EXP scales with the pilot\'s current rival tier (view and claim); Holos stay 100; the claim records its tier', () => {
  const board = boardWith('beast', 'guild_court', { reward: { holos: 100 } });
  const id = board.slots[0].posting.postingId;
  const f = facts({ zoneSettles: [{ zoneId: 'guild_court', didWin: true, expWithheld: false, settledAtMs: T0 + 1 }] });
  assert.equal(M.boardView(board, f, T0, 0).postings[0].reward.exp, 95);
  assert.equal(M.boardView(board, f, T0, 2).postings[0].reward.exp, 180);
  assert.equal(M.boardView(board, f, T0, 2).postings.find(p => p.kind === 'visit')?.reward.exp, undefined, 'visits carry no EXP');
  const r = M.claimPosting(board, profile(), claimCmd(id), f, SQUAD, T0 + 2, 2);
  assert.equal(r.reply.granted.expPerHolobot, 180); assert.equal(r.reply.granted.expTier, 2); assert.equal(r.reply.granted.holos, 100);
  assert.deepEqual(r.reply.progression.map(x => x.expGained), [180, 180]);
  // A claimed posting keeps showing what it paid, whatever the tier is later.
  assert.equal(M.boardView(r.board, f, T0, 7).postings[0].reward.exp, 180);
  const rival = boardWith('rival', 'any', { reward: { holos: 100 } });
  const rr = M.claimPosting(rival, profile({ expBoosterActiveUntil: T0 + 99 }), claimCmd(rival.slots[0].posting.postingId), facts({ rivalSettles: [{ pilotId: 'x', didWin: true, settledAtMs: T0 + 1 }] }), ['ace'], T0 + 2, 1);
  assert.equal(rr.reply.granted.expPerHolobot, 274, 'tier 1 = 137, booster doubles');
  assert.throws(() => M.claimPosting(board, profile(), claimCmd(id), f, SQUAD, T0 + 2, -1), /unavailable/);
});

test('districts: the shared city plan ids (cityDistrictAt on plan coordinates)', () => {
  assert.equal(D.cityDistrictAt(22.5, -58.5), 'D04', 'Guild Court site → Guild + Dome');
  assert.equal(M.BEAST_TARGETS[0].districtId, 'D04');
  assert.deepEqual(Object.fromEntries(M.VISIT_TARGETS.map(v => [v.destinationId, v.districtId])), { mission_board: 'D04', marketplace: 'D05', workshop: 'D08', harbor: 'D02', portal_terminal: 'D07' });
  assert.equal(M.TOWN_RIVAL_DISTRICT, 'D04'); assert.equal(M.RIVAL_DISTRICT, 'D09');
  assert.deepEqual(Object.fromEntries(M.CAPTURE_SPOTS.map(s => [s.spotId, s.districtId])), {
    hare_harbor: 'D02', tora_plaza: 'D01', era_market: 'D05', ken_gardens: 'D06', kuma_transit: 'D07', kurai_missionboard: 'D04',
    shadow_plazaedge: 'D08', tsuin_arenagate: 'D09', wolf_workshop: 'D08', wake_quay: 'D02', gama_courtside: 'D03', kurai_garden: 'D06' });
  // Every district centre resolves to itself (the Lite field's own invariant).
  for (const d of D.CITY_DISTRICTS) assert.equal(D.cityDistrictAt(d.x, d.z), d.id);
  // Off-zone ground takes the nearest centre (shadow_plazaedge sits between the plaza and workshop zones).
  assert.equal(D.CITY_DISTRICT_ZONES.some(z => z.id === 'D01'), true);
});

test('rewards: battle postings pay 100 Holos + table EXP to every travel-squad Holobot (+ the posting fragment); booster doubles EXP', () => {
  const withFrag = boardWith('beast', 'guild_court', { reward: { holos: 100, items: [{ itemId: 'blueprint_fragment', quantity: 1 }] } });
  const id = withFrag.slots[0].posting.postingId;
  const f = facts({ zoneSettles: [{ zoneId: 'guild_court', didWin: true, expWithheld: false, settledAtMs: T0 + 1 }] });
  const r = M.claimPosting(withFrag, profile(), claimCmd(id), f, SQUAD, T0 + 2, 0);
  assert.equal(r.userUpdates.holosTokens, 110);
  assert.deepEqual(r.userUpdates.itemStocks, { blueprint_fragment: 3 });
  assert.equal(r.userUpdates.holobots.length, 2);
  assert.deepEqual(r.reply.progression.map(x => [x.holobotId, x.expGained]), [['ace', 95], ['kuma', 95]]);
  assert.deepEqual(r.reply.granted, { holos: 100, expPerHolobot: 95, expTier: 0, items: [{ itemId: 'blueprint_fragment', quantity: 1 }] });
  assert.deepEqual(r.reply.balances, { holosTokens: 110, blueprintFragments: 3 });
  const boosted = M.claimPosting(withFrag, profile({ expBoosterActiveUntil: T0 + 999_999 }), claimCmd(id), f, ['ace'], T0 + 2, 0);
  assert.equal(boosted.reply.granted.expPerHolobot, 190);
  // No fragment on the posting: itemStocks untouched. Empty squad: Holos only, no holobots write.
  const plain = boardWith('beast', 'guild_court', { reward: { holos: 100 } });
  const p = M.claimPosting(plain, profile({ itemStocks: undefined }), claimCmd(plain.slots[0].posting.postingId), f, [], T0 + 2, 0);
  assert.deepEqual(p.userUpdates, { holosTokens: 110 });
  assert.deepEqual(p.reply.granted, { holos: 100, expPerHolobot: 0, expTier: 0, items: [] });
  // A squad id that is not on the profile, or a malformed balance, fails closed.
  assert.throws(() => M.claimPosting(plain, profile(), claimCmd(plain.slots[0].posting.postingId), f, ['wolf'], T0 + 2, 0), /unavailable/);
  assert.throws(() => M.claimPosting(plain, profile({ holosTokens: -1 }), claimCmd(plain.slots[0].posting.postingId), f, [], T0 + 2, 0), /unavailable/);
  assert.throws(() => M.claimPosting(withFrag, profile({ itemStocks: { blueprint_fragment: 'x' } }), claimCmd(id), f, [], T0 + 2, 0), /unavailable/);
});

test('idempotency: once per requestId and once per posting', () => {
  const board = boardWith('visit', 'harbor', { reward: { holos: 75 } });
  const id = board.slots[0].posting.postingId;
  const prof = profile();
  const first = M.claimPosting(board, prof, claimCmd(id, 'q1', 'harbor'), facts(), [], T0 + 5, 0);
  Object.assign(prof, first.userUpdates);
  const replay = M.claimPosting(first.board, prof, claimCmd(id, 'q1', 'harbor'), facts(), [], T0 + 6, 0);
  assert.equal(replay.reply.alreadyProcessed, true); assert.equal(replay.board, null); assert.deepEqual(replay.userUpdates, {});
  assert.deepEqual(replay.reply.granted, first.reply.granted); assert.equal(replay.reply.balances.holosTokens, 85);
  // Replay needs no destination (the original ruling is returned as-is).
  assert.equal(M.claimPosting(first.board, prof, claimCmd(id, 'q1'), facts(), [], T0 + 6, 0).reply.alreadyProcessed, true);
  assert.throws(() => M.claimPosting(first.board, prof, claimCmd(id, 'q2', 'harbor'), facts(), [], T0 + 6, 0), (e) => e.code === 'already_claimed' && e.detail.refillAtMs === T0 + 5 + 600_000);
  const other = first.board.slots[1].posting.postingId;
  assert.throws(() => M.claimPosting(first.board, prof, claimCmd(other, 'q1', 'x'), facts(), [], T0 + 6, 0), /invalid_request/, 'requestId reused for another posting');
  assert.throws(() => M.claimPosting(first.board, prof, claimCmd('mbp_999_deadbeef0000', 'q3'), facts(), [], T0 + 6, 0), /unknown_posting/);
  assert.equal(first.board.claims.length, 1);
});

test('hostFlags: new_posting for postings issued after the last status; posting_cleared while a verified posting awaits its claim', () => {
  const board = boardWith('beast', 'guild_court', { issuedAtMs: T0 });
  assert.equal(M.boardView(board, facts(), 0, 0).hostFlags.new_posting, true);
  assert.equal(M.boardView(board, facts(), T0, 0).hostFlags.new_posting, false);
  assert.equal(M.boardView(board, facts(), T0, 0).hostFlags.posting_cleared, false);
  const f = facts({ zoneSettles: [{ zoneId: 'guild_court', didWin: true, expWithheld: false, settledAtMs: T0 + 1 }] });
  assert.equal(M.boardView(board, f, T0, 0).hostFlags.posting_cleared, true);
  const claimed = M.claimPosting(board, profile(), claimCmd(board.slots[0].posting.postingId), f, [], T0 + 2, 0).board;
  assert.equal(M.boardView(claimed, f, T0, 0).hostFlags.posting_cleared, false, 'a claimed posting is no longer "cleared, unclaimed"');
});

test('stored doc: absent = null; malformed or inconsistent = unavailable (never reset to fresh)', () => {
  assert.equal(M.readBoard(undefined), null);
  const good = M.freshBoard(UID, SEED, C, T0);
  assert.deepEqual(M.readBoard(JSON.parse(JSON.stringify(good))), good);
  const bad = [null, {}, { ...good, schemaVersion: 'x' }, { ...good, slots: good.slots.slice(0, 2) }, { ...good, nextSerial: 1 }, { ...good, seed: 'nope' },
    { ...good, claims: 'x' }, { ...good, slots: [good.slots[0], good.slots[0], good.slots[1]] },
    { ...good, slots: [{ ...good.slots[0], refillAtMs: 5 }, good.slots[1], good.slots[2]] },
    { ...good, claims: [{ requestId: 'a', postingId: 'p', kind: 'visit', claimedAtMs: 1, granted: { holos: 1, expPerHolobot: 0, expTier: 0, items: [] }, progression: [] }, { requestId: 'a', postingId: 'q', kind: 'visit', claimedAtMs: 1, granted: { holos: 1, expPerHolobot: 0, expTier: 0, items: [] }, progression: [] }] },
    { ...good, slots: [{ ...good.slots[0], posting: { ...good.slots[0].posting, holobotId: 7 } }, good.slots[1], good.slots[2]] }];
  for (const b of bad) assert.throws(() => M.readBoard(b), /unavailable/, JSON.stringify(b)?.slice(0, 80));
});

test('commands: status | claim{postingId, requestId, destinationId?}; anything else is invalid_request', () => {
  assert.deepEqual(M.validateMissionBoardCommand({ operation: 'status' }), { operation: 'status' });
  assert.deepEqual(M.validateMissionBoardCommand({ schemaVersion: 'mission-board-1', operation: 'status' }), { operation: 'status' });
  assert.deepEqual(M.validateMissionBoardCommand({ operation: 'claim', postingId: 'p1', requestId: 'r1' }), { operation: 'claim', postingId: 'p1', requestId: 'r1', destinationId: '' });
  for (const bad of [null, 'status', {}, { operation: 'refill' }, { schemaVersion: 'mission-board-0', operation: 'status' }, { operation: 'claim', requestId: 'r1' },
    { operation: 'claim', postingId: 'p1' }, { operation: 'claim', postingId: 'p 1', requestId: 'r1' }, { operation: 'claim', postingId: 'p1', requestId: 'r'.repeat(129) },
    { operation: 'claim', postingId: 'p1', requestId: 'r1', destinationId: 7 }]) assert.throws(() => M.validateMissionBoardCommand(bad), /invalid_request/, JSON.stringify(bad));
});

test('holoZoneRuns fragment grant helper (shared with the zone settle)', () => {
  assert.deepEqual(Z.itemStocksAfterFragmentGrant({}, 1), { blueprint_fragment: 1 });
  assert.deepEqual(Z.itemStocksAfterFragmentGrant({ itemStocks: { a: 1, blueprint_fragment: 4 } }, 2), { a: 1, blueprint_fragment: 6 });
  for (const itemStocks of [null, [], { blueprint_fragment: -1 }, { blueprint_fragment: 1.5 }]) assert.equal(Z.itemStocksAfterFragmentGrant({ itemStocks }, 1), null);
});

test('docs/contracts/mission-board-1.json matches the host constants', async () => {
  const { readFileSync } = await import('node:fs');
  const c = JSON.parse(readFileSync(new URL('../../docs/contracts/mission-board-1.json', import.meta.url), 'utf8'));
  assert.equal(c.schemaVersion, M.MISSION_BOARD_SCHEMA);
  assert.equal(c.slots, M.MISSION_BOARD_SLOTS);
  assert.equal(c.refillCooldownMs, M.MISSION_BOARD_REFILL_MS);
  assert.deepEqual(c.postingKinds, M.POSTING_KINDS);
  assert.deepEqual(c.battlePostingReward, { holos: M.MISSION_BOARD_BATTLE_HOLOS, expTier0: battleExp, expTier: 'tierForWins(users.rivalWins) at claim', fragmentOneIn: M.MISSION_BOARD_FRAGMENT_ONE_IN, fragmentItemId: 'blueprint_fragment', fragmentQuantity: M.MISSION_BOARD_FRAGMENTS });
  assert.equal(c.beastTargets.guild_court.districtId, M.BEAST_TARGETS[0].districtId);
  assert.deepEqual(c.captureSpots, Object.fromEntries(M.CAPTURE_SPOTS.map(s => [s.spotId, { holobotId: s.holobotId, districtId: s.districtId }])));
  assert.equal(c.spotCooldownMs, S.CITY_SPOT_COOLDOWN_MS);
  assert.ok(!c.rejectionCodes.includes('intro_pending'));
  assert.deepEqual(c.visitTargets, Object.fromEntries(M.VISIT_TARGETS.map(v => [v.destinationId, { holos: v.holos, districtId: v.districtId }])));
  assert.deepEqual(Object.keys(c.beastTargets), M.BEAST_TARGETS.map(b => b.zoneId));
});
