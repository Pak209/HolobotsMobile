// rival-scaling-1 bench (2026-11-13): the server copy of the Lite headless practice simulator
// (mobile candidate src/lite/features/ringduel/practiceSim.ts). It builds REAL host issues (buildFightReplayIssue, as the rival host
// does for a town rival at the rank's tier) and plays them on the unchanged core + issued CPU brain against scripted player styles:
//   masher     LIGHT every 5 ticks, SPECIAL whenever SYNC allows; walks in; never guards
//   aggressive LIGHT LIGHT HEAVY in reach, SPECIAL when it can; guards only a slow (HEAVY / SPECIAL) wind-up it saw (8-tick lag)
//   balanced   guards any wind-up it saw in time, strikes back LIGHT LIGHT HEAVY with 3+ STA cells, rests when tired, SPECIAL into a
//              recovering rival
//   turtle     holds GUARD, one LIGHT after each blocked blow, SPECIAL into a recovering rival
// and reports fight length, win rate, WINDED / GUARD TIRED shares and SPECIAL uses per side.
//
// Usage (after npm run build):
//   node scripts/bench-rival-scaling.mjs [--n 12] [--player new|mid|qa|all] [--mode before|after|both] [--styles balanced,...]
//   before = today's issue (tier WOLF curve, no scaling); after = rivalScale on (HOLOCITY_RIVAL_SCALING).
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const { buildFightReplayIssue } = require('../lib/rival/fightReplayIssue.js');
const { getHolobotBattleStats } = require('../lib/lib/progression.js');
const { rivalTierBattleStats } = require('../lib/lib/rivalTierStats.js');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const N = Number(arg('n', '12'));
const PLAYERS = {
  new: { botId: 'tora', level: 1, boosts: {} },
  mid: { botId: 'ace', level: 12, boosts: { attack: 40, defense: 30, health: 30, speed: 20 } },
  qa: { botId: 'ace', level: 21, boosts: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } },
};
// The rival host's tier for each rank (fightRankForTier: tiers 0-1 rookie, 2-3 starter, 4 champion, 5-6 rare, 7-8 elite, 9+ legendary)
const RANK_TIER = { Rookie: 0, Starter: 2, Champion: 4, Rare: 5, Elite: 7, Legendary: 9 };
const RIVALS = ['wolf', 'ace', 'kuma', 'ken', 'tora', 'shadow'];
const which = arg('player', 'mid'), players = which === 'all' ? Object.keys(PLAYERS) : which.split(',');
const modes = arg('mode', 'both') === 'both' ? ['before', 'after'] : [arg('mode', 'both')];
const styles = arg('styles', 'masher,aggressive,balanced,turtle').split(',');

export function playerCombatantFor(p) {
  const s = getHolobotBattleStats(p.botId.toUpperCase(), p.level, p.boosts);
  return { holobotId: p.botId, level: p.level, maxHealth: s.maxHP, currentHealth: s.maxHP, attack: s.attack, defense: s.defense, speed: s.speed, intelligence: s.intelligence, statSource: 'progression' };
}
export function townRival(rivalId, tier) {
  const t = rivalTierBattleStats(tier);
  return { holobotId: rivalId, level: t.level, maxHealth: t.maxHealth, currentHealth: t.maxHealth, attack: t.attack, defense: t.defense, speed: t.speed, intelligence: t.intelligence };
}
export function benchIssue({ player, rivalId, tier, seed, scaled }) {
  return buildFightReplayIssue({ battleId: 'rb_bench', seed, tier, mentor: false, player: [player], opponent: [townRival(rivalId, tier)],
    chase: true, attrs: true, tempo: true, live: true, guardHold: true, staminaWind: true, ...(scaled ? { rivalScale: {} } : {}) });
}

