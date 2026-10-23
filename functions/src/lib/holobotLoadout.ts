/**
 * holobots-write-lockdown-1 (Pak 2026-10-23 "yes, lock it down"): the three
 * profile writes the mobile client used to make directly to users/{uid} and
 * that firestore.rules now freezes (holobots, equippedParts, battle_cards /
 * arena_deck_template_ids / starter_deck_claimed). Each builder validates
 * against the stored profile and returns the exact merge the callable writes.
 * Every operation is a "set to" (never an increment), so a replay of the same
 * request writes nothing new.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { GENESIS_STARTER_DECK_IDS } from "./genesisSignup";
import { MAX_HOLOBOT_NAME_LENGTH, getUnlockedSyncAbilityIds, normalizeSyncStats } from "./progressionEconomy";

const MAX_ID_LENGTH = 200;

function readHolobotName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name.length > 0 && name.length <= MAX_HOLOBOT_NAME_LENGTH ? name : null;
}

function readId(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 && raw.length <= MAX_ID_LENGTH ? raw : null;
}

function readHolobots(userData: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(userData.holobots)
    ? (userData.holobots as unknown[]).filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    : [];
}

function findOwnedIndex(holobots: Array<Record<string, unknown>>, holobotName: string): number {
  const wanted = holobotName.toUpperCase();
  return holobots.findIndex((entry) => typeof entry.name === "string" && entry.name.toUpperCase() === wanted);
}

// ---- equipSyncAbility ---------------------------------------------------------

export type EquipSyncAbilityRequest = { holobotName: string; abilityId: string };
export type EquipSyncAbilityRefusal = "not_owned" | "ability_locked";
export type EquipSyncAbilityOutcome =
  | EquipSyncAbilityRefusal
  | { updates: Record<string, unknown> | null; reply: { equipped: true; changed: boolean; abilityId: string } };

export function validateEquipSyncAbilityRequest(raw: unknown): EquipSyncAbilityRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const holobotName = readHolobotName(source.holobotName);
  const abilityId = readId(source.abilityId);
  return holobotName && abilityId ? { holobotName, abilityId } : null;
}

/**
 * Mobile InventoryScreen handleEquipSyncAbility: the ability must be in the
 * holobot's unlocks — the stored syncAbilityUnlocks (written only by
 * upgradeSyncStat) or, when absent, the unlocks its stored syncStats earn
 * (mobile normalizeUserHolobot's same fallback).
 */
export function buildEquipSyncAbility(
  userData: Record<string, unknown>,
  request: EquipSyncAbilityRequest,
): EquipSyncAbilityOutcome {
  const holobots = readHolobots(userData);
  const index = findOwnedIndex(holobots, request.holobotName);
  if (index < 0) return "not_owned";

  const target = holobots[index];
  const unlocks = Array.isArray(target.syncAbilityUnlocks)
    ? (target.syncAbilityUnlocks as unknown[]).filter((id): id is string => typeof id === "string")
    : getUnlockedSyncAbilityIds(String(target.name), normalizeSyncStats(target.syncStats));
  if (!unlocks.includes(request.abilityId)) return "ability_locked";

  if (target.equippedSyncAbilityId === request.abilityId) {
    return { updates: null, reply: { equipped: true, changed: false, abilityId: request.abilityId } };
  }

  const nextHolobots = holobots.map((entry, i) => (i === index ? { ...entry, equippedSyncAbilityId: request.abilityId } : entry));
  return { updates: { holobots: nextHolobots }, reply: { equipped: true, changed: true, abilityId: request.abilityId } };
}

// ---- equipHolobotPart ---------------------------------------------------------

export const PART_SLOTS = ["head", "torso", "arms", "legs", "core"] as const;
export type PartSlot = (typeof PART_SLOTS)[number];

export type EquipPartRequest = { holobotName: string; slot: PartSlot; partId: string };
export type EquipPartRefusal = "not_owned" | "part_not_found" | "slot_mismatch";
export type EquippedPartRecord = { id: string; name: string; rarity: string; slot: PartSlot };
export type EquipPartOutcome =
  | EquipPartRefusal
  | { updates: Record<string, unknown> | null; reply: { equipped: true; changed: boolean; part: EquippedPartRecord } };

