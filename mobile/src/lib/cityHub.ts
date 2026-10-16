/** HoloCity-lite presentation and strict adapters for PR #80's host contract. */
export const GATHERING_SCHEMA = "arena-gathering-1";
export const CITY_RING_COLORS = ["#2FE6FF", "#7CFF4F", "#B07CFF", "#FF7A1A", "#FF3D8B", "#FFD21A"] as const;
export const CITY_BOT_IDS = ["ace", "gama", "hare", "ken", "kuma", "kurai", "era", "shadow", "tora", "tsuin", "wake", "wolf"] as const;
export type CityStoryFlags = {
  arenaGatheringSeen: boolean;
  tournamentsWon: number;
  arenaArcBuilt: boolean;
  holoZonesArcBuilt: boolean;
};
export type ArenaCitizen = {
  citizenId: string;
  pilotName: string;
  holobotId: string;
  rank: "Rookie";
  ringColor: string;
};
export type ArenaGathering = { schemaVersion: typeof GATHERING_SCHEMA; roster: ArenaCitizen[]; storyFlags: CityStoryFlags };
export type CityDistrictId = "plaza" | "vendor" | "workshop" | "arena" | "harbor" | "port" | "zone";
export type CityDestination = "Home" | "Marketplace" | "Workshop" | "Arena" | "Quests" | "Rivals" | "Overworld";
export type CityDistrict = {
  id: CityDistrictId;
  name: string;
  activity: string;
  destination: CityDestination;
  /** Unity X/Z metres, north (+Z) up. Labels are separated for touch readability. */
  world: readonly [number, number];
  sourceAnchor: string;
};

export const CITY_LAYOUT_SOURCE = "HolobotsUnity/Documentation/QA/2026-09-22-layout-calls/context.json";
export const CITY_DISTRICTS: readonly CityDistrict[] = [
  { id: "plaza", name: "Plaza", activity: "Your squad", destination: "Home", world: [0, 10], sourceAnchor: "anchors.SyncTower_disc" },
  { id: "vendor", name: "Vendor", activity: "Catalog & supplies", destination: "Marketplace", world: [100, -55], sourceAnchor: "anchors.Market" },
  { id: "workshop", name: "Workshop", activity: "Heal & craft", destination: "Workshop", world: [-135, 0], sourceAnchor: "anchors_extra.minimapLandmarks.WORKSHOP" },
  { id: "arena", name: "Arena", activity: "Enter the arena", destination: "Arena", world: [-22, -55], sourceAnchor: "anchors.ArenaFoundation" },
  { id: "harbor", name: "Harbor", activity: "Quests & voyages", destination: "Quests", world: [-48, -164.4], sourceAnchor: "anchors.Marina gangway" },
  { id: "port", name: "Port", activity: "Citizen rivals", destination: "Rivals", world: [0, 115], sourceAnchor: "anchors_extra.minimapLandmarks.PORTAL TERMINAL" },
  { id: "zone", name: "HoloZone", activity: "Explore the wilds", destination: "Overworld", world: [120, 80], sourceAnchor: "anchors_extra.minimapLandmarks.RESEARCH GARDEN" },
];

export const EMPTY_CITY_FLAGS: CityStoryFlags = { arenaGatheringSeen: false, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false };
export function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
/** Missing pre-#80 account data stays locked. Corrupt supplied flags never open a gate. */
export function readCityStoryFlags(value: unknown): CityStoryFlags {
  const flags = record(value);
  if (!flags) return { ...EMPTY_CITY_FLAGS };
  if (typeof flags.arenaGatheringSeen !== "boolean" || typeof flags.arenaArcBuilt !== "boolean" || typeof flags.holoZonesArcBuilt !== "boolean" ||
      !Number.isInteger(flags.tournamentsWon) || Number(flags.tournamentsWon) < 0 || Number(flags.tournamentsWon) > 3 ||
      flags.arenaArcBuilt !== (flags.tournamentsWon === 3)) return { ...EMPTY_CITY_FLAGS };
  return { arenaGatheringSeen: flags.arenaGatheringSeen, arenaArcBuilt: flags.arenaArcBuilt, holoZonesArcBuilt: flags.holoZonesArcBuilt, tournamentsWon: Number(flags.tournamentsWon) };
}

