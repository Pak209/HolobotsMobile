/**
 * HoloCity daily district pickups (owner, 2026-11-12: "one glowing pickup per district per day"; CITY_PATH_PLAN 3b / S4;
 * owner rulings 2026-11-13: local-midnight reset, Buddy pickups shown). A `daily` posting kind on the Mission Board host
 * (mission-board-1 operations `dailyStatus` / `dailyClaim`).
 *
 * - Each of the shared city plan's 10 districts (lib/cityDistricts.ts, D01..D10) has ONE pickup per LOCAL day. The clients
 *   draw it at the district's plan `visit` point (cityPlan.generated.json); the server only knows the district id.
 * - Local day: the phone sends `utcOffsetMinutes` (−720…+840, whole 15-minute steps; absent = 0, UTC). The server computes the
 *   local day key from ITS clock + that offset, and stores the key with each claim.
 * - Time-zone hopping is capped by real time, whatever offset is sent: a district can't be claimed again within
 *   DAILY_PICKUP_MIN_GAP_MS (20 h) of its last claim, and at most DAILY_PICKUP_ROLLING_MAX (10) claims land in any rolling 20 h.
 * - The server cannot prove where the pilot stands, so the ledger is the cap. Rewards are server-owned and small on purpose:
 *     DAILY_PICKUP_HOLOS per pickup; 1 Light Buddy Unit where dailyBuddyRoll(uid, local day, district) says (about 1 in 20; the
 *     status reveals which pickups hold one); DAILY_ALL_DISTRICTS_BONUS_HOLOS when the 10th district of the local day is claimed.
 *   Most a day can pay: 10 × 5 + 25 = 75 Holos (+ on average 0.5 Light Buddy Units). One rookie Arena win or town rival win
 *   pays 100 Holos plus EXP.
 * - Idempotent by requestId: a replay returns the first grant and writes nothing; the ledger keeps the last
 *   DAILY_PICKUP_MAX_REQUESTS claims.
 *
 * Pure module: no firebase imports (functions/scripts/test-daily-pickups.mjs).
 */
import { createHash } from "node:crypto";
import { BUDDY_UNITS_FIELD, withTierDelta } from "./buddyUnits";
import { CITY_DISTRICTS, CityDistrictId } from "./cityDistricts";
import { REQUEST_ID } from "./introQuests";
import { BUDDY_LIGHT_ITEM, MISSION_BOARD_SCHEMA, MissionBoardError, missionBoardBalances, PostingItem } from "./missionBoard";
import { holosAfterGrant } from "./rivalLadder";

export const DAILY_PICKUP_SCHEMA = "city-daily-2";
/** The first (UTC-day) ledger shape, read and upgraded in place: {day, claimed:{D0n: claimedAtMs}, requests}. */
export const DAILY_PICKUP_SCHEMA_V1 = "city-daily-1";
/** Host env flag, default off: ON only for exactly "1". Off, both daily operations answer `daily_off` before any read. */
export const DAILY_PICKUPS_FLAG = "HOLOCITY_DAILY_PICKUPS";
export function dailyPickupsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[DAILY_PICKUPS_FLAG] === "1";
}
export const DAILY_PICKUP_HOLOS = 5;
export const DAILY_PICKUP_BUDDY_ONE_IN = 20;
export const DAILY_ALL_DISTRICTS_BONUS_HOLOS = 25;
export const DAILY_PICKUP_MAX_REQUESTS = 40;
const HOUR_MS = 60 * 60 * 1000, DAY_MS = 24 * HOUR_MS;
/** Real-time floor between two claims of the same district, whatever offset is sent. */
export const DAILY_PICKUP_MIN_GAP_MS = 20 * HOUR_MS;
/** At most this many claims in any rolling DAILY_PICKUP_ROLLING_WINDOW_MS. */
export const DAILY_PICKUP_ROLLING_MAX = 10;
export const DAILY_PICKUP_ROLLING_WINDOW_MS = 20 * HOUR_MS;
export const UTC_OFFSET_MIN = -12 * 60, UTC_OFFSET_MAX = 14 * 60, UTC_OFFSET_STEP = 15;
export const DAILY_PICKUP_DISTRICTS: readonly CityDistrictId[] = CITY_DISTRICTS.map((d) => d.id);

