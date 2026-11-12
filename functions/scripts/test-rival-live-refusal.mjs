// rival-live-only (Pak 2026-11-11): a live-only client (duel-inputs-2 + fightRules duel-rules-6, no duelSchema) that the host cannot
// give an input-log duel is refused with `live_unavailable` and NOTHING is written (no battle / match, no open-ledger slot, no fee,
// no vitals snapshot), so the retry is never blocked by too_many_open. Every other request shape behaves as before.
// In-memory Firestore double (no emulator), on the rival host and the Arena host.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
const require = createRequire(import.meta.url);
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const A = require('../lib/arena/arenaMatchStore.js');
const P = require('../lib/lib/progression.js');

const now = Date.UTC(2026, 10, 11, 12), random = () => 0.4, SEED = '3e'.repeat(32);
const LIVE_ONLY = { duelInputs: 'duel-inputs-2', fightRules: 'duel-rules-6' };
const OFF = { fightReplay: false, issueLegacy: true, allowLegacySettlement: true, fightSeed: () => SEED };
const OFF_RESOLVER_ENV = { ...OFF, issueLegacy: false };
const ON = { fightReplay: true, fightChase: true, fightAttrs: true, issueLegacy: false, allowLegacySettlement: false, fightSeed: () => SEED };
const dump = db => JSON.stringify([...db.docs.entries()].map(([k, v]) => [k, v.data]).sort(([a], [b]) => a < b ? -1 : 1));
const isCode = (code, reason) => e => { assert.equal(e.code, code); if (reason) assert.equal(e.detail?.reason ?? e.reason, reason); return true; };

let serial = 0;
function rivalWorld() {
  const db = fakeDb({ now }), uid = `rlr${serial++}`;
  db.put(`users/${uid}`, { holobots: [{ name: 'ACE', level: 20, experience: 0, nextLevelExp: 400, attributePoints: 0 }], holosTokens: 0,
    buddyUnits: { light: 0, medium: 0, heavy: 0 }, travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] } });
  const issue = (extra, options) => transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', operation: 'issue', ...extra }, now, random, options);
  const open = () => Object.keys(db.read(`rivalBattles/${uid}`)?.openBattles ?? {}).length;
  const battles = () => [...db.docs.keys()].filter(k => k.startsWith(`rivalBattles/${uid}/battles/`));
  return { db, uid, issue, open, battles };
}

test('rival: live-only opt-in with the replay flag off refuses live_unavailable and writes nothing; the retry is not blocked', async () => {
  for (const options of [OFF, OFF_RESOLVER_ENV]) {
    const w = rivalWorld(), before = dump(w.db);
    await assert.rejects(w.issue(LIVE_ONLY, options), isCode('live_unavailable', 'replay_off'));
    assert.equal(dump(w.db), before, 'no battle, no ledger, no user write (vitals, cooldown, rank)');
    assert.equal(w.open(), 0); assert.deepEqual(w.battles(), []);
    // the immediate retry refuses the same way (never too_many_open) ...
    await assert.rejects(w.issue(LIVE_ONLY, options), isCode('live_unavailable'));
    assert.equal(dump(w.db), before);
    // ... and once the server can issue live, the same request opens a live duel at once (no orphan holds the slot)
    const live = await w.issue(LIVE_ONLY, ON);
    assert.equal(live.duel.mode, 'input-log'); assert.equal(w.open(), 1);
  }
});

test('rival: the story / citizen variants of the live-only issue refuse the same way with the flag off', async () => {
  const w = rivalWorld(), before = dump(w.db);
  await assert.rejects(w.issue({ ...LIVE_ONLY, storySchema: 'zell-story-1', rivalId: 'zell' }, { ...OFF, zellEnabled: true }), isCode('live_unavailable', 'replay_off'));
  await assert.rejects(w.issue({ ...LIVE_ONLY, storySchema: 'zell-story-1' }, OFF), isCode('live_unavailable', 'replay_off'));
  assert.equal(dump(w.db), before);
});

