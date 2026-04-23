import { doc, getDoc, onSnapshot, updateDoc, db, type Unsubscribe } from "@/config/firebase";
import type { UserHolobot, UserProfile } from "@/types/profile";

const DEFAULT_USER_PROFILE = {
  dailyEnergy: 100,
  maxDailyEnergy: 100,
  holosTokens: 0,
  gachaTickets: 0,
  wins: 0,
  losses: 0,
  arenaPassses: 0,
  expBoosters: 0,
  energyRefills: 0,
  rankSkips: 0,
  asyncBattleTickets: 3,
  playerRank: "Rookie",
  blueprints: {},
  parts: [],
  equippedParts: {},
  holobots: [],
  isDevAccount: false,
  rentalHolobots: [],
  syncPoints: 0,
  inventory: {},
  todaySteps: 0,
  fitnessSource: "mobile",
  syncDistanceUnit: "km" as const,
};

type FirestoreUserDocument = {
  username?: string;
  dailyEnergy?: number;
  maxDailyEnergy?: number;
  holosTokens?: number;
  gachaTickets?: number;
  wins?: number;
  losses?: number;
  arenaPassses?: number;
  expBoosters?: number;
  energyRefills?: number;
  rankSkips?: number;
  asyncBattleTickets?: number;
  lastAsyncTicketRefresh?: { toDate?: () => Date };
  blueprints?: Record<string, number>;
  parts?: Array<Record<string, unknown>>;
  equippedParts?: Record<string, unknown>;
  holobots?: UserHolobot[];
  lastEnergyRefresh?: { toDate?: () => Date };
  isDevAccount?: boolean;
  rentalHolobots?: Array<Record<string, unknown>>;
  syncPoints?: number;
  leaderboardScore?: number;
  prestigeCount?: number;
  onboardingPath?: string;
  inventory?: Record<string, number>;
  packHistory?: Array<Record<string, unknown>>;
  battleCards?: Record<string, number>;
  battle_cards?: Record<string, number>;
  starter_deck_claimed?: boolean;
  arena_deck_template_ids?: string[];
  rewardSystem?: Record<string, unknown>;
  todaySteps?: number;
  lastStepSync?: { toDate?: () => Date };
  lastFitnessSyncAt?: { toDate?: () => Date };
  fitnessSource?: string;
  syncDistanceUnit?: "km" | "mi";
};

type LeaderboardScoreInput = {
  holobots?: UserHolobot[];
  prestigeCount?: number;
  syncPoints?: number;
  wins?: number;
};

export function computeLeaderboardScore(input: LeaderboardScoreInput) {
  const highestLevel = Math.max(1, ...(input.holobots || []).map((holobot) => holobot.level || 1));
  const wins = input.wins || 0;
  const syncPoints = input.syncPoints || 0;
  const prestigeCount = input.prestigeCount || 0;

  return wins * 120 + highestLevel * 25 + syncPoints + prestigeCount * 500;
}

function toIsoString(value?: { toDate?: () => Date } | string) {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.toDate?.()?.toISOString();
}

export function mapFirestoreToUserProfile(userId: string, data: FirestoreUserDocument): UserProfile {
  return {
    id: userId,
    username: data.username || `pilot_${userId.slice(0, 8)}`,
    holobots: data.holobots || [],
    dailyEnergy: data.dailyEnergy ?? DEFAULT_USER_PROFILE.dailyEnergy,
    maxDailyEnergy: data.maxDailyEnergy ?? DEFAULT_USER_PROFILE.maxDailyEnergy,
    holosTokens: data.holosTokens ?? DEFAULT_USER_PROFILE.holosTokens,
    gachaTickets: data.gachaTickets ?? DEFAULT_USER_PROFILE.gachaTickets,
    stats: {
      wins: data.wins ?? DEFAULT_USER_PROFILE.wins,
      losses: data.losses ?? DEFAULT_USER_PROFILE.losses,
    },
    lastEnergyRefresh:
      toIsoString(data.lastEnergyRefresh) || new Date().toISOString(),
    level: 1,
    arena_passes: data.arenaPassses ?? DEFAULT_USER_PROFILE.arenaPassses,
    exp_boosters: data.expBoosters ?? DEFAULT_USER_PROFILE.expBoosters,
    energy_refills: data.energyRefills ?? DEFAULT_USER_PROFILE.energyRefills,
    rank_skips: data.rankSkips ?? DEFAULT_USER_PROFILE.rankSkips,
    async_battle_tickets:
      data.asyncBattleTickets ?? DEFAULT_USER_PROFILE.asyncBattleTickets,
    last_async_ticket_refresh:
      toIsoString(data.lastAsyncTicketRefresh) || new Date().toISOString(),
    blueprints: data.blueprints ?? DEFAULT_USER_PROFILE.blueprints,
    inventory: data.inventory ?? DEFAULT_USER_PROFILE.inventory,
    parts: data.parts ?? DEFAULT_USER_PROFILE.parts,
    equippedParts:
      (data.equippedParts as Record<string, Record<string, Record<string, unknown>>>) ??
      DEFAULT_USER_PROFILE.equippedParts,
    pack_history: data.packHistory ?? [],
    battle_cards: data.battle_cards ?? data.battleCards ?? {},
    starter_deck_claimed: data.starter_deck_claimed ?? false,
    arena_deck_template_ids: data.arena_deck_template_ids ?? [],
    rewardSystem: data.rewardSystem ?? {},
    isDevAccount: data.isDevAccount ?? DEFAULT_USER_PROFILE.isDevAccount,
    rental_holobots: data.rentalHolobots ?? DEFAULT_USER_PROFILE.rentalHolobots,
    syncPoints: data.syncPoints ?? DEFAULT_USER_PROFILE.syncPoints,
    leaderboardScore:
      data.leaderboardScore ??
      computeLeaderboardScore({
        holobots: data.holobots || [],
        prestigeCount: data.prestigeCount ?? 0,
        syncPoints: data.syncPoints ?? DEFAULT_USER_PROFILE.syncPoints,
        wins: data.wins ?? DEFAULT_USER_PROFILE.wins,
      }),
    prestigeCount: data.prestigeCount ?? 0,
    onboardingPath: data.onboardingPath,
    todaySteps: data.todaySteps ?? DEFAULT_USER_PROFILE.todaySteps,
    lastStepSync: toIsoString(data.lastStepSync),
    lastFitnessSyncAt: toIsoString(data.lastFitnessSyncAt),
    fitnessSource: data.fitnessSource ?? DEFAULT_USER_PROFILE.fitnessSource,
    syncDistanceUnit: data.syncDistanceUnit ?? DEFAULT_USER_PROFILE.syncDistanceUnit,
  };
}

