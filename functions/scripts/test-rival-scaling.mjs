// rival-scaling-1 (owner 2026-11-13, "Scale rivals to you"): with HOLOCITY_RIVAL_SCALING the CPU side of a live fight is a same-level
// Holobot trained like the player (lib/rivalScaling); data only, so a shipped phone (rules-8 brain) verifies a scaled fight exactly
// like any other issue. Scope: town rivals (mentor / story Zell at Rookie), Arena, Guild Court, wild duels, expeditions; never PvP.
// Golden fixture the phone replays hash for hash (ringduelScaledIssue.test.ts):
//   WRITE_GOLDEN=1 node --test scripts/test-rival-scaling.mjs   rewrites scripts/fixtures/rules8-scaled-golden.json
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const seedOf = k => createHash('sha256').update(String(k)).digest('hex');
import { createRequire } from 'node:module';
import { F, buildFightReplayIssue, recordFightLog, smartPlayer, verifyFightReplay } from './lib/fight-replay-helpers.mjs';
import { benchIssue, playIssue, playerCombatantFor, townRival } from './bench-rival-scaling.mjs';
const require = createRequire(import.meta.url);
const S = require('../lib/lib/rivalScaling.js');
const { fightRankForTier } = require('../lib/rival/fightReplayIssue.js');

const base = (o = {}) => ({ battleId: 'rb_scaling_case', seed: '9a'.repeat(32), tier: 4, mentor: false, chase: true, attrs: true, tempo: true, live: true, guardHold: true, staminaWind: true,
  player: [{ holobotId: 'ace', level: 12, maxHealth: 210, attack: 133, defense: 107, speed: 113, intelligence: 77, statSource: 'progression' }],
  opponent: [townRival('wolf', 4)], ...o });

