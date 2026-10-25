import type { RepairChange } from "./accountRepairAudit";

/**
 * host-crawl-fixes-1 (crawl host item 2, firestore.rules economyFieldsSane): the rules check the WHOLE post-write
 * users/{uid} document, so one malformed legacy economy field (a string, a negative, a value over 1e8, an ISO-string
 * lastWildcardPackAt) denies every client write for that account — sync unit, quest refresh, sync-boost switch.
 * The rule stays as strict as it is. Instead the host normalizes those fields under its own authority, idempotently,
 * on its login / refresh paths (refreshEnergy, desktopAccountSnapshot), with an accountRepairs audit entry.
 *
 * Conservative by construction — a repaired value is never above the stored one where the stored one is a number:
 *  - a number over the rules cap (1e8)              -> the cap (a decrease);
 *  - a negative number                               -> 0 (the lowest sane value; nothing lower passes the rule);
 *  - NaN / +-Infinity                                -> 0;
 *  - a numeric string                                -> its number, then the same clamp (no value change);
 *  - anything else (bool, null, map, junk string)    -> 0.
 *  - lastWildcardPackAt (a cooldown start, epoch ms): a Timestamp or a parseable date string -> its epoch ms when that
 *    is in the rules range [0, 1e14); otherwise -> nowMs (restarts the cooldown: never opens a pack early).
 * Pure; no firebase imports. Mirror of economyFieldsSane / sane / saneEpochMsOptional (firestore.rules); the field list
 * is parity-tested against the rules file (scripts/test-economy-field-sanitizer.mjs).
 */
export const ECONOMY_SANE_FIELDS = [
  "holosTokens", "syncPoints", "lifetimeSyncPoints", "seasonSyncPoints", "gachaTickets", "arenaPassses",
  "expBoosters", "energyRefills", "rankSkips", "asyncBattleTickets", "dailyEnergy", "maxDailyEnergy",
  "stepEnergyGrantedToday", "leaderboardScore", "prestigeCount", "wins", "losses", "todaySteps", "wildcardBlueprints",
] as const;
export const ECONOMY_SANE_EPOCH_FIELDS = ["lastWildcardPackAt"] as const;
export const ECONOMY_SANE_MAX = 100_000_000;
export const ECONOMY_SANE_EPOCH_MAX_EXCLUSIVE = 100_000_000_000_000;

type Data = Record<string, unknown>;
const sane = (v: unknown) => typeof v === "number" && v >= 0 && v <= ECONOMY_SANE_MAX; // NaN fails both comparisons.
const saneEpoch = (v: unknown) => typeof v === "number" && v >= 0 && v < ECONOMY_SANE_EPOCH_MAX_EXCLUSIVE;
const NUMERIC_STRING = /^\s*-?\d+(\.\d+)?(e[+-]?\d+)?\s*$/i;

function clampNumber(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && NUMERIC_STRING.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(ECONOMY_SANE_MAX, Math.max(0, n));
}

function epochMs(v: unknown, nowMs: number): number {
  let ms = NaN;
  if (v && typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    try { ms = Number((v as { toMillis: () => unknown }).toMillis()); } catch { ms = NaN; }
  } else if (typeof v === "string") ms = Date.parse(v);
  return Number.isFinite(ms) && saneEpoch(ms) ? Math.floor(ms) : nowMs;
}

/** The field updates that make `profile` pass economyFieldsSane (empty = already sane), and an audit of each change. */
export function sanitizeEconomyFields(profile: Data, nowMs: number): { updates: Data; changes: RepairChange[] } {
  const updates: Data = {};
  const changes: RepairChange[] = [];
  for (const field of ECONOMY_SANE_FIELDS) {
    if (!(field in profile) || sane(profile[field])) continue;
    updates[field] = clampNumber(profile[field]);
    changes.push({ path: field, before: profile[field], after: updates[field] });
  }
  for (const field of ECONOMY_SANE_EPOCH_FIELDS) {
    if (!(field in profile) || saneEpoch(profile[field])) continue;
    updates[field] = epochMs(profile[field], nowMs);
    changes.push({ path: field, before: profile[field], after: updates[field] });
  }
  return { updates, changes };
}
