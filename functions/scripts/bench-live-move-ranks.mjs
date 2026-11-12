// live-move-ranks-1: the win-rate edge of a fully ranked bot (all five live moves at rank 3) over the SAME bot at rank 0.
// Usage: node scripts/bench-live-move-ranks.mjs [--n 600] [--ranks '{"jab":3,...}'] [--guard] [--levels 1,20] [--no-floor] [--json out.json]
//        node scripts/bench-live-move-ranks.mjs --by-level [--n 600]   (level 1 and level 20 cases, with and without the +1 floor)
// --levels pins the sampled levels (default 1,5,10,20,35,50). --no-floor drops the "+1 per ranked slot" minimum gain (the pure
// per-mille boost, floored) so its share of the edge can be measured; the shipped issue always applies the floor.
// Each sample is a mirror match (same Holobot both sides, same level, same CPU skill row driving both brains, same seed), issued by
// buildFightReplayIssue exactly as a live duel is (chase + attrs + tempo = duel-rules-6, live: true; --guard asks duel-rules-7),
// played twice: once with the side-0 player at the ranks, once at rank 0. Edge = side-0 win rate (draw = half) ranked minus
// unranked, so side bias cancels. Deterministic (fixed xorshift stream). Pak's aim: edge <= ~12 points.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const { buildFightReplayIssue, inputLogCombatant } = require('../lib/rival/fightReplayIssue.js');
const { buildPlayerCombatants } = require('../lib/lib/rivalLadder.js');
const { EMPTY_PART_BOOSTS } = require('../lib/lib/partStats.js');

export const FULL_RANKS = { jab: 3, heavy: 3, guard: 3, dash: 3, special: 3 };
const ZERO = { jab: 0, heavy: 0, guard: 0, dash: 0, special: 0 };

export function benchLiveMoveRanks({ n = 600, ranks = FULL_RANKS, guard = false, seed0 = 0x9e3779b9, levels = [1, 5, 10, 20, 35, 50], noFloor = false } = {}) {
  const BOTS = [...F.PROFILE_ROSTER_IDS], RANKS = [...F.RANKS], LEVELS = [...levels];
  let st = seed0 >>> 0;
  const rnd = k => { st ^= st << 13; st >>>= 0; st ^= st >>> 17; st ^= st << 5; st >>>= 0; return st % k; };
  const hex64 = () => Array.from({ length: 8 }, () => (rnd(0x7fffffff) >>> 0).toString(16).padStart(8, '0')).join('');
  const combatant = (id, level) => ({ ...buildPlayerCombatants({ holobots: [{ name: id.toUpperCase(), level, experience: 0 }] }, [id])[0], statSource: 'progression' });
  const withFloor = c => { if (!noFloor) return c; const { liveMoveMinGain, ...rest } = c; return rest; };
  const play = (id, level, rank, seed, r) => {
    const issue = buildFightReplayIssue({ battleId: 'rb_bench_lmr', seed, tier: 0, mentor: false, chase: true, attrs: true, tempo: true, live: true, guardHold: guard,
      player: [withFloor(inputLogCombatant(combatant(id, level), EMPTY_PART_BOOSTS, true, r))], opponent: [combatant(id, level)] });
    if (!issue) throw Error('unexpressible ' + id);
    const doc = F.rulesDocFromJson(issue.rules), skill = F.issuedSkill(rank);
    const res = F.runFight(doc.rules, seed,
      { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(id)), skill },
      { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill },
      { recordEvents: false, chase: doc.chase, attrs: doc.attrs, tempo: doc.tempo });
    return { winner: res.winner, f0: issue.rules.fighters[0] };
  };
  const score = w => (w === 0 ? 1 : w === 2 ? 0.5 : 0);
  let ranked = 0, base = 0, flips = 0;
  const byBot = {}, byLevel = {};
  for (let i = 0; i < n; i++) {
    const id = BOTS[rnd(BOTS.length)], level = LEVELS[rnd(LEVELS.length)], rank = RANKS[rnd(RANKS.length)], seed = hex64();
    const a = play(id, level, rank, seed, ranks), b = play(id, level, rank, seed, ZERO);
    ranked += score(a.winner); base += score(b.winner); if (a.winner !== b.winner) flips++;
    (byBot[id] ??= [0, 0, 0])[0] += score(a.winner); byBot[id][1] += score(b.winner); byBot[id][2]++;
    (byLevel[level] ??= [0, 0, 0])[0] += score(a.winner); byLevel[level][1] += score(b.winner); byLevel[level][2]++;
  }
  const pct = x => +(100 * x / n).toFixed(1);
  const edgeOf = ([r, b, k]) => +(100 * (r - b) / k).toFixed(1);
  return {
    n, ranks, guard, levels: LEVELS, floor: !noFloor, rankedWinPct: pct(ranked), baseWinPct: pct(base), edgePoints: +(pct(ranked) - pct(base)).toFixed(1), flippedPct: pct(flips),
    edgeByBot: Object.fromEntries(Object.entries(byBot).sort().map(([k, v]) => [k, `${edgeOf(v)} (n=${v[2]})`])),
    edgeByLevel: Object.fromEntries(Object.entries(byLevel).map(([k, v]) => [k, `${edgeOf(v)} (n=${v[2]})`])),
  };
}

/** Bench case (Pak 2026-11-11 floor ruling): all five slots at rank 3 vs rank 0 at level 1 and at a mid level (20), with the
 * shipped "+1 per ranked slot" floor and without it (pure per-mille), so the floor's share of the edge is visible. */
export const BENCH_MID_LEVEL = 20;
export function benchLiveMoveRanksByLevel({ n = 600, guard = false } = {}) {
  const row = (level, noFloor) => {
    const r = benchLiveMoveRanks({ n, guard, levels: [level], noFloor });
    return { rankedWinPct: r.rankedWinPct, baseWinPct: r.baseWinPct, edgePoints: r.edgePoints, flippedPct: r.flippedPct };
  };
  return {
    n, ranks: FULL_RANKS, guard,
    level1: { floor: row(1, false), noFloor: row(1, true) },
    [`level${BENCH_MID_LEVEL}`]: { floor: row(BENCH_MID_LEVEL, false), noFloor: row(BENCH_MID_LEVEL, true) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const t0 = Date.now();
  if (process.argv.includes('--by-level')) {
    const out = benchLiveMoveRanksByLevel({ n: +arg('n', 600), guard: process.argv.includes('--guard') });
    console.log(JSON.stringify({ ...out, ms: Date.now() - t0 }, null, 1));
    process.exit(0);
  }
  const levels = arg('levels', '') ? arg('levels', '').split(',').map(Number) : undefined;
  const res = benchLiveMoveRanks({ n: +arg('n', 600), ranks: JSON.parse(arg('ranks', JSON.stringify(FULL_RANKS))), guard: process.argv.includes('--guard'), levels, noFloor: process.argv.includes('--no-floor') });
  console.log(JSON.stringify({ ...res, ms: Date.now() - t0 }, null, 1));
  const out = arg('json', '');
  if (out) writeFileSync(out, JSON.stringify(res));
}
