/**
 * DECISIONS #53-1 + amendment 1 (Pak, 2026-10-06): Error Beast runs in a
 * HoloZone settle through the ONE battle XP table (battleSettlement.ts, kind
 * "beast"), once per SERVER-ISSUED run id, for the Holobots the client says it
 * fielded (a subset of the travel squad the run was issued with). Unity never
 * computes any of this; it sends `issue` on zone entry and `settle` with the
 * run's kill count / boss flag / fielded ids, and renders the reply.
 *
 * Mappings onto the battle table (Pak's ruling, producer-proposed):
 *   didWin           = kills >= 1 || bossDefeated
 *   combosCompleted  = min(kills, 25)          (MAX_PERFORMANCE_EVENTS)
 *   perfectDefenses  = bossDefeated ? 5 : 0
 *   tier             = HOLOZONE_ZONE_TIERS[zoneId] at issue
 * A run with kills = 0 and no boss is a loss (30 % EXP). Any run settled
 * sooner than HOLOZONE_MIN_XP_MS after issue settles but earns 0 EXP.
 * DECISIONS #58: every settled run also pays Holos (win 100 / loss 25, 0 under
 * HOLOZONE_MIN_XP_MS) and a non-boss clear with >= 1 kill pays 1
 * itemStocks.blueprint_fragment (a boss clear pays the #72 Kit instead). No Sync
 * Points or Buddy Units here.
 *
 * Storage: holoZoneRuns/{uid} (server-only, default-denied by the rules; NOT a
 * field on users/{uid}, which is client-writable outside its protected list —
 * a forged run there would farm XP). The doc keeps the last
 * HOLOZONE_MAX_STORED_RUNS runs, newest last; at most one run is open.
 *
 * rival-health-1 on the zone (DECISIONS #53 amendment 4, #54 amendment 2; lib/rivalHealth.ts — the ONE host-owned
 * health ledger users/{uid}.holobotVitals the deployed rival host writes): a request carrying `healthSchema` gets
 * `playerCombatants[]` on the issue reply (the rival-battle-3 player shape, built the same way) each with the host's
 * `currentHealth`; the issue writes the ledger (issueVitals: full for a bot never seen, clamped to the max, the city's
 * recovery at zero; zones refuse KO before issuing) and the run record keeps what it issued (`issuedVitals`); settle{health[]} keeps each report at or
 * below what was issued (settleVitals: inflated / foreign / non-finite reports are invalid_request, nothing written) in
 * the same transaction as the ruling. Without the flag accepted replies keep the deployed shape; the ledger is read
 * for KO admission but never written. Nothing health-related goes on a settle reply or a settlement (the rival host's rule).
 *
 * Pure module: no firebase imports, safe to import from tests
 * (functions/scripts/test-holozone-runs.mjs, test-holozone-health.mjs).
 */
import {healingDelta} from "./repairItems";
import { MAX_PERFORMANCE_EVENTS, computeBattleSettlement } from "./battleSettlement";
import { awardBattleExperienceRaw, HolobotProgressionEntry } from "./battleProgression";
import { HealthError, HealthRow, healthRows, issueVitals, RIVAL_HEALTH_SCHEMA, requireLivingVitals, settleVitals, Vitals } from "./rivalHealth";
import { BATTLE_LOSS_HOLOS, BATTLE_WIN_HOLOS, buildPlayerCombatants, holosAfterGrant, PlayerCombatantSnapshot } from "./rivalLadder";
import { DUEL_RECEIPT_SCHEMA, DuelIntent, DuelReceipt, resolveDuel, validateDuelIntents } from "./duelResolver";
import { applyPartBoosts, equippedPartBoosts } from "./partStats";
import { CourtDuelBlock, CourtDuelWire, courtDuelBlock, courtDuelWire, courtReportFromReceipt } from "./holoZoneCourtDuel";
import { CourtClosedBy, courtLiveIssue, courtReportFromFightReceipt } from "./holoZoneCourtLive";
import { FIGHT_INPUTS_CAPABILITY_FIELD, FIGHT_INPUTS_SCHEMA, FIGHT_LOG_FIELD, FIGHT_REPLAY_MODE, FightReceiptWire, FightReplayIssueWire } from "../shared/fightReplayContract";
import { RULES_SCHEMA_6, RULES_SCHEMA_7 } from "../sim/fight/rules";
import type { FightReplayVerdict } from "../sim/fight/replay";
import { readLeftBeforeFight } from "./leftBeforeFight";

/** Wire v1 (deployed 2026-10-06): the version on every holoZoneHost request / reply unless the request asks for v2. */
export const HOLOZONE_SCHEMA = "holozone-run-1";
export const HOLOZONE_SCHEMA_V1 = HOLOZONE_SCHEMA;
/**
 * Wire v2 (DECISIONS #54 plan §P1 item 2, additive over v1): issue adds `population` (the zone's beast roster, spawn
 * counts and respawn rule by zone and tier — lib/holoZonePopulation.ts) and status adds the open run's `population`;
 * settle is the v1 reply under the v2 version. v1 replies are byte-identical to the deployed shape (lib/holoZoneWire.ts).
 */
export const HOLOZONE_SCHEMA_V2 = "holozone-run-2";
export type HoloZoneWireVersion = typeof HOLOZONE_SCHEMA_V1 | typeof HOLOZONE_SCHEMA_V2;
/** Stored doc format (holoZoneRuns/{uid}). */
export const HOLOZONE_RECORD_SCHEMA = "holozone-runs-1";

/**
 * Zone → battle tier, server data (Pak tunes). The tier feeds the one battle
 * table: tier t pays floor(95 x (1 + 0.45 t)) base EXP.
 */
