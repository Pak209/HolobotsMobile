import {repairGrant} from "./repairItems";
import { desktopPracticeCommands } from "./desktopPracticeCommands";
/**
 * Pak DECISIONS #43 (2026-09-30): daily rival reward and rival difficulty
 * ladder. ONE data module: every tunable rival number lives here (producer
 * defaults, Pak tunes), plus the pure rules that read them. The Buddy Unit
 * tiers / inventory / capture odds (#44) live in lib/buddyUnits.ts. Unity never
 * sees or computes any of this; it renders the replies.
 *
 * Pure module: no firebase imports, safe to import from tests
 * (functions/scripts/test-rival-ladder.mjs).
 */
import { HOLOBOT_NAMES } from "./economy";
import { toHolobotKey } from "./mintingEconomy";
import { BUDDY_UNITS_FIELD, BuddyInventory, BuddyTierId, BuddyTierKey, readBuddyInventory, tierByKey, totalBuddyUnits, withTierDelta } from "./buddyUnits";
import { awardBattleExperienceRaw, HolobotProgressionEntry } from "./battleProgression";
import { getHolobotRank, normalizeUserHolobot } from "./progression";
import { getPlayerBattleStats } from "./progressionEconomy";
import { RIVAL_LINEUP_SCALE_WOLF, rivalTierBattleStats } from "./rivalTierStats";

// ---- Daily rival reward (Buddy Unit inventory: lib/buddyUnits.ts, #44) ---------

/** Units granted by the first rival WIN of each UTC day. */
export const DAILY_RIVAL_REWARD_BUDDY_UNITS = 1;
/** Tier of the daily rival reward (#44: Light). */
export const DAILY_RIVAL_REWARD_TIER: BuddyTierKey = "light";

// ---- Rival ladder ----------------------------------------------------------

/**
 * Stored battle-record format (rivalBattles/{uid}/battles/*). Production battles carry it, so it
 * never changes with the wire version.
 */
export const RIVAL_RECORD_SCHEMA = "rival-battle-1";
/** Wire v1: deployed 2026-09-30; status.buddyUnits is an int. Still served to clients that don't ask for v2. */
export const RIVAL_SCHEMA_V1 = "rival-battle-1";
/** Wire v2 (DECISIONS #44): status.buddyUnits is {light, medium, heavy}; settle adds buddyUnitTierGranted. */
export const RIVAL_SCHEMA_V2 = "rival-battle-2";
/**
 * Wire v3 (DECISIONS #53, additive over v2): issue adds `playerCombatants[]` (the player's travel
 * squad with real stats) and `speed` / `intelligence` on every opponent; settle accepts `fielded`
 * (Holobot ids that took part) and adds `progression[]` (Holobot XP). v2 / v1 replies are projections
 * that strip exactly those fields.
 */
export const RIVAL_SCHEMA_V3 = "rival-battle-3";
export type RivalWireVersion = typeof RIVAL_SCHEMA_V1 | typeof RIVAL_SCHEMA_V2 | typeof RIVAL_SCHEMA_V3;
/** tier = floor(rivalWins / RIVAL_WINS_PER_TIER). Losses never count. */
export const RIVAL_WINS_PER_TIER = 10;
/** An issued battleId settles only within this window. */
export const RIVAL_BATTLE_TTL_MS = 2 * 60 * 60 * 1000;
/**
 * Storage cleanup. Every issued battle carries RIVAL_BATTLE_CLEANUP_FIELD (a Firestore
 * Timestamp) = expiresAtMs + this grace; the Firestore TTL policy on collection group
 * `battles` deletes the record some time after that (typically within 24 h). Settled
 * battles stay replayable (alreadyProcessed) for the whole grace window; once deleted,
 * a late duplicate settle reads as unknown_battle and still writes nothing.
 */
export const RIVAL_BATTLE_TTL_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** TTL policy field on rivalBattles/{uid}/battles/{battleId}, added by the store (this module has no Firestore types). */
export const RIVAL_BATTLE_CLEANUP_FIELD = "expireAt";
/** Open = issued, unsettled and not past expiresAtMs. `issue` beyond this is too_many_open. */
export const RIVAL_MAX_OPEN_BATTLES = 3;
/** A settle claiming a win sooner than this after issue is too_fast (nothing written; may retry later). Losses are never too fast. */
export const RIVAL_MIN_WIN_MS = 20 * 1000;
/**
 * DECISIONS #53 Holobot XP: a LOSS settled sooner than this after issue still settles (the ladder
 * ruling is unchanged) but earns no XP (progression rows report expGained 0), so issue→instant-loss
 * cannot farm XP. Wins already need RIVAL_MIN_WIN_MS. Producer default; Pak tunes.
 */