export function validateEquipPartRequest(raw: unknown): EquipPartRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const holobotName = readHolobotName(source.holobotName);
  const partId = readId(source.partId);
  const slot = typeof source.slot === "string" && (PART_SLOTS as readonly string[]).includes(source.slot) ? (source.slot as PartSlot) : null;
  return holobotName && partId && slot ? { holobotName, slot, partId } : null;
}

/** Mobile HomeScreen compatibleParts (main + lite): a fuzzy slot/name match. */
export function partFitsSlot(slot: PartSlot, part: { name: string; slot: string }): boolean {
  const blob = `${part.slot} ${part.name}`.toLowerCase();
  const any = (...words: string[]) => words.some((word) => blob.includes(word));
  switch (slot) {
    case "head":
      return any("head", "mask", "visor", "scanner");
    case "torso":
      return any("torso", "body", "chassis", "chest");
    case "arms":
      return any("arm", "cannon", "boxer", "claw", "weapon");
    case "legs":
      return any("leg", "lower", "boot", "thruster", "mobility");
    case "core":
      return any("core");
  }
}

/** Mobile HomeScreen inventoryParts: the stored id, else `${name || "part"}-${index}`. */
export function readInventoryParts(userData: Record<string, unknown>): Array<{ id: string; name: string; rarity: string; slot: string }> {
  const parts = Array.isArray(userData.parts) ? (userData.parts as unknown[]) : [];
  return parts
    .map((raw, index) => {
      const part = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return {
        id: String(part.id || `${part.name || "part"}-${index}`),
        name: String(part.name || `Part ${index + 1}`),
        rarity: String(part.rarity || ""),
        slot: String(part.slot || ""),
      };
    })
    .filter((part) => part.name.trim().length > 0);
}

/**
 * Equips one OWNED part (users/{uid}.parts, server-written) into one slot.
 * The stored record is copied from the owned part, never from the request,
 * so a client cannot invent rarity/name (getEquippedPartBoosts reads both).
 * Keyed by the requested holobot name exactly as the client always keyed it
 * (the HomeScreen readers look up the exact and lowercase name).
 */
export function buildEquipPart(userData: Record<string, unknown>, request: EquipPartRequest): EquipPartOutcome {
  const holobots = readHolobots(userData);
  if (findOwnedIndex(holobots, request.holobotName) < 0) return "not_owned";

  const part = readInventoryParts(userData).find((entry) => entry.id === request.partId);
  if (!part) return "part_not_found";
  if (!partFitsSlot(request.slot, part)) return "slot_mismatch";

  const record: EquippedPartRecord = { id: part.id, name: part.name, rarity: part.rarity, slot: request.slot };
  const equipped = (userData.equippedParts && typeof userData.equippedParts === "object" ? userData.equippedParts : {}) as Record<
    string,
    Record<string, unknown>
  >;
  const current = equipped[request.holobotName]?.[request.slot] as Record<string, unknown> | undefined;
  if (current && current.id === record.id && current.name === record.name && current.rarity === record.rarity && current.slot === record.slot) {
    return { updates: null, reply: { equipped: true, changed: false, part: record } };
  }
  return {
    // Merged with { merge: true }: only this holobot's slot changes.
    updates: { equippedParts: { [request.holobotName]: { [request.slot]: record } } },
    reply: { equipped: true, changed: true, part: record },
  };
}

// ---- claimStarterDeck ---------------------------------------------------------

/**
 * The AuthContext legacy backfill: an account with no battle cards that never
 * claimed the starter deck gets the Genesis starter deck once (sign-up via
 * createGenesisProfile already includes it). Anything else is a no-op.
 */
export function buildStarterDeckClaim(userData: Record<string, unknown>): { updates: Record<string, unknown> | null; granted: boolean } {
  const cards = userData.battle_cards && typeof userData.battle_cards === "object" ? (userData.battle_cards as Record<string, unknown>) : {};
  if (userData.starter_deck_claimed === true || Object.keys(cards).length > 0) {
    return { updates: null, granted: false };
  }
  const deck: Record<string, number> = Object.fromEntries(GENESIS_STARTER_DECK_IDS.map((id) => [id, 1]));
  return {
    updates: { arena_deck_template_ids: Object.keys(deck), battle_cards: deck, starter_deck_claimed: true },
    granted: true,
  };
}
