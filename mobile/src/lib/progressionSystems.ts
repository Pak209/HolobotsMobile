import { applyHolobotExperience, getHolobotBattleStats, normalizeUserHolobot } from "@/config/holobots";
import { getTodayMissionKey, normalizeRewardSystem, type MobileRewardSystem } from "@/lib/dailyMissions";
import type { UserHolobot, UserProfile } from "@/types/profile";

export type TrainingCourseId =
  | "attack"
  | "defense"
  | "health"
  | "speed"
  | "special"
  | "balanced";

export type QuestId =
  | "forest_patrol"
  | "cave_exploration"
  | "factory_raid"
  | "desert_expedition"
  | "abandoned_fortress";

export type QuestRewardItemKey = "common" | "rare" | "legendary";

export type TrainingSessionRecord = {
  courseId: TrainingCourseId;
  endsAt: string;
  expReward: number;
  holobotName: string;
  startedAt: string;
  statBoosts: NonNullable<UserHolobot["boostedAttributes"]>;
};

export type ActiveQuestRecord = {
  endsAt: string;
  holobotName: string;
  holobotPower: number;
  id: string;
  questId: QuestId;
  rewards: {
    exp: number;
    itemAmount?: number;
    itemKey?: QuestRewardItemKey;
    syncPoints: number;
  };
  startedAt: string;
  succeeded: boolean;
};

export type MobileProgressionSystem = MobileRewardSystem & {
  activeQuests: ActiveQuestRecord[];
  activeTraining: TrainingSessionRecord | null;
  availableQuestIds: QuestId[];
  lastQuestRefreshDate: string;
  questRefreshesRemaining: number;
  syncBoostEnabled: boolean;
};

type CourseDefinition = {
  attributeLabel: string;
  copy: string;
  durationMinutes: number;
  energyCost: number;
  id: TrainingCourseId;
  minBoost: number;
  maxBoost: number;
  accent: string;
  textColor: string;
};

type QuestDefinition = {
  accent: string;
  difficulty: string;
  durationMinutes: number;
  energyCost: number;
  id: QuestId;
  recommendedPower: number;
  rewards: {
    exp: number;
    itemAmount?: number;
    itemKey?: QuestRewardItemKey;
    syncPoints: number;
  };
  summary: string;
  title: string;
};

export const TRAINING_COURSES: CourseDefinition[] = [
  {
    accent: "#ff6a2b",
    attributeLabel: "ATK",
    copy: "Focus on offensive power and damage.",
    durationMinutes: 30,
    energyCost: 10,
    id: "attack",
    maxBoost: 18,
    minBoost: 10,
    textColor: "#ff5d3f",
  },
  {
    accent: "#2793ff",
    attributeLabel: "DEF",
    copy: "Build resilience and reduce incoming damage.",
    durationMinutes: 30,
    energyCost: 10,
    id: "defense",
    maxBoost: 18,
    minBoost: 10,
    textColor: "#4da7ff",
  },
  {
    accent: "#69d84f",
    attributeLabel: "HP",
    copy: "Increase maximum HP and survivability.",
    durationMinutes: 30,
    energyCost: 10,
    id: "health",
    maxBoost: 18,
    minBoost: 10,
    textColor: "#7ee467",
  },
  {
    accent: "#f2c400",
    attributeLabel: "SPD",
    copy: "Improve speed and evasion.",
    durationMinutes: 30,
    energyCost: 10,
    id: "speed",
    maxBoost: 18,
    minBoost: 10,
    textColor: "#ffd44d",
  },
  {
    accent: "#9b5cff",
    attributeLabel: "SPC",
    copy: "Enhance special ability power and effects.",
    durationMinutes: 30,
    energyCost: 10,
    id: "special",
    maxBoost: 18,
    minBoost: 10,
    textColor: "#b280ff",
  },
  {
    accent: "#1fc9ff",
    attributeLabel: "ALL",
    copy: "Balanced growth across all attributes.",
    durationMinutes: 60,
    energyCost: 20,
    id: "balanced",
    maxBoost: 8,
    minBoost: 5,
    textColor: "#5fe1ff",
  },
] as const;

