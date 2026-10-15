import { HOLOBOT_RANK_TIERS } from '../lib/progression';
import { readStoryFlags, StoryError } from './storyFlags';

export const ARENA_TOURNAMENT_SCHEMA = 'arena-tournament-1';
export const TOURNAMENTS = ['starter','champion','rare'] as const;
export type TournamentId = typeof TOURNAMENTS[number];
export type TournamentAdmission = {schemaVersion:typeof ARENA_TOURNAMENT_SCHEMA;tournamentId:TournamentId;requiredLevel:number};
export function tournamentIndex(id: unknown): number {
  const index = TOURNAMENTS.indexOf(id as TournamentId);
  if (index < 0) throw new StoryError('invalid_request');
  return index;
}
export function tournamentLevel(id: unknown): number {
  const index = tournamentIndex(id);
  return HOLOBOT_RANK_TIERS.find(t => t.rank.toLowerCase() === TOURNAMENTS[index])!.startLevel;
}
export function requireNextTournament(rawFlags: unknown, id: unknown) {
  const flags = readStoryFlags(rawFlags), index = tournamentIndex(id);
  if (index < flags.tournamentsWon) throw new StoryError('already_won');
  if (index > flags.tournamentsWon) throw new StoryError('tournament_locked');
  return flags;
}
export function tournamentAdmission(rawFlags: unknown, id: unknown, level: unknown): TournamentAdmission {
  requireNextTournament(rawFlags,id);
  const requiredLevel = tournamentLevel(id);
  if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1) throw new StoryError('unavailable');
  if (level < requiredLevel) throw new StoryError('rank_too_low');
  return {schemaVersion:ARENA_TOURNAMENT_SCHEMA,tournamentId:id as TournamentId,requiredLevel};
}
