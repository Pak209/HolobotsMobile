// server-rulings-1 (Pak 2026-11-09): the four rulings on the rival input-log fight, without the emulator (in-memory Firestore).
//  1 parts count on an input-log issue; HP goes back as a fraction of max (and the ATTRS bench-bot settle bug)
//  2 duel-rules-6 (tempo block) only on the client's ask; light wind-up / chained lights / recovery cancels; old versions golden
//  3 forfeit; a replay_mismatch closes the battle; input-log too_fast carries retryAfterMs
//  4 the plausibility flag (fires on synthetic machine-perfect logs, never on brain logs; never withholds)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
import { F, recordFightLog, smartPlayer, verifyFightReplay, clone } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const { transactRivalBattle: host, FIGHT_PLAUSIBILITY_COLLECTION } = require('../lib/rival/rivalBattleStore.js');
const { buildFightReplayIssue, TEMPO_RULE_OVERRIDES, inputLogCombatant } = require('../lib/rival/fightReplayIssue.js');
const Parts = require('../lib/lib/partStats.js');
const { buildPlayerCombatants } = require('../lib/lib/rivalLadder.js');
const { ledgerHealthAfterFight } = require('../lib/lib/partStats.js');
const { settleVitals } = require('../lib/lib/rivalHealth.js');

const now = Date.UTC(2026, 10, 9, 12), later = now + 25_000, seed = () => 0.4;
const ON = { fightReplay: true, issueLegacy: false, allowLegacySettlement: false };
const ATTRS = { ...ON, fightChase: true, fightAttrs: true };
const base = { schemaVersion: 'rival-battle-3' };
let serial = 0;
const bot = (name, level) => ({ name, level, experience: 0, nextLevelExp: 400, attributePoints: 0 });
// Every world pins the input-log fight seed (options.fightSeed, a test-only seam; production draws randomBytes(32)), so a test that
// needs the player to WIN never depends on a lucky draw. The pinned seeds were checked to give each such test its win.
const PINNED_SEED = process.env.RULINGS_SEED || '3e'.repeat(32);
function world({ level = 99, squad = ['ace'], fightSeed = PINNED_SEED, ...extra } = {}) {
  const db = fakeDb({ now }), uid = `u${serial++}`;
  db.put(`users/${uid}`, { holobots: squad.map(id => bot(id.toUpperCase(), level)), holosTokens: 0, buddyUnits: { light: 0, medium: 0, heavy: 0 },
    travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: squad }, ...extra });
  const call = (c, time = now, options = ON) => host(db, uid, { ...base, ...c }, time, seed, { ...options, fightSeed: () => fightSeed });
  return { db, uid, call, user: () => db.read(`users/${uid}`), record: id => db.read(`rivalBattles/${uid}/battles/${id}`), ledger: () => db.read(`rivalBattles/${uid}`) };
}
const issueLog = (w, options = ON, extra = {}) => w.call({ operation: 'issue', duelInputs: 'duel-inputs-2', ...extra }, now, options);
const winLog = duel => recordFightLog(duel, smartPlayer(duel, 'ace', 'Legendary')).wire;
const epic = slot => ({ id: 'p_' + slot, name: 'Test ' + slot, rarity: 'Epic', slot });

// ---------------------------------------------------------------- ruling 1

test('ruling 1: equipped parts reach the input-log fighter exactly as the resolver applies them; the ledger stays on the bot\'s scale', async () => {
  const flags = { arenaGatheringSeen: true, tournamentsWon: 2, arenaArcBuilt: false, holoZonesArcBuilt: false };
  for (const options of [ON, ATTRS]) {
    // fresh worlds per rules version (forfeit-is-loss: a forfeit now starts the per-rival cooldown, so a world cannot reissue at once)
    const bare = world({ storyFlags: flags }), geared = world({ storyFlags: flags, equippedParts: { ACE: { arms: epic('arms'), core: epic('core'), legs: epic('legs') } } });
    const a = await issueLog(bare, options), b = await issueLog(geared, options);
    const fa = a.duel.rules.fighters[0], fb = b.duel.rules.fighters[0];
    assert.equal(fb.attack, fa.attack + 8 + 2, 'arms +8 ATK, legs +2 ATK');
    assert.equal(fb.maxHp, fa.maxHp + 80, 'core +80 HP');
    assert.equal(fb.hp, fb.maxHp, 'a full bot starts full');
    if (options === ATTRS) assert.equal(fb.speed, fa.speed + 2 + 1, 'arms +2 SPD, legs +1 SPD on duel-rules-5');
    assert.deepEqual(geared.record(b.battleId).issuedVitals, bare.record(a.battleId).issuedVitals, 'issued on the Holobot\'s own max');
    assert.deepEqual(b.playerCombatants, a.playerCombatants, 'the presentation squad is untouched (as the resolver)');
  }
});