export const HOLOZONE_ZONE_TIERS: Readonly<Record<string, number>> = Object.freeze({
  neonforest: 0,
  // Phase 2 zones go here when they ship (lowercase stable zone id → tier), e.g. the next
  // HoloZone after Neon Forest at tier 1. A zone that is not listed cannot be issued (unknown_zone).
});

/**
 * LITE CITY (Pak approved, 2026-11-07): the HoloCity Guild Court challenge in the
 * Lite mobile city settles through this same run contract and battle table as a zone (kind "beast"). It is a city
 * court, not a HoloZone portal, so it is NOT gated by storyFlags.holoZonesArcBuilt (holoZoneStore) and it has no
 * population row (a v2 issue reports population null). Same cooldown, TTL, 20 s anti-farm window, Holos and drop rule.
 */
export const HOLOCITY_COURT_ZONE_TIERS: Readonly<Record<string, number>> = Object.freeze({
  guild_court: 0,
});
export function isCityCourtZone(zoneId: string): boolean {
  return Object.prototype.hasOwnProperty.call(HOLOCITY_COURT_ZONE_TIERS, zoneId);
}

/** An issued run settles only within this window (producer default, = the rival battle TTL). */
export const HOLOZONE_RUN_TTL_MS = 2 * 60 * 60 * 1000;
/** A run settled sooner than this after issue settles but earns 0 EXP (the PR #59 rule). */
export const HOLOZONE_MIN_XP_MS = 20 * 1000;
/** Runs kept on holoZoneRuns/{uid} (newest last). An older settled run's duplicate settle reads as unknown_run. */
export const HOLOZONE_MAX_STORED_RUNS = 10;
export const HOLOZONE_MAX_FIELDED = 3;
/** DECISIONS #58 (3): blueprint fragments per settled non-boss zone clear with >= 1 kill (producer pick, Pak tunes). */
export const HOLOZONE_CLEAR_BLUEPRINT_FRAGMENTS = 1;
/** users/{uid}.itemStocks key the Workshop crafts from (workshop/workshopCraftHost.ts). */
export const BLUEPRINT_FRAGMENT_STOCK = "blueprint_fragment";
/**
 * users/{uid}.itemStocks after adding `amount` blueprint_fragment (the one grant rule the zone settle and the Mission
 * Board share). Missing stocks / key = 0; a malformed stored map or count fails closed (null).
 */
export function itemStocksAfterFragmentGrant(profile: Record<string, unknown>, amount: number): Record<string, unknown> | null {
  const stocks = profile.itemStocks;
  if (stocks !== undefined && (!stocks || typeof stocks !== "object" || Array.isArray(stocks))) return null;
  const have = (stocks as Record<string, unknown> | undefined)?.[BLUEPRINT_FRAGMENT_STOCK] ?? 0;
  if (typeof have !== "number" || !Number.isSafeInteger(have) || have < 0 || !Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(have + amount)) return null;
  return { ...(stocks as Record<string, unknown> | undefined ?? {}), [BLUEPRINT_FRAGMENT_STOCK]: have + amount };
}
/** perfectDefenses credited for a defeated boss. */
export const HOLOZONE_BOSS_PERFECT_DEFENSES = 5;

export const HOLOZONE_ZONE_ID = /^[a-z][a-z0-9_]{0,63}$/;
/** runId = crypto.randomUUID() (lowercase RFC 4122 v4). */
export const HOLOZONE_RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** A fielded Holobot id: the travel-squad id rule. */
export const HOLOZONE_FIELDED_ID = /^[a-z][a-z0-9_]{0,127}$/;

/** zone_locked: issue refused while storyFlags.holoZonesArcBuilt is false (holoZoneStore; critic review 2026-10-17 #1). */
/** court-live-1: live_unavailable (a live-only court issue that cannot be live; nothing written) and replay_mismatch (the run is closed). */
export type HoloZoneErrorCode = "invalid_request" | "unknown_zone" | "unknown_run" | "run_expired" | "run_closed" | "holobot_ko" | "activity_conflict" | "zone_cooldown" | "zone_locked" | "too_fast" | "unavailable" | "live_unavailable" | "replay_mismatch";
export class HoloZoneError extends Error {
  /** court-live-1: `detail` travels in the callable error's details (reason, closedBy, the verifier's window / field ...). */
  constructor(public code: HoloZoneErrorCode, public retryAfterMs?: number, public detail?: Record<string, unknown>) {
    super(code);
  }
}