export const QUEST_DEFINITIONS: QuestDefinition[] = [
  {
    accent: "#5fc95a",
    difficulty: "EASY",
    durationMinutes: 15,
    energyCost: 10,
    id: "forest_patrol",
    recommendedPower: 800,
    rewards: { exp: 50, syncPoints: 15 },
    summary: "Clear out rogue bots in the forest. Ideal for training and low risk.",
    title: "FOREST PATROL",
  },
  {
    accent: "#46a3ff",
    difficulty: "NORMAL",
    durationMinutes: 30,
    energyCost: 15,
    id: "cave_exploration",
    recommendedPower: 1500,
    rewards: { exp: 120, itemAmount: 1, itemKey: "common", syncPoints: 30 },
    summary: "Explore crystal caves and secure valuable resources.",
    title: "CAVE EXPLORATION",
  },
  {
    accent: "#b86dff",
    difficulty: "HARD",
    durationMinutes: 60,
    energyCost: 20,
    id: "factory_raid",
    recommendedPower: 2500,
    rewards: { exp: 250, itemAmount: 2, itemKey: "rare", syncPoints: 60 },
    summary: "Infiltrate an old factory and defeat heavy defense bots.",
    title: "FACTORY RAID",
  },
  {
    accent: "#ffae42",
    difficulty: "VERY HARD",
    durationMinutes: 120,
    energyCost: 25,
    id: "desert_expedition",
    recommendedPower: 4000,
    rewards: { exp: 500, itemAmount: 2, itemKey: "legendary", syncPoints: 100 },
    summary: "Brave the harsh desert and find rare ancient tech.",
    title: "DESERT EXPEDITION",
  },
  {
    accent: "#ff5454",
    difficulty: "EXTREME",
    durationMinutes: 240,
    energyCost: 30,
    id: "abandoned_fortress",
    recommendedPower: 6500,
    rewards: { exp: 1000, itemAmount: 3, itemKey: "legendary", syncPoints: 200 },
    summary: "High risk. High reward. Only the strongest return.",
    title: "ABANDONED FORTRESS",
  },
] as const;

const DEFAULT_QUEST_ROTATION: QuestId[] = QUEST_DEFINITIONS.map((quest) => quest.id);
const DAILY_QUEST_REFRESHES = 5;

