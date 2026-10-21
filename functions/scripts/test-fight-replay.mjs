// fight-host-1: input-log replay verification (pure, no emulator). The host re-runs the client's duel-inputs-2 log under the
// ISSUED rules/seed/profile/rank and settles what it computed; every tamper is refused at the first divergent window/field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { ajv2020 } from './lib/ajv2020.mjs';
import { F, buildFightReplayIssue, verifyFightReplay, FightReplayError, recordFightLog, combatant, issueFor, scriptedPlayer, smartPlayer, clone } from './lib/fight-replay-helpers.mjs';
const ajv = ajv2020();
const receiptSchema = ajv.compile(JSON.parse(readFileSync(new URL('../../Schemas/duel-receipt-2.json', import.meta.url))));
const inputsSchema = ajv.compile(JSON.parse(readFileSync(new URL('../../Schemas/duel-inputs-2.json', import.meta.url))));
const rulesSchema = ajv.compile(JSON.parse(readFileSync(new URL('../../Schemas/duel-rules-3.json', import.meta.url))));
const BATTLE = 'rb_fixture000000000000000000';

const rejects = (fn, check) => assert.throws(fn, e => e instanceof FightReplayError && check(e));
const verify = (issue, log) => verifyFightReplay(issue, log, { battleId: BATTLE });

/** Re-seal a tampered log's hash trail exactly as a cheating client would (so only the replay can catch it). */
function resealCpuOnly(wire, mutate) {
  const log = F.parseInputLog(wire); mutate(log); return F.inputLogToWire(log);
}

test('issue block: duel-rules-3 snapshot validates, hash recomputes, ids/kits/profiles/rank pinned', () => {
  const issue = issueFor({ player: [combatant('ace'), combatant('kuma', 520, 80, 60, 208.4)], opponent: [combatant('ace', 450), combatant('gama')], tier: 7 });
  assert.equal(rulesSchema(issue.rules), true, JSON.stringify(rulesSchema.errors));
  assert.equal(F.rulesHash(F.rulesFromJson(issue.rules)), issue.rulesHash);
  assert.deepEqual(issue.rules.fighters.map(f => [f.id, f.side]), [['ace', 0], ['kuma', 0], ['cpu-ace', 1], ['cpu-gama', 1]], 'a mirror bot gets a distinct fighter id');
  assert.equal(issue.rules.fighters[1].hp, 208, 'current HP floored like the resolver (duelFighterFromCombatant)');
  assert.equal(issue.cpu.rank.rank, 'elite'); assert.equal(issue.cpu.profile.id, 'ace', 'the brain is bound to the lead CPU bot');
  assert.deepEqual(issue.cpu.roster.map(r => r.profile), ['ace', 'gama']);
  assert.equal(issue.rulesId, 'duel-rules-3:' + BATTLE); assert.equal(issue.rules.rules.maxTicks, 5400);
  assert.equal(issueFor({ mentor: true, tier: 9 }).cpu.rank.rank, 'rookie');
  assert.equal(buildFightReplayIssue({ battleId: BATTLE, seed: '0'.repeat(64), tier: 0, mentor: false, player: [combatant('zell_unknown')], opponent: [combatant('wolf')] }), null, 'no kit row: caller keeps the existing mode');
  assert.equal(buildFightReplayIssue({ battleId: BATTLE, seed: '0'.repeat(64), tier: 0, mentor: false, player: [combatant('ace', 480, 90, 45, 0)], opponent: [combatant('wolf')] }), null, 'no standing player bot');
});

test('happy path: the host replays a real client log and computes the outcome + duel-receipt-2', () => {
  const issue = issueFor();
  const client = recordFightLog(issue, smartPlayer(issue));
  assert.equal(inputsSchema(client.wire), true);
  const v = verify(issue, client.wire);
  assert.equal(receiptSchema(v.receipt), true, JSON.stringify(receiptSchema.errors));
  assert.equal(v.receipt.winner, client.winner === 0 ? 'player' : client.winner === 1 ? 'opponent' : 'draw');
  assert.equal(v.receipt.endTick, client.endTick); assert.equal(v.receipt.tickCount, client.endTick + 1);
  assert.equal(v.receipt.checkpoints.finalHash, client.wire.finalHash);
  assert.deepEqual(v.fieldedHolobotIds, ['ace']);
  assert.equal(v.receipt.battleId, BATTLE); assert.equal(v.receipt.seed, issue.seed); assert.equal(v.receipt.verified, true);
  assert.equal(JSON.stringify(verify(issue, JSON.stringify(client.wire)).receipt), JSON.stringify(v.receipt), 'object or compact wire string: same receipt');
  // the receipt is a pure function of (issue, log): no clock, no randomness
  assert.deepEqual(verify(issue, clone(client.wire)).receipt, v.receipt);
});