export async function getUserProfile(userId: string) {
  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    return null;
  }

  return mapFirestoreToUserProfile(userId, userSnap.data() as FirestoreUserDocument);
}

export function subscribeToUserProfile(
  userId: string,
  onData: (profile: UserProfile | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const userRef = doc(db, "users", userId);

  return onSnapshot(
    userRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        onData(null);
        return;
      }

      onData(mapFirestoreToUserProfile(userId, snapshot.data() as FirestoreUserDocument));
    },
    (error) => {
      onError(error as Error);
    },
  );
}

type UserProfileUpdates = Partial<{
  dailyEnergy: number;
  holosTokens: number;
  syncPoints: number;
  gachaTickets: number;
  arena_passes: number;
  exp_boosters: number;
  energy_refills: number;
  rank_skips: number;
  async_battle_tickets: number;
  blueprints: Record<string, number>;
  inventory: Record<string, number>;
  parts: Array<Record<string, unknown>>;
  equippedParts: Record<string, Record<string, Record<string, unknown>>>;
  pack_history: Array<Record<string, unknown>>;
  battle_cards: Record<string, number>;
  starter_deck_claimed: boolean;
  arena_deck_template_ids: string[];
  holobots: UserHolobot[];
  rewardSystem: Record<string, unknown>;
  syncDistanceUnit: "km" | "mi";
}>;

export async function updateUserProfile(userId: string, updates: UserProfileUpdates) {
  const userRef = doc(db, "users", userId);
  const firestoreUpdates: Record<string, unknown> = {};

  if (updates.dailyEnergy !== undefined) firestoreUpdates.dailyEnergy = updates.dailyEnergy;
  if (updates.holosTokens !== undefined) firestoreUpdates.holosTokens = updates.holosTokens;
  if (updates.syncPoints !== undefined) firestoreUpdates.syncPoints = updates.syncPoints;
  if (updates.gachaTickets !== undefined) firestoreUpdates.gachaTickets = updates.gachaTickets;
  if (updates.arena_passes !== undefined) firestoreUpdates.arenaPassses = updates.arena_passes;
  if (updates.exp_boosters !== undefined) firestoreUpdates.expBoosters = updates.exp_boosters;
  if (updates.energy_refills !== undefined) firestoreUpdates.energyRefills = updates.energy_refills;
  if (updates.rank_skips !== undefined) firestoreUpdates.rankSkips = updates.rank_skips;
  if (updates.async_battle_tickets !== undefined) firestoreUpdates.asyncBattleTickets = updates.async_battle_tickets;
  if (updates.blueprints !== undefined) firestoreUpdates.blueprints = updates.blueprints;
  if (updates.inventory !== undefined) firestoreUpdates.inventory = updates.inventory;
  if (updates.parts !== undefined) firestoreUpdates.parts = updates.parts;
  if (updates.equippedParts !== undefined) firestoreUpdates.equippedParts = updates.equippedParts;
  if (updates.pack_history !== undefined) firestoreUpdates.packHistory = updates.pack_history;
  if (updates.battle_cards !== undefined) firestoreUpdates.battle_cards = updates.battle_cards;
  if (updates.starter_deck_claimed !== undefined) firestoreUpdates.starter_deck_claimed = updates.starter_deck_claimed;
  if (updates.arena_deck_template_ids !== undefined) {
    firestoreUpdates.arena_deck_template_ids = updates.arena_deck_template_ids;
  }
  if (updates.holobots !== undefined) firestoreUpdates.holobots = updates.holobots;
  if (updates.rewardSystem !== undefined) firestoreUpdates.rewardSystem = updates.rewardSystem;
  if (updates.syncDistanceUnit !== undefined) firestoreUpdates.syncDistanceUnit = updates.syncDistanceUnit;

  if (updates.holobots !== undefined || updates.syncPoints !== undefined) {
    const existingSnapshot = await getDoc(userRef);
    const existingData = (existingSnapshot.data() ?? {}) as FirestoreUserDocument;

    firestoreUpdates.leaderboardScore = computeLeaderboardScore({
      holobots: updates.holobots ?? existingData.holobots ?? DEFAULT_USER_PROFILE.holobots,
      prestigeCount: existingData.prestigeCount ?? 0,
      syncPoints: updates.syncPoints ?? existingData.syncPoints ?? DEFAULT_USER_PROFILE.syncPoints,
      wins: existingData.wins ?? DEFAULT_USER_PROFILE.wins,
    });
  }

  await updateDoc(userRef, firestoreUpdates as any);
}