export const RIVAL_MIN_XP_MS = RIVAL_MIN_WIN_MS;
/** Server-only open-battle ledger doc (parent of the battles): { openBattles: { [battleId]: expiresAtMs } }. */
export const RIVAL_OPEN_BATTLES_FIELD = "openBattles";
/** PilotBattleDirector spawns at most three opponents. */
export const MAX_RIVALS = 3;
export const RIVAL_MAX_LEVEL = 99;
/** Firestore fields on users/{uid}. Server-only. */
export const RIVAL_WINS_FIELD = "rivalWins";
export const RIVAL_REWARD_DAY_FIELD = "rivalRewardDay";

/** Rival Holobot ids: the real roster (lowercase stable ids, same set as Unity's HolobotRegistry). */
export const RIVAL_ROSTER_IDS: readonly string[] = HOLOBOT_NAMES.map((name) => toHolobotKey(name));

export type RivalTierRow = {
  tier: number;
  /** NpcPilotSnapshot.tier display label. */
  label: string;
  /** #43 opponent level — rival-battle-1 / -2 only (rival-battle-3: rivalTierStats.ts, 1 + 4t). */
  level: number;
  /** #43: multiplies the baseline health / attack / defense — rival-battle-1 / -2 only (retired for rival-battle-3). */
  statScale: number;
  rivals: number;
};

/**
 * Explicit table for tiers 0-9. Rival count: every second tier adds one
 * (0-1 → 1, 2-3 → 2, 4+ → 3). Beyond the last row the ladder keeps climbing
 * by RIVAL_TIER_EXTRAPOLATION per tier (level capped at RIVAL_MAX_LEVEL).
 * DECISIONS #53 amendment 1: `label` and `rivals` hold for every wire version; `level` and
 * `statScale` are the #43 scale that rival-battle-1 / -2 replies keep (byte-identical to the
 * deployed shapes). rival-battle-3 opponents use WOLF's battle stats at level 1 + 4t
 * (lib/rivalTierStats.ts).
 */
export const RIVAL_TIER_TABLE: readonly RivalTierRow[] = [
  { tier: 0, label: "rookie", level: 5, statScale: 0.8, rivals: 1 },
  { tier: 1, label: "rookie", level: 8, statScale: 0.9, rivals: 1 },
  { tier: 2, label: "challenger", level: 11, statScale: 1.0, rivals: 2 },
  { tier: 3, label: "challenger", level: 14, statScale: 1.1, rivals: 2 },
  { tier: 4, label: "elite", level: 18, statScale: 1.2, rivals: 3 },
  { tier: 5, label: "elite", level: 22, statScale: 1.3, rivals: 3 },
  { tier: 6, label: "elite", level: 26, statScale: 1.4, rivals: 3 },
  { tier: 7, label: "legend", level: 30, statScale: 1.5, rivals: 3 },
  { tier: 8, label: "legend", level: 35, statScale: 1.62, rivals: 3 },
  { tier: 9, label: "legend", level: 40, statScale: 1.75, rivals: 3 },
];
export const RIVAL_TIER_EXTRAPOLATION = { levelPerTier: 5, statScalePerTier: 0.12, label: "legend" } as const;

/**
 * Scale-1.0 rival (the wolf in Unity's pilot-battle sample payload). #43: health / attack / defense
 * scale by statScale — the rival-battle-1 / -2 opponents. maxStamina / staminaRegen / deployment /
 * moves are fixed for every version and every combatant (rival and player). rival-battle-3 opponents
 * take level / health / attack / defense / speed / intelligence from rivalTierStats.ts instead.
 */
export const RIVAL_BASELINE = {
  maxHealth: 285,
  attack: 52,
  defense: 18,
  maxStamina: 110,
  staminaRegen: 16,
  deployment: { deployCost: 14, drainPerSecond: 1.6, rechargePerSecond: 4 },
  moves: [
    { moveId: "gap_closer", staminaCost: 22, damageScale: 1.35, breakPower: 14, chargeable: true },
    { moveId: "break_heavy", staminaCost: 38, damageScale: 1.55, breakPower: 42, chargeable: true },
    { moveId: "intercept", staminaCost: 18, damageScale: 0.45, breakPower: 6, chargeable: false },
  ],
} as const;

export function rivalCountForTier(tier: number): number {
  return Math.min(MAX_RIVALS, 1 + Math.floor(tier / 2));
}

export function tierForWins(wins: number): number {
  return Math.floor(wins / RIVAL_WINS_PER_TIER);
}

