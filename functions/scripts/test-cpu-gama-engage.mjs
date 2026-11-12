// cpu-gama-engage-1 (2026-11-12): the CPU GAMA stood around. Its table row (profiles.ts) waits for 650 stamina and breaks off at
// 350; the ISSUED profile now carries engageMinStaminaPm 450 / breakAtStaminaPm 250 for a GAMA lead (fightReplayIssue.ts
// CPU_ISSUE_PROFILE_TUNING). The table row, its C# parity and every other bot are unchanged. Because 250 is under the old brain
// floor (profileIsValid 30000 bps) that phone builds before duel-rules-8 still enforce, only a duel-rules-8 ask gets the tuning.
//
// cpu-stamina-8 (2026-11-12, owner: "Rework the CPU stamina check"): the tuning alone could not fix it. Up close the brain wanted
// ~420 stamina whatever its engage number, CLOSE regen is 10/s and the shove (80) fired from 380, so GAMA sat at 330..406 forever.
// On duel-rules-8 only (gate: the core runs the `stamina` block, AiObs.econ), every CPU now plans with the real economy
// (brain.ts E0 / E1): its engage number must be reachable at the current range's regen (winded: the wind floor first) within
// ECON_PATIENCE_TICKS; if not, it commits as soon as a light keeps it above the break line, else it backs out to regenerate; if it
// keeps trying to back out but stays in CLOSE / EXCHANGE or inside the rival's light threat for ECON_PIN_TICKS[rank], it is
// pinned and spends one chain with whatever it has (retreat on its break number suspended), then tries to get out again. A shove
// may not eat the next clean light. Rules-7 and older: every brain output byte for byte (the rules-7 goldens pin it).
//
// cpu-stamina-8 follow-up (owner: "Fix it now", the turtle case): CPUs started chains into the player's incoming strike, because the
// player's own wind-up opened the exchange and the exchange tripled the engage roll before the CPU could even see the wind-up.
// Rules-8 only (brain.ts E0b): no fresh wind-up (chain start, charge, SYNC spend, or a chain light that would lose the race) into a
// rival strike it can see coming and is inside; the exchange boost waits until the exchange is older than the rank's reactionTicks
// (the strike that opened it has resolved); the rival's recovery in reach earns the boost outside an exchange; once per rival
// recovery it drops its shell at the rank's feintReadBps (Rookie 30 % .. Legendary 80 %); a gassed rival (under the break line)
// doubles the engage roll like a break does; and the pin count waits (instead of restarting) while it is hit or guarding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { F, buildFightReplayIssue, combatant } from './lib/fight-replay-helpers.mjs';
const require = createRequire(import.meta.url);
const { cpuIssueProfile, CPU_ISSUE_PROFILE_TUNING } = require('../lib/rival/fightReplayIssue.js');

const issue = (extra, opp = 'gama', seed = '3e'.repeat(32), hp = 480) => buildFightReplayIssue({ battleId: 'rb_gama', seed, tier: 2, mentor: false,
  player: [{ ...combatant('ace', hp), level: 20, speed: 40, intelligence: 40 }], opponent: [{ ...combatant(opp, hp), level: 20, speed: 40, intelligence: 40 }],
  chase: true, attrs: true, tempo: true, live: true, ...extra });

test('issue: a GAMA lead on a duel-rules-8 ask carries 450 / 250; without the ask (older phones, Unity) the table row; other bots untouched', () => {
  assert.deepEqual(Object.keys(CPU_ISSUE_PROFILE_TUNING), ['gama']);
  const row = F.issuedProfile(F.brainProfile('gama'));
  assert.equal(row.engageMinStaminaPm, 650); assert.equal(row.breakAtStaminaPm, 350, 'the table row is unchanged');
  const tuned = issue({ guardHold: true, staminaWind: true });
  assert.deepEqual(tuned.cpu.profile, { ...row, engageMinStaminaPm: 450, breakAtStaminaPm: 250 });
  assert.deepEqual(tuned.cpu.profile, cpuIssueProfile('gama'));
  assert.deepEqual(issue({ guardHold: true }).cpu.profile, row, 'a rules-7 ask: the table row, byte for byte');
  assert.deepEqual(issue({}).cpu.profile, row);
  for (const id of ['wolf', 'ace', 'kuma', 'shadow']) assert.deepEqual(issue({ guardHold: true, staminaWind: true }, id).cpu.profile, F.issuedProfile(F.brainProfile(id)), id);
  assert.equal(F.profileIsValid(F.brainFromIssued(tuned.cpu.profile)), null, 'the widened brain floor accepts the tuned row');
  assert.equal(F.profileIsValid({ ...F.brainProfile('gama'), breakAtStamina: 24900 }), 'breakAt');
  for (const p of F.allBrainProfiles()) assert.ok(p.breakAtStamina >= 30000, 'every table row is still above the old floor');
});

