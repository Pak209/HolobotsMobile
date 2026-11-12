// Guild Court plan-and-send (pure rules): the opt-in, the pinned fight, the too_fast refusal and reward parity with the client-reported run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Z = require('../lib/lib/holoZoneRuns.js');
const C = require('../lib/lib/holoZoneCourtDuel.js');
const B = require('../lib/lib/holoZoneBeastStats.js');
const D = require('../lib/lib/duelResolver.js');
const R = require('../lib/lib/rivalLadder.js');
const P = require('../lib/lib/progression.js');
const T0 = Date.UTC(2026, 10, 8, 12, 0, 0), RUN = '11111111-1111-4111-8111-111111111111', LATE = T0 + Z.HOLOZONE_MIN_XP_MS;
const profile = () => ({ holosTokens: 10, holobots: [{ name: 'ACE', level: 1, experience: 0, nextLevelExp: 400, attributePoints: 0 }, { name: 'KUMA', level: 1, experience: 0, nextLevelExp: 400, attributePoints: 0 }] });
const issue = (seed = 7, holobotId = 'ace', p = profile()) => Z.issueHoloZoneRun([], 'guild_court', ['ace', 'kuma'], RUN, T0, { profile: p, includeHealth: true, courtDuel: { holobotId, seed } });
const settle = playerIntents => Z.validateHoloZoneCommand({ schemaVersion: 'holozone-run-2', operation: 'settle', runId: RUN, playerIntents });
const FAIR = ['strike', 'strike', 'heavy', 'defend'];
const code = (f, want) => assert.throws(f, e => e instanceof Z.HoloZoneError && e.code === want, want);

test('opt-in: Guild Court only, a named Holobot, the exact schema; nothing else is accepted', () => {
  const ok = Z.validateHoloZoneCommand({ schemaVersion: 'holozone-run-2', operation: 'issue', zoneId: 'guild_court', duelSchema: 'duel-receipt-1', holobotId: 'ace' });
  assert.equal(ok.duelSchema, 'duel-receipt-1'); assert.equal(ok.holobotId, 'ace');
  const plain = Z.validateHoloZoneCommand({ schemaVersion: 'holozone-run-2', operation: 'issue', zoneId: 'guild_court', holobotId: 'ace' });
  assert.equal(plain.duelSchema, undefined, 'without the opt-in the run is client-reported');
  for (const bad of [{ zoneId: 'neonforest', duelSchema: 'duel-receipt-1', holobotId: 'ace' }, { zoneId: 'guild_court', duelSchema: 'duel-receipt-0', holobotId: 'ace' }, { zoneId: 'guild_court', duelSchema: 'duel-receipt-1' }, { zoneId: 'guild_court', duelSchema: 'duel-receipt-1', holobotId: 'ACE!' }])
    code(() => Z.validateHoloZoneCommand({ operation: 'issue', ...bad }), 'invalid_request');
});

test('settle body: the plan only; outcome, HP and fielded claims are refused', () => {
  assert.deepEqual(settle(['strike']).playerIntents, ['strike']);
  for (const extra of [{ kills: 1 }, { bossDefeated: true }, { fielded: ['ace'] }, { health: [] }, { healthSchema: 'rival-health-1' }])
    code(() => Z.validateHoloZoneCommand({ operation: 'settle', runId: RUN, playerIntents: ['strike'], ...extra }), 'invalid_request');
  for (const playerIntents of [[], ['win'], new Array(121).fill('strike')]) code(() => settle(playerIntents), 'invalid_request');
});

