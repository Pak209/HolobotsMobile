/**
 * Equipped parts in server fights (Pak's rulings, 2026-11-09). The table is mobile/src/lib/partStats.ts, derived from slot and
 * rarity and never stored, with one ruled change: legs give SPD +1 at rare and above and none at common. It is flat across
 * Holobots. A part above the pilot's cups counts as unequipped here, the one place fights read parts.
 *
 * The duel has no SPECIAL stat (duelFighterFromCombatant drops it), so SPECIAL is computed but changes nothing in a fight:
 * a head part's main stat and a core's second stat are dead there.
 *
 * Part HP is a fight-time layer. holobotVitals stays on the Holobot's own max HP, so clients that don't use the resolver, the
 * Workshop heal and unequipping are unaffected: a fight starts and ends at the same FRACTION of health as the ledger.
 *
 * Pure module: no firebase imports, safe to import from tests (functions/scripts/test-parts-in-fights.mjs).
 */
import { CupId } from "./cupRewards";
import { toHolobotKey } from "./mintingEconomy";
import { STORY_CUPS } from "../story/storyFlags";

export type PartBoosts = { attack: number; defense: number; speed: number; special: number; hp: number };
export const EMPTY_PART_BOOSTS: Readonly<PartBoosts> = Object.freeze({ attack: 0, defense: 0, speed: 0, special: 0, hp: 0 });
export const PART_SLOTS = ["head", "torso", "arms", "legs", "core"] as const;
export type FightPartSlot = (typeof PART_SLOTS)[number];

const AP_PER_STAR = 2;
const HP_PER_AP = 10;
const SLOT_THEMES: Record<FightPartSlot, { primary: keyof PartBoosts; secondary: keyof PartBoosts }> = {
  head: { primary: "special", secondary: "defense" },
  torso: { primary: "defense", secondary: "hp" },
  arms: { primary: "attack", secondary: "speed" },
  legs: { primary: "speed", secondary: "attack" },
  core: { primary: "hp", secondary: "special" },
};
/** Stars at which legs give their +1 SPD (the ruled change to the table). */
const LEGS_SPEED_MIN_STARS = 3;
const LEGS_SPEED = 1;

type PartRecord = { name?: unknown; rarity?: unknown };

/**
 * The rarity tier: a stored rarity field, or the "(Epic)" suffix legacy parts carry it as. A part with neither is common;
 * a word that merely contains a rarity ("Flare Cannon") doesn't count.
 */
export function partStars(part: PartRecord | null | undefined): number {
  const field = typeof part?.rarity === "string" ? part.rarity.toLowerCase() : "";
  const suffix = typeof part?.name === "string" ? (/\((legend[a-z]*|elite|epic|rare|champion)\)\s*$/i.exec(part.name)?.[1] ?? "").toLowerCase() : "";
  const blob = `${field} ${suffix}`;
  if (blob.includes("legend")) return 5;
  if (blob.includes("elite") || blob.includes("epic")) return 4;
  if (blob.includes("rare")) return 3;
  if (blob.includes("champion")) return 2;
  return 1;
}

/** The cup a part needs: Starter for rare, Champion for epic; legendary needs the last live cup (Elite, or Legends once it is on). */
export function partRequiredCup(part: PartRecord | null | undefined): CupId | null {
  const stars = partStars(part);
  if (stars >= 5) return STORY_CUPS.legendsLive ? "legends" : "rare";
  return stars === 4 ? "champion" : stars === 3 ? "starter" : null;
}
const CUPS_WON_FOR: Record<CupId, number> = { starter: 1, champion: 2, rare: 3, legends: 4 };
export function partOpenAtCups(part: PartRecord | null | undefined, cupsWon: number): boolean {
  const cup = partRequiredCup(part);
  return cup === null || cupsWon >= CUPS_WON_FOR[cup];
}
/** storyFlags.tournamentsWon, or 0 when unreadable: bad flags switch gear off, and never block a fight. */
export function cupsWonForParts(profile: Record<string, unknown>): number {
  const n = (profile.storyFlags as { tournamentsWon?: unknown } | undefined | null)?.tournamentsWon;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= 4 ? n : 0;
}

