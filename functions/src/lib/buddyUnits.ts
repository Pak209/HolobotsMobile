/**
 * Pak DECISIONS #44 (2026-10-01): Buddy Unit capture tiers. ONE data module for
 * the tier table, the per-tier inventory on users/{uid}, the capture-chance
 * formula and the seeded capture roll. Every tunable number lives here; Unity
 * never computes any of it and only renders the host's replies.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { createHmac } from "node:crypto";

export type BuddyTierKey = "light" | "medium" | "heavy";
export type BuddyTierId = "buddy_light" | "buddy_medium" | "buddy_heavy";
/** users/{uid}.buddyUnits since #44. Exactly these three keys, each a safe integer >= 0. */
export type BuddyInventory = Record<BuddyTierKey, number>;

export type BuddyTierRow = {
  key: BuddyTierKey;
  /** Wire id: the capture intent's toyId and the world item's itemId. */
  id: BuddyTierId;
  displayName: string;
  modelKey: string;
  /** Capture chance at affinity 0. */
  baseChance01: number;
  /** Whether toy affinity raises this tier's chance (Heavy is always 100%). */
  affinityApplies: boolean;
};

export const BUDDY_UNIT_TIERS: readonly BuddyTierRow[] = [
  { key: "light", id: "buddy_light", displayName: "Light Buddy Unit", modelKey: "buddy_unit_light", baseChance01: 0.35, affinityApplies: true },
  { key: "medium", id: "buddy_medium", displayName: "Medium Buddy Unit", modelKey: "buddy_unit_medium", baseChance01: 0.65, affinityApplies: true },
  { key: "heavy", id: "buddy_heavy", displayName: "Heavy Buddy Unit", modelKey: "buddy_unit_heavy", baseChance01: 1, affinityApplies: false },
];
export const BUDDY_UNIT_TIER_IDS: readonly BuddyTierId[] = BUDDY_UNIT_TIERS.map((t) => t.id);
const TIER_KEYS: readonly BuddyTierKey[] = BUDDY_UNIT_TIERS.map((t) => t.key);

/**
 * Affinity formula (#44, producer default):
 *   lift   = max(0, chanceByAffinity[affinityTier] - chanceByAffinity[0]) * AFFINITY_LIFT_SCALE
 *   chance = affinityApplies ? min(1, baseChance01 + lift) : baseChance01
 * i.e. each encounter's existing chanceByAffinity curve now describes how much
 * toys RAISE the odds over its affinity-0 value; the tier sets the base. At
 * affinity 0 every tier throws at exactly its base (35 / 65 / 100 %). Rounded
 * to 6 decimals so float noise never decides a roll at the boundary.
 */
export const AFFINITY_LIFT_SCALE = 1;

/** Firestore field on users/{uid}. Server-only (rules deny client create/update/delete). */
export const BUDDY_UNITS_FIELD = "buddyUnits";
/** Units a pilot holds the first time the server sees them (#43, tier per #44). */
export const STARTING_BUDDY_UNITS: { tier: BuddyTierKey; count: number } = { tier: "light", count: 1 };
/** Units one capture attempt spends. #44: a refusal consumes the Unit too. */
export const BUDDY_UNITS_PER_CAPTURE = 1;
/** Upper bound for the admin grant seam (one call). */
export const MAX_ADMIN_GRANT = 1000;

export function emptyInventory(): BuddyInventory {
  return { light: 0, medium: 0, heavy: 0 };
}

export function starterInventory(): BuddyInventory {
  return { ...emptyInventory(), [STARTING_BUDDY_UNITS.tier]: STARTING_BUDDY_UNITS.count };
}

export function tierById(id: unknown): BuddyTierRow | undefined {
  return BUDDY_UNIT_TIERS.find((t) => t.id === id);
}

export function tierByKey(key: BuddyTierKey): BuddyTierRow {
  return BUDDY_UNIT_TIERS.find((t) => t.key === key)!;
}

export function totalBuddyUnits(inv: BuddyInventory): number {
  return TIER_KEYS.reduce((n, k) => n + inv[k], 0);
}