test('Pak 2026-11-10: parts\' SPECIAL feeds the fighter\'s special on a duel-rules-6 issue only; duel-rules-5 issues the pre-SPECIAL bytes', async () => {
  const flags = { arenaGatheringSeen: true, tournamentsWon: 2, arenaArcBuilt: false, holoZonesArcBuilt: false };
  const headOnly = { ACE: { head: epic('head') } };   // Epic head: SPECIAL +8, DEF +2
  const bare = world({ storyFlags: flags }), geared = world({ storyFlags: flags, equippedParts: headOnly });
  const six = { fightRules: 'duel-rules-6' };
  const a6 = await issueLog(bare, ATTRS, six), b6 = await issueLog(geared, ATTRS, six);
  assert.match(b6.duel.rulesId, /^duel-rules-6:/);
  const f6a = a6.duel.rules.fighters[0], f6b = b6.duel.rules.fighters[0];
  assert.equal(f6b.special, f6a.special + 8, 'rules-6: SPECIAL +8'); assert.equal(f6b.defense, f6a.defense + 2);
  // fresh worlds (forfeit-is-loss: a forfeit starts the per-rival cooldown, so the same world cannot reissue at once)
  const bare5 = world({ storyFlags: flags }), geared5 = world({ storyFlags: flags, equippedParts: headOnly });
  const a5 = await issueLog(bare5, ATTRS), b5 = await issueLog(geared5, ATTRS);
  assert.match(b5.duel.rulesId, /^duel-rules-5:/);
  const f5a = a5.duel.rules.fighters[0], f5b = b5.duel.rules.fighters[0];
  assert.equal(f5b.special, f5a.special, 'rules-5: SPECIAL untouched');
  // the whole rules-5 document is the bare one with only the DEF the resolver also applies (no SPECIAL anywhere)
  const expect = clone(a5.duel.rules); expect.fighters[0].defense += 2;
  assert.deepEqual(b5.duel.rules, expect);
  const plain = Parts.applyPartBoosts({ maxHealth: 100, attack: 1, defense: 1, intelligence: 7 }, { ...Parts.EMPTY_PART_BOOSTS, defense: 2, special: 8 });
  assert.deepEqual(inputLogCombatant({ maxHealth: 100, attack: 1, defense: 1, intelligence: 7 }, { ...Parts.EMPTY_PART_BOOSTS, defense: 2, special: 8 }, false), plain, 'non-tempo = applyPartBoosts exactly');
  assert.equal(inputLogCombatant({ maxHealth: 100, attack: 1, defense: 1, intelligence: 7 }, { ...Parts.EMPTY_PART_BOOSTS, defense: 2, special: 8 }, true).intelligence, 15);
});

test('golden: duel-rules-6 with a Special-bearing part (pinned case) issues and replays byte for byte', () => {
  const g = JSON.parse(readFileSync(new URL('./fixtures/server-rulings-1-golden-rules6.json', import.meta.url)));
  const comb = (id, src) => ({ ...buildPlayerCombatants({ holobots: [bot(id.toUpperCase(), g.input.level)] }, [id])[0], ...(src ? { statSource: 'progression' } : {}) });
  const boosts = Object.entries(g.input.parts).reduce((t, [slot, p]) => { const b = Parts.partBoostsFor(slot, p); for (const k of Object.keys(t)) t[k] += b[k]; return t; }, { ...Parts.EMPTY_PART_BOOSTS });
  assert.deepEqual(boosts, g.boosts); assert.ok(boosts.special > 0);
  const { level, player, opponent, parts, ...input } = g.input;
  const issue = buildFightReplayIssue({ ...input, player: player.map(id => inputLogCombatant(comb(id), boosts, true)), opponent: opponent.map(id => comb(id, true)) });
  assert.deepEqual(issue, g.issue);
  const bareSpecial = buildFightReplayIssue({ ...input, player: player.map(id => comb(id)), opponent: opponent.map(id => comb(id, true)) }).rules.fighters[0].special;
  assert.equal(issue.rules.fighters[0].special, bareSpecial + boosts.special);
  const log = recordFightLog(issue, smartPlayer(issue, player[0], 'Legendary')).wire;
  assert.deepEqual(verifyFightReplay(issue, log, { battleId: input.battleId }).receipt, g.receipt);
});

