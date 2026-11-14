/**
 * pvp-daily-1 (ship-readiness item 7, Pak 2026-11-04): async PvP. Every UTC day each pilot gets three opponents: other
 * players' saved travel squads near their rival rank, frozen at list time and served by the rival host as an AI rival
 * (source `pvp_async`). Same energy cost as a rival battle, Holos only (rivalLadder.PVP_ASYNC_SOURCE), no rating, one
 * attempt per opponent per day.
 *
 * Rank = the rival ladder tier (tierForWins(users/{uid}.rivalWins), 10 wins per tier). "Near" = within
 * PVP_NEAR_TIER_BAND tiers; if that band has fewer than three other pilots with a valid squad the list widens to
 * PVP_WIDE_TIER_BAND, and any still-empty slot is a seeded squad at the caller's tier, so the list is never empty.
 *
 * Pure module: no firebase imports, safe to import from tests (functions/scripts/test-pvp-daily.mjs).
 */
import { createHash } from "node:crypto";
import {
  buildPlayerCombatants, buildRivalLineup, CombatantSnapshot, getRivalTierRow, NpcPilotSnapshot, RIVAL_BATTLE_ID,
  RIVAL_LINEUP_SCALE_WOLF, rivalScaledCombatantStats, tierForWins, utcDay,
} from "./rivalLadder";
import { RULES_SCHEMA_6, RULES_SCHEMA_7, RULES_SCHEMA_8 } from "../sim/fight/rules";

export const PVP_DAILY_SCHEMA = "pvp-daily-1" as const;
export const PVP_OPPONENTS_PER_DAY = 3;
export const PVP_ATTEMPTS_PER_OPPONENT = 1;
/** Same as a rival battle. Rival battles spend no energy on the host today, so neither does PvP (contract question for Pak). */
export const PVP_ENERGY_COST = 0;
export const PVP_NEAR_TIER_BAND = 1;
export const PVP_WIDE_TIER_BAND = 3;
/** Candidates the store reads per band query (users ordered by rivalWins inside the band). */
export const PVP_CANDIDATE_QUERY_LIMIT = 40;
export const PVP_CALLSIGN_MAX = 24;
export const PVP_OPPONENT_ID = /^po_[0-9]{8}_[0-9]$/;
/** Seeded opponents' callsigns (never a real player's). */
export const PVP_SEEDED_CALLSIGNS: readonly string[] = ["Kestrel", "Rook", "Vanta", "Juno", "Mako", "Sable", "Orion", "Pike", "Ember", "Quill", "Talon", "Halo"];

export type PvpErrorCode = "invalid_request" | "unknown_opponent" | "no_attempts_left" | "list_expired" | "unavailable";
export class PvpError extends Error {
  constructor(readonly code: PvpErrorCode) { super(code); this.name = "PvpError"; }
}

/** The frozen squad member: the rival CombatantSnapshot plus the stats a rival-battle-3 reply carries. */
export type PvpSquadMember = CombatantSnapshot & { speed: number; intelligence: number };

export type PvpOpponent = {
  opponentId: string;
  kind: "player" | "seeded";
  /** Server-only: the opponent's uid (exclusion / audit). Never in a reply. */
  sourceUid: string | null;
  callsign: string;
  tier: number;
  tierLabel: string;
  squad: PvpSquadMember[];
  attemptsUsed: number;
  battleId: string | null;
  issuedAtMs: number | null;
};

/** pvpDaily/{uid} (server-only; default-denied by the firestore.rules catch-all). */
export type PvpDailyDoc = {
  schemaVersion: typeof PVP_DAILY_SCHEMA;
  day: string;
  refreshedAtMs: number;
  callerTier: number;
  opponents: PvpOpponent[];
};

/** A pilot the store read from users/ (already projected; see candidateFromProfile). */
export type PvpCandidate = { uid: string; tier: number; callsign: string; squad: PvpSquadMember[] };

// ---- inputs ----------------------------------------------------------------

export type PvpCommand =
  | { operation: "list" }
  | { operation: "issue"; opponentId: string; duelInputs?: string; fightRules?: string };

/** pvp-daily-fight-rules: the live-fight rules a client may ask for at issue (the rival issue's own ask, forwarded as sent). */
export const PVP_FIGHT_RULES_ASKS: readonly string[] = [RULES_SCHEMA_6, RULES_SCHEMA_7, RULES_SCHEMA_8];

