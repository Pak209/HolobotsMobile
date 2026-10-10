/** DECISIONS #54-1: Zell is the story rival. Server-owned, opt-in; no new rewards.
 * WOLF is a temporary roster stand-in until Pak's thirteenth Holobot exists.
 * The host, not a request field, decides when a issued Zell victory turns him ally.
 */
import { desktopPracticeCommands } from './desktopPracticeCommands';
import { RivalBattleRecord, RivalError, IssueReply, RIVAL_SCHEMA_V3, rivalScaledCombatant, rivalScaledCombatantStats } from './rivalLadder';

export const ZELL_STORY_SCHEMA = 'zell-story-1';
export const ZELL_PILOT_ID = 'zell';
export const ZELL_PLACEHOLDER_HOLOBOT = 'wolf';
export const ZELL_STORY_ENV_FLAG = 'HOLOCITY_ZELL_STORY';
export type ZellPhase = 'unmet' | 'rival' | 'ally';
export type ZellStoryState = {
  schemaVersion: typeof ZELL_STORY_SCHEMA;
  phase: ZellPhase;
  metAtMs: number | null;
  allyAtMs: number | null;
  victoryBattleId: string | null;
};
export type StoryRivalRecord = RivalBattleRecord & { storySchema?: typeof ZELL_STORY_SCHEMA; storyRivalId?: typeof ZELL_PILOT_ID };
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const fail = (): never => { throw new RivalError('unavailable'); };
export function freshZellStory(): ZellStoryState {
  return { schemaVersion: ZELL_STORY_SCHEMA, phase: 'unmet', metAtMs: null, allyAtMs: null, victoryBattleId: null };
}
/** Missing is fresh; malformed is unavailable, never reset (no story/reward reset). */
export function readZellStory(raw: unknown): ZellStoryState {
  if (raw === undefined) return freshZellStory();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  const s = raw as Record<string, unknown>;
  if (s.schemaVersion !== ZELL_STORY_SCHEMA) return fail();
  if (s.phase === 'unmet') {
    if (s.metAtMs !== null || s.allyAtMs !== null || s.victoryBattleId !== null) return fail();
  } else if (s.phase === 'rival') {
    if (!integer(s.metAtMs) || s.allyAtMs !== null || s.victoryBattleId !== null) return fail();
  } else if (s.phase === 'ally') {
    if (!integer(s.metAtMs) || !integer(s.allyAtMs) || s.allyAtMs < s.metAtMs || typeof s.victoryBattleId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(s.victoryBattleId)) return fail();
  } else return fail();
  return { schemaVersion: ZELL_STORY_SCHEMA, phase: s.phase as ZellPhase, metAtMs: s.metAtMs as number | null, allyAtMs: s.allyAtMs as number | null, victoryBattleId: s.victoryBattleId as string | null };
}
export function storyRequest(raw: unknown): { requested: boolean; issueZell: boolean } {
  const c = raw as Record<string, unknown>;
  if (c.storySchema === undefined && c.rivalId === undefined) return { requested: false, issueZell: false };
  if (c.schemaVersion !== RIVAL_SCHEMA_V3 || c.storySchema !== ZELL_STORY_SCHEMA || (c.rivalId !== undefined && (c.operation !== 'issue' || c.rivalId !== ZELL_PILOT_ID))) throw new RivalError('invalid_request');
  return { requested: true, issueZell: c.rivalId === ZELL_PILOT_ID };
}
export function zellStoryView(s: ZellStoryState, enabled: boolean) {
  return { schemaVersion: ZELL_STORY_SCHEMA, pilotId: ZELL_PILOT_ID, phase: s.phase, turnedAlly: s.phase === 'ally', placeholder: true, placeholderHolobotId: ZELL_PLACEHOLDER_HOLOBOT, enabled };
}
export function meetZell(s: ZellStoryState, nowMs: number): ZellStoryState {
  if (!integer(nowMs)) return fail();
  return s.phase === 'unmet' ? { ...s, phase: 'rival', metAtMs: nowMs } : s;
}
/** Use the existing ladder's level/stat scale, commands and rewards; one named rival. */
export function bindZellLineup(result: { battle: RivalBattleRecord; reply: IssueReply }) {
  const pilot = { pilotId: ZELL_PILOT_ID, displayName: 'Zell', tier: result.reply.status.tierLabel };
  const combatant = rivalScaledCombatant(ZELL_PLACEHOLDER_HOLOBOT, result.battle.tier);
  const battle = result.battle as StoryRivalRecord;
  battle.storySchema = ZELL_STORY_SCHEMA;
  battle.storyRivalId = ZELL_PILOT_ID;
  battle.lineup = { opponentPilot: pilot, opponentSquad: [combatant] };
  result.reply.encounter = { ...result.reply.encounter, opponentPilot: { ...pilot }, opponentSquad: [{ ...combatant, ...rivalScaledCombatantStats(battle.tier), commandRules: desktopPracticeCommands(combatant.holobotId) }] };
}
/** Call only after the existing settle validation, and only on its first committed WIN. */
export function allyAfterZellVictory(s: ZellStoryState, battle: StoryRivalRecord, nowMs: number): ZellStoryState {
  if (battle.storySchema !== ZELL_STORY_SCHEMA || battle.storyRivalId !== ZELL_PILOT_ID || battle.lineup.opponentPilot.pilotId !== ZELL_PILOT_ID || !battle.settlement?.didWin || s.phase === 'ally') return s;
  if (!integer(nowMs) || s.phase !== 'rival' || s.metAtMs === null || nowMs < s.metAtMs) return fail();
  return { ...s, phase: 'ally', allyAtMs: nowMs, victoryBattleId: battle.battleId };
}
