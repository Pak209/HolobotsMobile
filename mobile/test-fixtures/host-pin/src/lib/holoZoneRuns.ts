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
/** perfectDefenses credited for a defeated boss. */
export const HOLOZONE_BOSS_PERFECT_DEFENSES = 5;

export const HOLOZONE_ZONE_ID = /^[a-z][a-z0-9_]{0,63}$/;
/** runId = crypto.randomUUID() (lowercase RFC 4122 v4). */
export const HOLOZONE_RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** A fielded Holobot id: the travel-squad id rule. */
export const HOLOZONE_FIELDED_ID = /^[a-z][a-z0-9_]{0,127}$/;

export type HoloZoneErrorCode = "invalid_request" | "unknown_zone" | "unknown_run" | "run_expired" | "run_closed" | "holobot_ko" | "activity_conflict" | "zone_cooldown" | "unavailable";
export class HoloZoneError extends Error {
  constructor(public code: HoloZoneErrorCode, public retryAfterMs?: number) {
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
};

export type HoloZoneRunsDoc = { schemaVersion: typeof HOLOZONE_RECORD_SCHEMA; runs: HoloZoneRunRecord[] };

/** `schemaVersion` is the reply version the client asked for (request field; missing = v1, the deployed shape). */
/**
 * `schemaVersion` is the reply version the client asked for (request field; missing = v1, the deployed shape).
 * rival-health-1: `healthSchema` (issue / settle) asks for host health; settle `health[]` carries the reports (needs the
 * flag). Both are absent from the command when not sent — the rival host's request rule (lib/rivalHealth.ts healthRows).
 */
export type HoloZoneCommand = (
  | { operation: "status" }
  | { operation: "issue"; zoneId: string }
  | { operation: "settle"; runId: string; kills: number; bossDefeated: boolean; fielded: string[]; health?: HealthRow[] }
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
    return { operation: "issue", zoneId: c.zoneId, schemaVersion, ...flag };
  }
  if (c.operation !== "settle") throw new HoloZoneError("invalid_request");
  if (typeof c.runId !== "string" || !HOLOZONE_RUN_ID.test(c.runId)) throw new HoloZoneError("invalid_request");
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

export type HoloZoneStatusReply = { schemaVersion: typeof HOLOZONE_SCHEMA; run: HoloZoneRunView | null };
/** rival-health-1: `playerCombatants` only on an issue that carried `healthSchema` (the rival-battle-3 player shape + currentHealth). */
export type HoloZoneIssueReply = { schemaVersion: typeof HOLOZONE_SCHEMA } & HoloZoneRunView & { playerCombatants?: (PlayerCombatantSnapshot & { currentHealth: number })[] };
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
};

/** status → the open run (issued, unsettled, not superseded, not past expiresAtMs) or null. */
export function holoZoneStatus(runs: readonly HoloZoneRunRecord[], nowMs: number): HoloZoneStatusReply {
  const open = [...runs].reverse().find((r) => isOpen(r, nowMs));
  return { schemaVersion: HOLOZONE_SCHEMA, run: open ? viewOf(open) : null };
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
export function issueHoloZoneRun(runs: readonly HoloZoneRunRecord[], zoneId: string, squadIds: readonly string[], runId: string, nowMs: number, health?: { profile: Record<string, unknown>; includeHealth?: boolean }): { doc: HoloZoneRunsDoc; reply: HoloZoneIssueReply; userUpdates: Record<string, unknown> } {
  if (!HOLOZONE_RUN_ID.test(runId)) throw new HoloZoneError("unavailable");
  const tier = holoZoneTier(zoneId);
  if (tier === null) throw new HoloZoneError("unknown_zone");
  if (runs.some((r) => r.runId === runId)) throw new HoloZoneError("unavailable");
  const run: HoloZoneRunRecord = { runId, zoneId, tier, squad: [...squadIds], issuedAtMs: nowMs, expiresAtMs: nowMs + HOLOZONE_RUN_TTL_MS, closedAtMs: null, settlement: null, progression: null };
  let players: { playerCombatants: (PlayerCombatantSnapshot & { currentHealth: number })[] } | Record<string, never> = {};
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
  }
  const next = runs.map((r) => (isOpen(r, nowMs) ? { ...r, closedAtMs: nowMs } : r));
  next.push(run);
  return { doc: { schemaVersion: HOLOZONE_RECORD_SCHEMA, runs: next.slice(-HOLOZONE_MAX_STORED_RUNS) }, reply: { schemaVersion: HOLOZONE_SCHEMA, ...viewOf(run), ...players }, userUpdates };
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
    const stocks = profile.itemStocks;
    if (stocks !== undefined && (!stocks || typeof stocks !== "object" || Array.isArray(stocks))) throw new HoloZoneError("unavailable");
    const have = (stocks as Record<string, unknown> | undefined)?.[BLUEPRINT_FRAGMENT_STOCK] ?? 0;
    if (typeof have !== "number" || !Number.isSafeInteger(have) || have < 0 || !Number.isSafeInteger(have + blueprintFragmentsGranted)) throw new HoloZoneError("unavailable");
    userUpdates.itemStocks = { ...(stocks as Record<string, unknown> | undefined ?? {}), [BLUEPRINT_FRAGMENT_STOCK]: have + blueprintFragmentsGranted };
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