export type DailyGrant = { holos: number; items: PostingItem[]; allDistrictsBonus: boolean };
export type DailyRequestRow = { requestId: string; day: string; districtId: CityDistrictId; claimedAtMs: number; granted: DailyGrant };
/** A district's last claim: its local day key and the real claim time. */
export type DailyLastClaim = { day: string; atMs: number };
export type DailyPickupDoc = {
  schemaVersion: typeof DAILY_PICKUP_SCHEMA;
  last: Partial<Record<CityDistrictId, DailyLastClaim>>;
  requests: DailyRequestRow[];
};
export type DailyCommand =
  | { operation: "dailyStatus"; utcOffsetMinutes: number }
  | { operation: "dailyClaim"; districtId: CityDistrictId; requestId: string; utcOffsetMinutes: number };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isDistrict = (x: unknown): x is CityDistrictId => typeof x === "string" && (DAILY_PICKUP_DISTRICTS as readonly string[]).includes(x);
const nonNegInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDailyOperation(raw: unknown): boolean {
  return isObj(raw) && (raw.operation === "dailyStatus" || raw.operation === "dailyClaim");
}
export function validUtcOffset(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= UTC_OFFSET_MIN && x <= UTC_OFFSET_MAX && x % UTC_OFFSET_STEP === 0;
}

/** Exact keys only; the district id must be one of the plan's ten; utcOffsetMinutes optional (absent = 0). */
export function validateDailyCommand(raw: unknown): DailyCommand {
  if (!isObj(raw)) throw new MissionBoardError("invalid_request");
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== MISSION_BOARD_SCHEMA) throw new MissionBoardError("invalid_request");
  if (raw.utcOffsetMinutes !== undefined && !validUtcOffset(raw.utcOffsetMinutes)) throw new MissionBoardError("invalid_request");
  const utcOffsetMinutes = (raw.utcOffsetMinutes as number | undefined) ?? 0;
  const keys = Object.keys(raw).filter((k) => k !== "schemaVersion" && k !== "utcOffsetMinutes");
  if (raw.operation === "dailyStatus") {
    if (keys.length !== 1) throw new MissionBoardError("invalid_request");
    return { operation: "dailyStatus", utcOffsetMinutes };
  }
  if (raw.operation !== "dailyClaim") throw new MissionBoardError("invalid_request");
  if (keys.length !== 3 || !isDistrict(raw.districtId)) throw new MissionBoardError("invalid_request");
  if (typeof raw.requestId !== "string" || !REQUEST_ID.test(raw.requestId)) throw new MissionBoardError("invalid_request");
  return { operation: "dailyClaim", districtId: raw.districtId, requestId: raw.requestId, utcOffsetMinutes };
}

