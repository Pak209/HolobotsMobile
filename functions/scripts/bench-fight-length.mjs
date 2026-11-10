// server-rulings-1 (ruling 2): CPU-vs-CPU fight-length + win-skew batch on the input-log issue path.
// Usage: node scripts/bench-fight-length.mjs [--rules current|tempo] [--n1 600] [--n3 240] [--json out.json]
// Every fight is issued by buildFightReplayIssue exactly as production does (chase + attrs on = duel-rules-5; `tempo` asks for
// duel-rules-6), both sides progression-sourced bots at a shared level, both driven by the shipped FightCoreBrain with their own
// profile and the same rank. Deterministic: lineup, level, rank and seed are drawn from a fixed xorshift stream.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const FI = require('../lib/rival/fightReplayIssue.js');
const { buildFightReplayIssue } = FI;
// experiments only: --ov '{"hpScaleLights":15}' replaces the duel-rules-6 global overrides for this run (the module freezes
// them; this swaps the binding the issue builder reads through the exports object)
if (process.argv.includes('--ov')) Object.defineProperty(FI, 'TEMPO_RULE_OVERRIDES', { value: JSON.parse(process.argv[process.argv.indexOf('--ov') + 1]) });
const { buildPlayerCombatants } = require('../lib/lib/rivalLadder.js');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const RULES = arg('rules', 'current'), N1 = +arg('n1', 600), N3 = +arg('n3', 240), OUT = arg('json', '');
const BOTS = [...F.PROFILE_ROSTER_IDS], RANKS = [...F.RANKS], LEVELS = [1, 5, 10, 20, 35, 50];
let st = 0x9e3779b9;
const rnd = n => { st ^= st << 13; st >>>= 0; st ^= st >>> 17; st ^= st << 5; st >>>= 0; return st % n; };
const hex64 = () => Array.from({ length: 8 }, () => (rnd(0x7fffffff) >>> 0).toString(16).padStart(8, '0')).join('');
const pickDistinct = k => { const pool = [...BOTS], out = []; while (out.length < k) out.push(pool.splice(rnd(pool.length), 1)[0]); return out; };
const combatant = (id, level) => ({ ...buildPlayerCombatants({ holobots: [{ name: id.toUpperCase(), level, experience: 0 }] }, [id])[0], statSource: 'progression' });

function one(size) {
  const a = pickDistinct(size), b = pickDistinct(size).map(x => x);
  const level = LEVELS[rnd(LEVELS.length)], rank = RANKS[rnd(RANKS.length)], seed = hex64();
  const issue = buildFightReplayIssue({ battleId: 'rb_bench', seed, tier: 0, mentor: false, chase: true, attrs: true, ...(RULES === 'tempo' ? { tempo: true } : {}),
    player: a.map(id => combatant(id, level)), opponent: b.map(id => combatant(id, level)) });
  if (!issue) throw Error('unexpressible ' + a + ' v ' + b);
  const doc = F.rulesDocFromJson(issue.rules);
  const skill = F.issuedSkill(rank);
  const r = F.runFight(doc.rules, seed,
    { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(a[0])), skill },
    { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill },
    { recordEvents: false, chase: doc.chase, attrs: doc.attrs, tempo: doc.tempo });
  const side = s => doc.rules.fighters.filter(f => f.side === s);
  const sum = (s, k) => side(s).reduce((t, f) => t + (f[k] ?? 0), 0);
  return { size, a, b, level, rank, winner: r.winner, reason: r.reason, seconds: (r.endTick + 1) / 30,
    stats: Object.fromEntries(['attack', 'defense', 'maxHp', 'speed', 'special'].map(k => [k, [sum(0, k), sum(1, k)]])),
    w: r.witness.sides.map(x => ({ hits: x.hits, blocks: x.blocks, perfect: x.perfectGuards, whiffs: x.whiffs, telegraphs: x.telegraphs })) };
}

const pct = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
function summary(rows, label) {
  const s = rows.map(r => r.seconds);
  const inBand = s.filter(x => x >= 30 && x <= 45).length, cap = rows.filter(r => r.reason === 'timeout').length;
  const out = { label, n: rows.length, min: Math.min(...s), p10: pct(s, 0.1), p25: pct(s, 0.25), median: pct(s, 0.5), p75: pct(s, 0.75), p90: pct(s, 0.9), max: Math.max(...s),
    mean: +(s.reduce((t, x) => t + x, 0) / s.length).toFixed(1), in30to45Pct: +(100 * inBand / rows.length).toFixed(1), timeoutPct: +(100 * cap / rows.length).toFixed(1),
    side0WinPct: +(100 * rows.filter(r => r.winner === 0).length / rows.length).toFixed(1), drawPct: +(100 * rows.filter(r => r.winner === 2).length / rows.length).toFixed(1) };
  // win-rate of the side with the higher stat (decided fights, stat differs by >= 5 %)
  out.higherStatWinPct = {};
  for (const k of ['attack', 'defense', 'maxHp', 'speed', 'special']) {
    let n = 0, w = 0;
    for (const r of rows) {
      if (r.winner > 1) continue;
      const [x, y] = r.stats[k]; if (Math.abs(x - y) < 0.05 * Math.max(x, y, 1)) continue;
      n++; if ((x > y ? 0 : 1) === r.winner) w++;
    }
    out.higherStatWinPct[k] = n ? `${(100 * w / n).toFixed(1)} (n=${n})` : 'n/a';
  }
  // per-profile (lead bot) win rate across both sides
  const prof = {};
  for (const r of rows) for (const s of [0, 1]) { if (r.winner > 1) continue; const id = (s ? r.b : r.a)[0]; prof[id] ??= [0, 0]; prof[id][1]++; if (r.winner === s) prof[id][0]++; }
  out.leadWinPct = Object.fromEntries(Object.entries(prof).sort().map(([k, [w, n]]) => [k, `${(100 * w / n).toFixed(0)} (n=${n})`]));
  const byRank = {};
  for (const r of rows) { byRank[r.rank] ??= []; byRank[r.rank].push(r.seconds); }
  out.medianByRank = Object.fromEntries(RANKS.map(k => [k, byRank[k] ? pct(byRank[k], 0.5) : null]));
  const tot = rows.reduce((t, r) => { for (const x of r.w) { t.h += x.hits; t.b += x.blocks; t.p += x.perfect; t.wf += x.whiffs; } return t; }, { h: 0, b: 0, p: 0, wf: 0 });
  out.contactMix = tot;
  return out;
}

const t0 = Date.now();
const r1 = Array.from({ length: N1 }, () => one(1));
const r3 = Array.from({ length: N3 }, () => one(3));
const res = { rules: RULES, ms: Date.now() - t0, v1: summary(r1, '1v1'), v3: summary(r3, '3v3') };
console.log(JSON.stringify(res, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify({ ...res, rows1: r1, rows3: r3 }));