export function getRivalTierRow(tier: number): RivalTierRow {
  if (!Number.isSafeInteger(tier) || tier < 0) throw new RangeError("tier");
  if (tier < RIVAL_TIER_TABLE.length) return RIVAL_TIER_TABLE[tier];
  const last = RIVAL_TIER_TABLE[RIVAL_TIER_TABLE.length - 1];
  const steps = tier - last.tier;
  return {
    tier,
    label: RIVAL_TIER_EXTRAPOLATION.label,
    level: Math.min(RIVAL_MAX_LEVEL, last.level + steps * RIVAL_TIER_EXTRAPOLATION.levelPerTier),
    statScale: Math.round((last.statScale + steps * RIVAL_TIER_EXTRAPOLATION.statScalePerTier) * 100) / 100,
    rivals: rivalCountForTier(tier),
  };
}

// ---- Payload shapes (Unity EncounterPayload fragments) ---------------------

export type MoveSnapshot = { moveId: string; staminaCost: number; damageScale: number; breakPower: number; chargeable: boolean };
export type CombatantSnapshot = {
  commandRules?: ReturnType<typeof desktopPracticeCommands>;
  holobotId: string;
  level: number;
  maxHealth: number;
  attack: number;
  defense: number;
  maxStamina: number;
  staminaRegen: number;
  deployment: { deployCost: number; drainPerSecond: number; rechargePerSecond: number };
  moves: MoveSnapshot[];
  /** rival-battle-3 (stripped from v1/v2 replies). */
  speed?: number;
  /** rival-battle-3: SPECIAL (stripped from v1/v2 replies). */
  intelligence?: number;
};
/** rival-battle-3: the stored flat boosts, every key present (integers >= 0). */
export type BoostedAttributesSnapshot = { attack: number; defense: number; speed: number; special: number; health: number };
/**
 * rival-battle-3 (DECISIONS #53-2/3): one of the player's travel-squad Holobots with its REAL stats —
 * getHolobotBattleStats(name, level, boostedAttributes) with the sync modifiers applied as
 * arenaConfig.buildPlayerFighter does (lib/progressionEconomy.ts getPlayerBattleStats; equipped parts
 * not included). maxStamina / staminaRegen / deployment / moves are the RIVAL_BASELINE constants so every
 * required combatant field is present; they are not stat-derived.
 */
export type PlayerCombatantSnapshot = CombatantSnapshot & {
  speed: number;
  intelligence: number;
  experience: number;
  nextLevelExp: number;
  attributePoints: number;
  boostedAttributes: BoostedAttributesSnapshot;
  rank: string;
};
export type NpcPilotSnapshot = { pilotId: string; displayName: string; tier: string };
export type RivalLineup = { opponentPilot: NpcPilotSnapshot; opponentSquad: CombatantSnapshot[] };

/** #43 scale: RIVAL_BASELINE x the tier row's statScale at the row's level. */
export const RIVAL_LINEUP_SCALE_BASELINE = "baseline-statscale";
/**
 * Which stat scale an issued lineup used; stored on the battle record (lineupScale) so it is
 * unambiguous. Records issued before 2026-10-06 (#53 amendment 1) have no field = the baseline.
 */
export type RivalLineupScale = typeof RIVAL_LINEUP_SCALE_BASELINE | typeof RIVAL_LINEUP_SCALE_WOLF;
export { RIVAL_LINEUP_SCALE_WOLF };

/** rival-battle-3 → WOLF at level 1 + 4t; rival-battle-1 / -2 → the #43 baseline (their replies stay byte-identical). */
export function rivalLineupScaleFor(version: RivalWireVersion): RivalLineupScale {
  return version === RIVAL_SCHEMA_V3 ? RIVAL_LINEUP_SCALE_WOLF : RIVAL_LINEUP_SCALE_BASELINE;
}

/** #43 baseline combatant (rival-battle-1 / -2). */
export function rivalCombatant(holobotId: string, row: RivalTierRow): CombatantSnapshot {
  const b = RIVAL_BASELINE;
  return {
    holobotId,
    level: row.level,
    maxHealth: Math.round(b.maxHealth * row.statScale),
    attack: Math.round(b.attack * row.statScale),
    defense: Math.round(b.defense * row.statScale),
    maxStamina: b.maxStamina,
    staminaRegen: b.staminaRegen,
    deployment: { ...b.deployment },
    moves: b.moves.map((m) => ({ ...m })),
  };
}

/**
 * DECISIONS #53 amendment 1 combatant in the #43 record format: level / maxHealth / attack / defense =
 * WOLF's battle stats at level 1 + 4t (rivalTierStats.ts); stamina / deployment / moves = RIVAL_BASELINE.
 * speed / intelligence are NOT stored (the record keeps the #43 format); the rival-battle-3 issue reply
 * adds them (rivalScaledCombatantStats).
 */