export function partBoostsFor(slot: FightPartSlot, part: PartRecord | null | undefined): PartBoosts {
  const boosts: PartBoosts = { ...EMPTY_PART_BOOSTS };
  if (typeof part?.name !== "string" || !part.name) return boosts;
  const stars = partStars(part), theme = SLOT_THEMES[slot];
  const points = (stat: keyof PartBoosts, n: number) => (stat === "hp" ? n * HP_PER_AP : n);
  boosts[theme.primary] += slot === "legs" ? (stars >= LEGS_SPEED_MIN_STARS ? LEGS_SPEED : 0) : points(theme.primary, stars * AP_PER_STAR);
  boosts[theme.secondary] += points(theme.secondary, Math.floor(stars / 2));
  return boosts;
}

function equippedMapFor(profile: Record<string, unknown>, holobotId: string): Record<string, unknown> {
  const all = profile.equippedParts;
  if (!all || typeof all !== "object" || Array.isArray(all)) return {};
  const map = all as Record<string, unknown>;
  const key = [holobotId.toUpperCase(), holobotId, ...Object.keys(map).filter((k) => toHolobotKey(k) === holobotId)].find((k) => Object.prototype.hasOwnProperty.call(map, k));
  const found = key === undefined ? undefined : map[key];
  return found && typeof found === "object" && !Array.isArray(found) ? (found as Record<string, unknown>) : {};
}

/** What a Holobot's equipped parts add in a fight, with the cup gate. Malformed entries count for nothing. */
export function equippedPartBoosts(profile: Record<string, unknown>, holobotId: string): PartBoosts {
  const map = equippedMapFor(profile, holobotId), cupsWon = cupsWonForParts(profile), total: PartBoosts = { ...EMPTY_PART_BOOSTS };
  for (const slot of PART_SLOTS) {
    const part = map[slot];
    if (!part || typeof part !== "object" || !partOpenAtCups(part as PartRecord, cupsWon)) continue;
    const b = partBoostsFor(slot, part as PartRecord);
    total.attack += b.attack; total.defense += b.defense; total.speed += b.speed; total.special += b.special; total.hp += b.hp;
  }
  return total;
}
export const partBoostsChangeFight = (b: PartBoosts) => b.attack > 0 || b.defense > 0 || b.speed > 0 || b.hp > 0;

/**
 * A combatant with parts applied, ready for duelFighterFromCombatant. Pass it only when building a resolver fighter: the
 * result is pinned on the fight, so later equipment changes can't touch an open one. No fight boost returns the input as is.
 */
export function applyPartBoosts<T extends { maxHealth: number; attack: number; defense: number; speed?: number; currentHealth?: number }>(c: T, b: PartBoosts): T {
  if (!partBoostsChangeFight(b)) return c;
  const maxHealth = c.maxHealth + b.hp;
  const scaled = c.currentHealth === undefined ? {} : { currentHealth: c.currentHealth <= 0 ? 0 : Math.max(1, Math.min(maxHealth, Math.round((maxHealth * c.currentHealth) / c.maxHealth))) };
  return { ...c, maxHealth, attack: c.attack + b.attack, defense: c.defense + b.defense, speed: (c.speed ?? 0) + b.speed, ...scaled };
}

/**
 * A fight's final HP back on the ledger's scale: the same fraction of the Holobot's own max, never above what it was issued,
 * and a survivor stays above zero. Without part HP (the fight's max equals the ledger's) the value passes through unchanged.
 */
export function ledgerHealthAfterFight(finalHealth: number, fightMaxHealth: number, issued: { currentHealth: number; maxHealth: number }): number {
  if (fightMaxHealth === Math.round(issued.maxHealth)) return finalHealth;
  if (finalHealth <= 0) return 0;
  return Math.min(issued.currentHealth, Math.ceil((issued.maxHealth * finalHealth) / fightMaxHealth));
}
