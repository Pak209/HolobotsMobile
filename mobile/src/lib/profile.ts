import { isLiteEnabled } from "@/config/liteFeature";
import { Timestamp } from "firebase/firestore";

import { doc, getDoc, onSnapshot, updateDoc, db, type Unsubscribe } from "@/config/firebase";
import type { SyncRank, UserHolobot, UserProfile } from "@/types/profile";
import { computeLeaderboardScore } from "@/lib/progression";
import { getSyncRank } from "@/lib/syncProgression";
import { readCityStoryFlags } from "@/lib/cityHub";

export { computeLeaderboardScore };

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
  emergencyPatches: 0,
  asyncBattleTickets: 3,
  playerRank: "Rookie",
  blueprints: {},
  parts: [],
  equippedParts: {},
  holobots: [],
  isDevAccount: false,
  rentalHolobots: [],
  syncPoints: 0,
  lifetimeSyncPoints: 0,
  seasonSyncPoints: 0,
  syncRank: "Rookie" as SyncRank,
  inventory: {},
  todaySteps: 0,
  fitnessSource: "mobile",
  syncDistanceUnit: "km" as const,
};

type FirestoreUserDocument = {
  storyFlags?: unknown;
  holobotVitals?: unknown;
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
  emergencyPatches?: number;
  rankSkips?: number;
  asyncBattleTickets?: number;
  lastAsyncTicketRefresh?: { toDate?: () => Date };
  blueprints?: Record<string, number>;
  parts?: Array<Record<string, unknown>>;
  equippedParts?: Record<string, unknown>;
  holobots?: UserHolobot[];
  lastEnergyRefresh?: { toDate?: () => Date };
  stepEnergyDate?: string;
  stepEnergyGrantedToday?: number;
  isDevAccount?: boolean;
  rentalHolobots?: Array<Record<string, unknown>>;
  syncPoints?: number;
  lifetimeSyncPoints?: number;
  seasonSyncPoints?: number;
  syncRank?: SyncRank;
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
  wildcardBlueprints?: number;
  legendaryBlueprints?: number;
  expBoosterActiveUntil?: number;
  lastWildcardPackAt?: number;
  referralCode?: string;
  referredBy?: string;
  referrals?: { pending?: number; qualified?: number };
  referralQualified?: boolean;
  genesisSquadClaimed?: string;
  genesisBadge?: boolean;
};

function toIsoString(value?: { toDate?: () => Date } | string) {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return value.toDate?.()?.toISOString();
}

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  // Firestore sentinel values must pass through untouched.
  if (value instanceof Timestamp || value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => stripUndefinedDeep(entry))
      .filter((entry) => entry !== undefined);
  }

  if (value && typeof value === "object") {
    const nextEntries = Object.entries(value).flatMap(([key, entry]) => {
      const sanitized = stripUndefinedDeep(entry);
      return sanitized === undefined ? [] : [[key, sanitized] as const];
    });

    return Object.fromEntries(nextEntries);
  }

  return value;
}

/**
 * Strict read of the City's HP ledger (`holobotVitals`, host-written on settles), the same rules as the lite reader
 * src/lite/lib/arenaVitals.ts `readHostVitals`: display only, and anything malformed is null ("unknown"). Mobile never
 * writes or computes these values; updateUserProfile has no holobotVitals field.
 */
function readHolobotVitals(raw: unknown): UserProfile["holobotVitals"] {
  if (raw === undefined || raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, { currentHealth: number; maxHealth: number }> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = value as Record<string, unknown> | null;
    if (!v || typeof v !== "object" || typeof v.currentHealth !== "number" || !Number.isFinite(v.currentHealth) || typeof v.maxHealth !== "number"
      || !Number.isFinite(v.maxHealth) || v.maxHealth <= 0 || v.currentHealth < 0 || v.currentHealth > v.maxHealth) return null;
    out[id] = { currentHealth: v.currentHealth, maxHealth: v.maxHealth };
  }
  return out;
}