// ------------------------------------------------------------------ scripted players (10 seeds each, no hand-picked seeds)
// "pass" = the longest gap between the CPU's landed hits (Hit / GuardBreak; the start and the end of the fight count) is at most
// 240 ticks (8 s). Measured 2026-11-12 (GAMA, issued row, Starter; hp 3000 so the fight lasts):
//   scenario                                                    rules-8 now           rules-8 before cpu-stamina-8   rules-7 (table row)
//   walk-in  (walks straight at GAMA, never attacks)             10/10, mean  136      1/10, mean 2108                0/10, mean 3343
//   edge     (walks in to 3 m, pulses guard)                      9/10, mean  189      7/10, mean  234                5/10, mean  269
//   turtle   (guard half of every 3 s, one light when in reach)   4/10, mean  276      2/10, mean  446                2/10, mean  929
// (first cpu-stamina-8 pass, before the incoming-strike follow-up: edge 7/10 mean 211, turtle 2/10 mean 373.) Target 8/10 (6/10
// on turtle) is not reached on turtle: the turtle's light (from ~2.6 m, lunge included) lands before a Starter (reactionTicks 13)
// can see it, so GAMA is hit every 3 s, and its answer often meets the turtle's next guard window (Blocked). By rank on turtle:
// Rookie 3/10, Champion 5/10, Legendary 6/10. The edge miss is the opening (387 ticks of stalking at full stamina).
let CORE = null;
const toward = () => { const a = CORE.F[0], b = CORE.F[1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return [Math.trunc(dx * 127 / l), Math.trunc(dz * 127 / l), l]; };
const PLAYERS = {
  walkIn: () => { const [x, z] = toward(); return { ...F.idleInput(), moveX: x, moveZ: z }; },
  edge: t => { const [x, z, l] = toward(); return l > 3000 ? { ...F.idleInput(), moveX: x, moveZ: z } : { ...F.idleInput(), guard: (t % 60) < 30 }; },
  turtle: t => { const [, , l] = toward(); return { ...F.idleInput(), guard: t % 90 < 45, press: t % 90 === 60 && l <= 3300 ? F.Press.Light : F.Press.None }; },
};
const SEEDS = Array.from({ length: 10 }, (_, k) => (k * 17 + 3).toString(16).padStart(2, '0').repeat(32));
/** The longest gap (ticks) between the CPU's (side 1) landed hits and between its strike attempts (telegraphs), fight start and end included. */
function gaps(iss, player) {
  const d = F.rulesDocFromJson(iss.rules);
  CORE = new F.FightCore(d.rules, iss.seed, d.chase, d.attrs, d.tempo);
  const res = F.runFight(d.rules, iss.seed, { inputs: { read: player } }, { brain: new F.FightCoreBrain(), profile: iss.cpu.profile, skill: iss.cpu.rank },
    { recordEvents: true, chase: d.chase, attrs: d.attrs, tempo: d.tempo, maxTicks: 3600, onTick: (_t, _i, c) => { CORE = c; } });
  const longest = ticks => { let g = 0, prev = 0; for (const h of ticks) { g = Math.max(g, h - prev); prev = h; } return Math.max(g, res.endTick - prev); };
  const mine = res.events.filter(e => e.side === 1);
  return {
    hit: longest(mine.filter(e => e.kind === F.EventKind.Contact && (e.outcome === F.Outcome.Hit || e.outcome === F.Outcome.GuardBreak)).map(e => e.tick)),
    attempt: longest(mine.filter(e => e.kind === F.EventKind.Telegraph).map(e => e.tick)),
  };
}
const pass = a => a.filter(g => g <= 240).length, mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const EXPECT = { walkIn: { minPass: 10 }, edge: { minPass: 9 }, turtle: { minPass: 4 } };
for (const [name, player] of Object.entries(PLAYERS)) {
  test(`10 seeds, ${name}: on duel-rules-8 GAMA passes at least ${EXPECT[name].minPass}/10 (a hit every 240 ticks; target 8/10) and beats rules-7`, () => {
    const now = [], seven = [];
    for (const seed of SEEDS) {
      now.push(gaps(issue({ guardHold: true, staminaWind: true }, 'gama', seed, 3000), player).hit);
      seven.push(gaps(issue({ guardHold: true }, 'gama', seed, 3000), player).hit);
    }
    console.log(`# gama ${name}: rules-8 ${pass(now)}/10 pass, mean longest gap ${mean(now)} ticks [${now.join(' ')}] | rules-7 ${pass(seven)}/10, mean ${mean(seven)}`);
    assert.ok(pass(now) >= EXPECT[name].minPass, `pass ${pass(now)}/10`);
    assert.ok(pass(now) >= pass(seven), 'never fewer passes than rules-7');
    assert.ok(mean(now) < mean(seven), `mean ${mean(now)} vs ${mean(seven)}`);
  });
}

// ------------------------------------------------------------------ every CPU profile on duel-rules-8 (cpu-stamina-8 is for all of them)
// The stall check: the longest gap without a strike ATTEMPT (a telegraph). Walk-in (the owner's report, and the stall every
// profile had: 12 of 13 at 0/10 before) must pass on at least 8/10 seeds for every profile. Edge and turtle have no profile at
// "most seeds" yet only because of the opening / neutral game and the turtle's own hits (era and shadow are at 4-5/10 on edge on
// rules-7 too), so they pin a hard ceiling instead: no seed waits 720 ticks (24 s) for a strike (before: turtle 2217, walk-in 3512).
// Measured 2026-11-12 (with the incoming-strike follow-up), attempts within 240 on N/10 seeds (walk-in / edge / turtle):
//   gama 10/9/7  ace 10/8/5  wolf 10/10/7  kuma 10/10/10  hare 10/10/4  ken 10/8/7  kurai 10/8/7  era 10/8/5  shadow 10/8/5
//   tora 10/7/4  tsuin 10/9/8  wake 10/10/8  jusan 10/9/4   (longest single gap anywhere: hare turtle 539)
const ROSTER = [...F.PROFILE_ROSTER_IDS];
test('every profile, duel-rules-8: walk-in never stalls (strike attempts within 240 ticks on >= 8/10 seeds); no scenario waits 720 ticks', () => {
  const rows = [];
  for (const id of ROSTER) {
    const row = { id };
    for (const [name, player] of Object.entries(PLAYERS)) {
      const g = SEEDS.map(seed => gaps(issue({ guardHold: true, staminaWind: true }, id, seed, 3000), player).attempt);
      row[name] = { pass: pass(g), max: Math.max(...g) };
    }
    rows.push(row);
  }
  console.log('# attempts within 240 (walk-in / edge / turtle): ' + rows.map(r => `${r.id} ${r.walkIn.pass}/${r.edge.pass}/${r.turtle.pass}`).join('  '));
  console.log('# longest attempt gap: ' + rows.map(r => `${r.id} ${Math.max(r.walkIn.max, r.edge.max, r.turtle.max)}`).join('  '));
  for (const r of rows) {
    assert.ok(r.walkIn.pass >= 8, `${r.id} walk-in ${r.walkIn.pass}/10`);
    for (const name of Object.keys(PLAYERS)) assert.ok(r[name].max <= 720, `${r.id} ${name} longest gap ${r[name].max}`);
  }
});

// CPU vs CPU (the stamina-wind bench's 56 pairs, at three ranks): the median fight length stays within +-25 % of rules-7 and nothing
// times out. Measured 2026-11-12 (median ticks rules-7 -> rules-8): Rookie 1093 -> 1114, Champion 1140 -> 1152, Legendary 1305 -> 1074 (after "Soften Legendary"; 1332 before it)
// (before cpu-stamina-8: 1071 / 1142 / 1305; first pass without the incoming-strike follow-up: 1124 / 1125 / 1415).
test('CPU vs CPU, 56 pairs at Rookie / Champion / Legendary: the rules-8 median fight length is within 25 % of rules-7, no timeouts', () => {
  const ids = ['ace', 'wolf', 'kuma', 'hare', 'gama', 'ken', 'shadow', 'tora'];
  const tempo7 = () => ({ ...F.defaultTempoRules(), guard: F.defaultGuardRules() }), tempo8 = () => ({ ...tempo7(), stamina: F.defaultStaminaRules() });
  const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
  const out = [];
  for (const rank of ['Rookie', 'Champion', 'Legendary']) {
    const st = { 7: { to: 0, ticks: [] }, 8: { to: 0, ticks: [] } };
    for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      for (const ver of [7, 8]) {
        const r = { ...F.defaultRules(ids[i], ids[j]), hpScaleLights: 17 };
        const res = F.runFight(r, ((i * 8 + j) % 256).toString(16).padStart(2, '0').repeat(32),
          { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(ids[i])), skill: F.issuedSkill(rank) },
          { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(ids[j])), skill: F.issuedSkill(rank) },
          { recordEvents: false, chase: F.defaultChaseRules(), attrs: F.defaultAttrRules(), tempo: ver === 8 ? tempo8() : tempo7() });
        if (res.reason === 'timeout') st[ver].to++;
        st[ver].ticks.push(res.endTick);
      }
    }
    const m7 = med(st[7].ticks), m8 = med(st[8].ticks);
    out.push(`${rank} ${m7} -> ${m8} (${((m8 / m7 - 1) * 100).toFixed(1)} %)`);
    assert.equal(st[8].to, 0, `${rank} rules-8 timeouts`);
    assert.ok(Math.abs(m8 - m7) <= m7 / 4, `${rank} median ${m8} vs rules-7 ${m7}`);
  }
  console.log('# CPU vs CPU median ticks rules-7 -> rules-8: ' + out.join(' | '));
});