/** The local day key (YYYY-MM-DD) at server time `nowMs` for a phone at `utcOffsetMinutes`. */
export function localDayOf(nowMs: number, utcOffsetMinutes: number): string {
  return new Date(nowMs + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}
/** The next local midnight after `nowMs`, in real (UTC) ms. */
export function nextLocalResetAtMs(nowMs: number, utcOffsetMinutes: number): number {
  const off = utcOffsetMinutes * 60_000;
  return (Math.floor((nowMs + off) / DAY_MS) + 1) * DAY_MS - off;
}

function readRequests(raw: unknown): DailyRequestRow[] {
  const bad = () => new MissionBoardError("unavailable");
  if (!Array.isArray(raw)) throw bad();
  for (const r of raw) {
    if (!isObj(r) || typeof r.requestId !== "string" || typeof r.day !== "string" || !isDistrict(r.districtId) || !nonNegInt(r.claimedAtMs)) throw bad();
    const g = r.granted;
    if (!isObj(g) || !nonNegInt(g.holos) || !Array.isArray(g.items) || typeof g.allDistrictsBonus !== "boolean") throw bad();
  }
  return structuredClone(raw) as DailyRequestRow[];
}

/** Reads cityDailyPickups/{uid}: missing → null (a new ledger); a city-daily-1 doc is upgraded; malformed → unavailable (never reset). */
export function readDailyDoc(raw: unknown): DailyPickupDoc | null {
  if (raw === undefined) return null;
  const bad = () => new MissionBoardError("unavailable");
  if (!isObj(raw)) throw bad();
  if (raw.schemaVersion === DAILY_PICKUP_SCHEMA_V1) {
    if (typeof raw.day !== "string" || !DAY.test(raw.day) || !isObj(raw.claimed) || !Object.entries(raw.claimed).every(([k, v]) => isDistrict(k) && nonNegInt(v))) throw bad();
    const last: DailyPickupDoc["last"] = {};
    for (const [k, v] of Object.entries(raw.claimed)) last[k as CityDistrictId] = { day: raw.day, atMs: v as number };
    return { schemaVersion: DAILY_PICKUP_SCHEMA, last, requests: readRequests(raw.requests) };
  }
  if (raw.schemaVersion !== DAILY_PICKUP_SCHEMA || !isObj(raw.last)) throw bad();
  for (const [k, v] of Object.entries(raw.last)) if (!isDistrict(k) || !isObj(v) || typeof v.day !== "string" || !DAY.test(v.day) || !nonNegInt(v.atMs)) throw bad();
  return { schemaVersion: DAILY_PICKUP_SCHEMA, last: structuredClone(raw.last) as DailyPickupDoc["last"], requests: readRequests(raw.requests) };
}

/** Whether today's pickup at `districtId` also carries a Light Buddy Unit (pure; the same answer on every retry and in the status). */
export function dailyBuddyRoll(uid: string, day: string, districtId: CityDistrictId): boolean {
  const digest = createHash("sha256").update(JSON.stringify(["city-daily-1", uid, day, districtId])).digest();
  return digest.readUInt32BE(0) % DAILY_PICKUP_BUDDY_ONE_IN === 0;
}

/** When the rolling cap next lets a claim through (null = it does now). */
function rollingReadyAtMs(doc: DailyPickupDoc | null, nowMs: number): number | null {
  const recent = (doc?.requests ?? []).map((r) => r.claimedAtMs).filter((t) => t > nowMs - DAILY_PICKUP_ROLLING_WINDOW_MS).sort((a, b) => a - b);
  if (recent.length < DAILY_PICKUP_ROLLING_MAX) return null;
  return recent[recent.length - DAILY_PICKUP_ROLLING_MAX] + DAILY_PICKUP_ROLLING_WINDOW_MS;
}
/** When `districtId` can next be claimed (null = now): local day, the 20 h real gap, and the rolling cap. */
export function districtReadyAtMs(doc: DailyPickupDoc | null, districtId: CityDistrictId, nowMs: number, utcOffsetMinutes: number): number | null {
  const last = doc?.last[districtId];
  let at = 0;
  if (last) {
    if (last.day === localDayOf(nowMs, utcOffsetMinutes)) at = Math.max(at, nextLocalResetAtMs(nowMs, utcOffsetMinutes));
    if (nowMs - last.atMs < DAILY_PICKUP_MIN_GAP_MS) at = Math.max(at, last.atMs + DAILY_PICKUP_MIN_GAP_MS);
  }
  const rolling = rollingReadyAtMs(doc, nowMs);
  if (rolling !== null) at = Math.max(at, rolling);
  return at > nowMs ? at : null;
}

export type DailyView = {
  day: string;
  nextResetAtMs: number;
  total: number;
  /** Districts claimed on this local day ("DAILY 3/10"). */
  claimedCount: number;
  /**
   * Plan order. `claimed`: claimed on this local day. `ready`: claimable now (the client draws a pickup only then).
   * `readyAtMs`: when a district that isn't ready will be (null when ready). `buddy`: a ready pickup that holds a Light Buddy Unit.
   */
  districts: { districtId: CityDistrictId; name: string; claimed: boolean; ready: boolean; readyAtMs: number | null; buddy: boolean }[];
  reward: { holos: number; allDistrictsBonusHolos: number; buddyLightOneIn: number };
};

export function dailyView(doc: DailyPickupDoc | null, uid: string, nowMs: number, utcOffsetMinutes: number): DailyView {
  const day = localDayOf(nowMs, utcOffsetMinutes);
  const districts = CITY_DISTRICTS.map((d) => {
    const readyAtMs = districtReadyAtMs(doc, d.id, nowMs, utcOffsetMinutes);
    return { districtId: d.id, name: d.name, claimed: doc?.last[d.id]?.day === day, ready: readyAtMs === null, readyAtMs, buddy: readyAtMs === null && dailyBuddyRoll(uid, day, d.id) };
  });
  return {
    day, nextResetAtMs: nextLocalResetAtMs(nowMs, utcOffsetMinutes), total: districts.length, claimedCount: districts.filter((d) => d.claimed).length, districts,
    reward: { holos: DAILY_PICKUP_HOLOS, allDistrictsBonusHolos: DAILY_ALL_DISTRICTS_BONUS_HOLOS, buddyLightOneIn: DAILY_PICKUP_BUDDY_ONE_IN },
  };
}

export type DailyClaimReply = {
  schemaVersion: typeof MISSION_BOARD_SCHEMA; source: "daily"; districtId: CityDistrictId; requestId: string; alreadyProcessed: boolean;
  granted: DailyGrant; balances: ReturnType<typeof missionBoardBalances>; daily: DailyView;
};

/**
 * Rules, in order: a replayed requestId returns its first grant (another district under the same id is invalid_request); a district
 * already claimed this local day, or within 20 h of its last claim, is already_claimed (detail.readyAtMs); an 11th claim inside a
 * rolling 20 h is daily_limit (detail.readyAtMs); otherwise pay DAILY_PICKUP_HOLOS, the rolled Light Buddy Unit, and the
 * all-districts bonus when every district has been claimed on this local day.
 */
export function claimDailyPickup(
  doc: DailyPickupDoc | null,
  profile: Record<string, unknown>,
  uid: string,
  cmd: Extract<DailyCommand, { operation: "dailyClaim" }>,
  nowMs: number,
): { doc: DailyPickupDoc | null; userUpdates: Record<string, unknown>; reply: DailyClaimReply } {
  const off = cmd.utcOffsetMinutes;
  const balances = missionBoardBalances(profile);
  const replay = doc?.requests.find((r) => r.requestId === cmd.requestId);
  if (replay) {
    if (replay.districtId !== cmd.districtId) throw new MissionBoardError("invalid_request");
    return { doc: null, userUpdates: {}, reply: { schemaVersion: MISSION_BOARD_SCHEMA, source: "daily", districtId: replay.districtId, requestId: replay.requestId, alreadyProcessed: true, granted: structuredClone(replay.granted), balances, daily: dailyView(doc, uid, nowMs, off) } };
  }
  const day = localDayOf(nowMs, off);
  const last = doc?.last[cmd.districtId];
  if (last && (last.day === day || nowMs - last.atMs < DAILY_PICKUP_MIN_GAP_MS)) throw new MissionBoardError("already_claimed", { readyAtMs: districtReadyAtMs(doc, cmd.districtId, nowMs, off) });
  const rolling = rollingReadyAtMs(doc, nowMs);
  if (rolling !== null) throw new MissionBoardError("daily_limit", { readyAtMs: rolling });
  const lastAfter = { ...(doc?.last ?? {}), [cmd.districtId]: { day, atMs: nowMs } } as DailyPickupDoc["last"];
  const allDistrictsBonus = DAILY_PICKUP_DISTRICTS.every((id) => lastAfter[id]?.day === day);
  const holos = DAILY_PICKUP_HOLOS + (allDistrictsBonus ? DAILY_ALL_DISTRICTS_BONUS_HOLOS : 0);
  const items: PostingItem[] = dailyBuddyRoll(uid, day, cmd.districtId) ? [{ itemId: BUDDY_LIGHT_ITEM, quantity: 1 }] : [];
  const nextHolos = holosAfterGrant(profile, holos);
  if (nextHolos === null) throw new MissionBoardError("unavailable");
  const userUpdates: Record<string, unknown> = { holosTokens: nextHolos };
  const buddyAfter = items.length ? withTierDelta(balances.buddyUnits, "light", 1) : balances.buddyUnits;
  if (items.length) userUpdates[BUDDY_UNITS_FIELD] = { ...buddyAfter };
  const granted: DailyGrant = { holos, items, allDistrictsBonus };
  const next: DailyPickupDoc = {
    schemaVersion: DAILY_PICKUP_SCHEMA, last: lastAfter,
    requests: [...(doc?.requests ?? []), { requestId: cmd.requestId, day, districtId: cmd.districtId, claimedAtMs: nowMs, granted }].slice(-DAILY_PICKUP_MAX_REQUESTS),
  };
  return {
    doc: next, userUpdates,
    reply: { schemaVersion: MISSION_BOARD_SCHEMA, source: "daily", districtId: cmd.districtId, requestId: cmd.requestId, alreadyProcessed: false, granted: structuredClone(granted),
      balances: { ...balances, holosTokens: nextHolos, buddyUnits: buddyAfter }, daily: dailyView(next, uid, nowMs, off) },
  };
}
