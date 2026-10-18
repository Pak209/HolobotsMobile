import type { DailyMissionLedger } from "@/lib/hostDashboard";
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
  /** CLAIM is offered only from the City's ledger (host #145 dailyMissionLedger), never from the device copy. */
  claimable: boolean;
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
  counts: { arenaBattlesToday: number; boosterPacksToday: number },
): number {
  // daily_login: always 1 for a signed-in pilot (Schemas/daily-mission-ledger-1.json).
  if (missionId === "daily_login") return profile ? 1 : 0;
  if (missionId === "arena_v2_battle") return counts.arenaBattlesToday;
  if (missionId === "open_booster_pack") return counts.boosterPacksToday;
  return 0;
}

/**
 * Daily missions from the City's ledger summary (desktopAccountSnapshot `dailyMissionLedger`, host #145) when the reply
 * carries it: counts and claimed flags are the host's, and CLAIM is offered only then. Without it (an older host, a read
 * still loading or failed), progress falls back to the client-writable rewardSystem copy for DISPLAY only: nothing is
 * claimable from it.
 */
export function buildDailyMissions(profile: UserProfile | null, date = new Date(), ledger: DailyMissionLedger | null = null): MobileDailyMission[] {
  const todayKey = getTodayMissionKey(date);
  const rewardSystem = normalizeRewardSystem(profile?.rewardSystem, date);
  const counts = ledger ?? rewardSystem;
  const claimedToday = rewardSystem.missionClaims || {};

  return DAILY_MISSION_TABLE.map((mission) => {
    const progress = getMissionProgress(mission.id, profile, counts);
    const completed = progress >= mission.target;
    const claimed = ledger ? ledger.claimed[mission.id] === true : claimedToday[mission.id] === todayKey;

    return {
      ...mission,
      reward: { ...mission.reward },
      completed,
      claimed,
      claimable: ledger !== null && profile !== null && completed && !claimed,
      progress: Math.min(progress, mission.target),
    };
  });
}

export function getDailyMissionSummary(profile: UserProfile | null, date = new Date(), ledger: DailyMissionLedger | null = null) {
  const missions = buildDailyMissions(profile, date, ledger);
  return {
    available: missions.length,
    completed: missions.filter((mission) => mission.completed).length,
    /** Claimable now: from the City's ledger only. */
    unclaimed: missions.filter((mission) => mission.claimable).length,
  };
}

/** PLACEHOLDER copy (Lex): why CLAIM is unavailable when the City's ledger is not in hand. Null when it is. */
export function missionLedgerNote(status: "idle" | "loading" | "ready" | "unavailable", ledger: DailyMissionLedger | null): string | null {
  if (ledger) return null;
  if (status === "idle" || status === "loading") return "Checking today's progress with the City…";
  if (status === "ready") return "The City hasn't confirmed today's progress yet. Showing this device's count; claims open once it does.";
  return "Couldn't reach the City. Showing this device's count; claims are paused.";
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