const REACT = 8;
/** Play an issue to the end with a scripted player; returns the fight's measures. */
export function playIssue(issue, style) {
  const { rules, chase, attrs, tempo } = F.rulesDocFromJson(issue.rules);
  let core = null, guardHeld = false, combo = 0, nextPress = 0, openUntil = -1;
  const out = { p: { winded: 0, tired: 0, spec: 0 }, c: { winded: 0, tired: 0, spec: 0 } }, was = [false, false];
  const me = rules.fighters.find(f => f.side === 0);
  const reach = me.reachLightMm + (me.reachLightMm <= rules.closeKitReachMm ? rules.closeKitLungeMm : rules.lungeLightMm);
  const driver = { read(t) {
    const inp = F.idleInput();
    if (!core) return inp;
    const a = core.F[0], b = core.F[1], d = core.distanceMm;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    if (d > reach - 300) { inp.moveX = Math.round(dx / len * 127); inp.moveZ = Math.round(dz / len * 127); }
    const tier = a.sync >= rules.specialFullSync ? 2 : a.sync >= rules.specialHalfSync ? 1 : 0;
    const winding = b.action === F.Action.Telegraph && t - b.atkStart >= REACT && b.atkContact >= t;
    const slow = winding && (b.atkMove === F.Move.Heavy || b.atkMove === F.Move.Special);
    const open = b.action === F.Action.Recovery || b.action === F.Action.Stun;
    let press = 0, guard = false;
    if (style === 'masher') { if (tier) press = F.Press.Special; else if (t % 5 === 0) press = F.Press.Light; }
    else if (style === 'aggressive') {
      guard = slow;
      if (!guard && t >= nextPress && d <= reach) { if (tier) { press = F.Press.Special; nextPress = t + 12; } else { press = combo++ % 3 === 2 ? F.Press.Heavy : F.Press.Light; nextPress = t + 7; } }
    } else if (style === 'balanced') {
      guard = winding;
      if (!guard && t >= nextPress) {
        if (tier && open && d <= me.reachSpecialMm) { press = F.Press.Special; nextPress = t + 14; }
        else if (d <= reach && a.sta >= 300) { press = combo++ % 3 === 2 ? F.Press.Heavy : F.Press.Light; nextPress = t + 8; }
        else combo = 0;
      }
    } else {
      if (t < openUntil || (open && !winding)) { if (t >= nextPress) { if (tier && open && d <= me.reachSpecialMm) { press = F.Press.Special; nextPress = t + 14; } else if (d <= reach) { press = F.Press.Light; nextPress = t + 9; } } }
      else guard = true;
    }
    if (press === F.Press.Special) inp.specialTier = tier === 2 ? 2 : 1;
    inp.guard = guard; inp.press = press; guardHeld = guard;
    return inp;
  } };
  const res = F.runFight(rules, issue.seed, { inputs: driver }, { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill: issue.cpu.rank }, {
    recordEvents: true, chase, attrs, tempo,
    onTick: (t, _i, c) => {
      core = c;
      for (const e of c.events.filter(x => x.tick === t)) {
        const s = e.side === 0 ? out.p : out.c;
        if (e.kind === F.EventKind.GuardLower && e.value === 1) s.tired++;
        if (e.kind === F.EventKind.Telegraph && e.move === F.Move.Special) s.spec++;
        if (style === 'turtle' && e.kind === F.EventKind.Contact && e.side === 1 && (e.outcome === F.Outcome.Blocked || e.outcome === F.Outcome.Perfect)) openUntil = t + 10;
      }
      for (let k = 0; k < 2; k++) { const w = c.winded(k), s = k ? out.c : out.p; if (w && !was[k]) s.winded++; was[k] = w; }
    } });
  const a = res.core.F[0];
  return { secs: (res.endTick + 1) / 30, win: res.winner === 0, reason: res.reason, hp: Math.max(0, a.hp) / a.maxHp, ...out };
}

const med = xs => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const pct = (rs, f) => `${Math.round(100 * rs.filter(f).length / rs.length)}%`.padStart(4);
const mean = (xs) => (xs.reduce((x, y) => x + y, 0) / Math.max(1, xs.length));

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const pk of players) {
    const p = PLAYERS[pk], player = playerCombatantFor(p);
    console.log(`\n## ${pk}: ${p.botId.toUpperCase()} LV${p.level} ${JSON.stringify(p.boosts)} · town rival at the rank's tier · duel-rules-8 · ${N} fights per cell`);
    console.log('rank      mode   style       med  win  P.wind C.wind P.tired C.tired P.spec C.spec P.HP');
    for (const rank of Object.keys(RANK_TIER)) for (const mode of modes) for (const style of styles) {
      const rs = [];
      for (let i = 0; i < N; i++) {
        const seed = createHash('sha256').update(`${pk}:${rank}:${i}`).digest('hex');
        rs.push(playIssue(benchIssue({ player, rivalId: RIVALS[i % RIVALS.length], tier: RANK_TIER[rank], seed, scaled: mode === 'after' }), style));
      }
      console.log(`${rank.padEnd(9)} ${mode.padEnd(6)} ${style.padEnd(10)} ${med(rs.map(r => r.secs)).toFixed(0).padStart(3)}s ${pct(rs, r => r.win)} ${pct(rs, r => r.p.winded)}   ${pct(rs, r => r.c.winded)}   ${pct(rs, r => r.p.tired)}    ${pct(rs, r => r.c.tired)}    ${mean(rs.map(r => r.p.spec)).toFixed(1).padStart(4)}   ${mean(rs.map(r => r.c.spec)).toFixed(1).padStart(4)}  ${Math.round(100 * mean(rs.filter(r => r.win).map(r => r.hp)))}%`);
    }
  }
}
