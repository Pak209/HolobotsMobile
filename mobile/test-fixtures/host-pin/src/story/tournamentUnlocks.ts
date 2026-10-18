import { HOLOBOT_BASE_STATS } from '../lib/progression';
import { toHolobotKey } from '../lib/mintingEconomy';
import { tournamentAdmission, tournamentIndex, TournamentId, TOURNAMENTS } from './arenaTournament';
import { readStoryFlags, StoryError } from './storyFlags';

export type TournamentUnlock = { tournamentId: TournamentId; requiredLevel: number; holobotId: string; level: number };
/** Permanent per-tournament acknowledgement, independent of the displayed bot/level. */
export function readTournamentAcknowledged(raw: unknown): TournamentId[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 3 || new Set(raw).size !== raw.length
    || raw.some(id => !TOURNAMENTS.includes(id))) throw new StoryError('unavailable');
  return TOURNAMENTS.filter(id => raw.includes(id));
}
/** Eligibility notification only: payment, health and activity are still checked at admission. */
export function tournamentUnlocks(profile: Record<string, unknown>): TournamentUnlock[] {
  const flags = readStoryFlags(profile.storyFlags);
  const acknowledged = readTournamentAcknowledged(profile.tournamentUnlockAcknowledged);
  if (flags.tournamentsWon === 3) return [];
  const tournamentId = TOURNAMENTS[flags.tournamentsWon];
  if (acknowledged.includes(tournamentId)) return [];
  const bots = Array.isArray(profile.holobots) ? profile.holobots : [];
  const candidates = bots.filter((b): b is Record<string, unknown> => !!b && typeof b === 'object' && !Array.isArray(b) && typeof b.name === 'string')
    .map(b => ({holobotId: toHolobotKey(b.name as string), level: b.level ?? 1}));
  candidates.sort((a,b) => a.holobotId < b.holobotId ? -1 : a.holobotId > b.holobotId ? 1 : 0);
  for (const bot of candidates) {
    if (!Object.hasOwn(HOLOBOT_BASE_STATS,bot.holobotId.toUpperCase())
      || candidates.filter(b => b.holobotId === bot.holobotId).length !== 1) continue;
    if (typeof bot.level !== 'number' || !Number.isSafeInteger(bot.level) || bot.level < 1) continue;
    try {
      const admission = tournamentAdmission(flags,tournamentId,bot.level,profile.pilotRank);
      return [{tournamentId, requiredLevel:admission.requiredLevel,holobotId:bot.holobotId,level:bot.level}];
    } catch (error) {
      if (error instanceof StoryError && error.code === 'rank_too_low') continue;
      throw error;
    }
  }
  return [];
}
/** Ack only a currently eligible (or already acknowledged) tournament; retries are idempotent. */
export function acknowledgeTournamentUnlock(profile: Record<string, unknown>, id: unknown): TournamentId[] {
  tournamentIndex(id);
  const acknowledged = readTournamentAcknowledged(profile.tournamentUnlockAcknowledged);
  if (acknowledged.includes(id as TournamentId)) return acknowledged;
  // A stale notification may be acknowledged after that tournament was won.
  const won = readStoryFlags(profile.storyFlags).tournamentsWon;
  if (tournamentIndex(id) >= won && !tournamentUnlocks(profile).some(row => row.tournamentId === id))
    throw new StoryError('not_eligible');
  return TOURNAMENTS.filter(t => t === id || acknowledged.includes(t));
}
