import { ARENA_GATHERING_SCHEMA, gatheringRoster } from './arenaGathering';
import { readStoryFlags } from './storyFlags';
import { desktopPracticeCommands } from '../lib/desktopPracticeCommands';
import { IssueReply, RivalBattleRecord, RivalError, rivalScaledCombatant, rivalScaledCombatantStats } from '../lib/rivalLadder';

export function gatheringRivalRequest(raw: unknown): string | undefined {
  const c = raw as Record<string, unknown>;
  if (c.storySchema !== ARENA_GATHERING_SCHEMA) return undefined;
  if (c.schemaVersion !== 'rival-battle-3' || c.operation !== 'issue' || typeof c.rivalId !== 'string') throw new RivalError('invalid_request');
  return c.rivalId;
}
export function bindGatheringRival(uid: string, profile: Record<string, unknown>, citizenId: string,
  result: {battle:RivalBattleRecord;reply:IssueReply}) {
  let seen: boolean;
  try { seen = readStoryFlags(profile.storyFlags).arenaGatheringSeen; }
  catch { throw new RivalError('unavailable'); }
  const row = gatheringRoster(uid).find(r => r.citizenId === citizenId);
  if (!seen || !row) throw new RivalError('invalid_request');
  const pilot = {pilotId:row.citizenId,displayName:row.pilotName,tier:row.rank};
  const combatant = rivalScaledCombatant(row.holobotId,result.battle.tier);
  result.battle.lineup = {opponentPilot:pilot,opponentSquad:[combatant]};
  result.reply.encounter = {...result.reply.encounter,opponentPilot:{...pilot},opponentSquad:[{
    ...combatant,...rivalScaledCombatantStats(result.battle.tier),commandRules:desktopPracticeCommands(row.holobotId),
  }]};
}
