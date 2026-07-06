export type ServerHolobot = {
  attributePoints?: number;
  experience: number;
  level: number;
  name: string;
  nextLevelExp: number;
  rank?: string;
  [key: string]: unknown;
};

export function calculateExperience(level: number): number;
export function getHolobotRank(level: number): string;
export function normalizeUserHolobot(rawHolobot: unknown): ServerHolobot;
export function applyHolobotExperience(rawHolobot: unknown, expGain: number): ServerHolobot;
export function applyWorkoutCareer(
  rawHolobot: unknown,
  update: { date: string; distanceMeters?: number },
): ServerHolobot;
export function getSyncRank(lifetimeSyncPoints: number): string;
export function computeLeaderboardScore(input: {
  holobots?: Array<{ level?: number }>;
  prestigeCount?: number;
  seasonSyncPoints?: number;
  wins?: number;
}): number;
export const SYNC_RANK_THRESHOLDS: Array<{ min: number; rank: string }>;
