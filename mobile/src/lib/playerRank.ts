import type { UserProfile } from "@/types/profile";

export type PlayerRank = "Rookie" | "Champion" | "Rare" | "Elite" | "Legend";

export const PLAYER_RANK_EXP_MULTIPLIER: Record<PlayerRank, number> = {
  Champion: 2,
  Elite: 5,
  Legend: 10,
  Rare: 3,
  Rookie: 1,
};

export function getPlayerRank(profile: UserProfile | null | undefined): PlayerRank {
  if (!profile) return "Rookie";

  const maxLevel = Math.max(0, ...(profile.holobots || []).map((holobot) => holobot.level || 0));
  const wins = profile.stats?.wins || 0;
  const score = maxLevel + wins * 0.35 + (profile.prestigeCount || 0) * 8;

  if (score >= 80) return "Legend";
  if (score >= 55) return "Elite";
  if (score >= 40) return "Rare";
  if (score >= 30) return "Champion";
  return "Rookie";
}

export function getPlayerRankExpMultiplier(profile: UserProfile | null | undefined) {
  return PLAYER_RANK_EXP_MULTIPLIER[getPlayerRank(profile)];
}
