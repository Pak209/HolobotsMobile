/**
 * Host-side daily energy regen (energy-quest-server-1, Pak 2026-10-23: "Local midnight").
 *
 * Before: mobile `useEnergyRegen` computed the trickle, the step bonus and the daily reset on the DEVICE clock and
 * wrote dailyEnergy / lastEnergyRefresh / stepEnergyDate / stepEnergyGrantedToday itself. Changing the device clock or
 * time zone forged a new "day" (a full refill) at will. Those four fields are now server-only (firestore.rules) and
 * only this module (via refreshEnergy and the quest / training start callables) moves them.
 *
 * Time-zone design (cannot be gamed by the device clock or zone):
 *   - Every instant is the HOST clock (`nowMs`). The client never sends a time.
 *   - The account's IANA zone lives server-side in `energyTimeZone`. The client may PROPOSE its zone; the first valid
 *     proposal is stored, and a different one replaces it only once `TIME_ZONE_CHANGE_COOLDOWN_MS` has passed since
 *     `energyTimeZoneChangedAt`. During the cooldown the stored zone keeps being used. No zone yet: UTC, not stored.
 *   - The daily reset is "the host's now, read in the account's zone, is a LATER calendar day than `energyDayKey`"
 *     (strictly later, compared as YYYY-MM-DD). A zone change that moves the calendar back never resets.
 *   - A zone change never grants a reset by itself: if the account's current energy day started less than
 *     `RESET_MIN_GAP_AFTER_ZONE_CHANGE_MS` ago (`energyDayStartedAt`), the new zone's today counts as already reset.
 *   - Step energy reads today's steps from the server-only `users/{uid}/fitness_daily/{todayKey}` doc, keyed by the
 *     host's today in the account zone (the caller passes `todaySteps`), and is capped per energy day.
 *
 * Trickle and step rates are the client's (mobile/src/lib/energy.ts): +1 per 15 min since lastEnergyRefresh up to
 * maxDailyEnergy; +1 per 250 steps, max 40 per day, up to max.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */

export const ENERGY_REGEN_SCHEMA = "energy-regen-1";
export const ENERGY_TRICKLE_INTERVAL_MS = 15 * 60 * 1000;
export const STEPS_PER_BONUS_ENERGY = 250;
export const MAX_DAILY_STEP_ENERGY = 40;
export const DEFAULT_MAX_DAILY_ENERGY = 100;
export const DEFAULT_ENERGY_TIME_ZONE = "UTC";
/** A stored zone may be replaced at most once per 7 days. */
export const TIME_ZONE_CHANGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** A zone change inside this window of the last reset never yields a second reset. */
export const RESET_MIN_GAP_AFTER_ZONE_CHANGE_MS = 24 * 60 * 60 * 1000;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ZONE_SHAPE = /^[A-Za-z0-9_+\-/]{1,64}$/;

type Data = Record<string, unknown>;

export type TimeZoneStatus = "set" | "unchanged" | "changed" | "cooldown" | "default" | "invalid";