test('a losing / passive player: the host computes the loss (no client verdict exists on the wire)', () => {
  const issue = issueFor({ opponent: [combatant('wolf', 450, 140, 40)] });
  const client = recordFightLog(issue, scriptedPlayer([{ t: 0, move: [-60, 0] }]));
  const v = verify(issue, client.wire);
  assert.equal(v.receipt.winner, 'opponent');
  assert.ok(v.receipt.playerFinal[0].currentHealth < issue.rules.fighters[0].hp);
});

test('tampered player log (stick rewritten from tick 100, trail kept) -> replay_mismatch at the first divergent window', () => {
  const issue = issueFor();
  const client = recordFightLog(issue, smartPlayer(issue));
  const log = F.parseInputLog(client.wire);
  for (let t = 100; t < log.tickCount; t++) log.sides[0].ticks[t] = { ...log.sides[0].ticks[t], moveX: 127, moveZ: 0 };
  // independent expectation: run the forged inputs through the twin with every tick hashed; the first sample tick whose
  // hash differs from the client's trail is the window the host must name
  const forgedRun = F.runFight(F.rulesFromJson(issue.rules), issue.seed, { inputs: F.logInputs(log, 0) },
    { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill: issue.cpu.rank }, { tickHashes: true, recordEvents: false });
  let k = 0; while (forgedRun.tickHashes.get(F.sampleTick(log, k))?.startsWith(log.hashes[k])) k++;
  assert.ok(k >= 3 && k < log.hashes.length, 'the forgery bites after tick 100 and inside the trail');
  rejects(() => verify(issue, F.inputLogToWire(log)), e => e.code === 'replay_mismatch' && e.detail.reason === 'hash'
    && e.detail.window === k && e.detail.fromTick === k * 30 && e.detail.toTick === k * 30 + 29);
});

test('a press that changes no hashed state (a buffered heavy that expires unused) replays to the SAME outcome', () => {
  // The sampled trail cannot see it, and it cannot matter: the host settles what the replay computed, which is unchanged.
  const issue = issueFor();
  const client = recordFightLog(issue, smartPlayer(issue));
  const log = F.parseInputLog(client.wire);
  log.sides[0].ticks[121] = { ...log.sides[0].ticks[121], press: 2 };
  const v = verify(issue, F.inputLogToWire(log)), base = verify(issue, client.wire);
  assert.deepEqual({ ...v.receipt, inputsHash: '' }, { ...base.receipt, inputsHash: '' });
  assert.notEqual(v.receipt.inputsHash, base.receipt.inputsHash, 'the receipt still pins exactly which log was replayed');
});

test('tampered identity: seed / rules id / rules hash / roster / profile / rank are each refused by field', () => {
  const issue = issueFor();
  const { wire } = recordFightLog(issue, smartPlayer(issue));
  const cases = [
    ['seed', l => { l.seed = 'a' + l.seed.slice(1); }],
    ['rulesId', l => { l.rulesId = 'duel-rules-3:rb_other'; }],
    ['rulesHash', l => { l.rulesHash = 'b'.repeat(64); }],
    ['sides[1].rank', l => { l.sides[1].rank = 'rookie'; }],
    ['sides[1].roster', l => { l.sides[1].roster[0].profile = 'kuma'; }],
    ['sides[0].roster', l => { l.sides[0].roster[0].id = 'kuma'; }],
  ];
  for (const [field, f] of cases) {
    const w = clone(wire); f(w);
    rejects(() => verify(issue, w), e => e.code === 'replay_mismatch' && e.detail.reason === 'identity' && e.detail.field === field);
  }
  // a client cannot swap in its own rules either: the host only ever runs the ISSUED snapshot
  const easier = clone(issue); easier.rules.rules.counterPm = 5000;
  rejects(() => verify(easier, wire), e => e.code === 'invalid_issue');
});