const count = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

export type InventoryRead = {
  units: BuddyInventory;
  /** Fields the caller must write in the same transaction ({} when the stored form is current). */
  updates: Record<string, unknown>;
  /** 'starter' = never seen (field missing), 'integer' = #43 form migrated, '' = current form. */
  migration: "" | "starter" | "integer";
};

/**
 * Lazy, idempotent read of users/{uid}.buddyUnits.
 * - missing        → never seen: the starter grant (exactly once; the caller persists it).
 * - integer N      → #43 form: { light: N, medium: 0, heavy: 0 }, no starter grant.
 * - {light,medium,heavy} → current form, no write.
 * - anything else (null, partial map, extra keys, negatives, floats) → null: callers fail
 *   closed. Malformed data is never treated as "missing", so it can never re-open the
 *   starter grant (cloud review 2026-10-01 #1; clients can't delete the field or the profile).
 */
export function readBuddyInventory(profile: Record<string, unknown>): InventoryRead | null {
  const raw = profile[BUDDY_UNITS_FIELD];
  if (raw === undefined) {
    const units = starterInventory();
    return { units, updates: { [BUDDY_UNITS_FIELD]: { ...units } }, migration: "starter" };
  }
  if (typeof raw === "number") {
    if (!count(raw)) return null;
    const units = { ...emptyInventory(), light: raw };
    return { units, updates: { [BUDDY_UNITS_FIELD]: { ...units } }, migration: "integer" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const map = raw as Record<string, unknown>;
  const keys = Object.keys(map);
  if (keys.length !== TIER_KEYS.length || !TIER_KEYS.every((k) => count(map[k]))) return null;
  return { units: { light: map.light as number, medium: map.medium as number, heavy: map.heavy as number }, updates: {}, migration: "" };
}

export function isValidInventory(inv: unknown): inv is BuddyInventory {
  return readBuddyInventory({ [BUDDY_UNITS_FIELD]: inv })?.migration === "";
}

export function withTierDelta(inv: BuddyInventory, key: BuddyTierKey, delta: number): BuddyInventory {
  const next = inv[key] + delta;
  if (!Number.isSafeInteger(next) || next < 0) throw new RangeError("buddy units");
  return { ...inv, [key]: next };
}

/** Encounter affinity lift (see AFFINITY_LIFT_SCALE). `chanceByAffinity` / `affinityTier` are pre-validated by the host. */
export function affinityLift01(chanceByAffinity: readonly number[], affinityTier: number): number {
  const lift = (chanceByAffinity[affinityTier] ?? 0) - (chanceByAffinity[0] ?? 0);
  return Number.isFinite(lift) ? Math.max(0, lift) * AFFINITY_LIFT_SCALE : 0;
}

export function captureChance01(tier: BuddyTierRow, chanceByAffinity: readonly number[], affinityTier: number): number {
  const raw = tier.affinityApplies ? tier.baseChance01 + affinityLift01(chanceByAffinity, affinityTier) : tier.baseChance01;
  return Math.round(Math.min(1, Math.max(0, raw)) * 1e6) / 1e6;
}

/** Per-session server secret (hex, 32 bytes). Stored on the server-only session doc; never sent to clients. */
export const ROLL_SEED = /^[0-9a-f]{64}$/;

/**
 * Deterministic capture roll in [0, 1): HMAC-SHA256(sessionSeed, encounterId|requestId).
 * The same requestId always yields the same roll (no re-roll on retry); the secret seed
 * stops a client from searching for requestIds that roll low. Independent of the tier, and
 * only revealed after a Unit was spent. captured ⇔ roll < chance, so 100 % always captures.
 */
export function captureRoll01(seed: string, encounterId: string, requestId: string): number {
  if (!ROLL_SEED.test(seed)) throw new RangeError("roll seed");
  const digest = createHmac("sha256", Buffer.from(seed, "hex")).update(`capture-roll-1|${encounterId}|${requestId}`).digest();
  return digest.readUIntBE(0, 6) / 2 ** 48;
}