export type EnergyRegenOutcome = {
  changed: boolean;
  /** Fields to merge into users/{uid}; times are epoch ms (the callable converts to Timestamps). Null = no write. */
  updates: null | {
    dailyEnergy: number;
    lastEnergyRefreshMs: number;
    stepEnergyDate: string;
    stepEnergyGrantedToday: number;
    energyDayKey: string;
    energyDayStartedAtMs: number;
    energyTimeZone?: string;
    energyTimeZoneChangedAtMs?: number;
  };
  reply: {
    schemaVersion: typeof ENERGY_REGEN_SCHEMA;
    changed: boolean;
    dailyEnergy: number;
    maxDailyEnergy: number;
    energyDayKey: string;
    timeZone: string;
    timeZoneStatus: TimeZoneStatus;
    timeZoneChangeAvailableAt: string | null;
    nextResetAt: string;
  };
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The canonical IANA name, or null when the string is not a zone this runtime knows. */
export function normalizeTimeZone(raw: unknown): string | null {
  if (typeof raw !== "string" || !ZONE_SHAPE.test(raw)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** YYYY-MM-DD of `ms` on the calendar of `zone`. */
export function dayKeyInZone(ms: number, zone: string): string {
  const parts = formatterFor(zone).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** First instant (to the second) after `nowMs` whose day key in `zone` is later than `afterKey`. */
export function nextResetAtMs(nowMs: number, zone: string, afterKey: string): number {
  // Whole seconds: every zone's midnight falls on one, so the search lands on it exactly.
  let lo = Math.floor(nowMs / 1000);
  if (dayKeyInZone(lo * 1000, zone) > afterKey) return nowMs;
  let hi = lo + 3 * 24 * 60 * 60;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKeyInZone(mid * 1000, zone) > afterKey) hi = mid;
    else lo = mid;
  }
  return hi * 1000;
}

/** Epoch ms of a stored time: Firestore Timestamp, Date, ISO string or number. Null when absent / unreadable. */
export function readTimeMs(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "object") {
    const v = value as { toMillis?: () => number; toDate?: () => Date };
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.toDate === "function") return v.toDate().getTime();
  }
  return null;
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The zone this request computes in, and whether to store it. */
export function resolveEnergyTimeZone(profile: Data, requested: unknown, nowMs: number) {
  const stored = normalizeTimeZone(profile.energyTimeZone);
  const proposed = requested === undefined || requested === null ? null : normalizeTimeZone(requested);
  const invalid = requested !== undefined && requested !== null && proposed === null;
  const changedAtMs = readTimeMs(profile.energyTimeZoneChangedAt);
  const availableAtMs = changedAtMs === null ? null : changedAtMs + TIME_ZONE_CHANGE_COOLDOWN_MS;

  if (!stored) {
    if (proposed) return { zone: proposed, priorZone: proposed, store: true, status: "set" as const, availableAtMs: null };
    return { zone: DEFAULT_ENERGY_TIME_ZONE, priorZone: DEFAULT_ENERGY_TIME_ZONE, store: false, status: invalid ? "invalid" as const : "default" as const, availableAtMs: null };
  }
  if (invalid) return { zone: stored, priorZone: stored, store: false, status: "invalid" as const, availableAtMs };
  if (!proposed || proposed === stored) return { zone: stored, priorZone: stored, store: false, status: "unchanged" as const, availableAtMs };
  if (availableAtMs !== null && nowMs < availableAtMs) return { zone: stored, priorZone: stored, store: false, status: "cooldown" as const, availableAtMs };
  return { zone: proposed, priorZone: stored, store: true, status: "changed" as const, availableAtMs: nowMs + TIME_ZONE_CHANGE_COOLDOWN_MS };
}

/**
 * One regen pass over a stored profile at host time `nowMs`. `todaySteps` is the stepsTotal of
 * fitness_daily/{todayKey} (the caller reads it; `undefined` = no step grant this pass). `requestedZone` is the
 * client's proposed IANA zone, or undefined (server callers that never change the zone).
 */
export function computeHostEnergyRegen(profile: Data, nowMs: number, todaySteps: number | undefined, requestedZone?: unknown): EnergyRegenOutcome {
  const tz = resolveEnergyTimeZone(profile, requestedZone, nowMs);
  const max = Math.max(1, count(profile.maxDailyEnergy) || DEFAULT_MAX_DAILY_ENERGY);
  const startingEnergy = count(profile.dailyEnergy);
  const storedRefreshMs = readTimeMs(profile.lastEnergyRefresh);
  // A legacy client may have written a future timestamp: settle on now, never on a grant.
  let lastRefreshMs = storedRefreshMs === null ? null : Math.min(storedRefreshMs, nowMs);
  const storedDayKey = typeof profile.energyDayKey === "string" && DAY_KEY.test(profile.energyDayKey) ? profile.energyDayKey : null;
  // Legacy accounts (client-side regen) have no energyDayKey: their day is lastEnergyRefresh's day, read in the zone
  // the account had (or, on the first set, the zone the device reports — what the client's local reset used).
  let dayKey = storedDayKey ?? (lastRefreshMs === null ? null : dayKeyInZone(lastRefreshMs, tz.priorZone));
  let dayStartedAtMs = readTimeMs(profile.energyDayStartedAt);
  const todayKey = dayKeyInZone(nowMs, tz.zone);

  let energy = startingEnergy;
  let didReset = false;

  // A zone change never grants a reset by itself.
  if (tz.store && dayKey !== null && todayKey > dayKey && dayStartedAtMs !== null && nowMs - dayStartedAtMs < RESET_MIN_GAP_AFTER_ZONE_CHANGE_MS) {
    dayKey = todayKey;
  }

  if (dayKey === null || lastRefreshMs === null || todayKey > dayKey) {
    didReset = true;
    energy = Math.max(energy, max);
    lastRefreshMs = nowMs;
    dayKey = todayKey;
    dayStartedAtMs = nowMs;
  } else if (energy < max) {
    const granted = Math.min(Math.floor((nowMs - lastRefreshMs) / ENERGY_TRICKLE_INTERVAL_MS), max - energy);
    if (granted > 0) {
      energy += granted;
      lastRefreshMs += granted * ENERGY_TRICKLE_INTERVAL_MS;
    }
  } else {
    // At (or above) max the trickle clock does not run, as on the client: nothing accrues while full.
  }

  const storedStepDate = typeof profile.stepEnergyDate === "string" ? profile.stepEnergyDate : null;
  const storedGranted = count(profile.stepEnergyGrantedToday);
  const grantedToday = storedStepDate === todayKey ? storedGranted : 0;
  let nextGranted = grantedToday;
  if (todaySteps !== undefined) {
    const eligibility = Math.min(Math.floor(Math.max(0, todaySteps) / STEPS_PER_BONUS_ENERGY), MAX_DAILY_STEP_ENERGY);
    const bonus = Math.min(Math.max(0, eligibility - grantedToday), Math.max(0, max - energy));
    if (bonus > 0) {
      energy += bonus;
      nextGranted += bonus;
    }
  }

  const changed = didReset
    || energy !== startingEnergy
    || lastRefreshMs !== storedRefreshMs
    || storedStepDate !== todayKey
    || nextGranted !== storedGranted
    || dayKey !== storedDayKey
    || tz.store;

  const updates: EnergyRegenOutcome["updates"] = changed
    ? {
      dailyEnergy: energy,
      lastEnergyRefreshMs: lastRefreshMs,
      stepEnergyDate: todayKey,
      stepEnergyGrantedToday: nextGranted,
      energyDayKey: dayKey,
      energyDayStartedAtMs: dayStartedAtMs ?? lastRefreshMs,
      ...(tz.store ? { energyTimeZone: tz.zone, ...(tz.status === "changed" ? { energyTimeZoneChangedAtMs: nowMs } : {}) } : {}),
    }
    : null;

  return {
    changed,
    updates,
    reply: {
      schemaVersion: ENERGY_REGEN_SCHEMA,
      changed,
      dailyEnergy: energy,
      maxDailyEnergy: max,
      energyDayKey: dayKey,
      timeZone: tz.zone,
      timeZoneStatus: tz.status,
      timeZoneChangeAvailableAt: tz.availableAtMs === null ? null : new Date(tz.availableAtMs).toISOString(),
      nextResetAt: new Date(nextResetAtMs(nowMs, tz.zone, dayKey)).toISOString(),
    },
  };
}

/** The refreshEnergy request: `{}` or `{timeZone}`; anything else is invalid_request. */
export function readRefreshEnergyRequest(raw: unknown): { timeZone?: unknown } | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const keys = Object.keys(raw as Data);
  if (keys.some((k) => k !== "timeZone")) return null;
  const timeZone = (raw as Data).timeZone;
  if (timeZone !== undefined && timeZone !== null && typeof timeZone !== "string") return null;
  return timeZone === undefined || timeZone === null ? {} : { timeZone };
}