export function rivalScaledCombatant(holobotId: string, tier: number): CombatantSnapshot {
  const stats = rivalTierBattleStats(tier);
  const b = RIVAL_BASELINE;
  return {
    holobotId,
    level: stats.level,
    maxHealth: stats.maxHealth,
    attack: stats.attack,
    defense: stats.defense,
    maxStamina: b.maxStamina,
    staminaRegen: b.staminaRegen,
    deployment: { ...b.deployment },
    moves: b.moves.map((m) => ({ ...m })),
  };
}

/** rival-battle-3 opponent speed / intelligence (WOLF at level 1 + 4t). Issue reply only. */
export function rivalScaledCombatantStats(tier: number): { speed: number; intelligence: number } {
  const stats = rivalTierBattleStats(tier);
  return { speed: stats.speed, intelligence: stats.intelligence };
}

const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

/** The player's combatant for `holobotId` from its stored record (see PlayerCombatantSnapshot). */
export function playerCombatant(holobotId: string, rawHolobot: unknown): PlayerCombatantSnapshot {
  const holobot = normalizeUserHolobot(rawHolobot);
  const stats = getPlayerBattleStats(holobot);
  const boosts = (holobot.boostedAttributes && typeof holobot.boostedAttributes === "object" ? holobot.boostedAttributes : {}) as Record<string, unknown>;
  const b = RIVAL_BASELINE;
  return {
    holobotId,
    commandRules: desktopPracticeCommands(holobotId),
    level: Math.max(1, Math.floor(holobot.level)),
    maxHealth: stats.maxHP,
    attack: stats.attack,
    defense: stats.defense,
    maxStamina: b.maxStamina,
    staminaRegen: b.staminaRegen,
    deployment: { ...b.deployment },
    moves: b.moves.map((m) => ({ ...m })),
    speed: stats.speed,
    intelligence: stats.intelligence,
    experience: whole(holobot.experience),
    nextLevelExp: whole(holobot.nextLevelExp),
    attributePoints: whole(holobot.attributePoints),
    boostedAttributes: { attack: whole(boosts.attack), defense: whole(boosts.defense), speed: whole(boosts.speed), special: whole(boosts.special), health: whole(boosts.health) },
    rank: typeof holobot.rank === "string" && holobot.rank ? holobot.rank : getHolobotRank(holobot.level),
  };
}

/** Player combatants for the travel-squad ids, in slot order. An id with no Holobot record is skipped. */
export function buildPlayerCombatants(profile: Record<string, unknown>, squadIds: readonly string[]): PlayerCombatantSnapshot[] {
  const holobots: unknown[] = Array.isArray(profile.holobots) ? profile.holobots : [];
  const out: PlayerCombatantSnapshot[] = [];
  for (const id of squadIds) {
    const record = holobots.find((h) => h && typeof h === "object" && typeof (h as { name?: unknown }).name === "string" && toHolobotKey((h as { name: string }).name) === id);
    if (record) out.push(playerCombatant(id, record));
  }
  return out;
}

/**
 * `random` returns [0,1). Rivals are distinct roster ids. The ids, pilot and draw count are the same
 * for both scales (only the stat numbers differ), so a battle's seed never depends on the version.
 */
export function buildRivalLineup(tier: number, random: () => number, scale: RivalLineupScale = RIVAL_LINEUP_SCALE_BASELINE): RivalLineup {
  const row = getRivalTierRow(tier);
  const pool = [...RIVAL_ROSTER_IDS];
  const picked: string[] = [];
  for (let i = 0; i < row.rivals; i++) {
    const j = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    picked.push(pool.splice(j, 1)[0]);
  }
  return {
    opponentPilot: { pilotId: `rival_tier_${tier}`, displayName: "Rival", tier: row.label },
    opponentSquad: picked.map((id) => (scale === RIVAL_LINEUP_SCALE_WOLF ? rivalScaledCombatant(id, tier) : rivalCombatant(id, row))),
  };
}

// ---- Profile readers (null = malformed stored data → callers fail closed) --

type Profile = Record<string, unknown>;

export function readRivalWins(profile: Profile): number | null {
  const raw = profile[RIVAL_WINS_FIELD];
  if (raw === undefined) return 0;
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < 0) return null;
  return raw;
}

export function readRivalRewardDay(profile: Profile): string | null {
  const raw = profile[RIVAL_REWARD_DAY_FIELD];
  if (raw === undefined) return "";
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return raw;
}

/** The server's day boundary: UTC calendar date, YYYY-MM-DD. */
export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

// ---- Rival battle rules ----------------------------------------------------

