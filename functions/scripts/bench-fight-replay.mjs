#!/usr/bin/env node
// fight-host-1 cost bench (needs `npm run build`): host replay CPU for the input-log settle (brief C0 budget ~85 ms per 60 s;
// design-1 gate <= 250 ms p95 for 180 s). 20 seeds x 180 s timeout fights (high-HP lineup so nothing KOs), Champion-driven
// player vs the issued CPU; reports the settle path (hash only at the 30-tick samples + the last tick) and the full per-tick
// SHA-256 path (the parity / diff tool), as p50 / p95 ms per 180 s and per 60 s.
import { F, issueFor, recordFightLog, smartPlayer, combatant, verifyFightReplay } from './lib/fight-replay-helpers.mjs';
const N = Number(process.argv[2] ?? 20);
const settle = [], full = [], kb = [];
const pairs = [['ace', 'wolf'], ['hare', 'shadow'], ['kuma', 'jusan'], ['tora', 'era'], ['kurai', 'gama']];
for (let i = 0; i < N; i++) {
  const [p, o] = pairs[i % pairs.length];
  const issue = issueFor({ battleId: `rb_bench${String(i).padStart(20, '0')}`, seed: (i + 1).toString(16).padStart(8, '0').repeat(8),
    player: [combatant(p, 1000000, 90, 45)], opponent: [combatant(o, 1000000, 85, 40)], tier: i % 10 });
  const { wire } = recordFightLog(issue, smartPlayer(issue, p, 'Champion'));
  kb.push(JSON.stringify(wire).length / 1024);
  verifyFightReplay(issue, wire, { battleId: issue.rulesId.slice(13) });   // warm
  settle.push(verifyFightReplay(issue, wire, { battleId: issue.rulesId.slice(13) }).replayMs);
  const t0 = performance.now();
  F.runFight(F.rulesFromJson(issue.rules), issue.seed, { inputs: F.logInputs(F.parseInputLog(wire), 0) },
    { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill: issue.cpu.rank }, { tickHashes: true });
  full.push(performance.now() - t0);
}
const q = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const row = (name, xs) => console.log(`${name.padEnd(34)} p50 ${q(xs, .5).toFixed(1).padStart(6)} ms  p95 ${q(xs, .95).toFixed(1).padStart(6)} ms  per 60 s p50 ${(q(xs, .5) / 3).toFixed(1)} / p95 ${(q(xs, .95) / 3).toFixed(1)} ms  (${(q(xs, .5) * 1000 / 5400).toFixed(2)} us/tick)`);
console.log(`node ${process.version}, ${N} x 5400-tick fights; log size p50 ${q(kb, .5).toFixed(1)} KB (180 s), max ${Math.max(...kb).toFixed(1)} KB`);
row('settle replay (sampled hashes)', settle);
row('full per-tick SHA-256 replay', full);