test('ruling 1: the input-log settle writes HP as the same fraction of max (part HP is a fight-time layer)', async () => {
  const w = world({ storyFlags: { arenaGatheringSeen: true, tournamentsWon: 2, arenaArcBuilt: false, holoZonesArcBuilt: false }, equippedParts: { ACE: { core: epic('core') } } });
  const issue = await issueLog(w);
  const log = winLog(issue.duel), expected = verifyFightReplay(issue.duel, log, { battleId: issue.battleId }).receipt;
  assert.equal(expected.winner, 'player');
  const ace = expected.playerFinal[0], issued = w.record(issue.battleId).issuedVitals.ace;
  assert.ok(ace.maxHealth > issued.maxHealth, 'the fight max carries the part HP');
  await w.call({ operation: 'settle', battleId: issue.battleId, inputLog: log }, later);
  const hp = w.user().holobotVitals.ace.currentHealth;
  assert.equal(hp, ledgerHealthAfterFight(ace.currentHealth, ace.maxHealth, issued));
  assert.ok(Math.abs(hp / issued.maxHealth - ace.currentHealth / ace.maxHealth) <= 1 / issued.maxHealth + 1e-9, 'same fraction of max');
});

test('reported bug (ATTRS on): a bench bot with a positive fight-HP bonus that never enters no longer breaks the winning settle', async () => {
  const w = world({ squad: ['ace', 'kurai'] });
  const issue = await issueLog(w, ATTRS);
  assert.match(issue.duel.rulesId, /^duel-rules-5:/);
  const rec = w.record(issue.battleId), kurai = issue.duel.rules.fighters.find(f => f.id === 'kurai');
  assert.ok(kurai.maxHp > rec.issuedVitals.kurai.maxHealth, `the #72.80 row lifts KURAI's fight max (${kurai.maxHp} > ${rec.issuedVitals.kurai.maxHealth})`);
  const log = winLog(issue.duel), expected = verifyFightReplay(issue.duel, log, { battleId: issue.battleId }).receipt;
  assert.equal(expected.winner, 'player');
  const bench = expected.playerFinal.find(f => f.holobotId === 'kurai');
  assert.equal(bench.fielded, false, 'KURAI never entered');
  // the pre-fix write: the raw receipt HP (fight units) is above the issued ledger HP and settleVitals refuses it
  assert.throws(() => settleVitals(w.user(), rec.issuedVitals, expected.playerFinal.map(f => ({ holobotId: f.holobotId, currentHealth: f.currentHealth }))), /invalid_request/);
  const r = await w.call({ operation: 'settle', battleId: issue.battleId, inputLog: log }, later, ATTRS);
  assert.equal(r.didWin, true); assert.equal(r.holosGranted, 100);
  assert.ok(w.record(issue.battleId).settlement, 'settled'); assert.deepEqual(w.ledger().openBattles, {});
  const v = w.user().holobotVitals;
  assert.deepEqual(v.kurai, rec.issuedVitals.kurai, 'the bench bot\'s ledger row is untouched');
  const ace = expected.playerFinal[0];
  assert.equal(v.ace.currentHealth, ledgerHealthAfterFight(ace.currentHealth, ace.maxHealth, rec.issuedVitals.ace));
  assert.ok(v.ace.currentHealth <= rec.issuedVitals.ace.currentHealth);
  const next = await w.call({ operation: 'issue', duelInputs: 'duel-inputs-2' }, later + 6 * 60_000, ATTRS);
  assert.equal(next.duel.mode, 'input-log', 'the next issue (past the per-rival cooldown) is not refused too_many_open');
});

// ---------------------------------------------------------------- ruling 3