function clampNumber(value: unknown, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function isQuestId(value: unknown): value is QuestId {
  return QUEST_DEFINITIONS.some((quest) => quest.id === value);
}

function isTrainingCourseId(value: unknown): value is TrainingCourseId {
  return TRAINING_COURSES.some((course) => course.id === value);
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeQuestRunId() {
  return `quest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getTrainingCourse(id: TrainingCourseId) {
  return TRAINING_COURSES.find((course) => course.id === id) || TRAINING_COURSES[0];
}

export function getQuestDefinition(id: QuestId) {
  return QUEST_DEFINITIONS.find((quest) => quest.id === id) || QUEST_DEFINITIONS[0];
}

export function normalizeProgressionSystem(
  value: unknown,
  date = new Date(),
): MobileProgressionSystem {
  const base = normalizeRewardSystem(value, date);
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const todayKey = getTodayMissionKey(date);
  const refreshDate = typeof raw.lastQuestRefreshDate === "string" ? raw.lastQuestRefreshDate : "";
  const isFreshQuestDay = refreshDate === todayKey;
  const availableQuestIds = Array.isArray(raw.availableQuestIds)
    ? raw.availableQuestIds.filter(isQuestId)
    : [];
  const activeTrainingRaw = raw.activeTraining;
  const activeTraining =
    activeTrainingRaw &&
    typeof activeTrainingRaw === "object" &&
    isTrainingCourseId((activeTrainingRaw as Record<string, unknown>).courseId)
      ? ({
          courseId: (activeTrainingRaw as Record<string, unknown>).courseId as TrainingCourseId,
          endsAt: String((activeTrainingRaw as Record<string, unknown>).endsAt || ""),
          expReward: clampNumber((activeTrainingRaw as Record<string, unknown>).expReward),
          holobotName: String((activeTrainingRaw as Record<string, unknown>).holobotName || ""),
          startedAt: String((activeTrainingRaw as Record<string, unknown>).startedAt || ""),
          statBoosts:
            ((activeTrainingRaw as Record<string, unknown>).statBoosts as NonNullable<UserHolobot["boostedAttributes"]>) ||
            {},
        })
      : null;
  const activeQuests: ActiveQuestRecord[] = Array.isArray(raw.activeQuests)
    ? raw.activeQuests.reduce<ActiveQuestRecord[]>((acc, entry) => {
        if (!entry || typeof entry !== "object" || !isQuestId((entry as Record<string, unknown>).questId)) {
          return acc;
        }

        const rewards = ((entry as Record<string, unknown>).rewards || {}) as Record<string, unknown>;
        acc.push({
          endsAt: String((entry as Record<string, unknown>).endsAt || ""),
          holobotName: String((entry as Record<string, unknown>).holobotName || ""),
          holobotPower: clampNumber((entry as Record<string, unknown>).holobotPower),
          id: String((entry as Record<string, unknown>).id || makeQuestRunId()),
          questId: (entry as Record<string, unknown>).questId as QuestId,
          rewards: {
            exp: clampNumber(rewards.exp),
            itemAmount: rewards.itemAmount === undefined ? undefined : clampNumber(rewards.itemAmount),
            itemKey:
              rewards.itemKey === "common" || rewards.itemKey === "rare" || rewards.itemKey === "legendary"
                ? (rewards.itemKey as QuestRewardItemKey)
                : undefined,
            syncPoints: clampNumber(rewards.syncPoints),
          },
          startedAt: String((entry as Record<string, unknown>).startedAt || ""),
          succeeded: Boolean((entry as Record<string, unknown>).succeeded),
        });
        return acc;
      }, [])
    : [];

  return {
    ...base,
    activeQuests,
    activeTraining,
    availableQuestIds: availableQuestIds.length ? availableQuestIds : DEFAULT_QUEST_ROTATION,
    lastQuestRefreshDate: todayKey,
    questRefreshesRemaining: isFreshQuestDay ? clampNumber(raw.questRefreshesRemaining, DAILY_QUEST_REFRESHES) : DAILY_QUEST_REFRESHES,
    syncBoostEnabled: Boolean(raw.syncBoostEnabled),
  };
}

export function refreshQuestBoard(system: unknown, date = new Date()): MobileProgressionSystem {
  const next = normalizeProgressionSystem(system, date);
  if (next.questRefreshesRemaining <= 0) {
    return next;
  }

  const shuffled = [...DEFAULT_QUEST_ROTATION].sort(() => Math.random() - 0.5);
  next.availableQuestIds = shuffled;
  next.questRefreshesRemaining -= 1;
  return next;
}

export function getHolobotPowerScore(holobot: UserHolobot) {
  const stats = getHolobotBattleStats(holobot.name, holobot.level, holobot.boostedAttributes);
  return Math.round(stats.maxHP * 4 + stats.attack * 6 + stats.defense * 5 + stats.speed * 4 + stats.intelligence * 5);
}

export function startTrainingSession(
  system: unknown,
  holobot: UserHolobot,
  courseId: TrainingCourseId,
  date = new Date(),
) {
  const next = normalizeProgressionSystem(system, date);
  const course = getTrainingCourse(courseId);
  const endsAt = new Date(date.getTime() + course.durationMinutes * 60 * 1000).toISOString();
  const boostAmount = randomInt(course.minBoost, course.maxBoost);
  const statBoosts: NonNullable<UserHolobot["boostedAttributes"]> =
    courseId === "balanced"
      ? {
          attack: boostAmount,
          defense: boostAmount,
          health: boostAmount,
          special: boostAmount,
          speed: boostAmount,
        }
      : courseId === "attack"
        ? { attack: boostAmount }
        : courseId === "defense"
          ? { defense: boostAmount }
          : courseId === "health"
            ? { health: boostAmount }
            : courseId === "speed"
              ? { speed: boostAmount }
              : { special: boostAmount };

  next.activeTraining = {
    courseId,
    endsAt,
    expReward: course.durationMinutes === 60 ? 140 : 70,
    holobotName: holobot.name,
    startedAt: date.toISOString(),
    statBoosts,
  };

  return next;
}

export function claimTrainingSession(holobots: UserHolobot[], session: TrainingSessionRecord) {
  return holobots.map((rawHolobot) => {
    if (rawHolobot.name.toUpperCase() !== session.holobotName.toUpperCase()) {
      return rawHolobot;
    }

    const normalized = normalizeUserHolobot(rawHolobot);
    const boosts = {
      ...(normalized.boostedAttributes || {}),
      attack: (normalized.boostedAttributes?.attack || 0) + (session.statBoosts.attack || 0),
      defense: (normalized.boostedAttributes?.defense || 0) + (session.statBoosts.defense || 0),
      health: (normalized.boostedAttributes?.health || 0) + (session.statBoosts.health || 0),
      special: (normalized.boostedAttributes?.special || 0) + (session.statBoosts.special || 0),
      speed: (normalized.boostedAttributes?.speed || 0) + (session.statBoosts.speed || 0),
    };

    return applyHolobotExperience(
      {
        ...normalized,
        boostedAttributes: boosts,
      },
      session.expReward,
    );
  });
}

export function startQuestRun(
  system: unknown,
  holobot: UserHolobot,
  questId: QuestId,
  date = new Date(),
) {
  const next = normalizeProgressionSystem(system, date);
  const quest = getQuestDefinition(questId);
  const holobotPower = getHolobotPowerScore(holobot);
  const successChance = Math.max(0.45, Math.min(0.95, holobotPower / quest.recommendedPower));
  const succeeded = Math.random() <= successChance;

  next.activeQuests = [
    ...next.activeQuests,
    {
      endsAt: new Date(date.getTime() + quest.durationMinutes * 60 * 1000).toISOString(),
      holobotName: holobot.name,
      holobotPower,
      id: makeQuestRunId(),
      questId,
      rewards: quest.rewards,
      startedAt: date.toISOString(),
      succeeded,
    },
  ].slice(0, 3);

  return next;
}

export function claimQuestRun(
  holobots: UserHolobot[],
  inventory: Record<string, number> | undefined,
  syncPoints: number,
  quest: ActiveQuestRecord,
) {
  const nextHolobots = holobots.map((rawHolobot) => {
    if (rawHolobot.name.toUpperCase() !== quest.holobotName.toUpperCase() || !quest.succeeded) {
      return rawHolobot;
    }

    return applyHolobotExperience(normalizeUserHolobot(rawHolobot), quest.rewards.exp);
  });

  const nextInventory = { ...(inventory || {}) };
  if (quest.succeeded && quest.rewards.itemKey && quest.rewards.itemAmount) {
    nextInventory[quest.rewards.itemKey] = (nextInventory[quest.rewards.itemKey] || 0) + quest.rewards.itemAmount;
  }

  return {
    holobots: nextHolobots,
    inventory: nextInventory,
    syncPoints: syncPoints + (quest.succeeded ? quest.rewards.syncPoints : 0),
  };
}

export function getEligibleQuestHolobots(profile: UserProfile | null) {
  const system = normalizeProgressionSystem(profile?.rewardSystem);
  const busyHolobots = new Set(system.activeQuests.map((quest) => quest.holobotName.toUpperCase()));
  return (profile?.holobots || []).filter((holobot) => !busyHolobots.has(holobot.name.toUpperCase()));
}

export function isSessionComplete(endsAt: string, now = new Date()) {
  return Boolean(endsAt) && new Date(endsAt).getTime() <= now.getTime();
}