export type RivalErrorCode = "invalid_request" | "unknown_battle" | "battle_expired" | "too_many_open" | "too_fast" | "unavailable";
export class RivalError extends Error {
  constructor(public code: RivalErrorCode) {
    super(code);
  }
}

export type RivalStatus = {
  tier: number;
  tierLabel: string;
  rivalWins: number;
  winsToNextTier: number;
  rivalsThisTier: number;
  dailyRewardAvailable: boolean;
  /** Per-tier inventory (#44). */
  buddyUnits: BuddyInventory;
};

/** buddyUnitTierGranted: the tier id of buddyUnitsGranted ("" when nothing was granted). Older records lack it. */
export type RivalSettlement = {
  didWin: boolean; buddyUnitsGranted: number; buddyUnitTierGranted?: BuddyTierId | ""; tierBefore: number; tierAfter: number; settledAtMs: number;
  /** DECISIONS #53 (records settled from 2026-10-06): the fielded ids the settle named, and the XP ruling replayed by duplicates. */
  fielded?: string[];
  progression?: HolobotProgressionEntry[];
};

/** Stored at rivalBattles/{uid}/battles/{battleId}; server-only path. */
export type RivalBattleRecord = {
  schemaVersion: typeof RIVAL_RECORD_SCHEMA;
  battleId: string;
  tier: number;
  issuedAtMs: number;
  expiresAtMs: number;
  lineup: RivalLineup;
  seed: number;
  settlement: RivalSettlement | null;
  /** DECISIONS #53: the travel squad at issue (records issued from 2026-10-06). `fielded` must come from it or the current squad. */
  playerSquadIds?: string[];
  /** DECISIONS #53 amendment 1: the stat scale of `lineup` (records issued from 2026-10-06 ~14:07; absent = the #43 baseline). */
  lineupScale?: RivalLineupScale;
};

/** When the TTL policy may delete an issued battle (epoch ms). */
export function rivalBattleCleanupAtMs(battle: Pick<RivalBattleRecord, "expiresAtMs">): number {
  return battle.expiresAtMs + RIVAL_BATTLE_TTL_GRACE_MS;
}

/**
 * Open-battle ledger at rivalBattles/{uid}: battleId → expiresAtMs. Missing doc/field = none open.
 * Returns only entries still open at nowMs (settle is legal while nowMs <= expiresAtMs);
 * malformed stored data → unavailable (fail closed). At most RIVAL_MAX_OPEN_BATTLES entries are ever stored.
 */
export function readOpenBattles(ledger: Record<string, unknown> | undefined, nowMs: number): Record<string, number> {
  const raw = ledger?.[RIVAL_OPEN_BATTLES_FIELD];
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new RivalError("unavailable");
  const open: Record<string, number> = {};
  for (const [id, expiresAtMs] of Object.entries(raw as Record<string, unknown>)) {
    if (!RIVAL_BATTLE_ID.test(id) || typeof expiresAtMs !== "number" || !Number.isFinite(expiresAtMs)) throw new RivalError("unavailable");
    if (nowMs <= expiresAtMs) open[id] = expiresAtMs;
  }
  return open;
}

/** Ledger after issuing `battle`, or too_many_open when RIVAL_MAX_OPEN_BATTLES are already open. */
export function openBattlesAfterIssue(open: Record<string, number>, battle: Pick<RivalBattleRecord, "battleId" | "expiresAtMs">): Record<string, number> {
  if (Object.keys(open).length >= RIVAL_MAX_OPEN_BATTLES) throw new RivalError("too_many_open");
  return { ...open, [battle.battleId]: battle.expiresAtMs };
}

/** Ledger after settling battleId (settled battles are no longer open). */
export function openBattlesAfterSettle(open: Record<string, number>, battleId: string): Record<string, number> {
  const next = { ...open };
  delete next[battleId];
  return next;
}

/** `schemaVersion` is the reply version the client asked for (request field; missing = v1, the deployed shape). */
export type RivalCommand = ({ operation: "status" } | { operation: "issue" } | { operation: "settle"; battleId: string; didWin: boolean; fielded?: string[] }) & { schemaVersion: RivalWireVersion };

export const RIVAL_BATTLE_ID = /^[a-zA-Z0-9_-]{1,128}$/;
/** A fielded Holobot id: the travel-squad id rule. */
export const RIVAL_FIELDED_ID = /^[a-z][a-z0-9_]{0,127}$/;
export const RIVAL_MAX_FIELDED = 3;

/** `fielded` (optional on settle): 0-3 distinct travel-squad ids. undefined = not sent (no XP). */
function validateFielded(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > RIVAL_MAX_FIELDED || raw.some((id) => typeof id !== "string" || !RIVAL_FIELDED_ID.test(id)) || new Set(raw).size !== raw.length) throw new RivalError("invalid_request");
  return [...(raw as string[])];
}