/** Strict request validation (desktopTelemetry style): unknown operation, extra-long or malformed ids refuse. */
export function validatePvpCommand(raw: unknown): PvpCommand {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PvpError("invalid_request");
  const c = raw as Record<string, unknown>;
  if (c.schemaVersion !== undefined && c.schemaVersion !== PVP_DAILY_SCHEMA) throw new PvpError("invalid_request");
  for (const k of Object.keys(c)) if (!["schemaVersion", "operation", "opponentId", "duelInputs", "fightRules"].includes(k)) throw new PvpError("invalid_request");
  if (c.operation === "list") {
    if (c.opponentId !== undefined || c.duelInputs !== undefined || c.fightRules !== undefined) throw new PvpError("invalid_request");
    return { operation: "list" };
  }
  if (c.operation !== "issue") throw new PvpError("invalid_request");
  if (typeof c.opponentId !== "string" || !PVP_OPPONENT_ID.test(c.opponentId)) throw new PvpError("invalid_request");
  if (c.duelInputs !== undefined && (typeof c.duelInputs !== "string" || c.duelInputs.length > 32)) throw new PvpError("invalid_request");
  // A rules ask (duel-rules-6 / -7 / -8) only makes sense on a live input-log issue, as on the rival issue itself; anything else
  // is refused before any read or write (clients step down 8 -> 7 -> 6 -> no ask on invalid_request).
  if (c.fightRules !== undefined && (c.duelInputs === undefined || typeof c.fightRules !== "string" || !PVP_FIGHT_RULES_ASKS.includes(c.fightRules))) throw new PvpError("invalid_request");
  if (c.duelInputs === undefined) return { operation: "issue", opponentId: c.opponentId };
  return c.fightRules === undefined ? { operation: "issue", opponentId: c.opponentId, duelInputs: c.duelInputs } : { operation: "issue", opponentId: c.opponentId, duelInputs: c.duelInputs, fightRules: c.fightRules };
}

// ---- projection of another player's profile --------------------------------

/** Display-safe callsign: trimmed, control characters dropped, capped; a pilot without one gets a stable "Pilot ####". */
export function callsignOf(uid: string, raw: unknown): string {
  const s = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, PVP_CALLSIGN_MAX).trim() : "";
  if (s) return s;
  const n = parseInt(createHash("sha256").update(uid).digest("hex").slice(0, 8), 16) % 10000;
  return `Pilot ${String(n).padStart(4, "0")}`;
}

function squadMember(c: CombatantSnapshot & { speed?: number; intelligence?: number }): PvpSquadMember {
  return {
    holobotId: c.holobotId, level: c.level, maxHealth: c.maxHealth, attack: c.attack, defense: c.defense,
    maxStamina: c.maxStamina, staminaRegen: c.staminaRegen, deployment: { ...c.deployment }, moves: c.moves.map((m) => ({ ...m })),
    speed: c.speed ?? 0, intelligence: c.intelligence ?? 0,
  };
}

/**
 * Another player's saved squad as a candidate, or null when it cannot be served (no / malformed / empty travel squad,
 * malformed rival ledger). `squadIds` is the store's readTravelSquad result (it throws on malformed data; pass [] then).
 * Only combat numbers and the callsign leave the profile.
 */
export function candidateFromProfile(uid: string, profile: Record<string, unknown>, squadIds: readonly string[]): PvpCandidate | null {
  const wins = profile.rivalWins === undefined ? 0 : profile.rivalWins;
  if (typeof wins !== "number" || !Number.isSafeInteger(wins) || wins < 0) return null;
  let squad: PvpSquadMember[];
  try { squad = buildPlayerCombatants(profile, squadIds).map(squadMember); } catch { return null; }
  if (squad.length === 0 || squad.length > 3) return null;
  return { uid, tier: tierForWins(wins), callsign: callsignOf(uid, profile.username), squad };
}

// ---- selection --------------------------------------------------------------