export function mapFirestoreToUserProfile(userId: string, data: FirestoreUserDocument): UserProfile {
  return {
    ...(isLiteEnabled() ? { storyFlags: readCityStoryFlags(data.storyFlags) } : {}),
    ...(isLiteEnabled() ? { holobotVitals: readHolobotVitals(data.holobotVitals) } : {}),
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
    stepEnergyDate: data.stepEnergyDate,
    stepEnergyGrantedToday: data.stepEnergyGrantedToday,
    level: 1,
    arena_passes: data.arenaPassses ?? DEFAULT_USER_PROFILE.arenaPassses,
    exp_boosters: data.expBoosters ?? DEFAULT_USER_PROFILE.expBoosters,
    energy_refills: data.energyRefills ?? DEFAULT_USER_PROFILE.energyRefills,
    rank_skips: data.rankSkips ?? DEFAULT_USER_PROFILE.rankSkips,
    emergency_patches: data.emergencyPatches ?? DEFAULT_USER_PROFILE.emergencyPatches,
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
    lifetimeSyncPoints: data.lifetimeSyncPoints ?? DEFAULT_USER_PROFILE.lifetimeSyncPoints,
    seasonSyncPoints: data.seasonSyncPoints ?? DEFAULT_USER_PROFILE.seasonSyncPoints,
    syncRank:
      data.syncRank ??
      getSyncRank(data.lifetimeSyncPoints ?? DEFAULT_USER_PROFILE.lifetimeSyncPoints),
    leaderboardScore:
      data.leaderboardScore ??
      computeLeaderboardScore({
        holobots: data.holobots || [],
        prestigeCount: data.prestigeCount ?? 0,
        seasonSyncPoints: data.seasonSyncPoints ?? DEFAULT_USER_PROFILE.seasonSyncPoints,
        wins: data.wins ?? DEFAULT_USER_PROFILE.wins,
      }),
    prestigeCount: data.prestigeCount ?? 0,
    onboardingPath: data.onboardingPath,
    todaySteps: data.todaySteps ?? DEFAULT_USER_PROFILE.todaySteps,
    lastStepSync: toIsoString(data.lastStepSync),
    lastFitnessSyncAt: toIsoString(data.lastFitnessSyncAt),
    fitnessSource: data.fitnessSource ?? DEFAULT_USER_PROFILE.fitnessSource,
    syncDistanceUnit: data.syncDistanceUnit ?? DEFAULT_USER_PROFILE.syncDistanceUnit,
    wildcardBlueprints: data.wildcardBlueprints ?? 0,
    legendaryBlueprints: data.legendaryBlueprints ?? 0,
    expBoosterActiveUntil: data.expBoosterActiveUntil,
    lastWildcardPackAt: data.lastWildcardPackAt,
    referralCode: data.referralCode,
    referredBy: data.referredBy,
    referrals: data.referrals,
    referralQualified: data.referralQualified ?? false,
    genesisSquadClaimed: data.genesisSquadClaimed,
    genesisBadge: data.genesisBadge ?? false,
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

/**
 * The ONLY profile fields the client may write (firestore.rules
 * clientWritableKeys, holobots-write-lockdown-1). Everything else — holobots,
 * currency, items, cards, parts, leaderboard inputs — is written by the
 * callables; adding a field here without adding it to the rules allowlist
 * makes every write that carries it PERMISSION_DENIED. Energy (dailyEnergy and
 * its regen clocks) is server-only since energy-quest-server-1: refreshEnergy.
 */
export type UserProfileUpdates = Partial<{
  rewardSystem: Record<string, unknown>;
  syncDistanceUnit: "km" | "mi";
  referralCode: string;
}>;

export async function updateUserProfile(userId: string, updates: UserProfileUpdates) {
  const userRef = doc(db, "users", userId);
  const firestoreUpdates: Record<string, unknown> = {};

  if (updates.rewardSystem !== undefined) firestoreUpdates.rewardSystem = updates.rewardSystem;
  if (updates.syncDistanceUnit !== undefined) firestoreUpdates.syncDistanceUnit = updates.syncDistanceUnit;
  if (updates.referralCode !== undefined) firestoreUpdates.referralCode = updates.referralCode;

  if (Object.keys(firestoreUpdates).length === 0) return;
  await updateDoc(userRef, stripUndefinedDeep(firestoreUpdates) as any);
}
