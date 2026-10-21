#!/usr/bin/env node
// fight-host-1 divergence tool (needs `npm run build`). Names the FIRST divergent tick and the differing state fields.
//   node scripts/fight-sim3-diff.mjs <frozen-vector.json>                     TS twin vs a Schemas/fixtures/duel-sim-3 vector
//   node scripts/fight-sim3-diff.mjs <brain-vectors.json> --vector <name>     TS twin vs a cold-oracle brain vector
//   ... --oracle      at the first divergent tick, ask the C# cold oracle (scripts/fight-sim3-oracle/oracle.py state) for its
//                     state bytes and print the field-by-field diff (needs the HolobotsUnity checkout + Unity's bundled SDK)
//   node scripts/fight-sim3-diff.mjs --issue <duel-block.json> --log <duel-inputs-2.json>
//                     a rejected settle: the host replay vs the client's hash trail, first divergent window, host state there
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const F = require('../lib/sim/fight/index.js');
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const window = (events, t, r = 5) => events.filter(e => e.tick >= t - r && e.tick <= t).map(F.eventText);
const show = (title, o) => { console.log(title); for (const [k, v] of Object.entries(o)) console.log('  ' + k.padEnd(28) + v); };

function driversOf(doc) {
  const d = doc.drivers;
  if (typeof d[0] === 'string') {
    const script = F.FightScript.fromJson(doc.script);
    const one = () => (d[0] === 'stub-brain' ? { brain: new F.FightStubBrain(), profile: null, skill: null } : { inputs: script });
    return [one(), one()];
  }
  return d.map((x, s) => (x.kind === 'log' ? { inputs: F.logInputs(F.parseInputLog(doc.log), s) } : { brain: new F.FightCoreBrain(), profile: x.profile, skill: x.skill }));
}

if (opt('--issue')) {
  const issue = json(opt('--issue')), log = F.parseInputLog(json(opt('--log')));
  const r = F.runFight(F.rulesFromJson(issue.rules), issue.seed, { inputs: F.logInputs(log, 0) },
    { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill: issue.cpu.rank }, { tickHashes: true, maxTicks: log.tickCount });
  const k = F.firstDivergentSample(log, r.tickHashes, r.endTick + 1);
  if (k < 0) { console.log('REPLAY OK: the host reproduces every sample + the final hash; winner', r.winner); process.exit(0); }
  const to = k < log.hashes.length ? F.sampleTick(log, k) : log.tickCount - 1;
  console.log(`REPLAY MISMATCH at window ${k} (ticks ${k * log.hashEvery}..${to}); host ran ${r.endTick + 1} ticks, log has ${log.tickCount}`);
  console.log('host events in the window:', window(r.events, to, to - k * log.hashEvery));
  process.exit(1);
}

const path = argv.find(a => !a.startsWith('--') && a !== opt('--vector'));
let doc = json(path);
if (opt('--vector')) doc = doc.vectors.find(v => v.name === opt('--vector'));
const ex = doc.expected;
const expected = ex.tickHashes ?? (ex.tickHashPrefixes ? ex.tickHashPrefixes.match(/.{16}/g) : null);
const rules = F.rulesFromJson(doc.rules);
const [d0, d1] = driversOf(doc);
const r = F.runFight(rules, doc.seed, d0, d1, { tickHashes: true });
const div = expected ? F.firstDivergence(expected, r.tickHashes) : null;
if (!div && r.finalHash === ex.finalHash) { console.log(`PARITY OK: ${doc.name} — ${r.tickHashes.size} tick hashes, final ${r.finalHash.slice(0, 16)}`); process.exit(0); }
const t = div ? div.tick : r.endTick;
console.log(`DIVERGENCE: ${doc.name} first differs at tick ${t} (expected ${div?.expected.slice(0, 16)}, TS ${div?.actual?.slice(0, 16)})`);
console.log('TS events up to that tick:', window(r.events, t));
const ts = F.runFight(rules, doc.seed, ...driversOf(doc), { maxTicks: t + 1 }).core;
if (argv.includes('--oracle')) {
  const args = [new URL('./fight-sim3-oracle/oracle.py', import.meta.url).pathname, 'state', path, String(t), ...(opt('--vector') ? [opt('--vector')] : [])];
  const cs = Buffer.from(execFileSync('python3', args, { encoding: 'utf8' }).trim(), 'hex');
  const diff = F.diffState(cs, ts.stateBytes(), rules);
  if (diff.length === 0) console.log(`C# and TS agree at tick ${t}: the vector's expected trail was produced from different rules/seed/inputs than this file now holds`);
  else show(`state fields differing at tick ${t} (C# expected vs TS actual):`, Object.fromEntries(diff.map(d => [d.field, `${d.expected} vs ${d.actual}`])));
} else {
  show(`TS state at tick ${t} (re-run with --oracle for the C# field diff):`, F.coreFields(ts));
}
process.exit(1);
