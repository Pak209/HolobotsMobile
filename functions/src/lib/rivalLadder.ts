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
export type RivalWireVersion = typeof RIVAL_SCHEMA_V1 | typeof RIVAL_SCHEMA_V2;
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
  level: number;
  /** Multiplies the baseline health / attack / defense. */
  statScale: number;
  rivals: number;
};

/**
 * Explicit table for tiers 0-9. Rival count: every second tier adds one
 * (0-1 → 1, 2-3 → 2, 4+ → 3). Beyond the last row the ladder keeps climbing
 * by RIVAL_TIER_EXTRAPOLATION per tier (level capped at RIVAL_MAX_LEVEL).
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

/** Scale-1.0 rival (the wolf in Unity's pilot-battle sample payload). Health/attack/defense scale; the rest is fixed. */
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
  holobotId: string;
  level: number;
  maxHealth: number;
  attack: number;
  defense: number;
  maxStamina: number;
  staminaRegen: number;
  deployment: { deployCost: number; drainPerSecond: number; rechargePerSecond: number };
  moves: MoveSnapshot[];
};
export type NpcPilotSnapshot = { pilotId: string; displayName: string; tier: string };
export type RivalLineup = { opponentPilot: NpcPilotSnapshot; opponentSquad: CombatantSnapshot[] };

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

