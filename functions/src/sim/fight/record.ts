import { FightReplayIssueWire } from '../../shared/fightReplayContract';
import { FightCoreBrain } from './brain';
import { FightProfile, FightSkill } from './contracts';
import { DuelInputs2Wire, FightTickRecord, inputLogToWire, toRecord } from './inputLog';
import { rulesFromJson } from './rules';
import { FightInputs, runFight } from './runner';

/**
 * The CLIENT's side of input-log mode, in TS (what Unity's FightInputRecorder + local C# twin produce): run the issued
 * fight with the player's per-tick inputs against the seeded CPU brain, record both sides' records and the hash trail, and
 * seal a duel-inputs-2 log. The host NEVER settles from this; it exists for tests, the cost bench and as an executable spec
 * for the editor lane (fight-present-1). `playerInputs` must be a pure function of the tick (no host state).
 */
export function recordFightLog(issue: FightReplayIssueWire, playerInputs: FightInputs, hashEvery = 30): { wire: DuelInputs2Wire; endTick: number; winner: number } {
  const rules = rulesFromJson(issue.rules);
  const rec: [FightTickRecord[], FightTickRecord[]] = [[], []];
  const res = runFight(rules, issue.seed, { inputs: playerInputs }, { brain: new FightCoreBrain(), profile: issue.cpu.profile as FightProfile, skill: issue.cpu.rank as FightSkill }, {
    hashAt: t => (t + 1) % hashEvery === 0, recordEvents: false,
    onTick: (_t, inputs) => { rec[0].push(toRecord(inputs[0])); rec[1].push(toRecord(inputs[1])); },
  });
  const tickCount = res.endTick + 1;
  const hashes: string[] = [];
  for (let k = 0; k < Math.trunc(tickCount / hashEvery); k++) hashes.push(res.tickHashes.get((k + 1) * hashEvery - 1)!.slice(0, 16));
  const wire = inputLogToWire({
    rulesId: issue.rulesId, rulesHash: issue.rulesHash, seed: issue.seed, tickCount, hashEvery, hashes, finalHash: res.finalHash,
    sides: [
      { side: 0, source: 'player', rank: null, roster: issue.player.roster.map(r => ({ id: r.fighterId, profile: null })), ticks: rec[0] },
      { side: 1, source: 'cpu', rank: issue.cpu.rank.rank, roster: issue.cpu.roster.map(r => ({ id: r.fighterId, profile: r.profile })), ticks: rec[1] },
    ],
  });
  return { wire, endTick: res.endTick, winner: res.winner };
}
