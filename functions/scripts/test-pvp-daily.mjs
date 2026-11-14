// pvp-daily-1 (ship-readiness item 7): async PvP daily opponents — selection (rank bands, self exclusion, seeded fill),
// the UTC daily refresh boundary, frozen squad snapshots, one attempt per opponent per day, Holos-only settle and its
// idempotency, request validation. Offline: pure module + the store against an in-memory Firestore model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pinFlags } from './lib/flag-env.mjs';
pinFlags({ HOLOCITY_FIGHT_ATTRS: undefined, HOLOCITY_FIGHT_REPLAY: undefined, HOLOCITY_RIVAL_ISSUE_RESOLVER: undefined });
const require = createRequire(import.meta.url);
const P = require('../lib/lib/pvpDaily.js');
const L = require('../lib/lib/rivalLadder.js');
const { transactPvpDaily } = require('../lib/pvp/pvpDailyStore.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');

const T0 = Date.UTC(2026, 10, 4, 12, 0, 0); // 2026-11-04 12:00 UTC
const DAY = 86400000;
const light = (n) => ({ light: n, medium: 0, heavy: 0 });
const bots = (lvl = 5) => [
  { name: 'ACE', level: lvl, experience: 0, nextLevelExp: 2500, attributePoints: 0 },
  { name: 'KUMA', level: lvl + 1, experience: 0, nextLevelExp: 2500, attributePoints: 0 },
];
const squad = (ids = ['ace', 'kuma']) => ({ schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ids });
const pilot = (wins, name, lvl = 5) => ({ buddyUnits: light(1), rivalWins: wins, username: name, holobots: bots(lvl), travelSquad: squad() });
const cand = (uid, tier, callsign = uid) => ({ uid, tier, callsign, squad: [{ holobotId: 'ace', level: 3, maxHealth: 100, attack: 10, defense: 5, maxStamina: 110, staminaRegen: 16, deployment: { deployCost: 14, drainPerSecond: 1.6, rechargePerSecond: 4 }, moves: [], speed: 1, intelligence: 1 }] });

/** utils: the shared in-memory Firestore model plus the range query the pvp store runs on users/. */
function memoryFirestore() {
  const rows = new Map(); let queue = Promise.resolve();
  const clone = v => v === undefined ? undefined : structuredClone(v);
  const snap = path => ({ id: path.split('/').pop(), exists: rows.has(path), data: () => clone(rows.get(path)) });
  const query = (path, filters = [], max = Infinity) => ({
    where: (field, op, value) => query(path, [...filters, [field, op, value]], max),
    select: () => query(path, filters, max),
    limit: n => query(path, filters, n),
    get: async () => {
      const docs = [...rows.keys()].filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).sort()
        .map(snap).filter(s => filters.every(([f, op, v]) => { const x = s.data()[f]; return typeof x === 'number' && (op === '>=' ? x >= v : op === '<=' ? x <= v : false); }));
      return { docs: docs.slice(0, max) };
    },
  });
  const db = {
    rows,
    doc(path) { return { path, get: async () => snap(path), set: async v => { rows.set(path, clone(v)); }, update: async v => { rows.set(path, { ...rows.get(path), ...clone(v) }); } }; },
    collection: path => query(path),
    runTransaction(fn) {
      const run = queue.then(async () => {
        const pending = []; let writing = false;
        const tx = {
          async get(ref) { if (writing) throw new Error('transaction read after write'); return snap(ref.path); },
          set(ref, v) { writing = true; pending.push(['set', ref.path, clone(v)]); },
          update(ref, v) { writing = true; if (!rows.has(ref.path)) throw new Error('missing update'); pending.push(['update', ref.path, clone(v)]); },
          create(ref, v) { writing = true; if (rows.has(ref.path)) throw new Error('exists'); pending.push(['set', ref.path, clone(v)]); },
        };
        const result = await fn(tx);
        for (const [op, path, v] of pending) rows.set(path, op === 'update' ? { ...rows.get(path), ...v } : v);
        return result;
      });
      queue = run.catch(() => {}); return run;
    },
  };
  return db;
}
const world = () => {
  const db = memoryFirestore();
  db.rows.set('users/me', pilot(25, 'Me'));          // tier 2
  db.rows.set('users/near1', pilot(15, 'Nyx'));      // tier 1
  db.rows.set('users/near2', pilot(30, 'Bolt'));     // tier 3
  db.rows.set('users/wide1', pilot(55, 'Far Kite')); // tier 5
  db.rows.set('users/far', pilot(200, 'Legend'));    // tier 20: outside both bands
  return db;
};

