/**
 * Server twin of the Genesis sign-up profile that mobile writes in
 * `mobile/src/contexts/AuthContext.tsx` (signup → userRefData) with
 * `createGenesisStarterHolobot` (mobile/src/config/holobots.ts) and
 * `getGenesisStarterDeckGrants` (mobile/src/lib/battleCards/catalog.ts).
 *
 * Used by the createGenesisProfile callable so that an account created in
 * HoloCity desktop is exactly the account a phone sign-up creates.
 * `mobile/src/lib/__tests__/genesisSignupParity.test.ts` evaluates the mobile
 * source and fails if the two drift.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { calculateExperience, computeLeaderboardScore, getHolobotRank } from "./progression";

export const GENESIS_STARTER_CHOICES = ["ACE", "KUMA", "SHADOW"] as const;
export type GenesisStarterChoice = (typeof GENESIS_STARTER_CHOICES)[number];

/** Mobile LoginScreen: trimmed username of at least 3 characters. */
export const SIGNUP_MIN_USERNAME_LENGTH = 3;
/** Server-only sanity bound (mobile has no maximum; no real username is near this). */
export const SIGNUP_MAX_USERNAME_LENGTH = 64;

/** mobile/src/lib/battleCards/catalog.ts STARTER_DECK_BALANCED_IDS. */
export const GENESIS_STARTER_DECK_IDS = [
  "strike.quickJab",
  "strike.snapShot",
  "strike.tempoThrust",
  "strike.cornerPressure",
  "strike.vortexKick",
  "strike.armorPierce",
  "strike.backhand",
  "strike.aerialSlash",
  "defense.guardUp",
  "defense.safetyProtocol",
  "defense.coolantFlush",
  "defense.parryWindow",
  "defense.reinforcePlating",
  "defense.firewall",
  "combo.chainBurst",
  "combo.doubleTap",
  "combo.crossCircuit",
  "combo.pressureLink",
  "combo.flowState",
  "finisher.tacticalOverride",
] as const;

export function normalizeSignupUsername(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export type SignupRejection = "invalid-username" | "invalid-starter";

export function validateGenesisSignup(
  starterHolobot: unknown,
  username: unknown,
): { ok: true; starter: GenesisStarterChoice; username: string } | { ok: false; reason: SignupRejection } {
  if (typeof starterHolobot !== "string" || !(GENESIS_STARTER_CHOICES as readonly string[]).includes(starterHolobot)) {
    return { ok: false, reason: "invalid-starter" };
  }
  if (typeof username !== "string") {
    return { ok: false, reason: "invalid-username" };
  }
  const trimmed = username.trim();
  if (trimmed.length < SIGNUP_MIN_USERNAME_LENGTH || trimmed.length > SIGNUP_MAX_USERNAME_LENGTH) {
    return { ok: false, reason: "invalid-username" };
  }
  return { ok: true, starter: starterHolobot as GenesisStarterChoice, username: trimmed };
}

/** Mobile createGenesisStarterHolobot after mobile normalizeUserHolobot (zero sync stats unlock nothing). */
export function buildGenesisStarterHolobot(name: GenesisStarterChoice) {
  return {
    attributePoints: 1,
    boostedAttributes: {},
    experience: 0,
    level: 1,
    name,
    nextLevelExp: calculateExperience(2),
    rank: getHolobotRank(1),
    lifetimeSPInvested: 0,
    syncAbilityUnlocks: [] as string[],
    syncLevel: 0,
    syncStats: { bond: 0, focus: 0, guard: 0, power: 0, tempo: 0 },
  };
}

/** `timestamp` is FieldValue.serverTimestamp() in the callable (serverTimestamp() on mobile). */
export function buildGenesisSignupUserDoc<T>(starterHolobot: GenesisStarterChoice, username: string, timestamp: T) {
  const starterDeck: Record<string, number> = Object.fromEntries(GENESIS_STARTER_DECK_IDS.map((id) => [id, 1]));
  const starterHolobotProfile = buildGenesisStarterHolobot(starterHolobot);

  return {
    arena_deck_template_ids: Object.keys(starterDeck),
    asyncBattleTickets: 3,
    battle_cards: starterDeck,
    dailyEnergy: 100,
    energyRefills: 0,
    expBoosters: 0,
    fitnessSource: "mobile",
    gachaTickets: 0,
    holobots: [starterHolobotProfile],
    holosTokens: 0,
    inventory: {},
    isDevAccount: false,
    lastAsyncTicketRefresh: timestamp,
    lastEnergyRefresh: timestamp,
    onboardingPath: "genesis",
    starter_deck_claimed: true,
    syncDistanceUnit: "km",
    syncPoints: 0,
    lifetimeSyncPoints: 0,
    seasonSyncPoints: 0,
    syncRank: "Rookie",
    leaderboardScore: computeLeaderboardScore({
      holobots: [starterHolobotProfile],
      prestigeCount: 0,
      seasonSyncPoints: 0,
      wins: 0,
    }),
    todaySteps: 0,
    username: normalizeSignupUsername(username),
    wins: 0,
    losses: 0,
  };
}