test('issue pins a single Cacheback and the named Holobot; the wire block never carries the seed', () => {
  const r = issue(99);
  const run = r.doc.runs[0];
  assert.equal(run.duel.input.seed, 99); assert.equal(run.duel.fielderId, 'ace'); assert.equal(run.duel.beastId, 'cacheback');
  assert.equal(run.duel.input.player.length, 1); assert.equal(run.duel.input.opponent.length, 1);
  assert.equal(run.duel.input.opponent[0].holobotId, 'cacheback'); assert.equal(run.duel.input.opponent[0].maxHealth, 285);
  assert.ok(run.issuedVitals.ace, 'host health is pinned');
  assert.equal(JSON.stringify(r.reply.duel).includes('"seed"'), false); assert.equal(r.reply.duel.maxRounds, 120);
  assert.deepEqual(Z.holoZoneStatus(r.doc.runs, T0 + 1).duel, r.reply.duel, 'status re-serves the open fight');
  code(() => issue(1, 'wolf'), 'invalid_request');
  code(() => issue(1, 'ace', { ...profile(), holobotVitals: { ace: { currentHealth: 0, maxHealth: 150, hpUpdatedAt: T0 } } }), 'holobot_ko');
});

test('a fast SEND is refused before resolving, win or lose: retryAfterMs, then it settles at the floor', () => {
  const { doc: { runs } } = issue();
  for (const plan of [FAIR, ['defend']]) {
    assert.throws(() => Z.courtSettleCommand(runs, settle(plan), T0 + 5000), e => e.code === 'too_fast' && e.retryAfterMs === Z.HOLOZONE_MIN_XP_MS - 5000);
    assert.ok(Z.courtSettleCommand(runs, settle(plan), LATE).receipt);
  }
});

test('the stored mode decides: no plan on a pinned run, no plan on a client-reported run, closed and expired refused, replay passes through', () => {
  const { doc: { runs } } = issue();
  const legacy = Z.validateHoloZoneCommand({ operation: 'settle', runId: RUN, kills: 1, bossDefeated: false, fielded: ['ace'] });
  code(() => Z.courtSettleCommand(runs, legacy, LATE), 'invalid_request');
  const plain = Z.issueHoloZoneRun([], 'guild_court', ['ace'], RUN, T0, { profile: profile(), includeHealth: false }).doc.runs;
  code(() => Z.courtSettleCommand(plain, settle(FAIR), LATE), 'invalid_request');
  assert.equal(Z.courtSettleCommand(plain, legacy, LATE).command, legacy);
  code(() => Z.courtSettleCommand([{ ...runs[0], closedAtMs: T0 + 1 }], settle(FAIR), LATE), 'run_closed');
  code(() => Z.courtSettleCommand(runs, settle(FAIR), runs[0].expiresAtMs + 1), 'run_expired');
  assert.equal(Z.courtSettleCommand([{ ...runs[0], settlement: { kind: 'beast' } }], legacy, LATE).command, legacy);
});

test('rewards match the client-reported Guild Court run exactly: a win as kills 1, a loss as kills 0, the fielded companion only', () => {
  let win = null;
  for (let seed = 0; !win && seed < 500; seed++) { const i = issue(seed), runs = i.doc.runs; const c = Z.courtSettleCommand(runs, settle(FAIR), LATE); if (c.receipt.winner === 'player') win = { runs, c, vitals: i.userUpdates.holobotVitals }; }
  assert.ok(win, 'a fair plan can win');
  const lossIssue = issue(3), lossRuns = lossIssue.doc.runs, loss = Z.courtSettleCommand(lossRuns, settle(['defend']), LATE);
  assert.equal(loss.receipt.winner, 'opponent');
  for (const [runs, c, kills, holos, fragments, vitals] of [[win.runs, win.c, 1, 100, 1, win.vitals], [lossRuns, loss, 0, 25, 0, lossIssue.userUpdates.holobotVitals]]) {
    assert.equal(c.command.kills, kills); assert.equal(c.command.bossDefeated, false); assert.deepEqual(c.command.fielded, ['ace']);
    const paid = Z.settleHoloZoneRun({ ...profile(), holobotVitals: vitals }, runs, c.command, LATE); // The issue wrote the ledger.
    const plain = Z.issueHoloZoneRun([], 'guild_court', ['ace', 'kuma'], RUN, T0, { profile: profile(), includeHealth: false }).doc.runs;
    const lite = Z.settleHoloZoneRun(profile(), plain, { runId: RUN, kills, bossDefeated: false, fielded: ['ace'] }, LATE);
    assert.equal(paid.reply.holosGranted, holos); assert.equal(paid.reply.blueprintFragmentsGranted, fragments);
    assert.deepEqual(paid.reply.settlement, lite.reply.settlement); assert.deepEqual(paid.reply.progression, lite.reply.progression);
    const { holobotVitals, ...rest } = paid.userUpdates;
    assert.deepEqual(rest, lite.userUpdates);
    assert.equal(holobotVitals.ace.currentHealth, c.receipt.playerFinal[0].currentHealth, 'HP comes from the receipt');
  }
});