/** economy-host-2: a zone may be re-issued 3 minutes after its last first-time settle. */
export const HOLOZONE_COOLDOWN_MS = 3 * 60 * 1000;
/** Server-only parent ledger map; separate from bounded run history so pruning cannot bypass admission. */
export const HOLOZONE_LAST_SETTLED_FIELD = "zoneLastSettledAtMs";
export function readHoloZoneLastSettled(doc: Record<string, unknown> | undefined, runs: readonly HoloZoneRunRecord[]): Record<string, number> {
  const raw = doc?.[HOLOZONE_LAST_SETTLED_FIELD];
  if (raw !== undefined && (!raw || typeof raw !== "object" || Array.isArray(raw))) throw new HoloZoneError("unavailable");
  const out: Record<string, number> = {};
  for (const [zoneId, at] of Object.entries(raw ?? {})) {
    if (!HOLOZONE_ZONE_ID.test(zoneId) || typeof at !== "number" || !Number.isFinite(at)) throw new HoloZoneError("unavailable");
    out[zoneId] = at;
  }
  // Existing ledgers predate the map: honor their recorded settles immediately after deployment.
  for (const run of runs) if (run.settlement) {
    const at = run.settlement.settledAtMs;
    if (!Number.isFinite(at)) throw new HoloZoneError("unavailable");
    out[run.zoneId] = Math.max(out[run.zoneId] ?? -Infinity, at);
  }
  return out;
}
export function requireHoloZoneOffCooldown(lastSettled: Record<string, number>, zoneId: string, nowMs: number): void {
  const at = lastSettled[zoneId];
  if (at === undefined) return;
  const retryAfterMs = at + HOLOZONE_COOLDOWN_MS - nowMs;
  if (retryAfterMs > 0) throw new HoloZoneError("zone_cooldown", retryAfterMs);
}
export function holoZoneLastSettledAfterSettle(lastSettled: Record<string, number>, zoneId: string, nowMs: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(lastSettled)) if (at + HOLOZONE_COOLDOWN_MS > nowMs) out[id] = at;
  out[zoneId] = nowMs;
  return out;
}
/** forfeit-is-loss: a live run's expiry is its loss time; its cooldown starts there (never earlier than a recorded later settle). */
export function holoZoneLastSettledAfterExpiry(lastSettled: Record<string, number>, zoneId: string, expiredAtMs: number, nowMs: number): Record<string, number> {
  const out = holoZoneLastSettledAfterSettle(lastSettled, zoneId, nowMs);
  out[zoneId] = Math.max(expiredAtMs, lastSettled[zoneId] ?? -Infinity);
  return out;
}

/** The run as Unity sees it (issue reply, status.run). */
export type HoloZoneRunView = {
  runId: string;
  zoneId: string;
  tier: number;
  /** The travel squad at issue (slot order); `fielded` must be a subset. */
  squad: string[];
  issuedAtMs: number;
  expiresAtMs: number;
};

export type HoloZoneSettlement = {
  kind: "beast";
  zoneId: string;
  tier: number;
  kills: number;
  bossDefeated: boolean;
  fielded: string[];
  didWin: boolean;
  combosCompleted: number;
  perfectDefenses: number;
  /** The one battle table's EXP for this result (before the EXP Booster). */
  tableExp: number;
  /** EXP each fielded Holobot received (EXP Booster applied; 0 when withheld). */
  expPerHolobot: number;
  /** True when the run was settled sooner than HOLOZONE_MIN_XP_MS after issue. */
  expWithheld: boolean;
  settledAtMs: number;
};

export type HoloZoneRunRecord = HoloZoneRunView & {
  /** Set when a later issue superseded the run before it was settled (it can no longer settle). */
  closedAtMs: number | null;
  settlement: HoloZoneSettlement | null;
  /** Stored with the settlement; duplicates replay it. */
  progression: HolobotProgressionEntry[] | null;
  /** DECISIONS #58 (runs settled from economy-host-1): Holos / blueprint fragments this settle paid; absent = 0. */
  holosGranted?: number;
  blueprintFragmentsGranted?: number;
  /** rival-health-1: set on a run issued with the flag (the rival record's field names); absent = issued without it. */
  healthSchema?: typeof RIVAL_HEALTH_SCHEMA;
  /** rival-health-1: the {currentHealth, maxHealth} each player combatant was issued with — the settle's bound. */
  issuedVitals?: Vitals;
  /** Guild Court plan-and-send: the pinned fight (lib/holoZoneCourtDuel.ts); court-live-1: or the pinned input-log issue
   * (mode 'input-log', lib/holoZoneCourtLive.ts); absent = a client-reported run. */
  duel?: CourtDuelBlock | FightReplayIssueWire;
  /** court-live-1: set (with closedAtMs) when a live run closed without a settlement: no pay, HP as issued; forfeit-is-loss: a loss
   * that starts the zone cooldown. */
  closedBy?: CourtClosedBy;
  /** court-live-1: the verifier's detail when closedBy is replay_mismatch (host-only). */
  replayRejection?: Record<string, unknown>;
};

export type HoloZoneRunsDoc = { schemaVersion: typeof HOLOZONE_RECORD_SCHEMA; runs: HoloZoneRunRecord[] };

/** `schemaVersion` is the reply version the client asked for (request field; missing = v1, the deployed shape). */
/**
 * `schemaVersion` is the reply version the client asked for (request field; missing = v1, the deployed shape).
 * rival-health-1: `healthSchema` (issue / settle) asks for host health; settle `health[]` carries the reports (needs the
 * flag). Both are absent from the command when not sent — the rival host's request rule (lib/rivalHealth.ts healthRows).
 */
/**
 * court-live-1: issue `live` is present only when the request declared `duelInputs: 'duel-inputs-2'` for the court with a valid
 * `holobotId` (`rules6` = it also asked `fightRules: 'duel-rules-6'`; `liveOnly` = that ask without `duelSchema`, the live-only
 * phone, which is refused rather than given a non-live run). settle `inputLog` = a live settle (no report fields). forfeit = the
 * explicit forfeit of an open live run.
 */
export type HoloZoneCommand = (
  | { operation: "status" }
  | { operation: "issue"; zoneId: string; duelSchema?: typeof DUEL_RECEIPT_SCHEMA; holobotId?: string; live?: { rules6: boolean; liveOnly: boolean; rules7?: boolean } }
  | { operation: "settle"; runId: string; kills: number; bossDefeated: boolean; fielded: string[]; health?: HealthRow[]; playerIntents?: DuelIntent[]; inputLog?: unknown }
  | { operation: "forfeit"; runId: string; leftBeforeFight?: true }
) & { schemaVersion: HoloZoneWireVersion; healthSchema?: typeof RIVAL_HEALTH_SCHEMA };