test('ruling 3 + forfeit-is-loss: forfeit = an immediate no-pay loss that closes the battle and starts the per-rival cooldown', async () => {
  const w = world();
  const issue = await issueLog(w);
  const pilotId = w.record(issue.battleId).lineup.opponentPilot.pilotId;
  const before = w.user();
  const r = await w.call({ operation: 'forfeit', battleId: issue.battleId }, now + 1000);
  assert.deepEqual([r.didWin, r.holosGranted, r.buddyUnitsGranted, r.alreadyProcessed, r.closedBy, r.progression.length], [false, 0, 0, false, 'forfeit', 0]);
  const after = w.user();
  for (const k of ['holosTokens', 'holobots', 'holobotVitals', 'rivalWins', 'pilotRank', 'buddyUnits']) assert.deepEqual(after[k], before[k], k);
  assert.equal(w.record(issue.battleId).settlement.closedBy, 'forfeit');
  assert.deepEqual(w.ledger().openBattles, {}); assert.deepEqual(w.ledger().rivalLastSettledAtMs, { [pilotId]: now + 1000 }, 'the per-rival cooldown starts, as for a lost settle');
  const closed = JSON.stringify([w.user(), w.ledger(), w.record(issue.battleId)]);
  const again = await w.call({ operation: 'forfeit', battleId: issue.battleId }, now + 2000);
  assert.deepEqual([again.alreadyProcessed, again.closedBy, again.holosGranted], [true, 'forfeit', 0]);
  const late = await w.call({ operation: 'settle', battleId: issue.battleId, inputLog: winLog(issue.duel) }, later);
  assert.deepEqual([late.alreadyProcessed, late.didWin], [true, false], 'a later winning log cannot reopen it');
  assert.equal(JSON.stringify([w.user(), w.ledger(), w.record(issue.battleId)]), closed, 'repeats write nothing: no second loss, the cooldown does not move');
  await assert.rejects(() => w.call({ operation: 'issue', duelInputs: 'duel-inputs-2' }, now + 2000), e => e.code === 'rival_cooldown' && e.retryAfterMs === 5 * 60_000 - 1000);
  const next = await w.call({ operation: 'issue', duelInputs: 'duel-inputs-2' }, now + 1000 + 5 * 60_000);
  assert.equal(next.duel.mode, 'input-log', 'same rival pilot (fixed draws), issued once the cooldown is over');
});

test('ruling 3: forfeit shape and scope: rival-battle-3 + battleId; only an input-log battle; unknown / expired refused', async () => {
  const w = world();
  await assert.rejects(() => w.call({ operation: 'forfeit' }), /invalid_request/);
  await assert.rejects(() => w.call({ operation: 'forfeit', battleId: 'rb_x', schemaVersion: 'rival-battle-2' }), /invalid_request/);
  await assert.rejects(() => w.call({ operation: 'forfeit', battleId: 'rb_nope' }), /unknown_battle/);
  const resolver = await w.call({ operation: 'issue', duelSchema: 'duel-receipt-1' });
  assert.equal(resolver.duel.mode, 'resolver');
  await assert.rejects(() => w.call({ operation: 'forfeit', battleId: resolver.battleId }), /invalid_request/);
  const w2 = world(), i2 = await issueLog(w2);
  await assert.rejects(() => w2.call({ operation: 'forfeit', battleId: i2.battleId }, now + 3 * 3600_000), /battle_expired/);
});

test('ruling 3: a replay_mismatch settle closes the battle as a no-pay loss, then reports the mismatch as before', async () => {
  const w = world();
  const issue = await issueLog(w);
  const log = F.parseInputLog(winLog(issue.duel));
  for (let t = 0; t < log.tickCount; t++) log.sides[0].ticks[t] = { ...log.sides[0].ticks[t], moveX: -127, moveZ: 0 };
  const before = w.user();
  await assert.rejects(() => w.call({ operation: 'settle', battleId: issue.battleId, inputLog: F.inputLogToWire(log) }, later),
    e => e.code === 'replay_mismatch' && e.detail.reason === 'hash' && e.detail.window === 0);
  const b = w.record(issue.battleId);
  assert.deepEqual([b.settlement.didWin, b.settlement.holosGranted, b.settlement.closedBy], [false, 0, 'replay_mismatch']);
  assert.equal(b.fightReceipt, undefined);
  assert.deepEqual(w.ledger().openBattles, {});
  for (const k of ['holosTokens', 'holobots', 'holobotVitals', 'rivalWins']) assert.deepEqual(w.user()[k], before[k], k);
  const pilotId = b.lineup.opponentPilot.pilotId;
  assert.deepEqual(w.ledger().rivalLastSettledAtMs, { [pilotId]: later }, 'forfeit-is-loss: the per-rival cooldown starts');
  const ok = await w.call({ operation: 'settle', battleId: issue.battleId, inputLog: winLog(issue.duel) }, later + 1);
  assert.deepEqual([ok.alreadyProcessed, ok.didWin, ok.closedBy], [true, false, 'replay_mismatch']);
  assert.deepEqual(w.ledger().rivalLastSettledAtMs, { [pilotId]: later }, 'a resend does not move it');
  await assert.rejects(() => w.call({ operation: 'issue', duelInputs: 'duel-inputs-2' }, later + 2), /rival_cooldown/);
  assert.equal((await w.call({ operation: 'issue', duelInputs: 'duel-inputs-2' }, later + 5 * 60_000)).duel.mode, 'input-log', 'a new issue works once the cooldown is over');
  // an undecodable log is NOT a mismatch: it stays retryable and the battle stays open
  const w2 = world(), i2 = await issueLog(w2), bad = clone(winLog(i2.duel)); bad.sides[0].stream = '!!!!';
  await assert.rejects(() => w2.call({ operation: 'settle', battleId: i2.battleId, inputLog: bad }, later), /invalid_request/);
  assert.equal(w2.record(i2.battleId).settlement, null);
});

