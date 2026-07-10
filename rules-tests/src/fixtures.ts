import { Timestamp } from "firebase/firestore";

// -----------------------------------------------------------------------------
// Fixtures below mirror real write shapes from the app so rules tests exercise
// realistic payloads rather than invented ones. Sources:
//   - SIGNUP_USER_DOC: userRefData in mobile/src/contexts/AuthContext.tsx (signup)
//   - FITNESS_USER_UPDATES / FITNESS_DAILY_UPDATES: computeFitnessSyncOutcome in
//     mobile/src/lib/fitnessSync.ts, holobots[].career via applyWorkoutCareer in
//     mobile/src/lib/progression.ts
//   - ENERGY_REGEN_UPDATE: updateUserProfile in mobile/src/lib/profile.ts
//   - GACHA_GRANT_UPDATE: buildPackGrantUpdates/buildPackRewards in
//     mobile/src/lib/gacha.ts as used by mobile/src/screens/GachaScreen.tsx
//   - WEB_PROFILE_UPDATE / WEB_ENERGY_UPDATE: updateUserProfile / updateUserEnergy
//     in ../holobots-fun/src/lib/firestore.ts
//   - BATTLE_POOL_ENTRY / BATTLE_ROOM_DOC: consistent with firestore.rules
//     battle_pool_entries / battle_rooms match blocks
// -----------------------------------------------------------------------------

export const SIGNUP_USER_DOC: Record<string, unknown> = {
  arena_deck_template_ids: ["genesis_ace_01", "genesis_ace_02"],
  asyncBattleTickets: 3,
  battle_cards: { genesis_ace_01: 1, genesis_ace_02: 1 },
  dailyEnergy: 100,
  energyRefills: 0,
  expBoosters: 0,
  fitnessSource: "mobile",
  gachaTickets: 0,
  holobots: [
    {
      name: "ACE",
      level: 1,
      experience: 0,
      rank: "Rookie",
    },
  ],
  holosTokens: 0,
  inventory: {},
  isDevAccount: false,
  lastAsyncTicketRefresh: new Date(),
  lastEnergyRefresh: new Date(),
  onboardingPath: "genesis",
  starter_deck_claimed: true,
  syncDistanceUnit: "km",
  syncPoints: 0,
  lifetimeSyncPoints: 0,
  seasonSyncPoints: 0,
  syncRank: "Rookie",
  leaderboardScore: 0,
  todaySteps: 0,
  username: "test_pilot",
  wins: 0,
  losses: 0,
};

export function buildUserDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...SIGNUP_USER_DOC, ...overrides };
}

// ---- fitness sync (mobile/src/lib/fitnessSync.ts) --------------------------

export const FITNESS_USER_UPDATES: Record<string, unknown> = {
  fitnessSource: "manual",
  holosTokens: 10,
  holobots: [
    {
      name: "ACE",
      level: 1,
      experience: 50,
      rank: "Rookie",
      career: {
        workouts: 1,
        distanceMeters: 2500,
        activeDays: 1,
        firstWorkoutDate: "2026-07-06",
        lastWorkoutDate: "2026-07-06",
      },
    },
  ],
  leaderboardScore: 42,
  syncPoints: 5,
  lifetimeSyncPoints: 5,
  seasonSyncPoints: 5,
  syncRank: "Rookie",
  todaySteps: 5000,
};

export const FITNESS_DAILY_UPDATES: Record<string, unknown> = {
  date: "2026-07-06",
  distanceMeters: 2500,
  source: "manual",
  stepsSynced: 5000,
  stepsTotal: 5000,
  syncPointsAwarded: 5,
  processedActivityIds: { "activity-1": true },
  processedWorkoutEvents: { "activity-1": true },
  workoutCooldownEndsAt: null,
  workoutMinutes: 20,
  workoutSessionsCompleted: 1,
};

// ---- energy regen (mobile/src/lib/profile.ts updateUserProfile) -----------

export const ENERGY_REGEN_UPDATE: Record<string, unknown> = {
  dailyEnergy: 100,
  lastEnergyRefresh: Timestamp.fromDate(new Date()),
  stepEnergyDate: "2026-07-06",
  stepEnergyGrantedToday: 20,
};

// ---- gacha grant (mobile/src/lib/gacha.ts + GachaScreen.tsx) ---------------

export const GACHA_GRANT_UPDATE: Record<string, unknown> = {
  gachaTickets: 0,
  parts: [{ name: "Combat Mask", rarity: "rare", slot: "head" }],
  blueprints: { ace: 2 },
  energy_refills: 1,
  arena_passes: 0,
  exp_boosters: 0,
  pack_history: [
    {
      id: "gacha_basic_1720000000000",
      items: [{ name: "Combat Mask", rarity: "rare" }],
      openedAt: new Date().toISOString(),
      packId: "basic",
    },
  ],
  rewardSystem: { boosterPacksOpenedToday: 1 },
};

// ---- web app (holobots-fun/src/lib/firestore.ts) ---------------------------

export const WEB_PROFILE_UPDATE: Record<string, unknown> = {
  holosTokens: 250,
  gachaTickets: 2,
  dailyEnergy: 80,
  wins: 3,
  losses: 1,
  arenaPassses: 1,
  expBoosters: 2,
  energyRefills: 1,
  rankSkips: 0,
  asyncBattleTickets: 3,
  syncPoints: 15,
  prestigeCount: 0,
  packHistory: [
    { id: "web_pack_1", items: [{ name: "Core Part", rarity: "common" }], openedAt: new Date().toISOString() },
  ],
};

export const WEB_ENERGY_UPDATE: Record<string, unknown> = {
  dailyEnergy: 60,
};

// ---- PvP (firestore.rules battle_pool_entries / battle_rooms) -------------
// These builders mirror what the clients ACTUALLY write (mobile
// useRealtimeArena.ts and the holobots-fun web hook): pool entries are
// self-describing via userId, and battle-room participant uids live only at
// players.p1.uid / players.p2.uid. The original fixtures invented top-level
// hostId/guestId/p1/p2 fields no client ever wrote, which let the old
// (broken) rules pass their tests while denying every real PvP write in
// production.

const FIXTURE_HOLOBOT_STATS: Record<string, unknown> = {
  name: "ACE",
  level: 5,
  attack: 10,
  defense: 10,
  speed: 10,
  intelligence: 5,
  maxHealth: 150,
};

export function buildPoolEntry(
  userId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    userId,
    username: userId,
    holobotStats: { ...FIXTURE_HOLOBOT_STATS },
    isActive: true,
    createdAt: Date.now(),
    ...overrides,
  };
}

function buildRoomPlayer(uid: string): Record<string, unknown> {
  return {
    uid,
    username: uid,
    holobot: uid ? { ...FIXTURE_HOLOBOT_STATS } : {},
    health: uid ? 150 : 0,
    maxHealth: uid ? 150 : 0,
    stamina: uid ? 7 : 0,
    maxStamina: uid ? 7 : 0,
    specialMeter: 0,
    hand: [],
    activeBoosts: [],
    isConnected: Boolean(uid),
    damageDealt: 0,
    damageTaken: 0,
  };
}

// Pass p2Uid: "" for a freshly created room still waiting for an opponent.
export function buildBattleRoom(
  p1Uid: string,
  p2Uid: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    roomCode: "ABC234",
    status: p2Uid ? "active" : "waiting",
    players: { p1: buildRoomPlayer(p1Uid), p2: buildRoomPlayer(p2Uid) },
    currentTurn: 0,
    winner: null,
    battleLog: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}