export function validateRivalCommand(raw: unknown): RivalCommand {
  if (!raw || typeof raw !== "object") throw new RivalError("invalid_request");
  const c = raw as Record<string, unknown>;
  if (c.schemaVersion !== undefined && c.schemaVersion !== RIVAL_SCHEMA_V1 && c.schemaVersion !== RIVAL_SCHEMA_V2 && c.schemaVersion !== RIVAL_SCHEMA_V3) throw new RivalError("invalid_request");
  const schemaVersion: RivalWireVersion = c.schemaVersion === RIVAL_SCHEMA_V3 ? RIVAL_SCHEMA_V3 : c.schemaVersion === RIVAL_SCHEMA_V2 ? RIVAL_SCHEMA_V2 : RIVAL_SCHEMA_V1;
  if (c.operation === "status" || c.operation === "issue") return { operation: c.operation, schemaVersion };
  if (c.operation !== "settle") throw new RivalError("invalid_request");
  if (typeof c.battleId !== "string" || !RIVAL_BATTLE_ID.test(c.battleId) || typeof c.didWin !== "boolean") throw new RivalError("invalid_request");
  const fielded = validateFielded(c.fielded);
  return fielded === undefined ? { operation: "settle", battleId: c.battleId, didWin: c.didWin, schemaVersion } : { operation: "settle", battleId: c.battleId, didWin: c.didWin, fielded, schemaVersion };
}

type Ledger = { units: BuddyInventory; inventoryUpdates: Profile; wins: number; rewardDay: string };
function readLedger(profile: Profile): Ledger {
  const inv = readBuddyInventory(profile);
  const wins = readRivalWins(profile);
  const rewardDay = readRivalRewardDay(profile);
  if (!inv || wins === null || rewardDay === null) throw new RivalError("unavailable");
  return { units: inv.units, inventoryUpdates: inv.updates, wins, rewardDay };
}

function statusOf(l: Ledger, nowMs: number): RivalStatus {
  const tier = tierForWins(l.wins);
  const row = getRivalTierRow(tier);
  return {
    tier,
    tierLabel: row.label,
    rivalWins: l.wins,
    winsToNextTier: (tier + 1) * RIVAL_WINS_PER_TIER - l.wins,
    rivalsThisTier: row.rivals,
    dailyRewardAvailable: l.rewardDay !== utcDay(nowMs),
    buddyUnits: { ...l.units },
  };
}

/** Starter grant or #43 integer → tier-map migration, persisted with whatever else the call writes. */
function starterUpdates(l: Ledger): Profile {
  return { ...l.inventoryUpdates };
}

export function rivalStatus(profile: Profile, nowMs: number): { userUpdates: Profile; reply: { schemaVersion: string; status: RivalStatus } } {
  const l = readLedger(profile);
  return { userUpdates: starterUpdates(l), reply: { schemaVersion: RIVAL_SCHEMA_V3, status: statusOf(l, nowMs) } };
}

export type IssueReply = {
  schemaVersion: string;
  battleId: string;
  expiresAtMs: number;
  tier: number;
  encounter: { encounterId: string; seed: number; opponentPilot: NpcPilotSnapshot; opponentSquad: CombatantSnapshot[] };
  status: RivalStatus;
  /** rival-battle-3: the player's travel squad with real stats ([] when the squad is empty). */
  playerCombatants: PlayerCombatantSnapshot[];
};

/**
 * `playerSquadIds`: the travel squad at issue (the store reads it; [] when unreadable).
 * `scale` (DECISIONS #53 amendment 1): the store passes rivalLineupScaleFor(request version) — WOLF at
 * level 1 + 4t for rival-battle-3, the #43 baseline for rival-battle-1 / -2. The reply is the v3 shape
 * either way (projected by rivalReplyForVersion); with the baseline scale its opponents carry no
 * speed / intelligence (the v1 / v2 projection has none).
 */
