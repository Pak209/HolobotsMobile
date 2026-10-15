import type { UserProfile } from "@/types/profile";

/** Synthetic local data. No user ID or credentials from a real account. */
export const previewProfile: UserProfile = {
  id: "offline-preview",
  username: "Preview Pilot",
  holobots: [
    { name: "ACE", level: 12, experience: 320, nextLevelExp: 800, rank: "Champion", attributePoints: 3 },
    { name: "KUMA", level: 8, experience: 180, nextLevelExp: 500, rank: "Starter", attributePoints: 1 },
    { name: "SHADOW", level: 4, experience: 80, nextLevelExp: 250, rank: "Starter", attributePoints: 1 },
  ],
  dailyEnergy: 84,
  maxDailyEnergy: 100,
  holosTokens: 2480,
  gachaTickets: 3,
  stats: { wins: 12, losses: 4 },
  lastEnergyRefresh: new Date().toISOString(),
  arena_passes: 2,
  exp_boosters: 2,
  energy_refills: 1,
  emergency_patches: 3,
  async_battle_tickets: 3,
  blueprints: { ace: 12, kuma: 4, shadow: 3, wolf: 2 },
  syncPoints: 1250,
  lifetimeSyncPoints: 5400,
  seasonSyncPoints: 3200,
  todaySteps: 6820,
  inventory: { repair_kit: 3, holo_dust: 20 },
  parts: [],
};

export const previewLeaderboard = [
  { id: "preview-1", username: "Harbor Pilot", leaderboardScore: 4200, wins: 32, highestHolobotLevel: 42 },
  { id: "preview-2", username: "Plaza Pilot", leaderboardScore: 3600, wins: 24, highestHolobotLevel: 34 },
  { id: "preview-3", username: "Preview Pilot", leaderboardScore: 2480, wins: 12, highestHolobotLevel: 12 },
];
