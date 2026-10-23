// fight-host-1 test helpers: build an input-log issue from synthetic combatants, and produce a CLIENT log for it the way
// Unity does (local twin + recorder): a scripted player, or a "smart" player whose presses come from a brain run (two
// phases: the brain's decisions are recorded in run 1 and replayed as plain inputs, so the logged side never draws).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const F = require('../../lib/sim/fight/index.js');
export const { buildFightReplayIssue } = require('../../lib/rival/fightReplayIssue.js');
export const { verifyFightReplay, FightReplayError } = require('../../lib/sim/fight/replay.js');
export const { recordFightLog } = require('../../lib/sim/fight/record.js');

export const combatant = (holobotId, maxHealth = 480, attack = 90, defense = 45, currentHealth) =>
  ({ holobotId, maxHealth, attack, defense, ...(currentHealth === undefined ? {} : { currentHealth }) });

export function issueFor({ battleId = 'rb_fixture000000000000000000', seed = '5eed'.repeat(16), tier = 4, mentor = false,
  player = [combatant('ace')], opponent = [combatant('wolf', 450, 85, 40)], chase = false } = {}) {
  const issue = buildFightReplayIssue({ battleId, seed, tier, mentor, player, opponent, chase });
  if (!issue) throw Error('unexpressible lineup');
  return issue;
}

/** A pure-of-tick scripted player (FightScript keys). */
export function scriptedPlayer(keys) { return F.FightScript.fromJson(keys.map(k => ({ s: 0, ...k }))); }

/** Run 1: brain(profileId, rank) vs the issued CPU; its side-0 decisions become a plain per-tick input list. */
export function smartPlayer(issue, profileId = 'ace', rank = 'Legendary') {
  const { rules, chase } = F.rulesDocFromJson(issue.rules);
  const rec = [];
  F.runFight(rules, issue.seed,
    { brain: new F.FightCoreBrain(), profile: F.issuedProfile(F.brainProfile(profileId)), skill: F.issuedSkill(rank) },
    { brain: new F.FightCoreBrain(), profile: issue.cpu.profile, skill: issue.cpu.rank },
    { recordEvents: false, chase, onTick: (_t, inputs) => rec.push(F.toRecord(inputs[0])) });
  return { read: t => (t < rec.length ? F.toInput(rec[t]) : F.toInput(F.idleRecord())) };
}

export const clone = o => structuredClone(o);
