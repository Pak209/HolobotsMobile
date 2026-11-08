/**
 * Cup prizes and the Workshop's part tiers (Pak, 2026-11-08: "Prizes + part-tier unlock"). ONE data module: each cup
 * (starter, champion, rare) pays a one-time prize on its first win, and storyFlags.tournamentsWon opens the next tier
 * of Workshop parts. No new story flag: Unity's TournamentBracketReplies rejects unknown storyFlags keys, and
 * tournamentsWon already says exactly which cups are won (they are won in order).
 * Every amount here is PROPOSED (functions/src/story/CUP_PRIZES.md); Pak tunes the constants.
 *
 * Pure module: no firebase imports, safe to import from tests (functions/scripts/test-cup-rewards.mjs).
 */
import { BUDDY_UNITS_FIELD, BuddyInventory, readBuddyInventory, withTierDelta } from "./buddyUnits";
import { MARKETPLACE_PART_PRICES } from "./economy";
import { holosAfterGrant } from "./rivalLadder";

export const CUP_PRIZE_SCHEMA = "cup-prize-1";
export type CupId = "starter" | "champion" | "rare";
export const CUP_IDS: readonly CupId[] = ["starter", "champion", "rare"];
export const CUP_NAMES: Readonly<Record<CupId, string>> = Object.freeze({ starter: "Starter Cup", champion: "Champion Cup", rare: "Rare Cup" });

export type CupPrize = { holos: number; blueprints: number; heavyBuddyUnits: number };
/** PROPOSED (Pak can change these). `blueprints` are of the Holobot the pilot won the cup with. */
export const CUP_PRIZES: Readonly<Record<CupId, CupPrize>> = Object.freeze({
  starter: { holos: 500, blueprints: 10, heavyBuddyUnits: 0 },
  champion: { holos: 1000, blueprints: 15, heavyBuddyUnits: 0 },
  rare: { holos: 2000, blueprints: 20, heavyBuddyUnits: 1 },
});

/** PROPOSED. A part's tier is its price; `cupsWon` = the tournamentsWon a pilot needs to buy that tier. */
export const PART_TIERS: readonly { price: number; cupsWon: number; cupId: CupId | null }[] = Object.freeze([
  { price: MARKETPLACE_PART_PRICES.common, cupsWon: 0, cupId: null },
  { price: MARKETPLACE_PART_PRICES.rare, cupsWon: 1, cupId: "starter" },
  { price: MARKETPLACE_PART_PRICES.epic, cupsWon: 2, cupId: "champion" },
]);

/** Fail closed: a price outside the tier table is not for sale until it is added here (a test pins the catalog). */
export function partTierOpen(price: number, cupsWon: number): boolean {
  const tier = PART_TIERS.find((t) => t.price === price);
  return !!tier && cupsWon >= tier.cupsWon;
}
/** The cup that opens `price`'s tier, or null when it is already open / not in the table. */
export function partLockedBehind(price: number, cupsWon: number): CupId | null {
  const tier = PART_TIERS.find((t) => t.price === price);
  return tier && cupsWon < tier.cupsWon ? tier.cupId : null;
}

/** Added to the Workshop catalog reply so clients can say "Win the Starter Cup to unlock". */
export type PartTierView = { unlockedMaxPrice: number; unlockedPrices: number[]; next: { price: number; cupId: CupId; cupName: string } | null };
export function partTierView(cupsWon: number): PartTierView {
  const open = PART_TIERS.filter((t) => cupsWon >= t.cupsWon);
  const nextTier = PART_TIERS.find((t) => cupsWon < t.cupsWon);
  return {
    unlockedMaxPrice: Math.max(...open.map((t) => t.price)),
    unlockedPrices: open.map((t) => t.price),
    next: nextTier ? { price: nextTier.price, cupId: nextTier.cupId as CupId, cupName: CUP_NAMES[nextTier.cupId as CupId] } : null,
  };
}

// ---- The prize ----

export type CupPrizeReceipt = { cupId: CupId; matchId: string; holobotId: string; awardedAtMs: number; holos: number; blueprints: number; heavyBuddyUnits: number };
/** Stored at cupPrizes/{uid} (server-only): one receipt per cup, so a story-flag reset can never pay a cup twice. */
export type CupPrizeLedger = { schemaVersion: typeof CUP_PRIZE_SCHEMA; prizes: Partial<Record<CupId, CupPrizeReceipt>> };
/** The wire block a request carrying `prizeSchema` gets. `unlocksPartPrice`: the part tier this cup opened (null: none). */
export type CupPrizeView = Omit<CupPrizeReceipt, "awardedAtMs"> & { schemaVersion: typeof CUP_PRIZE_SCHEMA; unlocksPartPrice: number | null; alreadyPaid: boolean };

export function cupPrizeView(r: CupPrizeReceipt, alreadyPaid: boolean): CupPrizeView {
  const { awardedAtMs: _at, ...rest } = r;
  return { schemaVersion: CUP_PRIZE_SCHEMA, ...rest, unlocksPartPrice: PART_TIERS.find((t) => t.cupId === r.cupId)?.price ?? null, alreadyPaid };
}

const whole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** undefined = no prizes yet. A malformed ledger returns null (the caller fails closed; it is never treated as empty). */
export function readCupPrizeLedger(raw: unknown): CupPrizeLedger | null {
  if (raw === undefined) return { schemaVersion: CUP_PRIZE_SCHEMA, prizes: {} };
  if (!obj(raw) || raw.schemaVersion !== CUP_PRIZE_SCHEMA || !obj(raw.prizes)) return null;
  for (const [id, r] of Object.entries(raw.prizes)) {
    if (!CUP_IDS.includes(id as CupId) || !obj(r) || r.cupId !== id || typeof r.matchId !== "string" || typeof r.holobotId !== "string" || !whole(r.awardedAtMs) || !whole(r.holos) || !whole(r.blueprints) || !whole(r.heavyBuddyUnits)) return null;
  }
  return structuredClone(raw) as unknown as CupPrizeLedger;
}

/**
 * The user-doc writes for `cupId`'s prize. null = malformed balance / blueprints / Buddy Units (fail closed, nothing paid).
 * Uses the existing grant rules: holosAfterGrant, the blueprints map keyed by lowercase Holobot id, and the Buddy tier inventory.
 */
export function applyCupPrize(profile: Record<string, unknown>, cupId: CupId, holobotId: string, matchId: string, nowMs: number): { receipt: CupPrizeReceipt; userUpdates: Record<string, unknown> } | null {
  const prize = CUP_PRIZES[cupId];
  const holosTokens = holosAfterGrant(profile, prize.holos);
  if (holosTokens === null) return null;
  const raw = profile.blueprints ?? {};
  if (!obj(raw) || Object.values(raw).some((n) => !whole(n))) return null;
  const blueprints = { ...(raw as Record<string, number>), [holobotId]: ((raw as Record<string, number>)[holobotId] ?? 0) + prize.blueprints };
  const userUpdates: Record<string, unknown> = { holosTokens, blueprints };
  if (prize.heavyBuddyUnits > 0) {
    const inv = readBuddyInventory(profile);
    if (!inv) return null;
    const units: BuddyInventory = withTierDelta(inv.units, "heavy", prize.heavyBuddyUnits);
    userUpdates[BUDDY_UNITS_FIELD] = { ...units };
  }
  return { receipt: { cupId, matchId, holobotId, awardedAtMs: nowMs, ...prize }, userUpdates };
}