test('Cacheback scales with the pilot level: stat x (1 + 0.05 x (level - 1)), stamina fixed, pinned at issue', () => {
  assert.deepEqual(B.scaledBeastStats('guild_court', 0, 'cacheback', 1), { ...B.holoZoneBeastStats('guild_court', 0, 'cacheback') });
  const l20 = B.scaledBeastStats('guild_court', 0, 'cacheback', 20);
  assert.deepEqual([l20.level, l20.maxHealth, l20.attack, l20.defense, l20.speed, l20.maxStamina, l20.staminaRegen], [20, 556, 78, 16, 117, 7, 0.5]);
  assert.equal(B.scaledBeastStats('guild_court', 0, 'cacheback', 500).level, 99);
  assert.equal(B.scaledBeastStats('neonforest', 0, 'scrapling', 20).maxHealth, 120, 'a zone with no growth entry does not scale');
  assert.equal(B.scaledBeastStats('guild_court', 0, 'nope', 5), null);
  const p = profile(); p.holobots[0].level = 20;
  const pinned = issue(5, 'ace', p).doc.runs[0].duel.input.opponent[0];
  assert.equal(pinned.maxHealth, 556); assert.equal(pinned.level, 20);
});

test('the fight stays fair at every level: fair plan wins most, HARE near two in three, real rounds and real HP lost; doing nothing loses', () => {
  const FIGHT_LEVELS = [1, 10, 20];
  for (const level of FIGHT_LEVELS) {
    const s = B.scaledBeastStats('guild_court', 0, 'cacheback', level);
    const beast = D.duelFighterFromCombatant({ holobotId: 'cacheback', level: s.level, tier: 0, maxHealth: s.maxHealth, attack: s.attack, defense: s.defense, speed: s.speed });
    let wins = 0, rounds = 0, hp = 0, total = 0, idle = 0, worst = 1, hare = 0;
    for (const name of Object.keys(P.HOLOBOT_BASE_STATS)) {
      const id = name.toLowerCase(), c = R.buildPlayerCombatants({ holobots: [{ name, level, experience: 0 }] }, [id])[0], p = D.duelFighterFromCombatant({ ...c, tier: 0 });
      let botWins = 0;
      for (let seed = 0; seed < 200; seed++) {
        const r = D.resolveDuel({ seed, player: [p], opponent: [beast], playerIntents: FAIR });
        if (r.winner === 'player') { wins++; botWins++; }
        rounds += r.rounds[r.rounds.length - 1].round; hp += r.playerFinal[0].currentHealth / r.playerFinal[0].maxHealth; total++;
        idle += D.resolveDuel({ seed, player: [p], opponent: [beast], playerIntents: ['defend'] }).winner === 'player' ? 1 : 0;
      }
      worst = Math.min(worst, botWins / 200); if (id === 'hare') hare = botWins / 200;
    }
    assert.ok(wins / total >= 0.85 && wins / total <= 0.97, `level ${level} win rate ${wins / total}`);
    assert.ok(worst >= 0.55, `level ${level} worst bot ${worst}`);
    assert.ok(hare >= 0.58 && hare <= 0.76, `level ${level} HARE ${hare}`);
    assert.ok(rounds / total >= 4.5, `level ${level} rounds ${rounds / total}`);
    assert.ok(hp / total <= 0.6, `level ${level} HP left ${hp / total}`);
    assert.equal(idle, 0);
  }
});