export function readArenaGathering(value: unknown): ArenaGathering {
  const reply = record(value);
  if (reply?.schemaVersion !== GATHERING_SCHEMA || !Array.isArray(reply.roster) || reply.roster.length !== 8) throw new Error("The city roster needs an app update. Try again later.");
  const flags = readCityStoryFlags(reply.storyFlags);
  if (!flags.arenaGatheringSeen) throw new Error("The city host has not confirmed your gathering yet.");
  const ids = new Set<string>();
  const botRings = new Set<string>();
  const roster = reply.roster.map((value): ArenaCitizen => {
    const row = record(value);
    if (!row || typeof row.citizenId !== "string" || !/^CV1_[A-Za-z0-9_]{1,100}$/.test(row.citizenId) || ids.has(row.citizenId) ||
        typeof row.pilotName !== "string" || row.pilotName.length < 1 || row.pilotName.length > 80 || row.rank !== "Rookie" ||
        typeof row.holobotId !== "string" || !(CITY_BOT_IDS as readonly string[]).includes(row.holobotId) ||
        typeof row.ringColor !== "string" || !(CITY_RING_COLORS as readonly string[]).includes(row.ringColor)) throw new Error("The city roster could not be verified. Refresh to retry.");
    const botRing = `${row.holobotId}:${row.ringColor}`;
    if (botRings.has(botRing)) throw new Error("The city roster contains an ambiguous pilot ring. Refresh to retry.");
    ids.add(row.citizenId); botRings.add(botRing);
    return { citizenId: row.citizenId, pilotName: row.pilotName, holobotId: row.holobotId, rank: "Rookie", ringColor: row.ringColor };
  });
  return { schemaVersion: GATHERING_SCHEMA, roster, storyFlags: flags };
}

export function cityDistrictAccess(id: CityDistrictId, flags: CityStoryFlags): "open" | "locked" | "hidden" {
  if (id === "zone" && !flags.holoZonesArcBuilt) return "hidden";
  if (id === "arena" && !flags.arenaGatheringSeen) return "locked";
  return "open";
}
export function cityMapPoint(world: readonly [number, number]): { x: number; y: number } {
  return { x: 190 + world[0] * 0.91, y: 160 - world[1] * 0.9 };
}
export function cityTimeOfDay(hour: number): "day" | "night" {
  return hour >= 6 && hour < 19 ? "day" : "night";
}
/** The host supplies identity, not city coordinates; these are gathering presentation slots. */
export const CITY_RIVAL_PIN_POINTS = [
  { x: 120, y: 110 }, { x: 277, y: 154 }, { x: 322, y: 155 }, { x: 91, y: 225 },
  { x: 224, y: 285 }, { x: 66, y: 280 }, { x: 300, y: 285 }, { x: 66, y: 82 },
] as const;

export function cityActionMessage(error: unknown): string {
  const detail = record(record(error)?.details);
  const code = String(detail?.rejectionCode ?? record(error)?.code ?? "");
  const messages: Record<string, string> = {
    "functions/not-found": "The city host is not available yet. Please try again after the service update.",
    "functions/unavailable": "The city host is offline. Check your connection and retry.",
    "functions/unauthenticated": "Sign in again to meet the city pilots.",
    "unauthenticated": "Sign in again to meet the city pilots.",
    "rival_cooldown": "This pilot is recovering. Check their countdown before a rematch.",
    "battle_open": "Finish your current battle before healing at the workshop.",
    "arena_no_heal": "Workshop healing is unavailable during an Arena match.",
    "no_squad": "Choose a travel squad on your dashboard first.",
    "health_unavailable": "Your squad health is unavailable. Refresh your account before trying again.",
    "not_enough_fragments": "You need more Blueprint Fragments for this recipe.",
    "not_owned": "You need the lower-tier repair item for this recipe.",
    "insufficient_stock": "You need the lower-tier repair item for this recipe.",
    "no_item": "You need the lower-tier repair item for this recipe.",
    "too_many_open": "Finish your open rival battle before starting another.",
    "activity_conflict": "Finish your current activity before battling a rival.",
    "too_fast": "The host is still confirming this battle. Wait a moment and retry.",
  };
  return messages[code] ?? (error instanceof Error && !code ? error.message : "The city could not complete that action. Please retry.");
}

/** Host relative refusal clock; unrelated errors must never disable a rival pin. */
export function cityRivalCooldownEnd(error: unknown, receivedAtMs: number): number | null {
  const details = record(record(error)?.details);
  if (details?.rejectionCode !== "rival_cooldown" || typeof details.retryAfterMs !== "number" ||
      !Number.isFinite(details.retryAfterMs) || details.retryAfterMs < 0) return null;
  return receivedAtMs + details.retryAfterMs;
}