test('rival: requests without the live-only opt-in behave as before with the flag off (fallback, battle opened)', async () => {
  const cases = [
    [{}, OFF, 'legacy'],
    [{ duelInputs: 'duel-inputs-2' }, OFF, 'legacy'], // Unity FightFlow / pvp-daily shape: duelInputs alone
    [{ fightRules: 'duel-rules-6' }, OFF, 'legacy'],
    [{ duelSchema: 'duel-receipt-1' }, OFF_RESOLVER_ENV, 'resolver'],
    [{ ...LIVE_ONLY, duelSchema: 'duel-receipt-1' }, OFF_RESOLVER_ENV, 'resolver'], // older Lite / Arena-style fallback opt-in
    [{ ...LIVE_ONLY, duelSchema: 'duel-receipt-1' }, OFF, 'legacy'],
  ];
  for (const [extra, options, mode] of cases) {
    const w = rivalWorld(), r = await w.issue(extra, options);
    assert.equal(r.duel.mode, mode, JSON.stringify(extra));
    assert.equal(w.battles().length, 1); assert.equal(w.open(), 1);
  }
});

test('rival: live-only opt-in with the flag on is unchanged (input-log, duel-rules-6, one open battle)', async () => {
  const w = rivalWorld(), r = await w.issue(LIVE_ONLY, ON);
  assert.equal(r.duel.mode, 'input-log'); assert.match(r.duel.rulesId, /^duel-rules-6:rb_/); assert.equal(r.duel.seed, SEED);
  assert.equal(w.battles().length, 1); assert.equal(w.open(), 1);
  assert.deepEqual(w.db.read(w.battles()[0]).duel, r.duel);
  // a second issue while it is open is still too_many_open (health on), as before
  await assert.rejects(w.issue(LIVE_ONLY, ON), isCode('too_many_open'));
});

// ---------------------------------------------------------------- Arena
const threshold = l => P.calculateExperience(l + 1);
function arenaWorld() {
  const db = fakeDb({ now }), uid = `alr${serial++}`;
  db.put(`users/${uid}`, { holobots: [{ name: 'ACE', level: 21, experience: 0, nextLevelExp: threshold(21), attributePoints: 0, boostedAttributes: {} }], arenaPassses: 5, holosTokens: 1000, syncPoints: 0, wins: 0, losses: 0,
    buddyUnits: { light: 0, medium: 0, heavy: 0 }, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false } });
  const issue = (extra, options, requestId = `req_lr_${serial++}`) => A.transactArenaMatch(db, uid, { schemaVersion: 'arena-match-1', operation: 'issue', requestId, tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE', ...extra }, now, options);
  const arenaDocs = () => [...db.docs.keys()].filter(k => k.startsWith(`arenaMatches/${uid}`));
  return { db, uid, issue, arenaDocs, tokens: () => db.read(`users/${uid}`).holosTokens };
}
const A_OFF = { arenaFightReplay: false, fightChase: true, fightAttrs: true, fightSeed: () => SEED };
const A_ON = { ...A_OFF, arenaFightReplay: true };

test('arena: live-only opt-in with the flag off refuses live_unavailable before the fee; nothing is written; the same requestId works later', async () => {
  const w = arenaWorld(), before = dump(w.db);
  await assert.rejects(w.issue(LIVE_ONLY, A_OFF, 'req_lr_same'), isCode('live_unavailable', 'replay_off'));
  assert.equal(dump(w.db), before, 'no fee, no match, no request row, no lease');
  assert.equal(w.tokens(), 1000); assert.deepEqual(w.arenaDocs(), []);
  const live = await w.issue(LIVE_ONLY, A_ON, 'req_lr_same');
  assert.equal(live.duel.mode, 'input-log');
  assert.ok(w.tokens() < 1000, 'the live issue charges the fee as before');
});

test('arena: requests without the live-only opt-in, and the flag-on live issue, are unchanged', async () => {
  const cases = [
    [{}, A_OFF, undefined],
    [{ duelInputs: 'duel-inputs-2' }, A_OFF, undefined],
    [{ duelSchema: 'duel-receipt-1' }, A_OFF, 'resolver'],
    [{ ...LIVE_ONLY, duelSchema: 'duel-receipt-1' }, A_OFF, 'resolver'], // the Arena phone contract: keeps duelSchema as the fallback
    [LIVE_ONLY, A_ON, 'input-log'],
    [{ ...LIVE_ONLY, duelSchema: 'duel-receipt-1' }, A_ON, 'input-log'],
  ];
  for (const [extra, options, mode] of cases) {
    const w = arenaWorld(), r = await w.issue(extra, options);
    assert.equal(r.duel?.mode, mode, JSON.stringify(extra));
    assert.ok(w.tokens() < 1000, 'fee charged at issue'); assert.ok(w.arenaDocs().length > 0);
  }
});