const GOLDEN8S = new URL('./fixtures/rules8-scaled-golden.json', import.meta.url);
function goldenCase(input, note, rank) {
  const issue = buildFightReplayIssue(input);
  const log = recordFightLog(issue, smartPlayer(issue, 'ace', rank)).wire;
  const receipt = verifyFightReplay(issue, log, { battleId: input.battleId }).receipt;
  return { note, input, issue, log, receipt };
}
function goldens() {
  const player = playerCombatantFor({ botId: 'ace', level: 21, boosts: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
  const scaled8 = goldenCase({ ...base({ battleId: 'rb_rules8_scaled_golden', seed: '83'.repeat(32), tier: 4, player: [player], opponent: [townRival('wolf', 4)] }), rivalScale: {} },
    'rival-scaling-1: a SCALED duel-rules-8 fight (QA-boosted ACE LV21 vs a Champion WOLF town rival scaled to it); an older phone replays it with its rules-8 brain', 'Champion');
  return { scaled8 };
}
test('golden fight: a scaled rules-8 fight verifies and lasts; the fixture the phone replays is reproduced', () => {
  const { scaled8 } = goldens();
  assert.equal(scaled8.receipt.verified, true);
  assert.match(scaled8.issue.rulesId, /^duel-rules-8:/);
  console.log(`# scaled rules-8 golden: ${scaled8.receipt.reason}@${scaled8.receipt.endTick} ${scaled8.receipt.winner}`);
  assert.ok(scaled8.receipt.endTick > 20 * 30, 'the scaled fight lasts more than 20 s (it ended in seconds before scaling)');
  if (process.env.WRITE_GOLDEN === '1') writeFileSync(GOLDEN8S, JSON.stringify(scaled8, null, 1) + '\n');
  assert.equal(JSON.stringify(JSON.parse(readFileSync(GOLDEN8S, 'utf8'))), JSON.stringify(scaled8));
});

// ------------------------------------------------------------------ (A) rival scaling
test('scaling off (the default): the issue is byte for byte today\'s', () => {
  assert.equal(S.RIVAL_SCALING_FLAG, 'HOLOCITY_RIVAL_SCALING');
  assert.equal(S.rivalScalingEnabled({}), false); assert.equal(S.rivalScalingEnabled({ HOLOCITY_RIVAL_SCALING: '1' }), true);
  const a = buildFightReplayIssue(base()), b = buildFightReplayIssue(base({ rivalScale: undefined }));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('scaling: the CPU = its own fight row at the player level + the player\'s training, then the rank preset; hpScaleLights = the preset', () => {
  const player = playerCombatantFor({ botId: 'ace', level: 21, boosts: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
  for (const tier of [0, 4, 9]) {
    const issue = buildFightReplayIssue({ ...base({ tier, player: [player], opponent: [townRival('kurai', tier)] }), rivalScale: {} });
    const d = F.rulesDocFromJson(issue.rules), [me, cpu] = d.rules.fighters, rank = fightRankForTier(tier), p = S.rivalScalePreset(rank);
    const row = S.fightRowStats('kurai', 21), mineRow = S.fightRowStats('ace', 21);
    const tr = k => Math.max(0, ({ maxHealth: me.maxHp, attack: me.attack, defense: me.defense, speed: me.speed, special: me.special })[k] - mineRow[k]);
    assert.equal(cpu.defense, row.defense + tr('defense')); assert.equal(cpu.speed, row.speed + tr('speed')); assert.equal(cpu.special, row.special + tr('special'));
    assert.equal(cpu.maxHp, Math.round((row.maxHealth + tr('maxHealth')) * p.hpPm / 1000)); assert.equal(cpu.hp, cpu.maxHp);
    assert.equal(cpu.attack, Math.round((row.attack + tr('attack')) * p.atkPm / 1000));
    assert.equal(d.rules.hpScaleLights, p.lights);
    assert.match(issue.rulesId, /^duel-rules-8:/, 'the rules id never moves');
  }
  // the CPU hits harder at each higher rank
  const atk = ['rookie', 'starter', 'champion', 'rare', 'elite', 'legendary'].map(r => S.rivalScalePreset(r).atkPm);
  for (let i = 1; i < atk.length; i++) assert.ok(atk[i] >= atk[i - 1]);
  // a court-style exclusion (parts the beast host already added) is taken off the training
  const t = S.playerTraining({ holobotId: 'ace', level: 10, ...S.fightRowStats('ace', 10), attack: S.fightRowStats('ace', 10).attack + 50 }, { attack: 20 });
  assert.equal(t.attack, 30);
});

test('scaling fixes the 1-3 s fights: a +2000 trained ACE vs Rookie / Legendary town rivals (bench, balanced player)', () => {
  const player = playerCombatantFor({ botId: 'ace', level: 21, boosts: { attack: 2000, defense: 2000, health: 2000, speed: 2000 } });
  const med = (tier, scaled) => { const s = []; for (let i = 0; i < 8; i++) s.push(playIssue(benchIssue({ player, rivalId: ['wolf', 'ace', 'kuma', 'ken'][i % 4], tier, seed: seedOf(`len:${tier}:${i}`), scaled }), 'balanced').secs); s.sort((a, b) => a - b); return s[4]; };
  const before = med(0, false), rookie = med(0, true), legend = med(9, true);
  console.log(`# QA ACE balanced median: before ${before.toFixed(1)} s, scaled Rookie ${rookie.toFixed(1)} s, scaled Legendary ${legend.toFixed(1)} s`);
  assert.ok(before < 5); assert.ok(rookie >= 22 && rookie <= 40); assert.ok(legend >= 40 && legend <= 80); assert.ok(legend > rookie);
});

test('scaling: a CPU that comes in hurt (an expedition beast) keeps its HP fraction; the mentor fights at the Rookie preset', () => {
  const player = playerCombatantFor({ botId: 'ace', level: 15, boosts: { attack: 300, defense: 200 } });
  const wolf = { ...townRival('wolf', 5), statSource: 'progression' };
  const hurt = buildFightReplayIssue({ ...base({ tier: 5, player: [player], opponent: [{ ...wolf, currentHealth: Math.floor(wolf.maxHealth / 2) }] }), rivalScale: {} });
  const cpu = F.rulesDocFromJson(hurt.rules).rules.fighters[1];
  assert.equal(cpu.hp, Math.max(1, Math.floor(Math.floor(wolf.maxHealth / 2) * cpu.maxHp / wolf.maxHealth)));
  const mentor = buildFightReplayIssue({ ...base({ tier: 9, mentor: true, player: [player], opponent: [wolf] }), rivalScale: {} });
  assert.equal(F.rulesDocFromJson(mentor.rules).rules.hpScaleLights, S.rivalScalePreset('Rookie').lights);
  // an expedition-style issue with no rules ask pins hpScaleLights 19 itself: scaling keeps the pinned number
  const pinned = buildFightReplayIssue({ ...base({ tier: 5, tempo: false, live: false, guardHold: false, staminaWind: false, player: [player], opponent: [wolf] }), hpScaleLights: 19, rivalScale: {} });
  assert.equal(F.rulesDocFromJson(pinned.rules).rules.hpScaleLights, 19);
});

test('Elite / Legendary can beat a balanced player (bench: 60-75 % wins); Rookie .. Rare stay friendly (>= 90 %)', () => {
  const player = playerCombatantFor({ botId: 'ace', level: 12, boosts: { attack: 40, defense: 30, health: 30, speed: 20 } });
  const wins = tier => { let w = 0; const n = 24; for (let i = 0; i < n; i++) if (playIssue(benchIssue({ player, rivalId: ['wolf', 'ace', 'kuma', 'ken', 'tora', 'shadow'][i % 6], tier, seed: seedOf(`win:${tier}:${i}`), scaled: true }), 'balanced').win) w++; return w / n; };
  const r = { rookie: wins(0), champion: wins(4), rare: wins(5), elite: wins(7), legendary: wins(9) };
  console.log('# balanced-player win rate (mid ACE LV12) ' + JSON.stringify(r));
  for (const k of ['rookie', 'champion', 'rare']) assert.ok(r[k] >= 0.9, k);
  for (const k of ['elite', 'legendary']) assert.ok(r[k] >= 0.5 && r[k] <= 0.9, k);
  assert.ok(r.legendary <= r.rookie - 0.1);
});