/** Deterministic [0,1) stream from a string key (mulberry32 over sha256), so a day's list is stable per pilot. */
export function seededRandom(key: string): () => number {
  let a = parseInt(createHash("sha256").update(key).digest("hex").slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: readonly T[], random: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The rivalWins range [lo, hi] a band of `band` tiers around `tier` covers (the store's query bounds). */
export function winsRangeForBand(tier: number, band: number): { lo: number; hi: number } {
  const per = 10;
  return { lo: Math.max(0, (tier - band) * per), hi: (tier + band + 1) * per - 1 };
}

/** A seeded squad at the caller's tier (WOLF-scaled rival lineup), for slots no player fills. */
export function seededOpponent(callerTier: number, random: () => number): Omit<PvpOpponent, "opponentId" | "attemptsUsed" | "battleId" | "issuedAtMs"> {
  const lineup = buildRivalLineup(callerTier, random, RIVAL_LINEUP_SCALE_WOLF);
  const extra = rivalScaledCombatantStats(callerTier);
  const name = PVP_SEEDED_CALLSIGNS[Math.min(PVP_SEEDED_CALLSIGNS.length - 1, Math.floor(random() * PVP_SEEDED_CALLSIGNS.length))];
  return {
    kind: "seeded", sourceUid: null, callsign: name, tier: callerTier, tierLabel: getRivalTierRow(callerTier).label,
    squad: lineup.opponentSquad.map((c) => squadMember({ ...c, ...extra })),
  };
}

export function opponentIdFor(day: string, slot: number): string {
  return `po_${day.replace(/-/g, "")}_${slot}`;
}

/**
 * The day's three opponents. Order of preference: near band (|tier - callerTier| <= 1), then the wide band (<= 3),
 * then seeded squads. The caller and duplicate uids are excluded; within a band the pick is a shuffle seeded by
 * (uid, day). Pure: the same inputs give the same list.
 */
export function selectDailyOpponents(callerUid: string, callerTier: number, candidates: readonly PvpCandidate[], day: string): PvpOpponent[] {
  const random = seededRandom(`${PVP_DAILY_SCHEMA}|${callerUid}|${day}`);
  const seen = new Set<string>([callerUid]);
  const pool: PvpCandidate[] = [];
  for (const c of candidates) {
    if (!c || seen.has(c.uid) || c.squad.length === 0) continue;
    seen.add(c.uid); pool.push(c);
  }
  const dist = (c: PvpCandidate) => Math.abs(c.tier - callerTier);
  const near = shuffled(pool.filter((c) => dist(c) <= PVP_NEAR_TIER_BAND), random);
  const wide = shuffled(pool.filter((c) => dist(c) > PVP_NEAR_TIER_BAND && dist(c) <= PVP_WIDE_TIER_BAND), random);
  const picked = [...near, ...wide].slice(0, PVP_OPPONENTS_PER_DAY);
  const out: PvpOpponent[] = picked.map((c, slot) => ({
    opponentId: opponentIdFor(day, slot), kind: "player", sourceUid: c.uid, callsign: c.callsign, tier: c.tier,
    tierLabel: getRivalTierRow(c.tier).label, squad: c.squad.map((m) => structuredClone(m)), attemptsUsed: 0, battleId: null, issuedAtMs: null,
  }));
  const usedNames = new Set(out.map((o) => o.callsign));
  for (let slot = out.length; slot < PVP_OPPONENTS_PER_DAY; slot++) {
    let s = seededOpponent(callerTier, random);
    for (let k = 0; k < 4 && usedNames.has(s.callsign); k++) s = seededOpponent(callerTier, random);
    usedNames.add(s.callsign);
    out.push({ ...s, opponentId: opponentIdFor(day, slot), attemptsUsed: 0, battleId: null, issuedAtMs: null });
  }
  return out;
}

// ---- the daily doc ----------------------------------------------------------

/** Next 00:00 UTC after nowMs: the list's refresh time. */
export function nextRefreshAtMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Stored doc, or null when missing / malformed (the store then rebuilds it). */
export function readPvpDaily(raw: unknown): PvpDailyDoc | null {
  const d = raw as PvpDailyDoc | undefined;
  if (!d || d.schemaVersion !== PVP_DAILY_SCHEMA || typeof d.day !== "string" || !Array.isArray(d.opponents) || d.opponents.length !== PVP_OPPONENTS_PER_DAY) return null;
  for (const o of d.opponents) {
    if (!o || typeof o.opponentId !== "string" || !PVP_OPPONENT_ID.test(o.opponentId) || !Array.isArray(o.squad) || o.squad.length === 0) return null;
    if (!Number.isSafeInteger(o.attemptsUsed) || o.attemptsUsed < 0) return null;
  }
  return d;
}

/** True when the stored list is not today's (UTC): refresh. */
export function pvpDailyNeedsRefresh(doc: PvpDailyDoc | null, nowMs: number): boolean {
  return !doc || doc.day !== utcDay(nowMs);
}

export function buildPvpDaily(callerUid: string, callerTier: number, candidates: readonly PvpCandidate[], nowMs: number): PvpDailyDoc {
  const day = utcDay(nowMs);
  return { schemaVersion: PVP_DAILY_SCHEMA, day, refreshedAtMs: nowMs, callerTier, opponents: selectDailyOpponents(callerUid, callerTier, candidates, day) };
}

export type PvpResult = "won" | "lost" | "in_progress" | null;

export type PvpOpponentView = {
  opponentId: string;
  callsign: string;
  tier: number;
  tierLabel: string;
  squad: { holobotId: string; level: number }[];
  energyCost: number;
  attemptsLeft: number;
  result: PvpResult;
};

export type PvpDailyReply = {
  schemaVersion: typeof PVP_DAILY_SCHEMA;
  day: string;
  nowMs: number;
  refreshesAtMs: number;
  energyCost: number;
  attemptsPerOpponent: number;
  opponents: PvpOpponentView[];
};

/** The list reply. `results` maps battleId -> won/lost for settled battles (the store reads those records). Never leaks uids. */
export function pvpDailyView(doc: PvpDailyDoc, nowMs: number, results: Readonly<Record<string, boolean>> = {}): PvpDailyReply {
  return {
    schemaVersion: PVP_DAILY_SCHEMA, day: doc.day, nowMs, refreshesAtMs: nextRefreshAtMs(nowMs), energyCost: PVP_ENERGY_COST,
    attemptsPerOpponent: PVP_ATTEMPTS_PER_OPPONENT,
    opponents: doc.opponents.map((o) => ({
      opponentId: o.opponentId, callsign: o.callsign, tier: o.tier, tierLabel: o.tierLabel,
      squad: o.squad.map((m) => ({ holobotId: m.holobotId, level: m.level })), energyCost: PVP_ENERGY_COST,
      attemptsLeft: Math.max(0, PVP_ATTEMPTS_PER_OPPONENT - o.attemptsUsed),
      result: o.battleId === null ? null : o.battleId in results ? (results[o.battleId] ? "won" : "lost") : "in_progress",
    })),
  };
}

/**
 * The issue ruling for one opponent: the doc after spending the attempt, and the frozen lineup the rival issue fields.
 * list_expired when the stored list is not today's (the board reloads); no_attempts_left after the day's attempt.
 */
export function pvpIssue(doc: PvpDailyDoc | null, opponentId: string, battleId: string, nowMs: number): {
  doc: PvpDailyDoc; opponent: PvpOpponent; lineup: { opponentPilot: NpcPilotSnapshot; opponentSquad: PvpSquadMember[] };
} {
  if (!RIVAL_BATTLE_ID.test(battleId)) throw new PvpError("unavailable");
  if (!doc || pvpDailyNeedsRefresh(doc, nowMs)) throw new PvpError("list_expired");
  const index = doc.opponents.findIndex((o) => o.opponentId === opponentId);
  if (index < 0) throw new PvpError("unknown_opponent");
  const o = doc.opponents[index];
  if (o.attemptsUsed >= PVP_ATTEMPTS_PER_OPPONENT) throw new PvpError("no_attempts_left");
  const spent: PvpOpponent = { ...o, attemptsUsed: o.attemptsUsed + 1, battleId, issuedAtMs: nowMs };
  const opponents = doc.opponents.map((x, i) => (i === index ? spent : x));
  return {
    doc: { ...doc, opponents },
    opponent: spent,
    lineup: {
      opponentPilot: { pilotId: `pvp_${opponentId}`, displayName: o.callsign, tier: o.tierLabel },
      opponentSquad: o.squad.map((m) => structuredClone(m)),
    },
  };
}