test('ruling 3: an input-log win settled too soon is too_fast with retryAfterMs (nothing written), then settles', async () => {
  const w = world();
  const issue = await issueLog(w);
  const log = winLog(issue.duel);
  await assert.rejects(() => w.call({ operation: 'settle', battleId: issue.battleId, inputLog: log }, now + 5000),
    e => e.code === 'too_fast' && e.retryAfterMs === 15_000);
  assert.equal(w.record(issue.battleId).settlement, null);
  const r = await w.call({ operation: 'settle', battleId: issue.battleId, inputLog: log }, now + 20_000);
  assert.equal(r.didWin, true);
});

// ---------------------------------------------------------------- ruling 2

test('ruling 2: duel-rules-6 is issued only on the client\'s ask and only on top of duel-rules-5; a bad ask is refused', async () => {
  const w = world();
  const plain = await issueLog(w, ATTRS);
  assert.match(plain.duel.rulesId, /^duel-rules-5:/, 'no ask: today\'s issue');
  // a fresh world (forfeit-is-loss: a forfeit would start the per-rival cooldown against the same pilot)
  const w6 = world();
  const six = await issueLog(w6, ATTRS, { fightRules: 'duel-rules-6' });
  assert.match(six.duel.rulesId, /^duel-rules-6:/);
  const doc = F.rulesDocFromJson(six.duel.rules);
  assert.deepEqual(doc.tempo, F.defaultTempoRules());
  assert.equal(six.duel.rules.simVersion, 'duel-sim-5');
  assert.equal(doc.rules.hpScaleLights, TEMPO_RULE_OVERRIDES.hpScaleLights);
  assert.equal(F.rulesHash(doc.rules, doc.chase, doc.attrs, doc.tempo), six.duel.rulesHash);
  assert.equal(six.duel.simVersion, 'duel-sim-3', 'the wire envelope is unchanged');
  const log = winLog(six.duel);
  const r = await w6.call({ operation: 'settle', battleId: six.battleId, inputLog: log }, later, ATTRS);
  assert.equal(r.fightReceipt.rulesId, six.duel.rulesId);
  await assert.rejects(() => issueLog(world(), ATTRS, { fightRules: 'duel-rules-9' }), /invalid_request/);
  const noAttrs = await issueLog(world(), { ...ON, fightChase: true }, { fightRules: 'duel-rules-6' });
  assert.match(noAttrs.duel.rulesId, /^duel-rules-4:/, 'without the attrs flag the ask changes nothing');
});

test('ruling 2: a duel-rules-6 log never verifies against the duel-rules-5 issue of the same battle, nor the reverse', () => {
  const player = buildPlayerCombatants({ holobots: [bot('ACE', 20)] }, ['ace']), opponent = buildPlayerCombatants({ holobots: [bot('WOLF', 20)] }, ['wolf']);
  const mk = tempo => buildFightReplayIssue({ battleId: 'rb_v', seed: 'ab'.repeat(32), tier: 3, mentor: false, chase: true, attrs: true, tempo, player, opponent });
  const five = mk(false), six = mk(true);
  assert.throws(() => verifyFightReplay(five, winLog(six), { battleId: 'rb_v' }), e => e.code === 'replay_mismatch' && e.detail.field === 'rulesId');
  assert.throws(() => verifyFightReplay(six, winLog(five), { battleId: 'rb_v' }), e => e.code === 'replay_mismatch' && e.detail.field === 'rulesId');
  const tampered = clone(six); tampered.rules.tempo.lightTelegraphTicks = 15;
  assert.throws(() => verifyFightReplay(tampered, winLog(six), { battleId: 'rb_v' }), e => e.code === 'invalid_issue');
  assert.throws(() => F.rulesDocFromJson({ ...six.rules, simVersion: 'duel-sim-4' }), /invalid_version/);
  assert.throws(() => F.rulesDocFromJson({ ...six.rules, tempo: { ...six.rules.tempo, cancelStep: 2 } }), /invalid_tempo_rules/);
});

