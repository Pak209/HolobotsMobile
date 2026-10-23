/**
 * The public /leaderboard/{uid} projection of a users/{uid} document: written by
 * the mirrorLeaderboardEntry trigger and scripts/backfill-leaderboard.mjs.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { computeLeaderboardScore } from "./progression";

export type LeaderboardEntry = {
  username: string;
  leaderboardScore: number;
  wins: number;
  prestigeCount: number;
  highestHolobotLevel: number;
  syncRank: string;
  genesisBadge: boolean;
};

export function projectLeaderboardEntry(uid: string, data: Record<string, unknown>): LeaderboardEntry {
  const holobots = Array.isArray(data.holobots) ? (data.holobots as Array<Record<string, unknown>>) : [];
  const highestHolobotLevel = holobots.reduce(
    (highest, holobot) => Math.max(highest, Number(holobot?.level || 0)),
    0,
  );

  return {
    username: String(data.username || `pilot_${uid.slice(0, 8)}`),
    // holobots-write-lockdown-1: recomputed from the server-owned inputs instead of
    // trusting the stored users/{uid}.leaderboardScore (client-writable until this
    // lane, so a legacy tampered value would otherwise keep ranking).
    leaderboardScore: computeLeaderboardScore({
      holobots,
      prestigeCount: Number(data.prestigeCount || 0),
      seasonSyncPoints: Number(data.seasonSyncPoints || 0),
      wins: Number(data.wins || 0),
    }),
    wins: Number(data.wins || 0),
    prestigeCount: Number(data.prestigeCount || 0),
    highestHolobotLevel,
    syncRank: String(data.syncRank || "Rookie"),
    genesisBadge: Boolean(data.genesisBadge),
  };
}