/** lib/rivalHealth.ts throws its own error type (its message is the code); the zone host maps it onto the zone codes. */
function asZone<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    if (e instanceof HealthError) throw new HoloZoneError(e.message === "invalid_request" ? "invalid_request" : e.message === "holobot_ko" ? "holobot_ko" : "unavailable");
    throw e;
  }
}

export function validateHoloZoneCommand(raw: unknown): HoloZoneCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HoloZoneError("invalid_request");
  const c = raw as Record<string, unknown>;
  if (c.schemaVersion !== undefined && c.schemaVersion !== HOLOZONE_SCHEMA_V1 && c.schemaVersion !== HOLOZONE_SCHEMA_V2) throw new HoloZoneError("invalid_request");
  const schemaVersion: HoloZoneWireVersion = c.schemaVersion === HOLOZONE_SCHEMA_V2 ? HOLOZONE_SCHEMA_V2 : HOLOZONE_SCHEMA_V1;
  if (c.healthSchema !== undefined && c.healthSchema !== RIVAL_HEALTH_SCHEMA) throw new HoloZoneError("invalid_request");
  const flag: { healthSchema?: typeof RIVAL_HEALTH_SCHEMA } = c.healthSchema === RIVAL_HEALTH_SCHEMA ? { healthSchema: RIVAL_HEALTH_SCHEMA } : {};
  if (c.operation === "status") return { operation: "status", schemaVersion, ...flag };
  if (c.operation === "issue") {
    if (typeof c.zoneId !== "string" || !HOLOZONE_ZONE_ID.test(c.zoneId)) throw new HoloZoneError("invalid_request");
    // court-live-1: the live capability (exactly the rival host's `duelInputs` value; any other value is ignored, as every unknown
    // field is today) only opts INTO a live court fight. A live-only request that does not name a court fighter is malformed.
    const declared = c[FIGHT_INPUTS_CAPABILITY_FIELD] === FIGHT_INPUTS_SCHEMA, rules7 = c.fightRules === RULES_SCHEMA_7, rules6 = c.fightRules === RULES_SCHEMA_6 || rules7;   // guard-hold-1: rules-7 = rules-6 + guard
    const courtFighter = isCityCourtZone(c.zoneId) && typeof c.holobotId === "string" && HOLOZONE_FIELDED_ID.test(c.holobotId);
    const liveOnly = declared && rules6 && c.duelSchema === undefined;
    if (liveOnly && !courtFighter) throw new HoloZoneError("invalid_request");
    const live: { live?: { rules6: boolean; liveOnly: boolean; rules7?: boolean } } = declared && courtFighter ? { live: { rules6, liveOnly, ...(rules7 ? { rules7 } : {}) } } : {};
    // Plan-and-send opt-in: Guild Court only, naming the one Holobot that fights. A request cannot pick anything else.
    if (c.duelSchema !== undefined) {
      if (c.duelSchema !== DUEL_RECEIPT_SCHEMA || !isCityCourtZone(c.zoneId) || typeof c.holobotId !== "string" || !HOLOZONE_FIELDED_ID.test(c.holobotId)) throw new HoloZoneError("invalid_request");
      return { operation: "issue", zoneId: c.zoneId, duelSchema: DUEL_RECEIPT_SCHEMA, holobotId: c.holobotId, schemaVersion, ...flag, ...live };
    }
    if (live.live) return { operation: "issue", zoneId: c.zoneId, holobotId: c.holobotId as string, schemaVersion, ...flag, ...live };
    return { operation: "issue", zoneId: c.zoneId, schemaVersion, ...flag };
  }
  if (c.operation !== "settle" && c.operation !== "forfeit") throw new HoloZoneError("invalid_request");
  if (typeof c.runId !== "string" || !HOLOZONE_RUN_ID.test(c.runId)) throw new HoloZoneError("invalid_request");
  if (c.operation === "forfeit") {
    // no-loss-before-fight (Pak 2026-11-11): `leftBeforeFight: true` (only that literal) asks for the no-loss cancel; absent = today's forfeit.
    const leftBeforeFight = readLeftBeforeFight(c);
    if (leftBeforeFight === null) throw new HoloZoneError("invalid_request");
    return { operation: "forfeit", runId: c.runId, schemaVersion, ...(leftBeforeFight ? { leftBeforeFight: true as const } : {}) };
  }
  if (c[FIGHT_LOG_FIELD] !== undefined) {
    // court-live-1: a live settle sends the recorded log only; outcome, HP and the fielded fighter come from the host's replay.
    if (["kills", "bossDefeated", "fielded", "health", "healthSchema", "playerIntents"].some((k) => c[k] !== undefined)) throw new HoloZoneError("invalid_request");
    const log = c[FIGHT_LOG_FIELD];
    if (typeof log !== "string" && (!log || typeof log !== "object" || Array.isArray(log))) throw new HoloZoneError("invalid_request");
    return { operation: "settle", runId: c.runId, kills: 0, bossDefeated: false, fielded: [], inputLog: log, schemaVersion };
  }
  if (c.playerIntents !== undefined) {
    // A resolver settle sends the plan only: no outcome, HP or fielded list is accepted from the client.
    if (["kills", "bossDefeated", "fielded", "health", "healthSchema"].some((k) => c[k] !== undefined)) throw new HoloZoneError("invalid_request");
    let playerIntents: DuelIntent[];
    try {
      playerIntents = validateDuelIntents(c.playerIntents);
    } catch {
      throw new HoloZoneError("invalid_request");
    }
    return { operation: "settle", runId: c.runId, kills: 0, bossDefeated: false, fielded: [], playerIntents, schemaVersion };
  }
  if (typeof c.kills !== "number" || !Number.isSafeInteger(c.kills) || c.kills < 0) throw new HoloZoneError("invalid_request");
  if (typeof c.bossDefeated !== "boolean") throw new HoloZoneError("invalid_request");
  const f = c.fielded;
  if (!Array.isArray(f) || f.length > HOLOZONE_MAX_FIELDED || f.some((id) => typeof id !== "string" || !HOLOZONE_FIELDED_ID.test(id)) || new Set(f).size !== f.length) throw new HoloZoneError("invalid_request");
  const health = asZone(() => healthRows(c.health));
  if (health !== undefined && c.healthSchema !== RIVAL_HEALTH_SCHEMA) throw new HoloZoneError("invalid_request");
  const rows: { health?: HealthRow[] } = health === undefined ? {} : { health };
  return { operation: "settle", runId: c.runId, kills: c.kills, bossDefeated: c.bossDefeated, fielded: [...(f as string[])], schemaVersion, ...flag, ...rows };
}