// scripted core: ACE vs WOLF 1400 mm apart (inside ACE's 1500 mm light), both SPEED 0 (no tempo cut, no evade)
const I = (o = {}) => ({ ...F.idleInput(), ...o });
function core(tempo, gap = 1400) {
  const r = F.defaultRules('ace', 'wolf', gap);
  for (const f of r.fighters) { f.speed = 0; f.special = 0; }
  return new F.FightCore(r, '11'.repeat(32), F.defaultChaseRules(), F.defaultAttrRules(), tempo ? F.defaultTempoRules() : null);
}
const run = (c, n, a = () => I(), b = () => I()) => { for (let k = 0; k < n && !c.ended; k++) c.step(a(c.tick + 1), b(c.tick + 1)); };
const evs = (c, kind, side = 0) => c.events.filter(e => e.kind === kind && e.side === side);

test('ruling 2: duel-rules-6 light wind-up is 6 ticks and a chained light is never slower; duel-rules-5 keeps 15 / 9', () => {
  for (const [tempo, opener, chained] of [[true, 6, 6], [false, 15, 9]]) {
    const c = core(tempo);
    run(c, 1, () => I({ press: F.Press.Light }));
    const t0 = evs(c, F.EventKind.Telegraph)[0];
    assert.equal(t0.value - t0.tick, opener, `opener (${tempo ? 6 : 5})`);
    // chain: press again the tick the recovery ends
    run(c, 60, t => (c.F[0].action === F.Action.Idle && evs(c, F.EventKind.Telegraph).length === 1 ? I({ press: F.Press.Light }) : I()));
    const t1 = evs(c, F.EventKind.Telegraph)[1];
    assert.ok(t1, 'second light');
    assert.equal(t1.value - t1.tick, chained, 'chained');
  }
});

test('ruling 2: Guard / Step cancel a recovery after a landed hit on duel-rules-6; a whiffed strike stays committed; duel-rules-5 never cancels', () => {
  for (const tempo of [true, false]) for (const how of ['guard', 'step']) {
    const c = core(tempo);
    run(c, 1, () => I({ press: F.Press.Light }));
    run(c, 30, () => I(), () => I());
    const hit = c.events.find(e => e.kind === F.EventKind.Contact && e.side === 0);
    assert.ok(hit && hit.outcome === F.Outcome.Hit, 'the light lands on the idle WOLF');
    // re-run to the tick after contact, then press
    const d = core(tempo);
    run(d, 1, () => I({ press: F.Press.Light }));
    run(d, hit.tick - d.tick);
    assert.equal(d.F[0].action, F.Action.Recovery);
    const t = d.tick + 1;
    d.step(how === 'guard' ? I({ guard: true }) : I({ press: F.Press.Step, stepX: -127, stepZ: 0 }), I());
    const cancelled = how === 'guard' ? d.F[0].guard === F.Guard.Raising : d.F[0].action === F.Action.Step;
    assert.equal(cancelled, tempo, `${how} cancel on ${tempo ? 'rules-6' : 'rules-5'} at tick ${t}`);
  }
  // a whiff (out of reach) leaves a punishable recovery that a guard does not cancel
  const w = core(true, 4000);
  run(w, 1, () => I({ press: F.Press.Light }));
  run(w, 40, () => I(), () => I({ moveX: 127 }));
  const whiff = w.events.find(e => e.kind === F.EventKind.Contact && e.side === 0);
  assert.ok(whiff && (whiff.outcome === F.Outcome.Whiffed || whiff.outcome === F.Outcome.Evaded), 'whiffed');
  const x = core(true, 4000);
  run(x, 1, () => I({ press: F.Press.Light }));
  run(x, whiff.tick - x.tick, () => I(), () => I({ moveX: 127 }));
  x.step(I({ guard: true }), I());
  assert.equal(x.F[0].action, F.Action.Recovery, 'still recovering'); assert.equal(x.F[0].guard, F.Guard.Down);
});