test('tampered CPU stream (trail kept) -> replay_mismatch cpu_stream at the first differing tick', () => {
  const issue = issueFor();
  const { wire } = recordFightLog(issue, smartPlayer(issue));
  const forged = resealCpuOnly(wire, l => { const r = l.sides[1].ticks[77]; l.sides[1].ticks[77] = { ...r, moveX: r.moveX === 5 ? 6 : 5 }; });
  rejects(() => verify(issue, forged), e => e.code === 'replay_mismatch' && e.detail.reason === 'cpu_stream' && e.detail.tick === 77);
});

test('final hash / short log / long log / undecodable log are refused', () => {
  const issue = issueFor();
  const { wire } = recordFightLog(issue, smartPlayer(issue));
  const fin = clone(wire); fin.finalHash = 'c'.repeat(64);
  rejects(() => verify(issue, fin), e => e.detail.reason === 'final_hash');
  // a client that stops recording before the KO (a sealed but unfinished fight): every sample it has matches -> incomplete
  const log = F.parseInputLog(wire);
  const cut = 300; log.tickCount = cut; log.sides.forEach(s => { s.ticks = s.ticks.slice(0, cut); });
  log.hashes = log.hashes.slice(0, Math.trunc(cut / log.hashEvery));
  const core = F.runFight(F.rulesFromJson(issue.rules), issue.seed, { inputs: F.logInputs(F.parseInputLog(wire), 0) },
    { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill: issue.cpu.rank }, { maxTicks: cut, recordEvents: false });
  log.finalHash = core.finalHash;
  rejects(() => verify(issue, F.inputLogToWire(log)), e => e.detail.reason === 'incomplete');
  const bad = clone(wire); bad.sides[0].stream = 'AR==';
  rejects(() => verify(issue, bad), e => e.code === 'invalid_log' && e.detail.decoderCode === 'invalid_stream');
  rejects(() => verify(issue, '{"nope":'), e => e.code === 'invalid_log' && e.detail.decoderCode === 'invalid_json');
  rejects(() => verify(issue, 'x'.repeat(300000)), e => e.code === 'invalid_log' && e.detail.decoderCode === 'too_large');
});

test('3v3: a player bench deploy and CPU forced swaps; fielded = every player bot that actually fought', () => {
  const issue = issueFor({ player: [combatant('ace', 300, 110, 35), combatant('kuma', 300, 110, 35)],
    opponent: [combatant('wolf', 260, 105, 30), combatant('gama', 260, 105, 30), combatant('kurai', 260, 105, 30)], tier: 5 });
  const brain = smartPlayer(issue, 'ace', 'Legendary');
  const withDeploy = { read: t => { const i = brain.read(t); return t === 45 ? { ...i, deploy: 1 } : i; } };
  const client = recordFightLog(issue, withDeploy);
  const v = verify(issue, client.wire);
  assert.deepEqual(v.fieldedHolobotIds, ['ace', 'kuma']);
  assert.equal(v.receipt.witness.sides[0].swaps, 1, 'the voluntary deploy at tick 45');
  assert.ok(v.receipt.witness.sides[1].forcedSwaps >= 1 || v.receipt.winner === 'opponent');
  assert.equal(receiptSchema(v.receipt), true, JSON.stringify(receiptSchema.errors));
});

test('cost: replay CPU per 60 s of fight (budget ~85 ms; design-1 gate <= 250 ms p95 for 180 s)', () => {
  const issue = issueFor({ player: [combatant('ace', 100000, 90, 45)], opponent: [combatant('wolf', 100000, 85, 40)] });
  const client = recordFightLog(issue, smartPlayer(issue, 'ace', 'Champion'));
  assert.equal(client.endTick, 5399, '180 s timeout fight');
  const runs = [];
  for (let i = 0; i < 7; i++) { const v = verify(issue, client.wire); runs.push(v.replayMs); }
  runs.sort((a, b) => a - b);
  const p50 = runs[3], per60 = p50 / 3;
  console.log(`fight replay cost: 180 s fight p50 ${p50.toFixed(1)} ms (max ${runs[6].toFixed(1)} ms) = ${per60.toFixed(1)} ms per 60 s, ${(p50 * 1000 / 5400).toFixed(1)} us/tick`);
  assert.ok(runs[6] <= 250, `p100 ${runs[6]} ms over the 250 ms design-1 gate`);
});