export function issueRivalBattle(profile: Profile, nowMs: number, battleId: string, random: () => number, playerSquadIds: readonly string[] = [], scale: RivalLineupScale = RIVAL_LINEUP_SCALE_WOLF): { userUpdates: Profile; battle: RivalBattleRecord; reply: IssueReply } {
  if (!RIVAL_BATTLE_ID.test(battleId)) throw new RivalError("unavailable");
  const l = readLedger(profile);
  const status = statusOf(l, nowMs);
  const lineup = buildRivalLineup(status.tier, random, scale);
  const seed = Math.floor(random() * 0x7fffffff);
  const battle: RivalBattleRecord = { schemaVersion: RIVAL_RECORD_SCHEMA, battleId, tier: status.tier, issuedAtMs: nowMs, expiresAtMs: nowMs + RIVAL_BATTLE_TTL_MS, lineup, seed, settlement: null, playerSquadIds: [...playerSquadIds], lineupScale: scale };
  const extra = scale === RIVAL_LINEUP_SCALE_WOLF ? rivalScaledCombatantStats(status.tier) : null;
  return {
    userUpdates: starterUpdates(l),
    battle,
    reply: {
      schemaVersion: RIVAL_SCHEMA_V3, battleId, expiresAtMs: battle.expiresAtMs, tier: status.tier,
      encounter: { encounterId: battleId, seed, opponentPilot: { ...lineup.opponentPilot }, opponentSquad: lineup.opponentSquad.map((c) => (extra ? { ...c, ...extra, commandRules: desktopPracticeCommands(c.holobotId) } : { ...c })) },
      status, playerCombatants: buildPlayerCombatants(profile, playerSquadIds),
    },
  };
}

export type SettleReply = {
  schemaVersion: string;
  battleId: string;
  alreadyProcessed: boolean;
  didWin: boolean;
  buddyUnitsGranted: number;
  /** Tier id of buddyUnitsGranted ("buddy_light" since #44), "" when nothing was granted. */
  buddyUnitTierGranted: BuddyTierId | "";
  tierBefore: number;
  tierAfter: number;
  status: RivalStatus;
  /** rival-battle-3 (DECISIONS #53): one row per fielded Holobot; [] when `fielded` was not sent. Duplicates replay it. */
  progression: HolobotProgressionEntry[];
};

/**
 * Client claims the outcome; the server owns the amounts (settleArenaBattle
 * trust model). `battle` is the record at rivalBattles/{authenticated uid}/…,
 * so a foreign or invented battleId reads as undefined → unknown_battle.
 * A settled battle replays its original ruling with the CURRENT status and
 * writes nothing (once per battleId).
 */
/**
 * DECISIONS #53 Holobot XP: when `fielded` is sent, every fielded Holobot gets the one battle table's
 * EXP (kind "rival", the battle's issued tier; EXP Booster honoured) via applyHolobotExperience, once per
 * battleId (stored in the settlement, replayed by duplicates). Each fielded id must be in the travel squad
 * at issue or the current one (`currentSquadIds`), else invalid_request. rivalWins / Buddy Units are
 * ruled exactly as before; `fielded` never changes them.
 */
export function settleRivalBattle(profile: Profile, battle: RivalBattleRecord | undefined, battleId: string, didWin: boolean, nowMs: number, fielded?: readonly string[], currentSquadIds: readonly string[] = []): { userUpdates: Profile; battleUpdates: Partial<RivalBattleRecord> | null; reply: SettleReply } {
  const l = readLedger(profile);
  if (!battle || battle.battleId !== battleId || battle.schemaVersion !== RIVAL_RECORD_SCHEMA) throw new RivalError("unknown_battle");
  if (battle.settlement) {
    const s = battle.settlement;
    return {
      userUpdates: starterUpdates(l),
      battleUpdates: null,
      reply: { schemaVersion: RIVAL_SCHEMA_V3, battleId, alreadyProcessed: true, didWin: s.didWin, buddyUnitsGranted: s.buddyUnitsGranted, buddyUnitTierGranted: s.buddyUnitTierGranted ?? (s.buddyUnitsGranted > 0 ? tierByKey(DAILY_RIVAL_REWARD_TIER).id : ""), tierBefore: s.tierBefore, tierAfter: s.tierAfter, status: statusOf(l, nowMs), progression: (s.progression ?? []).map((row) => ({ ...row })) },
    };
  }
  if (!Number.isFinite(battle.expiresAtMs) || nowMs > battle.expiresAtMs) throw new RivalError("battle_expired");
  // A claimed win needs a real fight; a loss may end at any time.
  if (didWin && (!Number.isFinite(battle.issuedAtMs) || nowMs - battle.issuedAtMs < RIVAL_MIN_WIN_MS)) throw new RivalError("too_fast");
  const tierBefore = tierForWins(l.wins);
  const userUpdates: Profile = starterUpdates(l);
  let granted = 0;
  if (didWin) {
    Object.assign(userUpdates, repairGrant(profile));
    if (l.wins >= Number.MAX_SAFE_INTEGER) throw new RivalError("unavailable");
    l.wins += 1;
    userUpdates[RIVAL_WINS_FIELD] = l.wins;
    const today = utcDay(nowMs);
    if (l.rewardDay !== today) {
      granted = DAILY_RIVAL_REWARD_BUDDY_UNITS;
      l.units = withTierDelta(l.units, DAILY_RIVAL_REWARD_TIER, granted);
      l.rewardDay = today;
      userUpdates[BUDDY_UNITS_FIELD] = { ...l.units };
      userUpdates[RIVAL_REWARD_DAY_FIELD] = today;
    }
  }
  const tierGranted: BuddyTierId | "" = granted > 0 ? tierByKey(DAILY_RIVAL_REWARD_TIER).id : "";
  let progression: HolobotProgressionEntry[] = [];
  if (fielded && fielded.length) {
    const allowed = new Set([...(Array.isArray(battle.playerSquadIds) ? battle.playerSquadIds : []), ...currentSquadIds]);
    if (fielded.some((id) => !allowed.has(id))) throw new RivalError("invalid_request");
    const withheld = !didWin && (!Number.isFinite(battle.issuedAtMs) || nowMs - battle.issuedAtMs < RIVAL_MIN_XP_MS);
    const award = awardBattleExperienceRaw(profile, fielded, { kind: "rival", tier: battle.tier, didWin }, nowMs, { withheld });
    if (!award) throw new RivalError("unavailable");
    progression = award.progression;
    if (award.expPerHolobot > 0) userUpdates.holobots = award.holobots;
  }
  const settlement: RivalSettlement = { didWin, buddyUnitsGranted: granted, buddyUnitTierGranted: tierGranted, tierBefore, tierAfter: tierForWins(l.wins), settledAtMs: nowMs, fielded: [...(fielded ?? [])], progression };
  return {
    userUpdates,
    battleUpdates: { settlement },
    reply: { schemaVersion: RIVAL_SCHEMA_V3, battleId, alreadyProcessed: false, didWin, buddyUnitsGranted: granted, buddyUnitTierGranted: tierGranted, tierBefore, tierAfter: settlement.tierAfter, status: statusOf(l, nowMs), progression: progression.map((row) => ({ ...row })) },
  };
}