test('golden: duel-rules-3 / -4 / -5 issues and replays are byte-for-byte the pre-change build (HEAD fixture)', () => {
  const doc = JSON.parse(readFileSync(new URL('./fixtures/server-rulings-1-golden.json', import.meta.url)));
  assert.equal(doc.cases.length, 9);
  for (const c of doc.cases) {
    const comb = (id, src) => ({ ...buildPlayerCombatants({ holobots: [bot(id.toUpperCase(), c.input.level)] }, [id])[0], ...(src ? { statSource: 'progression' } : {}) });
    const issue = buildFightReplayIssue({ ...c.input, player: c.input.player.map(id => comb(id)), opponent: c.input.opponent.map(id => comb(id, true)) });
    assert.deepEqual(issue, c.issue, c.issue.rulesId);
    const log = recordFightLog(issue, smartPlayer(issue, c.input.player[0], 'Legendary')).wire;
    assert.deepEqual(verifyFightReplay(issue, log, { battleId: c.input.battleId }).receipt, c.receipt, c.issue.rulesId);
  }
});

// ---------------------------------------------------------------- ruling 4

/** A machine player driven by the live core (no reaction lag): `react` presses guard 1 tick after any CPU telegraph; `perfect`
 * presses it 1 tick before contact (always a perfect guard). With `offense` it walks in and lights the CPU whenever it is free
 * (a fight it can win); without, it only defends (many CPU strikes). Recorded, then replayed as plain per-tick inputs. */
function machine(issue, mode, offense = true) {
  const { rules, chase, attrs, tempo } = F.rulesDocFromJson(issue.rules);
  const rec = [];
  const driver = {
    begin() {},
    decide(v) {
      const t = v.tick + 1, o = v.opponent(0), me = v.self, inp = F.idleInput();
      const dx = o.xMm - me.xMm, dz = o.zMm - me.zMm, d = Math.max(1, Math.round(Math.hypot(dx, dz)));
      if (o.action === F.Action.Telegraph) {
        inp.guard = mode === 'react' ? t > o.telegraphStartTick : t >= o.contactTick - 1;
        return inp;
      }
      const reach = v.selfDef.reachLightMm;
      if (offense && d > reach - 200) { inp.moveX = Math.trunc(dx * 127 / d); inp.moveZ = Math.trunc(dz * 127 / d); }
      else if (offense && me.action === F.Action.Idle && me.guard === F.Guard.Down && (o.action === F.Action.Recovery || o.action === F.Action.Stun || o.action === F.Action.Idle)) inp.press = F.Press.Light;
      return inp;
    },
  };
  F.runFight(rules, issue.seed, { brain: driver, profile: null, skill: null }, { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill: issue.cpu.rank },
    { recordEvents: false, chase, attrs, tempo, onTick: (_t, i) => rec.push(F.toRecord(i[0])) });
  return recordFightLog(issue, { read: t => (t < rec.length ? F.toInput(rec[t]) : F.toInput(F.idleRecord())) }).wire;
}
const strongIssue = (tempo = false, i = 0) => buildFightReplayIssue({ battleId: 'rb_p' + i, seed: (i.toString(16).padStart(2, '0')).repeat(32), tier: 6, mentor: false, chase: true, attrs: true, tempo,
  player: buildPlayerCombatants({ holobots: [bot('ACE', 20)] }, ['ace']), opponent: buildPlayerCombatants({ holobots: [bot('WOLF', 40)] }, ['wolf']) });

test('ruling 4: the plausibility flag fires on synthetic machine-perfect logs (reaction floor, perfect-guard rate)', () => {
  const five = strongIssue(false, 1);
  const win = verifyFightReplay(five, machine(five, 'react'), { battleId: 'rb_p1' });
  assert.equal(win.receipt.winner, 'player'); assert.deepEqual(win.plausibility.flags, ['reaction_floor'], JSON.stringify(win.plausibility));
  for (const tempo of [false, true]) {
    const issue = strongIssue(tempo, 2);
    const react = verifyFightReplay(issue, machine(issue, 'react', false), { battleId: 'rb_p2' }).plausibility;
    assert.ok(react.flags.includes('reaction_floor'), JSON.stringify(react));
    const perfect = verifyFightReplay(issue, machine(issue, 'perfect', false), { battleId: 'rb_p2' }).plausibility;
    assert.ok(perfect.flags.includes('perfect_guard_rate'), JSON.stringify(perfect));
    assert.equal(perfect.flags.includes('reaction_floor'), false, 'a perfect guard pressed late is not a fast reaction');
  }
});

