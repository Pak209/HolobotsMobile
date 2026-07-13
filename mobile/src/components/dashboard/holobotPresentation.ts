import type { HolobotRosterEntry } from "@/config/holobots";
import type { UserHolobot, UserProfile } from "@/types/profile";

type AttributeKey = keyof HolobotRosterEntry["stats"];

type HolobotPresentation = {
  archetype: string;
  core: string;
  flavor: string;
  subtitle: string;
  type: string;
};

const PRESENTATION: Record<string, HolobotPresentation> = {
  ACE: {
    archetype: "Attacker",
    core: "Fire Core",
    flavor: "A prototype assault Holobot built for high-speed aerial combat.",
    subtitle: "Jet Vanguard",
    type: "Speed Type",
  },
  KUMA: {
    archetype: "Defender",
    core: "Earth Core",
    flavor: "A close-range guardian engineered to hold the line under pressure.",
    subtitle: "Iron Guardian",
    type: "Power Type",
  },
  SHADOW: {
    archetype: "Striker",
    core: "Void Core",
    flavor: "A covert combat Holobot tuned for sudden, decisive attacks.",
    subtitle: "Night Operative",
    type: "Speed Type",
  },
};

const FALLBACK_PRESENTATION: HolobotPresentation = {
  archetype: "Combatant",
  core: "Holo Core",
  flavor: "A battle-ready Holobot linked to its pilot through every encounter.",
  subtitle: "Arena Vanguard",
  type: "Balanced Type",
};

export function getHolobotPresentation(name: string) {
  return PRESENTATION[name.trim().toUpperCase()] ?? FALLBACK_PRESENTATION;
}

export function getStatGrade(value: number) {
  if (value >= 90) return "S";
  if (value >= 75) return "A";
  if (value >= 60) return "B";
  if (value >= 45) return "C";
  return "D";
}

export function getGradeColor(grade: string) {
  if (grade === "S") return "#ff3b46";
  if (grade === "A") return "#ff596f";
  if (grade === "B") return "#35bdf2";
  if (grade === "C") return "#f5c40d";
  return "#b7b7b7";
}

/**
 * Star count follows the game's canonical tier ladder (BLUEPRINT_TIERS:
 * Common < Champion < Rare < Elite < Legendary), unlike the design
 * handoff's placeholder numbers. "Epic" (marketplace part rarity) sits at
 * the Elite tier.
 */
export function getRarity(rank?: string) {
  const value = (rank || "Rookie").trim();
  const normalized = value.toLowerCase();
  const stars = normalized.includes("legend")
    ? 5
    : normalized.includes("elite") || normalized.includes("epic")
      ? 4
      : normalized.includes("rare")
        ? 3
        : normalized.includes("champion")
          ? 2
          : 1;

  return { label: value, stars };
}

export function getBondPercent(holobot?: UserHolobot) {
  const bond = holobot?.syncStats?.bond;
  return typeof bond === "number" ? Math.max(0, Math.min(100, Math.round(bond))) : 0;
}

export function getSyncPercent(profile?: UserProfile | null) {
  const points = profile?.seasonSyncPoints ?? profile?.syncPoints ?? 0;
  return Math.max(0, Math.min(100, Math.round(points % 101)));
}

export function getAttributeValue(stats: HolobotRosterEntry["stats"], key: AttributeKey) {
  return stats[key];
}

/** Compact tier label for the dashboard part plates — every part gets one
    (unlabeled legacy parts read as common). */
export function getRarityShortLabel(rarity?: string) {
  const normalized = (rarity || "").toLowerCase();
  if (normalized.includes("legend")) return "LGND";
  if (normalized.includes("elite")) return "ELITE";
  if (normalized.includes("epic")) return "EPIC";
  if (normalized.includes("rare")) return "RARE";
  if (normalized.includes("champion")) return "CHMP";
  return "CMN";
}
