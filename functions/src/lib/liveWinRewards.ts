/**
 * early-progression-1 (Pak 2026-11-12): what a VERIFIED live win (Arena, rival, Guild Court) adds on top of the one battle table.
 *
 * 1. Win bonus back. The battle table's win multiplier 1 + 0.05 x perfectDefenses + 0.1 x combos (lib/battleSettlement.ts) was
 *    forced to 0 / 0 on the live paths. The counts now come from the host's own replay receipt (duel-receipt-2), never from the
 *    client, and the multiplier is capped at LIVE_WIN_BONUS_CAP (x2.0). The receipt has no field named "combos" or "perfect
 *    defenses"; both are read from its witness block (sim/fight/witness.ts), which the core computes from the hashed state stream
 *    of the replay the host itself ran, so the numbers are deterministic and identical on every replay of the same log:
 *      perfectDefenses = witness.sides[playerSide].perfectGuards  (CPU strikes the player perfect-guarded: Outcome.Perfect)
 *      combosCompleted = witness.sides[playerSide].counters       (player strikes that landed as COUNTER hits: a Hit or a
 *                                                                   GuardBreak into the CPU's telegraph / punish window)
 *    each clamped to 0..MAX_PERFORMANCE_EVENTS (25) like any report. Losses keep the 0.3 rule (no bonus).
 * 2. First win of the day. The account's first verified live win of each UTC day (whichever host settles it first) pays
 *    FIRST_WIN_OF_DAY_MULTIPLIER x EXP and x Holos, after the cap (so up to x2 x x2; the EXP Booster still doubles on top).
 *    Server-tracked in the server-only doc firstWinOfDay/{uid} (default-deny rules; deleteUserAccount removes it).
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { BATTLE_COMBO_BONUS, BATTLE_PERFECT_DEFENSE_BONUS, clampPerformanceCount } from "./battleSettlement";

export const LIVE_WIN_BONUS_CAP = 2;
export const FIRST_WIN_OF_DAY_MULTIPLIER = 2;
export const FIRST_WIN_SCHEMA = "first-win-1";
/** Server-only users' ledger collection: firstWinOfDay/{uid}. */
export const FIRST_WIN_COLLECTION = "firstWinOfDay";
export type FirstWinSource = "arena" | "rival" | "court";

export type LivePerformance = { perfectDefenses: number; combosCompleted: number };
/** The reply/settlement block that says how the win bonus was computed. */
export type LiveWinBonusWire = LivePerformance & { multiplier: number };
/**
 * The reply field `firstWinOfDay` (Arena, rival-battle-3, holozone-run-2 settle replies; present only on the settle that got the
 * bonus and on its replays). `day` is the UTC day it was spent on.
 */
export type FirstWinOfDayWire = { schemaVersion: typeof FIRST_WIN_SCHEMA; day: string; expMultiplier: number; holosMultiplier: number };

type WitnessLike = { sides?: Array<{ perfectGuards?: unknown; counters?: unknown }> };
type ReceiptLike = { playerSide?: unknown; witness?: WitnessLike };

/** The win-bonus counts a verified duel-receipt-2 stands for (header, item 1). */
export function livePerformanceFromReceipt(receipt: ReceiptLike): LivePerformance {
  const side = receipt.playerSide === 1 ? 1 : 0;
  const w = receipt.witness?.sides?.[side];
  return { perfectDefenses: clampPerformanceCount(w?.perfectGuards), combosCompleted: clampPerformanceCount(w?.counters) };
}

/** The capped win multiplier: min(1 + 0.05 x perfectDefenses + 0.1 x combos, cap). */
export function liveWinMultiplier(perf: LivePerformance, cap = LIVE_WIN_BONUS_CAP): number {
  const raw = 1 + clampPerformanceCount(perf.perfectDefenses) * BATTLE_PERFECT_DEFENSE_BONUS + clampPerformanceCount(perf.combosCompleted) * BATTLE_COMBO_BONUS;
  return Math.min(raw, cap);
}

export function liveWinBonusWire(perf: LivePerformance, cap = LIVE_WIN_BONUS_CAP): LiveWinBonusWire {
  return { perfectDefenses: clampPerformanceCount(perf.perfectDefenses), combosCompleted: clampPerformanceCount(perf.combosCompleted), multiplier: liveWinMultiplier(perf, cap) };
}

export const utcDayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * True when today's first live win is still unspent. A missing doc is unspent; a doc for an earlier day is unspent; a malformed
 * doc reads as spent (fail closed: no bonus, never a refusal).
 */
export function firstWinAvailable(raw: unknown, nowMs: number): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw !== "object" || Array.isArray(raw)) return false;
  const doc = raw as Record<string, unknown>;
  if (doc.schemaVersion !== FIRST_WIN_SCHEMA || typeof doc.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(doc.day)) return false;
  return doc.day < utcDayOf(nowMs);
}

/** The firstWinOfDay/{uid} document written by the settle that spends the day's bonus. */
export function firstWinRecord(source: FirstWinSource, battleId: string, nowMs: number) {
  return { schemaVersion: FIRST_WIN_SCHEMA, day: utcDayOf(nowMs), source, battleId, spentAtMs: nowMs };
}

export function firstWinWire(day: string): FirstWinOfDayWire {
  return { schemaVersion: FIRST_WIN_SCHEMA, day, expMultiplier: FIRST_WIN_OF_DAY_MULTIPLIER, holosMultiplier: FIRST_WIN_OF_DAY_MULTIPLIER };
}
