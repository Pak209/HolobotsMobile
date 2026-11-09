import { HOLOBOT_RANK_TIERS } from '../lib/progression';
import { readStoryFlags, STORY_CUPS, StoryError } from './storyFlags';
import { readPilotRank } from '../account/pilotRank';

export const ARENA_TOURNAMENT_SCHEMA = 'arena-tournament-1';
/** Stored ids. `rare` is the Elite Cup: the id stays, because tournament records, prize receipts and shipped clients all carry it. */
const SHIPPED_TOURNAMENTS = ['starter','champion','rare'] as const;
const ALL_TOURNAMENTS = [...SHIPPED_TOURNAMENTS,'legends'] as const;
export type TournamentId = typeof ALL_TOURNAMENTS[number];
/** The cups that can be entered, in order. Legends joins when STORY_CUPS.legendsLive is on. */
export const liveTournaments = (): readonly TournamentId[] => STORY_CUPS.legendsLive ? ALL_TOURNAMENTS : SHIPPED_TOURNAMENTS;
/** The Holobot rank whose start level gates each cup. Legends (PROPOSED) is the next rank up from the Elite Cup's. */
const CUP_RANK: Record<TournamentId,string> = {starter:'Starter',champion:'Champion',rare:'Rare',legends:'Elite'};
export type TournamentAdmission = {schemaVersion:typeof ARENA_TOURNAMENT_SCHEMA;tournamentId:TournamentId;requiredLevel:number;pilotRankAtAdmission:number};
export function tournamentIndex(id: unknown): number {
  const index = liveTournaments().indexOf(id as TournamentId);
  if (index < 0) throw new StoryError('invalid_request');
  return index;
}
export function tournamentLevel(id: unknown): number {
  const index = tournamentIndex(id);
  return HOLOBOT_RANK_TIERS.find(t => t.rank === CUP_RANK[liveTournaments()[index]])!.startLevel;
}
export function requireNextTournament(rawFlags: unknown, id: unknown) {
  const flags = readStoryFlags(rawFlags), index = tournamentIndex(id);
  if (index < flags.tournamentsWon) throw new StoryError('already_won');
  if (index > flags.tournamentsWon) throw new StoryError('tournament_locked');
  return flags;
}
/**
 * A cup entry at arenaMatchHost issue: the bracket fields the 8 gathering citizens, so tournamentBracketHost start refuses a
 * pilot who hasn't attended the gathering. Refusing here, with start's own code, happens before anything is charged.
 * tournamentAdmission itself stays the eligibility rule the unlock notification reads.
 */
export function cupEntryAdmission(rawFlags: unknown, id: unknown, level: unknown, rawPilotRank?: unknown): TournamentAdmission {
  if (!readStoryFlags(rawFlags).arenaGatheringSeen) throw new StoryError('not_admitted');
  return tournamentAdmission(rawFlags, id, level, rawPilotRank);
}
export function tournamentAdmission(rawFlags: unknown, id: unknown, level: unknown, rawPilotRank?: unknown): TournamentAdmission {
  requireNextTournament(rawFlags,id);
  const requiredLevel = tournamentLevel(id);
  if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1) throw new StoryError('unavailable');
  if (level < requiredLevel) throw new StoryError('rank_too_low');
  return {schemaVersion:ARENA_TOURNAMENT_SCHEMA,tournamentId:id as TournamentId,requiredLevel,pilotRankAtAdmission:readPilotRank(rawPilotRank)};
}