/** Tier of a zone id, or null when the zone is not in the table. */
export function holoZoneTier(zoneId: string): number | null {
  if (isCityCourtZone(zoneId)) return HOLOCITY_COURT_ZONE_TIERS[zoneId];
  return Object.prototype.hasOwnProperty.call(HOLOZONE_ZONE_TIERS, zoneId) ? HOLOZONE_ZONE_TIERS[zoneId] : null;
}

/** The pure battle-table input for a run result (the mappings in the header). */
export function beastSettlementInput(tier: number, kills: number, bossDefeated: boolean) {
  return {
    kind: "beast" as const,
    tier,
    didWin: kills >= 1 || bossDefeated,
    combosCompleted: Math.min(kills, MAX_PERFORMANCE_EVENTS),
    perfectDefenses: bossDefeated ? HOLOZONE_BOSS_PERFECT_DEFENSES : 0,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function validRecord(r: unknown): r is HoloZoneRunRecord {
  if (!r || typeof r !== "object") return false;
  const x = r as Record<string, unknown>;
  return typeof x.runId === "string" && typeof x.zoneId === "string" && Number.isSafeInteger(x.tier) && isStringArray(x.squad)
    && Number.isFinite(x.issuedAtMs) && Number.isFinite(x.expiresAtMs)
    && (x.closedAtMs === null || Number.isFinite(x.closedAtMs))
    && (x.settlement === null || (!!x.settlement && typeof x.settlement === "object"))
    && (x.progression === null || Array.isArray(x.progression));
}

/** Stored runs (newest last). Missing doc = none; malformed stored data → unavailable (fail closed). */
export function readHoloZoneRuns(doc: Record<string, unknown> | undefined): HoloZoneRunRecord[] {
  if (doc === undefined) return [];
  if (doc.schemaVersion !== HOLOZONE_RECORD_SCHEMA || !Array.isArray(doc.runs) || !doc.runs.every(validRecord)) throw new HoloZoneError("unavailable");
  return (doc.runs as HoloZoneRunRecord[]).map((r) => structuredClone(r));
}

const isOpen = (r: HoloZoneRunRecord, nowMs: number) => r.settlement === null && r.closedAtMs === null && nowMs <= r.expiresAtMs;

export function viewOf(r: HoloZoneRunRecord): HoloZoneRunView {
  return { runId: r.runId, zoneId: r.zoneId, tier: r.tier, squad: [...r.squad], issuedAtMs: r.issuedAtMs, expiresAtMs: r.expiresAtMs };
}

export type HoloZoneStatusReply = { schemaVersion: typeof HOLOZONE_SCHEMA; run: HoloZoneRunView | null; duel?: CourtDuelWire | FightReplayIssueWire };
/** rival-health-1: `playerCombatants` only on an issue that carried `healthSchema` (the rival-battle-3 player shape + currentHealth). */
export type HoloZoneIssueReply = { schemaVersion: typeof HOLOZONE_SCHEMA } & HoloZoneRunView & { playerCombatants?: (PlayerCombatantSnapshot & { currentHealth: number })[]; duel?: CourtDuelWire | FightReplayIssueWire };
export type HoloZoneSettleReply = {
  schemaVersion: typeof HOLOZONE_SCHEMA;
  runId: string;
  /** True for a duplicate settle: the stored ruling is replayed and nothing is written. */
  alreadyProcessed: boolean;
  settlement: HoloZoneSettlement;
  /** One row per fielded Holobot (the rival-battle-3 shape); [] when nothing was fielded. */
  progression: HolobotProgressionEntry[];  /** DECISIONS #58: Holos this run paid (win 100 / loss 25 / 0 under HOLOZONE_MIN_XP_MS). holozone-run-2 only (lib/holoZoneWire.ts). */
  holosGranted: number;
  /** DECISIONS #58: blueprint_fragment paid (1 for a non-boss clear with >= 1 kill, else 0). holozone-run-2 only. */
  blueprintFragmentsGranted: number;
  /** Guild Court plan-and-send: the host's receipt (stored at holoZoneRuns/{uid}/receipts/{runId}). */
  duelReceipt?: DuelReceipt;
  /** court-live-1: the verified duel-receipt-2 of a live court fight (stored in the same receipts doc). */
  fightReceipt?: FightReceiptWire;
};

/** The client view of a stored court fight. court-live-1: an input-log run serves its whole pinned issue (seed included, by design:
 * the phone predicts the CPU locally), exactly the rival-battle-3 / arena-match-1 `duel` block. */
function duelWireOf(duel: CourtDuelBlock | FightReplayIssueWire): CourtDuelWire | FightReplayIssueWire {
  return duel.mode === FIGHT_REPLAY_MODE ? structuredClone(duel) : courtDuelWire(duel);
}

/** status → the open run (issued, unsettled, not superseded, not past expiresAtMs) or null. */
export function holoZoneStatus(runs: readonly HoloZoneRunRecord[], nowMs: number): HoloZoneStatusReply {
  const open = [...runs].reverse().find((r) => isOpen(r, nowMs));
  return { schemaVersion: HOLOZONE_SCHEMA, run: open ? viewOf(open) : null, ...(open?.duel ? { duel: duelWireOf(open.duel) } : {}) };
}

/**
 * issue → a new run for `zoneId` with the current travel squad. An open run is superseded (closedAtMs = now;
 * it can no longer settle), so at most one run is open. `runId` comes from the store (crypto.randomUUID()).
 */
/**
 * `health`: the store always supplies the profile for zone admission. `includeHealth:false` validates eligibility
 * without changing legacy reply/record shapes or writing the ledger. Otherwise (rival-health-1), the reply adds
 * `playerCombatants[]` (buildPlayerCombatants, the rival-battle-3 shape) each with `currentHealth`, `userUpdates` carries
 * the ledger to write (`holobotVitals`, lib/rivalHealth.ts issueVitals: exactly what the rival issue writes) and the
 * record keeps the issued values. Absent: the reply and the record are exactly as before and `userUpdates` is empty.
 */
/**
 * court-live-1 `courtLive`: try an input-log fight for `holobotId` first (the store passes it only with the flag on and the live
 * capability declared). A lineup the fight core cannot express refuses a live-only client (live_unavailable, lineup_unsupported:
 * thrown before the store writes anything) and otherwise keeps the next mode down (`courtDuel` resolver, else a plain run).
 */
export function issueHoloZoneRun(runs: readonly HoloZoneRunRecord[], zoneId: string, squadIds: readonly string[], runId: string, nowMs: number, health?: { profile: Record<string, unknown>; includeHealth?: boolean; courtDuel?: { holobotId: string; seed: number };
  courtLive?: { holobotId: string; seed: string; chase: boolean; attrs: boolean; tempo: boolean; liveOnly: boolean; guardHold?: boolean } }): { doc: HoloZoneRunsDoc; reply: HoloZoneIssueReply; userUpdates: Record<string, unknown> } {
  if (!HOLOZONE_RUN_ID.test(runId)) throw new HoloZoneError("unavailable");
  const tier = holoZoneTier(zoneId);
  if (tier === null) throw new HoloZoneError("unknown_zone");
  if (runs.some((r) => r.runId === runId)) throw new HoloZoneError("unavailable");
  const run: HoloZoneRunRecord = { runId, zoneId, tier, squad: [...squadIds], issuedAtMs: nowMs, expiresAtMs: nowMs + HOLOZONE_RUN_TTL_MS, closedAtMs: null, settlement: null, progression: null };
  let players: { playerCombatants: (PlayerCombatantSnapshot & { currentHealth: number })[]; duel?: CourtDuelWire | FightReplayIssueWire } | Record<string, never> = {};
  const userUpdates: Record<string, unknown> = {};
  // Store always supplies the profile for admission, even when legacy clients omit healthSchema.
  if (health) asZone(() => requireLivingVitals(health.profile, squadIds));
  if (health && health.includeHealth !== false) {
    const combatants = buildPlayerCombatants(health.profile, squadIds);
    const vitals = asZone(() => issueVitals(health.profile, combatants));
    userUpdates.holobotVitals = vitals;
    run.healthSchema = RIVAL_HEALTH_SCHEMA;
    run.issuedVitals = Object.fromEntries(combatants.map((p) => [p.holobotId, { ...vitals[p.holobotId] }]));
    players = { playerCombatants: combatants.map((p) => ({ ...p, currentHealth: vitals[p.holobotId].currentHealth })) };
    if (health.courtLive) {
      const live = health.courtLive;
      const fighter = players.playerCombatants.find((p) => p.holobotId === live.holobotId);
      if (!fighter) throw new HoloZoneError("invalid_request");
      if (Math.floor(fighter.currentHealth) <= 0) throw new HoloZoneError("holobot_ko");
      // court-full-hp (Pak 2026-11-11, the live Arena's live-tuning-1 rule): the live court fight starts at FULL HP whatever the
      // ledger carries. The ledger (and run.issuedVitals, its issue-time row) is unchanged; the settle maps the fight's end HP onto
      // the ledger from a full-HP start and writes min(ledger now, that) (courtReportFromFightReceipt + settleVitals), so the
      // ledger never rises. The ledger still needs HP > 0 to enter (the check above).
      const issue = courtLiveIssue({ fighter: { ...fighter, currentHealth: fighter.maxHealth }, gear: equippedPartBoosts(health.profile, fighter.holobotId), zoneId, tier, runId, seed: live.seed, chase: live.chase, attrs: live.attrs, tempo: live.tempo, guardHold: live.guardHold === true });
      if (issue) {
        run.duel = issue;
        players = { ...players, duel: structuredClone(issue) };
      } else if (live.liveOnly) throw new HoloZoneError("live_unavailable", undefined, { reason: "lineup_unsupported" });
    }
    if (health.courtDuel && !run.duel) {
      const fighter = players.playerCombatants.find((p) => p.holobotId === health.courtDuel!.holobotId);
      if (!fighter) throw new HoloZoneError("invalid_request");
      if (Math.floor(fighter.currentHealth) <= 0) throw new HoloZoneError("holobot_ko");
      try {
        const gear = equippedPartBoosts(health.profile, fighter.holobotId);
        run.duel = courtDuelBlock(applyPartBoosts(fighter, gear), zoneId, tier, health.courtDuel.seed, gear);
      } catch (e) {
        if (e instanceof RangeError) throw new HoloZoneError("unavailable");
        throw e;
      }
      players = { ...players, duel: courtDuelWire(run.duel) };
    }
  }
  const next = runs.map((r) => (isOpen(r, nowMs) ? { ...r, closedAtMs: nowMs } : r));
  next.push(run);
  return { doc: { schemaVersion: HOLOZONE_RECORD_SCHEMA, runs: next.slice(-HOLOZONE_MAX_STORED_RUNS) }, reply: { schemaVersion: HOLOZONE_SCHEMA, ...viewOf(run), ...players }, userUpdates };
}

/**
 * Turns a plan-and-send settle into the run report settleHoloZoneRun pays from. The stored mode decides: a pinned run needs
 * a plan, an unpinned run refuses one. A run already settled passes through to its replay. A SEND inside HOLOZONE_MIN_XP_MS
 * is refused here for every outcome, before resolving, so it is never a withheld run and never reveals how the plan goes.
 */
/** court-live-1: the settle-time replay the store ran OUTSIDE the transaction for a live run (`mismatch` = it did not reproduce the log). */
export type CourtLivePre = { issue: FightReplayIssueWire; verdict?: FightReplayVerdict; mismatch?: Record<string, unknown> };
/** court-live-1: a verified court WIN settled sooner than this after issue is too_fast (nothing written, retryAfterMs); a loss never
 * is (it settles under the existing < HOLOZONE_MIN_XP_MS rule: 0 EXP, 0 Holos). The rival input-log rule. */
export const COURT_LIVE_MIN_WIN_MS = HOLOZONE_MIN_XP_MS;
export function courtSettleCommand<C extends Extract<HoloZoneCommand, { operation: "settle" }>>(runs: readonly HoloZoneRunRecord[], command: C, nowMs: number, live?: CourtLivePre): { command: C; receipt?: DuelReceipt; verdict?: FightReplayVerdict; mismatch?: Record<string, unknown> } {
  const run = runs.find((r) => r.runId === command.runId);
  if (!run || run.settlement) return { command };
  if (!run.duel) {
    if (command.playerIntents !== undefined || command.inputLog !== undefined) throw new HoloZoneError("invalid_request");
    return { command };
  }
  // forfeit-is-loss (Pak 2026-11-11): a live run closed by its expiry answers a late settle exactly as before (run_expired), now
  // saying it was recorded as a loss.
  if (run.closedBy === "expired") throw new HoloZoneError("run_expired", undefined, { closedBy: "expired" });
  if (run.closedAtMs !== null) throw new HoloZoneError("run_closed", undefined, run.closedBy ? { closedBy: run.closedBy } : undefined);
  if (nowMs > run.expiresAtMs) throw new HoloZoneError("run_expired");
  if (run.duel.mode === FIGHT_REPLAY_MODE) {
    // court-live-1: a live run settles from its log only; the stored mode is never downgraded by the request.
    if (command.inputLog === undefined) throw new HoloZoneError("invalid_request", undefined, { reason: "input_log_required" });
    // The replay ran before the transaction against this same immutable issue; a record that changed in between is never
    // settled from a stale verdict (retryable: the same log is resent).
    if (!live || live.issue.rulesHash !== run.duel.rulesHash || live.issue.seed !== run.duel.seed) throw new HoloZoneError("unavailable");
    if (live.mismatch) return { command, mismatch: live.mismatch };
    const verdict = live.verdict!;
    const sinceIssue = nowMs - run.issuedAtMs;
    if (verdict.receipt.winner === "player" && sinceIssue < COURT_LIVE_MIN_WIN_MS) throw new HoloZoneError("too_fast", COURT_LIVE_MIN_WIN_MS - sinceIssue);
    return { command: { ...command, ...courtReportFromFightReceipt(verdict.receipt, run.issuedVitals ?? {}) }, verdict };
  }
  if (command.playerIntents === undefined) throw new HoloZoneError("invalid_request");
  if (run.duel.schemaVersion !== DUEL_RECEIPT_SCHEMA) throw new HoloZoneError("unavailable");
  const sinceIssue = nowMs - run.issuedAtMs;
  if (sinceIssue < HOLOZONE_MIN_XP_MS) throw new HoloZoneError("too_fast", HOLOZONE_MIN_XP_MS - sinceIssue);
  let receipt: DuelReceipt;
  try {
    receipt = resolveDuel({ ...run.duel.input, playerIntents: command.playerIntents });
  } catch {
    throw new HoloZoneError("unavailable");
  }
  return { command: { ...command, ...courtReportFromReceipt(run.duel, receipt, run.issuedVitals ?? {}) }, receipt };
}

/**
 * court-live-1: close an OPEN live run without a settlement (the explicit forfeit, or a log that failed replay): nothing is paid
 * (no Holos, EXP, fragment or kit), the HP ledger keeps its issue-time rows, mission postings are not completed.
 * forfeit-is-loss (Pak 2026-11-11): the closure is the run's loss record, and the store starts the normal zone cooldown with it
 * (holoZoneStore writes zoneLastSettledAtMs exactly as a first-time settle does).
 */
export function closeCourtRunNoPay(runs: readonly HoloZoneRunRecord[], runId: string, nowMs: number, closedBy: CourtClosedBy, rejection?: Record<string, unknown>): HoloZoneRunsDoc {
  const index = runs.findIndex((r) => r.runId === runId);
  if (index < 0) throw new HoloZoneError("unknown_run");
  const run = runs[index];
  if (run.duel?.mode !== FIGHT_REPLAY_MODE || run.settlement) throw new HoloZoneError("invalid_request");
  if (run.closedAtMs !== null) throw new HoloZoneError("run_closed", undefined, run.closedBy ? { closedBy: run.closedBy } : undefined);
  if (nowMs > run.expiresAtMs) throw new HoloZoneError("run_expired");
  const next = runs.map((r, i) => (i === index ? { ...r, closedAtMs: nowMs, closedBy, ...(rejection ? { replayRejection: rejection } : {}) } : r));
  return { schemaVersion: HOLOZONE_RECORD_SCHEMA, runs: next };
}

/**
 * settle → validates the run (the caller's own doc, so a foreign runId is unknown_run; not superseded; not
 * expired; fielded ⊆ the run's squad), rules it on the one battle table (beastSettlementInput) and awards EXP
 * to every fielded Holobot via awardBattleExperienceRaw (EXP Booster honoured; withheld under
 * HOLOZONE_MIN_XP_MS) — once per runId: a settled run replays its stored ruling and writes nothing.
 */
export function settleHoloZoneRun(
  profile: Record<string, unknown>,
  runs: readonly HoloZoneRunRecord[],
  command: { runId: string; kills: number; bossDefeated: boolean; fielded: readonly string[]; health?: readonly HealthRow[] },
  nowMs: number,
): { userUpdates: Record<string, unknown>; doc: HoloZoneRunsDoc | null; reply: HoloZoneSettleReply } {
  const index = runs.findIndex((r) => r.runId === command.runId);
  if (index < 0) throw new HoloZoneError("unknown_run");
  const run = runs[index];
  if (run.settlement) {
    return { userUpdates: {}, doc: null, reply: { schemaVersion: HOLOZONE_SCHEMA, runId: run.runId, alreadyProcessed: true, settlement: structuredClone(run.settlement), progression: (run.progression ?? []).map((row) => ({ ...row })), holosGranted: run.holosGranted ?? 0, blueprintFragmentsGranted: run.blueprintFragmentsGranted ?? 0 } };
  }
  if (run.closedAtMs !== null) throw new HoloZoneError("run_closed");
  if (nowMs > run.expiresAtMs) throw new HoloZoneError("run_expired");
  const squad = new Set(run.squad);
  if (command.fielded.some((id) => !squad.has(id))) throw new HoloZoneError("invalid_request");
  const input = beastSettlementInput(run.tier, command.kills, command.bossDefeated);
  const table = computeBattleSettlement(input);
  if (!table) throw new HoloZoneError("unavailable");
  const expWithheld = nowMs - run.issuedAtMs < HOLOZONE_MIN_XP_MS;
  const award = awardBattleExperienceRaw(profile, command.fielded, input, nowMs, { withheld: expWithheld });
  if (!award) throw new HoloZoneError("unavailable");
  const settlement: HoloZoneSettlement = {
    kind: "beast", zoneId: run.zoneId, tier: run.tier, kills: command.kills, bossDefeated: command.bossDefeated, fielded: [...command.fielded],
    didWin: input.didWin, combosCompleted: input.combosCompleted, perfectDefenses: input.perfectDefenses,
    tableExp: table.exp, expPerHolobot: command.fielded.length ? award.expPerHolobot : 0, expWithheld, settledAtMs: nowMs,
  };
  const userUpdates: Record<string, unknown> = award.expPerHolobot > 0 && award.progression.length ? { holobots: award.holobots } : {};
  // DECISIONS #58: every settled run pays Holos (win = kills >= 1 || boss); the < HOLOZONE_MIN_XP_MS rule pays 0.
  const holosGranted = expWithheld ? 0 : input.didWin ? BATTLE_WIN_HOLOS : BATTLE_LOSS_HOLOS;
  if (holosGranted > 0) {
    const nextHolos = holosAfterGrant(profile, holosGranted);
    if (nextHolos === null) throw new HoloZoneError("unavailable");
    userUpdates.holosTokens = nextHolos;
  }
  // DECISIONS #58 (3): one blueprint_fragment per NON-boss clear with >= 1 kill (a boss clear keeps its Kit, #72);
  // the < HOLOZONE_MIN_XP_MS rule pays none; once per run (the stored amount replays).
  const blueprintFragmentsGranted = !command.bossDefeated && command.kills >= 1 && !expWithheld ? HOLOZONE_CLEAR_BLUEPRINT_FRAGMENTS : 0;
  if (blueprintFragmentsGranted > 0) {
    const itemStocks = itemStocksAfterFragmentGrant(profile, blueprintFragmentsGranted);
    if (itemStocks === null) throw new HoloZoneError("unavailable");
    userUpdates.itemStocks = itemStocks;
  }
  const next = runs.map((r, i) => (i === index ? { ...r, settlement, progression: award.progression, holosGranted, blueprintFragmentsGranted } : r));
  if (command.bossDefeated && !expWithheld) Object.assign(userUpdates, healingDelta(profile,"item.repair_kit",1));
  // rival-health-1: `health[]` reports settle the ledger with the ruling — only on a run issued with the flag, each
  // report at or below what that run issued (lib/rivalHealth.ts settleVitals; a violation refuses the whole settle).
  if (command.health !== undefined) {
    if (run.healthSchema !== RIVAL_HEALTH_SCHEMA || !run.issuedVitals) throw new HoloZoneError("invalid_request");
    const issued = run.issuedVitals;
    userUpdates.holobotVitals = asZone(() => settleVitals(profile, issued, [...command.health!]));
  }
  return {
    userUpdates,
    doc: { schemaVersion: HOLOZONE_RECORD_SCHEMA, runs: next },
    reply: { schemaVersion: HOLOZONE_SCHEMA, runId: run.runId, alreadyProcessed: false, settlement: structuredClone(settlement), progression: award.progression.map((row) => ({ ...row })), holosGranted, blueprintFragmentsGranted },
  };
}
