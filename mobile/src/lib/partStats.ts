/**
 * Part stat boosts — equipment finally does something.
 *
 * Boosts are DERIVED from part identity (slot + rarity), never stored, so
 * every part ever granted gains stats retroactively with no migration, and
 * there is nothing for a client to forge (combat stats remain self-authored
 * in PvP exactly like levels and ranks — C4's documented model).
 *
 * The economy anchor: one attribute point buys +1 ATK/DEF/SPD/SPECIAL or
 * +10 HP. A part's PRIMARY boost is worth 2 attribute points per rarity
 * star (Legendary = 10 AP-equivalent), its themed SECONDARY half a star's
 * worth. A full five-slot Legendary loadout ≈ 50 AP — about half a full
 * rank-climb's attribute grant: meaningful, chaseable, never dominant.
 *
 * Slot themes: HEAD targeting → SPECIAL · TORSO armor → DEF ·
 * ARMS weapons → ATK · LEGS mobility → SPD · CORE reserves → HP.
 */

export type PartLike = {
  name?: string;
  slot?: string;
  rarity?: string;
};

export type PartBoosts = {
  attack: number;
  defense: number;
  speed: number;
  special: number;
  /** Flat HP (already in HP units, not attribute points). */
  hp: number;
};

export const EMPTY_PART_BOOSTS: PartBoosts = { attack: 0, defense: 0, speed: 0, special: 0, hp: 0 };

const AP_PER_STAR = 2;
const HP_PER_AP = 10;

/** Canonical tier ladder (matches the dashboard's star display). Legacy
    parts often carry rarity only as a name suffix — "Quantum Core (Epic)". */
export function getPartStars(part: PartLike | null | undefined): number {
  const fromField = (part?.rarity || "").toLowerCase();
  const fromName = (part?.name || "").toLowerCase();
  const blob = `${fromField} ${fromName}`;

  if (blob.includes("legend")) return 5;
  if (blob.includes("elite") || blob.includes("epic")) return 4;
  if (blob.includes("rare")) return 3;
  if (blob.includes("champion")) return 2;
  return 1;
}

export type PartSlot = "head" | "torso" | "arms" | "legs" | "core";

/** Slot from the record, else inferred from the name (same keyword
    heuristics the equip picker uses). */
export function resolvePartSlot(part: PartLike | null | undefined): PartSlot | null {
  const blob = `${part?.slot || ""} ${part?.name || ""}`.toLowerCase();

  if (blob.includes("head") || blob.includes("mask") || blob.includes("visor") || blob.includes("scanner")) {
    return "head";
  }
  if (blob.includes("torso") || blob.includes("body") || blob.includes("chassis") || blob.includes("chest") || blob.includes("plating")) {
    return "torso";
  }
  if (blob.includes("arm") || blob.includes("cannon") || blob.includes("boxer") || blob.includes("claw") || blob.includes("weapon") || blob.includes("glove")) {
    return "arms";
  }
  if (blob.includes("leg") || blob.includes("boot") || blob.includes("thruster") || blob.includes("mobility")) {
    return "legs";
  }
  if (blob.includes("core")) {
    return "core";
  }
  return null;
}

type SlotTheme = { primary: keyof PartBoosts; secondary: keyof PartBoosts };

const SLOT_THEMES: Record<PartSlot, SlotTheme> = {
  head: { primary: "special", secondary: "defense" },
  torso: { primary: "defense", secondary: "hp" },
  arms: { primary: "attack", secondary: "speed" },
  legs: { primary: "speed", secondary: "attack" },
  core: { primary: "hp", secondary: "special" },
};

function boostPoints(stat: keyof PartBoosts, points: number): number {
  return stat === "hp" ? points * HP_PER_AP : points;
}

/** The single part → stat contribution. */
export function getPartBoosts(part: PartLike | null | undefined): PartBoosts {
  const slot = resolvePartSlot(part);
  if (!slot || !part?.name) {
    return { ...EMPTY_PART_BOOSTS };
  }

  const stars = getPartStars(part);
  const theme = SLOT_THEMES[slot];
  const boosts: PartBoosts = { ...EMPTY_PART_BOOSTS };
  boosts[theme.primary] += boostPoints(theme.primary, stars * AP_PER_STAR);
  boosts[theme.secondary] += boostPoints(theme.secondary, Math.floor(stars / 2));
  return boosts;
}

/** Totals across one Holobot's equipped loadout. */
export function getEquippedPartBoosts(
  equippedParts: Record<string, PartLike | null | undefined> | null | undefined,
): PartBoosts {
  const totals: PartBoosts = { ...EMPTY_PART_BOOSTS };
  for (const part of Object.values(equippedParts || {})) {
    const boosts = getPartBoosts(part);
    totals.attack += boosts.attack;
    totals.defense += boosts.defense;
    totals.speed += boosts.speed;
    totals.special += boosts.special;
    totals.hp += boosts.hp;
  }
  return totals;
}

/** Case-tolerant lookup of a Holobot's equipped map on the profile. */
export function getHolobotEquippedParts(
  allEquippedParts: Record<string, unknown> | null | undefined,
  holobotName: string,
): Record<string, PartLike> {
  const map = (allEquippedParts || {}) as Record<string, Record<string, PartLike>>;
  return map[holobotName] ?? map[holobotName.toLowerCase()] ?? map[holobotName.toUpperCase()] ?? {};
}

const BOOST_LABELS: Array<{ key: keyof PartBoosts; label: string }> = [
  { key: "attack", label: "ATK" },
  { key: "defense", label: "DEF" },
  { key: "speed", label: "SPD" },
  { key: "special", label: "SPC" },
  { key: "hp", label: "HP" },
];

/** "+10 ATK · +2 SPD" — for pickers and inventory rows. */
export function describePartBoosts(part: PartLike | null | undefined): string {
  const boosts = getPartBoosts(part);
  const parts = BOOST_LABELS.filter(({ key }) => boosts[key] > 0).map(
    ({ key, label }) => `+${boosts[key]} ${label}`,
  );
  return parts.join(" · ");
}