test('validation: strict shapes like desktopTelemetry', () => {
  assert.deepEqual(P.validatePvpCommand({ operation: 'list' }), { operation: 'list' });
  assert.deepEqual(P.validatePvpCommand({ schemaVersion: 'pvp-daily-1', operation: 'issue', opponentId: 'po_20261104_0' }), { operation: 'issue', opponentId: 'po_20261104_0' });
  for (const bad of [null, [], 'list', {}, { operation: 'grant' }, { operation: 'list', extra: 1 }, { operation: 'list', opponentId: 'po_20261104_0' },
    { operation: 'issue' }, { operation: 'issue', opponentId: 'po_x' }, { operation: 'issue', opponentId: 'po_20261104_0/../x' },
    { operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 7 }, { operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 'x'.repeat(33) },
    { schemaVersion: 'pvp-daily-2', operation: 'list' }])
    assert.throws(() => P.validatePvpCommand(bad), /invalid_request/, JSON.stringify(bad));
});

test('pvp-daily-fight-rules: issue takes a rules ask (duel-rules-6 / -7 / -8) beside duelInputs only; list and anything else refuse', () => {
  for (const r of ['duel-rules-6', 'duel-rules-7', 'duel-rules-8'])
    assert.deepEqual(P.validatePvpCommand({ schemaVersion: 'pvp-daily-1', operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 'duel-inputs-2', fightRules: r }),
      { operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 'duel-inputs-2', fightRules: r });
  assert.deepEqual(P.validatePvpCommand({ operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 'duel-inputs-2' }), { operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 'duel-inputs-2' }, 'no ask: today\'s command');
  for (const bad of [
    { operation: 'issue', opponentId: 'po_20261104_0', fightRules: 'duel-rules-8' },                                   // no duelInputs
    { operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-5' },       // not an ask value
    { operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-9' },
    { operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 'duel-inputs-2', fightRules: 8 },
    { operation: 'issue', opponentId: 'po_20261104_0', duelInputs: 'duel-inputs-2', fightRules: null },
    { operation: 'list', fightRules: 'duel-rules-8' },
  ]) assert.throws(() => P.validatePvpCommand(bad), /invalid_request/, JSON.stringify(bad));
});

test('selection: near band first, then wide, self and duplicates excluded, seeded fill; never empty', () => {
  const day = '2026-11-04';
  const near = P.selectDailyOpponents('me', 4, [cand('me', 4), cand('a', 3), cand('b', 5), cand('a', 3), cand('w', 7), cand('x', 20)], day);
  assert.equal(near.length, 3);
  assert.deepEqual(near.slice(0, 2).map(o => o.sourceUid).sort(), ['a', 'b']);
  assert.equal(near[2].sourceUid, 'w');                       // wide band only after near is exhausted
  assert.ok(!near.some(o => o.sourceUid === 'me' || o.sourceUid === 'x'));
  const sparse = P.selectDailyOpponents('me', 4, [cand('a', 4)], day);
  assert.deepEqual(sparse.map(o => o.kind), ['player', 'seeded', 'seeded']);
  const empty = P.selectDailyOpponents('me', 0, [], day);
  assert.deepEqual(empty.map(o => o.kind), ['seeded', 'seeded', 'seeded']);
  assert.equal(new Set(empty.map(o => o.callsign)).size, 3);
  for (const o of empty) { assert.equal(o.tier, 0); assert.ok(o.squad.length >= 1); assert.equal(o.sourceUid, null); }
  assert.deepEqual(empty.map(o => o.opponentId), ['po_20261104_0', 'po_20261104_1', 'po_20261104_2']);
  // deterministic per (uid, day); a different day reshuffles the near band
  const many = Array.from({ length: 12 }, (_, i) => cand('p' + i, 4));
  assert.deepEqual(P.selectDailyOpponents('me', 4, many, day), P.selectDailyOpponents('me', 4, many, day));
  const days = new Set(Array.from({ length: 6 }, (_, k) => P.selectDailyOpponents('me', 4, many, `2026-11-0${k + 1}`).map(o => o.sourceUid).join()));
  assert.ok(days.size > 1);
  // more than three near pilots: only near pilots are picked
  assert.ok(P.selectDailyOpponents('me', 4, [...many, cand('w', 7)], day).every(o => o.tier === 4));
});

test('bands map to the rivalWins ranges the store queries', () => {
  assert.deepEqual(P.winsRangeForBand(2, 1), { lo: 10, hi: 39 });
  assert.deepEqual(P.winsRangeForBand(0, 3), { lo: 0, hi: 39 });
  assert.deepEqual(P.winsRangeForBand(10, 3), { lo: 70, hi: 139 });
});

test('candidate projection: combat numbers + callsign only; unservable profiles are skipped', () => {
  const c = P.candidateFromProfile('u1', { ...pilot(12, '  Ri\u0007ze  '), email: 'x@y.z' }, ['ace', 'kuma']);
  assert.equal(c.tier, 1); assert.equal(c.callsign, 'Rize'); assert.equal(c.squad.length, 2);
  assert.deepEqual(Object.keys(c.squad[0]).sort(), ['attack', 'defense', 'deployment', 'holobotId', 'intelligence', 'level', 'maxHealth', 'maxStamina', 'moves', 'speed', 'staminaRegen']);
  assert.ok(!JSON.stringify(c).includes('x@y.z'));
  assert.match(P.candidateFromProfile('u2', { ...pilot(0, ''), username: undefined }, ['ace']).callsign, /^Pilot \d{4}$/);
  assert.equal(P.candidateFromProfile('u3', pilot(0, 'Z'), []), null);
  assert.equal(P.candidateFromProfile('u4', { ...pilot(0, 'Z'), rivalWins: -1 }, ['ace']), null);
  assert.equal(P.candidateFromProfile('u5', pilot(0, 'x'.repeat(40)), ['ace']).callsign.length, P.PVP_CALLSIGN_MAX);
});

test('daily refresh boundary is 00:00 UTC; the countdown points at it', () => {
  const doc = P.buildPvpDaily('me', 0, [], T0);
  assert.equal(doc.day, '2026-11-04');
  assert.equal(P.pvpDailyNeedsRefresh(doc, Date.UTC(2026, 10, 4, 23, 59, 59, 999)), false);
  assert.equal(P.pvpDailyNeedsRefresh(doc, Date.UTC(2026, 10, 5, 0, 0, 0)), true);
  assert.equal(P.pvpDailyNeedsRefresh(null, T0), true);
  const view = P.pvpDailyView(doc, T0);
  assert.equal(view.refreshesAtMs, Date.UTC(2026, 10, 5)); assert.equal(view.energyCost, P.PVP_ENERGY_COST); assert.equal(view.attemptsPerOpponent, 1);
  assert.ok(!JSON.stringify(view).includes('sourceUid'));
});

test('attempts: one per opponent per day; stale list refuses; unknown opponent refuses', () => {
  const doc = P.buildPvpDaily('me', 1, [cand('a', 1)], T0);
  const r = P.pvpIssue(doc, 'po_20261104_0', 'rb_1', T0);
  assert.equal(r.opponent.attemptsUsed, 1); assert.equal(r.opponent.battleId, 'rb_1');
  assert.equal(r.lineup.opponentPilot.pilotId, 'pvp_po_20261104_0'); assert.equal(r.lineup.opponentPilot.displayName, 'a');
  assert.throws(() => P.pvpIssue(r.doc, 'po_20261104_0', 'rb_2', T0 + 1), /no_attempts_left/);
  assert.equal(P.pvpIssue(r.doc, 'po_20261104_1', 'rb_3', T0 + 2).opponent.attemptsUsed, 1);
  assert.throws(() => P.pvpIssue(r.doc, 'po_20261104_1', 'rb_4', T0 + DAY), /list_expired/);
  assert.throws(() => P.pvpIssue(doc, 'po_20261104_9', 'rb_5', T0), /unknown_opponent/);
  const v = P.pvpDailyView(r.doc, T0, {});
  assert.deepEqual(v.opponents.map(o => [o.attemptsLeft, o.result]), [[0, 'in_progress'], [1, null], [1, null]]);
  assert.deepEqual(P.pvpDailyView(r.doc, T0, { rb_1: true }).opponents[0].result, 'won');
});

test('frozen snapshot: the issued lineup is the list-time squad, not a copy that follows later edits', () => {
  const c = cand('a', 1);
  const doc = P.buildPvpDaily('me', 1, [c], T0);
  c.squad[0].attack = 9999; c.squad[0].level = 99;
  const r = P.pvpIssue(doc, 'po_20261104_0', 'rb_1', T0);
  assert.equal(r.lineup.opponentSquad[0].attack, 10); assert.equal(r.lineup.opponentSquad[0].level, 3);
  r.lineup.opponentSquad[0].attack = 1;
  assert.equal(doc.opponents[0].squad[0].attack, 10);
});

test('Holos-only settle for pvp_async: no rivalWins, Buddy Unit, repair kit or XP; duplicate settle is a no-op', () => {
  const p = { buddyUnits: light(0), rivalWins: 9, holobots: bots(), holosTokens: 0 };
  const i = L.issueRivalBattle(p, T0 - L.RIVAL_MIN_WIN_MS, 'rb_pvp', () => 0.3, ['ace']);
  i.battle.source = L.PVP_ASYNC_SOURCE;
  const s = L.settleRivalBattle(p, i.battle, 'rb_pvp', true, T0, ['ace'], ['ace']);
  assert.deepEqual(Object.keys(s.userUpdates).sort(), ['holosTokens']);
  assert.equal(s.userUpdates.holosTokens, L.BATTLE_WIN_HOLOS);
  assert.equal(s.reply.buddyUnitsGranted, 0); assert.equal(s.reply.tierAfter, s.reply.tierBefore); assert.deepEqual(s.reply.progression, []);
  assert.equal(s.reply.holosGranted, L.BATTLE_WIN_HOLOS);
  Object.assign(p, s.userUpdates);
  const again = L.settleRivalBattle(p, { ...i.battle, ...s.battleUpdates }, 'rb_pvp', true, T0 + 5);
  assert.equal(again.reply.alreadyProcessed, true); assert.equal(again.battleUpdates, null); assert.equal(again.reply.holosGranted, L.BATTLE_WIN_HOLOS);
  // a loss pays the rival loss Holos; still nothing else
  const j = L.issueRivalBattle(p, T0 - L.RIVAL_MIN_WIN_MS, 'rb_pvp2', () => 0.3, ['ace']); j.battle.source = L.PVP_ASYNC_SOURCE;
  const loss = L.settleRivalBattle(p, j.battle, 'rb_pvp2', false, T0);
  assert.deepEqual(loss.userUpdates, { holosTokens: L.BATTLE_WIN_HOLOS + L.BATTLE_LOSS_HOLOS });
  // the same battle WITHOUT the source still pays the full rival ruling (no regression)
  const k = L.issueRivalBattle({ ...p }, T0 - L.RIVAL_MIN_WIN_MS, 'rb_r', () => 0.3, ['ace']);
  assert.equal(L.settleRivalBattle({ ...p }, k.battle, 'rb_r', true, T0).userUpdates.rivalWins, 10);
});

test('store: list builds once per UTC day from near-rank pilots, never lists the caller, and keeps spent attempts', async () => {
  const db = world();
  const a = await transactPvpDaily(db, 'me', { operation: 'list' }, T0);
  assert.equal(a.opponents.length, 3);
  const names = a.opponents.map(o => o.callsign);
  assert.ok(names.includes('Nyx') && names.includes('Bolt') && names.includes('Far Kite'), names.join());
  assert.ok(!names.includes('Me') && !names.includes('Legend'));
  assert.ok(!JSON.stringify(a).match(/near1|near2|wide1|sourceUid/));
  // same day: same list even after the pool changes
  db.rows.set('users/near3', pilot(20, 'Late'));
  assert.deepEqual((await transactPvpDaily(db, 'me', { operation: 'list' }, T0 + 3600000)).opponents.map(o => o.callsign), names);
  // next UTC day: rebuilt (attempts reset)
  const b = await transactPvpDaily(db, 'me', { operation: 'list' }, T0 + DAY);
  assert.equal(b.day, '2026-11-05'); assert.ok(b.opponents.every(o => o.attemptsLeft === 1));
});

test('store: issue binds the frozen squad as an AI rival with source pvp_async; rival settle pays Holos only; attempts and replay', async () => {
  const db = world();
  const list = await transactPvpDaily(db, 'me', { operation: 'list' }, T0);
  const target = list.opponents.find(o => o.callsign === 'Nyx');
  db.rows.set('users/near1', { ...pilot(15, 'Nyx', 40) }); // the opponent levels up after the list: the snapshot is frozen
  const issued = await transactPvpDaily(db, 'me', { operation: 'issue', opponentId: target.opponentId }, T0);
  assert.equal(issued.pvp.source, 'pvp_async'); assert.equal(issued.pvp.callsign, 'Nyx');
  assert.equal(issued.encounter.opponentPilot.displayName, 'Nyx');
  assert.deepEqual(issued.encounter.opponentSquad.map(c => [c.holobotId, c.level]), target.squad.map(s => [s.holobotId, s.level]));
  assert.ok(issued.encounter.opponentSquad.every(c => c.level < 40));
  const record = db.rows.get(`rivalBattles/me/battles/${issued.battleId}`);
  assert.equal(record.source, 'pvp_async'); assert.equal(record.pvp.opponentId, target.opponentId);
  assert.equal(record.lineup.opponentPilot.pilotId, `pvp_${target.opponentId}`);
  await assert.rejects(transactPvpDaily(db, 'me', { operation: 'issue', opponentId: target.opponentId }, T0 + 1), /no_attempts_left/);
  const after = await transactPvpDaily(db, 'me', { operation: 'list' }, T0 + 2);
  assert.deepEqual(after.opponents.find(o => o.opponentId === target.opponentId).attemptsLeft, 0);
  assert.equal(after.opponents.find(o => o.opponentId === target.opponentId).result, 'in_progress');
  // settle through the ordinary rival path (legacy mode: the alpha default)
  const before = db.rows.get('users/me');
  const settle = { schemaVersion: 'rival-battle-3', operation: 'settle', battleId: issued.battleId, didWin: true, fielded: ['ace'] };
  const s = await transactRivalBattle(db, 'me', settle, T0 + L.RIVAL_MIN_WIN_MS, undefined, { issueLegacy: true, allowLegacySettlement: true });
  assert.equal(s.holosGranted, L.BATTLE_WIN_HOLOS); assert.equal(s.buddyUnitsGranted, 0);
  const me = db.rows.get('users/me');
  assert.equal(me.rivalWins, before.rivalWins); assert.equal(me.pilotRank, before.pilotRank); assert.deepEqual(me.buddyUnits, before.buddyUnits);
  assert.deepEqual(me.holobots, before.holobots);
  assert.equal(me.holosTokens, (before.holosTokens ?? 0) + L.BATTLE_WIN_HOLOS);
  const dup = await transactRivalBattle(db, 'me', settle, T0 + L.RIVAL_MIN_WIN_MS + 9, undefined, { issueLegacy: true, allowLegacySettlement: true });
  assert.equal(dup.alreadyProcessed, true); assert.equal(db.rows.get('users/me').holosTokens, me.holosTokens);
  assert.equal((await transactPvpDaily(db, 'me', { operation: 'list' }, T0 + L.RIVAL_MIN_WIN_MS + 10)).opponents.find(o => o.opponentId === target.opponentId).result, 'won');
  // an ordinary rival issue is untouched by the pvp path
  const rival = await transactRivalBattle(db, 'me', { schemaVersion: 'rival-battle-3', operation: 'issue', healthSchema: 'rival-health-1' }, T0 + DAY, undefined, { issueLegacy: true });
  assert.equal(db.rows.get(`rivalBattles/me/battles/${rival.battleId}`).source, undefined);
  assert.match(rival.encounter.opponentPilot.pilotId, /^rival_tier_/);
});

test('store: a stale list refuses issue (list_expired) instead of spending a new day on an old list', async () => {
  const db = world();
  const list = await transactPvpDaily(db, 'me', { operation: 'list' }, T0);
  await assert.rejects(transactPvpDaily(db, 'me', { operation: 'issue', opponentId: list.opponents[0].opponentId }, T0 + DAY), /list_expired/);
  await assert.rejects(transactPvpDaily(db, 'nobody', { operation: 'list' }, T0), /unavailable/);
  await assert.rejects(transactPvpDaily(db, 'nobody', { operation: 'issue', opponentId: 'po_20261104_0' }, T0), /unavailable|list_expired/);
});