/** `random` returns [0,1). Rivals are distinct roster ids. */
export function buildRivalLineup(tier: number, random: () => number): RivalLineup {
  const row = getRivalTierRow(tier);
  const pool = [...RIVAL_ROSTER_IDS];
  const picked: string[] = [];
  for (let i = 0; i < row.rivals; i++) {
    const j = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    picked.push(pool.splice(j, 1)[0]);
  }
  return {
    opponentPilot: { pilotId: `rival_tier_${tier}`, displayName: "Rival", tier: row.label },
    opponentSquad: picked.map((id) => rivalCombatant(id, row)),
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
export type RivalSettlement = { didWin: boolean; buddyUnitsGranted: number; buddyUnitTierGranted?: BuddyTierId | ""; tierBefore: number; tierAfter: number; settledAtMs: number };

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
export type RivalCommand = ({ operation: "status" } | { operation: "issue" } | { operation: "settle"; battleId: string; didWin: boolean }) & { schemaVersion: RivalWireVersion };

export const RIVAL_BATTLE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

export function validateRivalCommand(raw: unknown): RivalCommand {
  if (!raw || typeof raw !== "object") throw new RivalError("invalid_request");
  const c = raw as Record<string, unknown>;
  if (c.schemaVersion !== undefined && c.schemaVersion !== RIVAL_SCHEMA_V1 && c.schemaVersion !== RIVAL_SCHEMA_V2) throw new RivalError("invalid_request");
  const schemaVersion: RivalWireVersion = c.schemaVersion === RIVAL_SCHEMA_V2 ? RIVAL_SCHEMA_V2 : RIVAL_SCHEMA_V1;
  if (c.operation === "status" || c.operation === "issue") return { operation: c.operation, schemaVersion };
  if (c.operation !== "settle") throw new RivalError("invalid_request");
  if (typeof c.battleId !== "string" || !RIVAL_BATTLE_ID.test(c.battleId) || typeof c.didWin !== "boolean") throw new RivalError("invalid_request");
  return { operation: "settle", battleId: c.battleId, didWin: c.didWin, schemaVersion };
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
  return { userUpdates: starterUpdates(l), reply: { schemaVersion: RIVAL_SCHEMA_V2, status: statusOf(l, nowMs) } };
}

export type IssueReply = {
  schemaVersion: string;
  battleId: string;
  expiresAtMs: number;
  tier: number;
  encounter: { encounterId: string; seed: number; opponentPilot: NpcPilotSnapshot; opponentSquad: CombatantSnapshot[] };
  status: RivalStatus;
};

export function issueRivalBattle(profile: Profile, nowMs: number, battleId: string, random: () => number): { userUpdates: Profile; battle: RivalBattleRecord; reply: IssueReply } {
  if (!RIVAL_BATTLE_ID.test(battleId)) throw new RivalError("unavailable");
  const l = readLedger(profile);
  const status = statusOf(l, nowMs);
  const lineup = buildRivalLineup(status.tier, random);
  const seed = Math.floor(random() * 0x7fffffff);
  const battle: RivalBattleRecord = { schemaVersion: RIVAL_RECORD_SCHEMA, battleId, tier: status.tier, issuedAtMs: nowMs, expiresAtMs: nowMs + RIVAL_BATTLE_TTL_MS, lineup, seed, settlement: null };
  return {
    userUpdates: starterUpdates(l),
    battle,
    reply: { schemaVersion: RIVAL_SCHEMA_V2, battleId, expiresAtMs: battle.expiresAtMs, tier: status.tier, encounter: { encounterId: battleId, seed, ...lineup }, status },
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
};

/**
 * Client claims the outcome; the server owns the amounts (settleArenaBattle
 * trust model). `battle` is the record at rivalBattles/{authenticated uid}/…,
 * so a foreign or invented battleId reads as undefined → unknown_battle.
 * A settled battle replays its original ruling with the CURRENT status and
 * writes nothing (once per battleId).
 */
export function settleRivalBattle(profile: Profile, battle: RivalBattleRecord | undefined, battleId: string, didWin: boolean, nowMs: number): { userUpdates: Profile; battleUpdates: Partial<RivalBattleRecord> | null; reply: SettleReply } {
  const l = readLedger(profile);
  if (!battle || battle.battleId !== battleId || battle.schemaVersion !== RIVAL_RECORD_SCHEMA) throw new RivalError("unknown_battle");
  if (battle.settlement) {
    const s = battle.settlement;
    return {
      userUpdates: starterUpdates(l),
      battleUpdates: null,
      reply: { schemaVersion: RIVAL_SCHEMA_V2, battleId, alreadyProcessed: true, didWin: s.didWin, buddyUnitsGranted: s.buddyUnitsGranted, buddyUnitTierGranted: s.buddyUnitTierGranted ?? (s.buddyUnitsGranted > 0 ? tierByKey(DAILY_RIVAL_REWARD_TIER).id : ""), tierBefore: s.tierBefore, tierAfter: s.tierAfter, status: statusOf(l, nowMs) },
    };
  }
  if (!Number.isFinite(battle.expiresAtMs) || nowMs > battle.expiresAtMs) throw new RivalError("battle_expired");
  // A claimed win needs a real fight; a loss may end at any time.
  if (didWin && (!Number.isFinite(battle.issuedAtMs) || nowMs - battle.issuedAtMs < RIVAL_MIN_WIN_MS)) throw new RivalError("too_fast");
  const tierBefore = tierForWins(l.wins);
  const userUpdates: Profile = starterUpdates(l);
  let granted = 0;
  if (didWin) {
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
  const settlement: RivalSettlement = { didWin, buddyUnitsGranted: granted, buddyUnitTierGranted: tierGranted, tierBefore, tierAfter: tierForWins(l.wins), settledAtMs: nowMs };
  return {
    userUpdates,
    battleUpdates: { settlement },
    reply: { schemaVersion: RIVAL_SCHEMA_V2, battleId, alreadyProcessed: false, didWin, buddyUnitsGranted: granted, buddyUnitTierGranted: tierGranted, tierBefore, tierAfter: settlement.tierAfter, status: statusOf(l, nowMs) },
  };
}

// ---- Wire versions ---------------------------------------------------------

/** rival-battle-1 status: identical to the 2026-09-30 deployment; buddyUnits is the TOTAL of all tiers. */
export type RivalStatusV1 = Omit<RivalStatus, "buddyUnits"> & { buddyUnits: number };

/**
 * Every rule above produces the rival-battle-2 reply. A client that did not ask for v2 (the shipped
 * Unity build) gets the exact v1 shape: schemaVersion "rival-battle-1", status.buddyUnits as the
 * total Unit count across tiers, and no buddyUnitTierGranted. Rulings are identical in both.
 */
export function rivalReplyForVersion(reply: { schemaVersion: string; status: RivalStatus }, version: RivalWireVersion): Record<string, unknown> {
  if (version === RIVAL_SCHEMA_V2) return { ...reply };
  const { buddyUnitTierGranted: _, ...rest } = reply as typeof reply & { buddyUnitTierGranted?: unknown };
  const status: RivalStatusV1 = { ...reply.status, buddyUnits: totalBuddyUnits(reply.status.buddyUnits) };
  return { ...rest, schemaVersion: RIVAL_SCHEMA_V1, status };
}