test('ruling 4: never on brain-generated logs (every profile, every rank, duel-rules-5 and -6); the config is one named block', () => {
  assert.deepEqual(Object.keys(F.FIGHT_PLAUSIBILITY_CONFIG).sort(), ['perfectFlagRate', 'perfectMinContacts', 'reactionFlagShare', 'reactionFloorTicks', 'reactionMinSamples', 'reactionMinTelegraphTicks', 'version']);
  let n = 0, maxShare = 0, maxRate = 0;
  for (const tempo of [false, true]) for (const [k, id] of F.PROFILE_ROSTER_IDS.entries()) for (const rank of F.RANKS) {
    const issue = buildFightReplayIssue({ battleId: 'rb_b', seed: ((k * 7 + n) % 256).toString(16).padStart(2, '0').repeat(32), tier: 9, mentor: false, chase: true, attrs: true, tempo,
      player: buildPlayerCombatants({ holobots: [bot(id.toUpperCase(), 40)] }, [id]), opponent: buildPlayerCombatants({ holobots: [bot('WOLF', 40)] }, ['wolf']) });
    const p = verifyFightReplay(issue, recordFightLog(issue, smartPlayer(issue, id, rank)).wire, { battleId: 'rb_b' }).plausibility;
    assert.equal(p.flagged, false, `${id} ${rank} ${tempo}: ${JSON.stringify(p)}`);
    n++;
    if (p.reaction.samples >= F.FIGHT_PLAUSIBILITY_CONFIG.reactionMinSamples) maxShare = Math.max(maxShare, p.reaction.underFloor / p.reaction.samples);
    if (p.perfect.contacts >= F.FIGHT_PLAUSIBILITY_CONFIG.perfectMinContacts) maxRate = Math.max(maxRate, p.perfect.ratePm);
  }
  assert.equal(n, 2 * 13 * 6);
  assert.ok(maxShare < F.FIGHT_PLAUSIBILITY_CONFIG.reactionFlagShare, `brain under-floor share max ${maxShare}`);
  assert.ok(maxRate < 1000 * F.FIGHT_PLAUSIBILITY_CONFIG.perfectFlagRate, `brain perfect-guard rate max ${maxRate} pm`);
  console.log(`# calibration: ${n} brain fights, max under-floor share ${maxShare}, max perfect-guard rate ${maxRate} pm`);
});

test('ruling 4: a flagged WIN is recorded for admins and still pays in full; an unflagged win is recorded unflagged; a loss is not judged', async () => {
  const w = world({ level: 20, rivalWins: 60 });
  const issue = await issueLog(w);
  const log = machine(issue.duel, 'react');
  const v = verifyFightReplay(issue.duel, log, { battleId: issue.battleId });
  assert.equal(v.receipt.winner, 'player', 'the reacting machine wins');
  assert.equal(v.plausibility.flagged, true);
  const r = await w.call({ operation: 'settle', battleId: issue.battleId, inputLog: log }, later);
  assert.deepEqual([r.didWin, r.holosGranted], [true, 100], 'rewards are not withheld');
  assert.deepEqual(w.record(issue.battleId).fightPlausibility, v.plausibility);
  const flag = w.db.read(`${FIGHT_PLAUSIBILITY_COLLECTION}/${w.uid}_${issue.battleId}`);
  assert.deepEqual([flag.uid, flag.battleId, flag.flagged, flag.reviewed, flag.inputsHash], [w.uid, issue.battleId, true, false, v.receipt.inputsHash]);
  const w2 = world(), i2 = await issueLog(w2);
  await w2.call({ operation: 'settle', battleId: i2.battleId, inputLog: winLog(i2.duel) }, later);
  assert.equal(w2.record(i2.battleId).fightPlausibility.flagged, false);
  assert.equal([...w2.db.docs.keys()].some(k => k.startsWith(FIGHT_PLAUSIBILITY_COLLECTION + '/')), false);
  const w3 = world(), i3 = await issueLog(w3);
  const lose = recordFightLog(i3.duel, { read: () => F.toInput(F.idleRecord()) }).wire;
  const lr = await w3.call({ operation: 'settle', battleId: i3.battleId, inputLog: lose }, later);
  assert.equal(lr.didWin, false); assert.equal(w3.record(i3.battleId).fightPlausibility, undefined);
});