// ---- Wire versions ---------------------------------------------------------

/** rival-battle-1 status: identical to the 2026-09-30 deployment; buddyUnits is the TOTAL of all tiers. */
export type RivalStatusV1 = Omit<RivalStatus, "buddyUnits"> & { buddyUnits: number };

/** The fields rival-battle-3 adds; a v2 projection removes exactly these (and nothing else). */
export const RIVAL_V3_REPLY_FIELDS = ["playerCombatants", "progression"] as const;
export const RIVAL_V3_COMBATANT_FIELDS = ["speed", "intelligence", "commandRules"] as const;

/** The rival-battle-2 shape of a v3 reply: identical to the 2026-10-01 deployment (#44). */
function toV2(reply: { schemaVersion: string; status: RivalStatus }): Record<string, unknown> & { status: RivalStatus } {
  const { playerCombatants: _p, progression: _g, ...rest } = reply as typeof reply & { playerCombatants?: unknown; progression?: unknown };
  const out: Record<string, unknown> & { status: RivalStatus } = { ...rest, schemaVersion: RIVAL_SCHEMA_V2 };
  const encounter = (reply as { encounter?: { opponentSquad?: CombatantSnapshot[] } }).encounter;
  if (encounter && Array.isArray(encounter.opponentSquad)) {
    out.encounter = { ...encounter, opponentSquad: encounter.opponentSquad.map(({ speed: _s, intelligence: _i, commandRules: _c, ...combatant }) => combatant) };
  }
  return out;
}

/**
 * Every rule above produces the rival-battle-3 reply (v2 + DECISIONS #53 fields). A client that asks for
 * v2 gets the exact v2 shape (RIVAL_V3_* fields stripped); a client that did not ask (the shipped Unity
 * build) gets the exact v1 shape: schemaVersion "rival-battle-1", status.buddyUnits as the total Unit
 * count across tiers, and no buddyUnitTierGranted. Rulings are identical in all three.
 */
export function rivalReplyForVersion(reply: { schemaVersion: string; status: RivalStatus }, version: RivalWireVersion): Record<string, unknown> {
  if (version === RIVAL_SCHEMA_V3) return { ...reply, schemaVersion: RIVAL_SCHEMA_V3 };
  const v2 = toV2(reply);
  if (version === RIVAL_SCHEMA_V2) return v2;
  const { buddyUnitTierGranted: _, ...rest } = v2 as typeof v2 & { buddyUnitTierGranted?: unknown };
  const status: RivalStatusV1 = { ...v2.status, buddyUnits: totalBuddyUnits(v2.status.buddyUnits) };
  return { ...rest, schemaVersion: RIVAL_SCHEMA_V1, status };
}
