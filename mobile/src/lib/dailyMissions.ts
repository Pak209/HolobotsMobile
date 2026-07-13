import type { UserProfile } from "@/types/profile";

export type MobileRewardSystem = {
  arenaBattlesToday: number;
  boosterPacksToday: number;
  lastDailyMissionReset: string;
  missionClaims: Record<string, string>;
};

export type MobileDailyMission = {
  id: string;
  name: string;
  description: string;
  target: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  reward: {
    gachaTickets: number;
    holosTokens?: number;
  };
};

const DEFAULT_REWARD_SYSTEM: MobileRewardSystem = {
  arenaBattlesToday: 0,
  boosterPacksToday: 0,
  lastDailyMissionReset: "",
  missionClaims: {},
};

export function getTodayMissionKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function normalizeRewardSystem(value: unknown, date = new Date()): MobileRewardSystem {
  const todayKey = getTodayMissionKey(date);
  const raw = (value && typeof value === "object" ? value : {}) as Partial<MobileRewardSystem>;
  const hasFreshCounters = raw.lastDailyMissionReset === todayKey;

  return {
    arenaBattlesToday: hasFreshCounters ? Number(raw.arenaBattlesToday || 0) : 0,
    boosterPacksToday: hasFreshCounters ? Number(raw.boosterPacksToday || 0) : 0,
    lastDailyMissionReset: todayKey,
    missionClaims: raw.missionClaims && typeof raw.missionClaims === "object" ? raw.missionClaims : {},
  };
}

/**
 * The daily mission table — mirrored in functions/src/lib/economy.ts where
 * claimDailyMission validates completion (against server-incremented
 * counters) and pays. Parity-tested; change both together.
 */
export const DAILY_MISSION_TABLE = [
  {
    id: "daily_login",
    name: "Daily Check-in",
    description: "Log in to the game",
    target: 1,
    reward: { gachaTickets: 1, holosTokens: 0 },
  },
  {
    id: "arena_v2_battle",
    name: "Arena V2 Warrior",
    description: "Complete Arena V2 battles",
    target: 3,
    reward: { gachaTickets: 2, holosTokens: 100 },
  },
  {
    id: "open_booster_pack",
    name: "Pack Collector",
    description: "Open booster packs",
    target: 1,
    reward: { gachaTickets: 1, holosTokens: 0 },
  },
] as const;

function getMissionProgress(
  missionId: string,
  profile: UserProfile | null,
  rewardSystem: MobileRewardSystem,
): number {
  if (missionId === "daily_login") return profile ? 1 : 0;
  if (missionId === "arena_v2_battle") return rewardSystem.arenaBattlesToday;
  if (missionId === "open_booster_pack") return rewardSystem.boosterPacksToday;
  return 0;
}

export function buildDailyMissions(profile: UserProfile | null, date = new Date()): MobileDailyMission[] {
  const todayKey = getTodayMissionKey(date);
  const rewardSystem = normalizeRewardSystem(profile?.rewardSystem, date);
  const claimedToday = rewardSystem.missionClaims || {};

  const missions: Omit<MobileDailyMission, "claimed" | "completed">[] = DAILY_MISSION_TABLE.map(
    (mission) => ({
      ...mission,
      reward: { ...mission.reward },
      progress: getMissionProgress(mission.id, profile, rewardSystem),
    }),
  );

  return missions.map((mission) => {
    const completed = mission.progress >= mission.target;
    const claimed = claimedToday[mission.id] === todayKey;

    return {
      ...mission,
      completed,
      claimed,
      progress: Math.min(mission.progress, mission.target),
    };
  });
}

export function getDailyMissionSummary(profile: UserProfile | null, date = new Date()) {
  const missions = buildDailyMissions(profile, date);
  return {
    available: missions.length,
    completed: missions.filter((mission) => mission.completed).length,
    unclaimed: missions.filter((mission) => mission.completed && !mission.claimed).length,
  };
}

export function markMissionClaimed(
  rewardSystem: unknown,
  missionId: string,
  date = new Date(),
): MobileRewardSystem {
  const next = normalizeRewardSystem(rewardSystem, date);
  next.missionClaims = {
    ...next.missionClaims,
    [missionId]: getTodayMissionKey(date),
  };
  return next;
}

export function incrementArenaBattlesToday(rewardSystem: unknown, date = new Date()): MobileRewardSystem {
  const next = normalizeRewardSystem(rewardSystem, date);
  next.arenaBattlesToday += 1;
  return next;
}

export function incrementBoosterPacksToday(rewardSystem: unknown, date = new Date()): MobileRewardSystem {
  const next = normalizeRewardSystem(rewardSystem, date);
  next.boosterPacksToday += 1;
  return next;
}
