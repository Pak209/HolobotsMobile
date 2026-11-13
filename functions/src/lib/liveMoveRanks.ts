/**
 * live-move-ranks-1 (Pak 2026-11-11, Move Lab rework slice 1): the Move Lab upgrades the five LIVE duel moves, one slot per live
 * button: Jab (light), Heavy, Guard, Dash, Special. Ranks 0-3 at the old Sync Point costs (25 / 60 / 120).
 *
 * Route (Pak: "simple first"): a rank folds into the per-fighter numbers a live fight is ALREADY issued with (attack, defense,
 * special, step / jump distance). No new rules block, no rules-schema or hash-layout change, no change to sim/fight/rules.ts or
 * anything shared with the phone port / Unity. The issue pins the boosted numbers in the hashed snapshot like any other stat, so a
 * client replays them from `rules` and never needs this table to verify a fight. Per-move numbers (damage / cost of ONE move)
 * need a per-fighter move block (duel-rules-8) and come later.
 *
 * Storage: users/{uid}.holobots[i].liveMoves = { schemaVersion: 'live-moves-1', ranks: {jab,heavy,guard,dash,special},
 * carryOver: {spentSp, carriedSp, refundSp} }, plus moveSystemVersion 2. The old moveProgress / combatKit stay in place, read-only
 * (the plan-and-send fallback still reads them). The server is the source of truth: a fight reads ranks from the stored profile,
 * never from a request.
 *
 * Pure module: no firebase imports, safe to import from tests.
 */
import { buildMoveUpgradeUpdatesRaw, getMoveCategory, MOVE_RANK_SP_COSTS, MoveCategory, MoveRank } from "./moveProgression";
import { toHolobotKey } from "./mintingEconomy";

export const LIVE_MOVES_SCHEMA = "live-moves-1";
export const LIVE_MOVE_SYSTEM_VERSION = 2;

/** The five live buttons, in control order. */
export const LIVE_MOVE_SLOTS = ["jab", "heavy", "guard", "dash", "special"] as const;
export type LiveMoveSlot = (typeof LIVE_MOVE_SLOTS)[number];
export type LiveMoveRanks = Record<LiveMoveSlot, MoveRank>;

export const LIVE_MOVE_MAX_RANK = 3;
/** Same SP prices as the old card ranks (Pak: "ranks 0-3 at today's costs"): rank 1 25, rank 2 60, rank 3 120 = 205 a slot. */
export const LIVE_MOVE_RANK_SP_COSTS: Readonly<Record<1 | 2 | 3, number>> = MOVE_RANK_SP_COSTS;

/** What a rank r cost in total (0, 25, 85, 205). Anything that is not a whole rank 0..3 counts as 0 (never sold). */
export function cumulativeRankCost(rank: unknown): number {
  const r = validRank(rank);
  let total = 0;
  for (let k = 1; k <= r; k++) total += LIVE_MOVE_RANK_SP_COSTS[k as 1 | 2 | 3];
  return total;
}

function validRank(v: unknown): MoveRank {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= LIVE_MOVE_MAX_RANK ? (v as MoveRank) : 0;
}

export function zeroLiveMoveRanks(): LiveMoveRanks {
  return { jab: 0, heavy: 0, guard: 0, dash: 0, special: 0 };
}

/** Stored / requested ranks -> a clean rank row. Strict: anything but a whole number 0..3 is 0 (crafted data cannot lift a cap). */
export function normalizeLiveMoveRanks(raw: unknown): LiveMoveRanks {
  const out = zeroLiveMoveRanks();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const slot of LIVE_MOVE_SLOTS) out[slot] = validRank((raw as Record<string, unknown>)[slot]);
  return out;
}

// ---------------------------------------------------------------- modifiers (the per-fighter fold-in)

/**
 * Per-mille boosts on the issued player fighter. 0 everywhere = the fighter exactly as issued today.
 * - attackPm: added to the fighter's `attack` (every hit's damage is attack x scale x 100 / (100 + defender defense)).
 * - defensePm: added to `defense` (damage taken is x (100 + D) / (100 + D'), so it cuts damage taken by at most defensePm).
 * - specialPm: added to `special` (duel-rules-5+ only: the pair-relative SYNC-gain and Special-damage edge, rules.syncMul /
 *   specialDmgMul; at equal SPECIAL a +s boost moves both by 2s/(2+s) < s).
 * - stepPm: added to backstepMm / sidestepMm / forwardJumpMm (same ticks, so the step covers more ground: a longer, faster
 *   dodge and gap-close). Not a damage number.
 */
export type LiveMoveModifiers = { attackPm: number; defensePm: number; specialPm: number; stepPm: number };

/**
 * Per-rank numbers (per-mille per rank; rank 3 in brackets). Sized so that a fully ranked bot's TOTAL damage edge on ANY hit,
 * light / heavy / charge / Special, is at most +9 % (Pak's cap), counting attack x damage-taken x Special together:
 *   1.042 x 1.021 x 1.024 = 1.0894 (+8.9 %).
 * - JAB:     attack +0.7 % a rank [+2.1 %]  (Jab and Heavy share `attack` until per-move numbers exist)
 * - HEAVY:   attack +0.7 % a rank [+2.1 %]
 * - GUARD:   defense +0.7 % a rank [+2.1 %] (damage taken -2.1 % at most; about -0.7 % to -1.5 % at real defense values)
 * - DASH:    step / jump distance +5 % a rank [+15 %] (no damage)
 * - SPECIAL: special +0.8 % a rank [+2.4 %] (SYNC gain and Special damage each up to about +2.4 % vs an equal SPECIAL)
 * Win-rate evidence: scripts/bench-live-move-ranks.mjs (full ranks vs the same bot at rank 0, mirror matches).
 * The +9 % holds for these per-mille numbers; the issued fields also get at least +1 per slot that has any rank (liveMoveMinGain /
 * boostStat, Pak 2026-11-11 "at least +1 per slot"): attack at most +2 (Jab, Heavy), defense +1, special +1. That floor can still
 * nudge the stat product past +9 % at very low stats (it binds while attack <= 47, defense <= 47, special <= 41 at full ranks).
 */
export const LIVE_MOVE_PER_RANK_PM: Readonly<Record<LiveMoveSlot, Partial<LiveMoveModifiers>>> = Object.freeze({
  jab: { attackPm: 7 },
  heavy: { attackPm: 7 },
  guard: { defensePm: 7 },
  dash: { stepPm: 50 },
  special: { specialPm: 8 },
});

/** Pak 2026-11-11: total damage edge at most +9 %. Enforced on the product (1000+atk)(1000+def)(1000+spc) <= 1090 x 10^6. */
export const LIVE_MOVE_MAX_DAMAGE_EDGE_PM = 90;
/** Dash cap: step / jump distance at most +15 %. */
export const LIVE_MOVE_MAX_STEP_PM = 150;

/** The cap, applied to any modifier row: trims attack first, then special, then defense, until the product fits. */
export function capDamageEdge(m: LiveMoveModifiers): LiveMoveModifiers {
  const limit = (1000 + LIVE_MOVE_MAX_DAMAGE_EDGE_PM) * 1e6;
  const out = { ...m, stepPm: Math.min(Math.max(0, m.stepPm), LIVE_MOVE_MAX_STEP_PM) };
  const prod = () => (1000 + out.attackPm) * (1000 + out.defensePm) * (1000 + out.specialPm);
  for (const k of ["attackPm", "specialPm", "defensePm"] as const) {
    out[k] = Math.max(0, out[k]);
    while (prod() > limit && out[k] > 0) out[k]--;
  }
  return out;
}

/** ranks -> capped modifiers. Ranks are normalized first, so any stored or crafted row stays inside the caps. */
export function liveMoveModifiers(ranks: unknown): LiveMoveModifiers {
  const r = normalizeLiveMoveRanks(ranks);
  const m: LiveMoveModifiers = { attackPm: 0, defensePm: 0, specialPm: 0, stepPm: 0 };
  for (const slot of LIVE_MOVE_SLOTS) {
    const per = LIVE_MOVE_PER_RANK_PM[slot];
    for (const k of Object.keys(per) as (keyof LiveMoveModifiers)[]) m[k] += (per[k] ?? 0) * r[slot];
  }
  return capDamageEdge(m);
}

export function isIdentityModifiers(m: LiveMoveModifiers): boolean {
  return m.attackPm === 0 && m.defensePm === 0 && m.specialPm === 0 && m.stepPm === 0;
}

/** v x (1000 + pm) / 1000, floored (an integer fighter field; never above the capped boost). pm 0 returns v unchanged. */
export function scalePm(v: number, pm: number): number {
  return pm === 0 ? v : Math.floor((v * (1000 + pm)) / 1000);
}

/**
 * live-move-ranks-1 "no dead slot" (Pak 2026-11-11 ruling "at least +1 per slot"): once a slot has ANY rank (1, 2 or 3), that slot
 * adds at least +1 to the field it boosts; ranks 2 and 3 do not each force another +1 (they add only their per-mille share). The
 * minimum whole-number gain of each fighter field = the number of slots feeding it that have a rank: attack <- jab, heavy (0..2),
 * defense <- guard (0..1), special <- special (0..1), step distances <- dash (0..1 mm; a dash rank is +5 % of >= 358 mm, so this
 * floor never binds for a real kit). A special of 0 with a Special rank becomes 1 (the slot's +1, nothing more).
 * At very low stats this floor can still push the attack x defense x special product a little past the +9 % cap (capDamageEdge
 * caps the per-mille part only): the floor wins, by the owner's ruling.
 */
export type LiveMoveMinGain = { attack: number; defense: number; special: number; step: number };

export function liveMoveMinGain(ranks: unknown): LiveMoveMinGain {
  const r = normalizeLiveMoveRanks(ranks);
  const on = (rank: MoveRank) => (rank > 0 ? 1 : 0);
  return { attack: on(r.jab) + on(r.heavy), defense: on(r.guard), special: on(r.special), step: on(r.dash) };
}

/** v + max(floor(v x pm / 1000), minGain), integer and deterministic. pm 0 and minGain 0 return v unchanged (scalePm). */
export function boostStat(v: number, pm: number, minGain: number): number {
  const scaled = scalePm(v, pm);
  return minGain > 0 ? Math.max(scaled, Math.floor(v) + minGain) : scaled;
}

// ---------------------------------------------------------------- carry-over from the old card ranks

/** Old card category -> live slot (Pak's mapping; also the plan's B1 table): STRIKE->Jab, COMBO->Heavy, DEFEND->Guard, FINISHER->
 * Special. Dash is new and starts at 0. */
export const LEGACY_CATEGORY_TO_SLOT: Readonly<Record<MoveCategory, LiveMoveSlot>> = Object.freeze({
  strike: "jab", combo: "heavy", defense: "guard", finisher: "special",
});

export type CarryOver = { ranks: LiveMoveRanks; spentSp: number; carriedSp: number; refundSp: number };

/**
 * The live ranks a Holobot's old moveProgress carries: each slot takes the HIGHEST rank among that Holobot's old cards of the
 * matching category. spentSp = what every old card rank cost; carriedSp = what the carried live ranks cost at the same prices;
 * refundSp = spentSp - carriedSp (always >= 0: a slot's rank is one of the ranks that was paid for). Rows with no category or a
 * rank that was never sold (not a whole 0..3) carry nothing; a valid paid rank with no category is refunded in full.
 */
export function carryOverFromLegacy(moveProgress: unknown): CarryOver {
  const ranks = zeroLiveMoveRanks();
  let spentSp = 0;
  if (moveProgress && typeof moveProgress === "object" && !Array.isArray(moveProgress)) {
    for (const [templateId, row] of Object.entries(moveProgress as Record<string, unknown>)) {
      const rank = validRank(row && typeof row === "object" ? (row as { rank?: unknown }).rank : undefined);
      spentSp += cumulativeRankCost(rank);
      const category = getMoveCategory(templateId);
      if (!category) continue;
      const slot = LEGACY_CATEGORY_TO_SLOT[category];
      if (rank > ranks[slot]) ranks[slot] = rank;
    }
  }
  const carriedSp = LIVE_MOVE_SLOTS.reduce((t, s) => t + cumulativeRankCost(ranks[s]), 0);
  return { ranks, spentSp, carriedSp, refundSp: spentSp - carriedSp };
}

type RawHolobot = Record<string, unknown> & { name?: unknown; liveMoves?: unknown; moveProgress?: unknown };
export type StoredLiveMoves = { schemaVersion: typeof LIVE_MOVES_SCHEMA; ranks: LiveMoveRanks; carryOver: Omit<CarryOver, "ranks"> };

const holobotsOf = (userData: Record<string, unknown>): RawHolobot[] =>
  Array.isArray(userData.holobots) ? (userData.holobots as RawHolobot[]) : [];

function indexByName(holobots: RawHolobot[], name: string): number {
  const key = name.trim().toUpperCase();
  return holobots.findIndex((h) => h && typeof h === "object" && String(h.name ?? "").trim().toUpperCase() === key);
}

/** A Holobot is on live moves once it carries a `liveMoves` key (whatever its content): it is never migrated / refunded again. */
const isMigrated = (h: RawHolobot) => Object.prototype.hasOwnProperty.call(h, "liveMoves");

/** The ranks a fight uses for one stored Holobot: its stored liveMoves.ranks, else (not migrated yet) the carried ranks. */
export function liveMoveRanksOf(holobot: unknown): LiveMoveRanks {
  if (!holobot || typeof holobot !== "object") return zeroLiveMoveRanks();
  const h = holobot as RawHolobot;
  if (isMigrated(h)) {
    const lm = h.liveMoves;
    return normalizeLiveMoveRanks(lm && typeof lm === "object" ? (lm as { ranks?: unknown }).ranks : undefined);
  }
  return carryOverFromLegacy(h.moveProgress).ranks;
}

/** The ranks for holobotId (a roster key, e.g. 'ace') from a stored profile; all 0 when the Holobot is not there. */
export function liveMoveRanksFor(profile: Record<string, unknown>, holobotId: string): LiveMoveRanks {
  const record = holobotsOf(profile ?? {}).find((h) => h && typeof h === "object" && typeof h.name === "string" && toHolobotKey(h.name) === holobotId);
  return liveMoveRanksOf(record);
}

/**
 * The STORED ranks only (no legacy carry-over): a Holobot without a `liveMoves` key reads as rank 0. Not used by any fight now:
 * expeditions carry old card ranks like every other fight (Pak 2026-11-11 "Count straight away").
 */
export function storedLiveMoveRanksFor(profile: Record<string, unknown>, holobotId: string): LiveMoveRanks {
  const record = holobotsOf(profile ?? {}).find((h) => h && typeof h === "object" && typeof h.name === "string" && toHolobotKey(h.name) === holobotId);
  return record && isMigrated(record) ? liveMoveRanksOf(record) : zeroLiveMoveRanks();
}

export type MigrationResult = {
  migrated: boolean; refundSp: number; liveMoves: StoredLiveMoves | null;
  updates: { holobots: RawHolobot[]; syncPoints: number } | null;
};

/**
 * Lazy, idempotent migration of ONE Holobot onto live moves: writes liveMoves (the carried ranks + the carry-over receipt) and
 * moveSystemVersion 2, and adds refundSp to syncPoints ONCE. A Holobot that already has `liveMoves` returns updates null.
 * moveProgress / combatKit are kept as they are.
 */
export function migrateHolobotLiveMoves(userData: Record<string, unknown>, holobotName: string): MigrationResult {
  const holobots = holobotsOf(userData);
  const index = indexByName(holobots, holobotName);
  if (index < 0) throw new Error("You do not own that Holobot.");
  const holobot = holobots[index];
  if (isMigrated(holobot)) {
    return { migrated: false, refundSp: 0, liveMoves: storedLiveMoves(holobot), updates: null };
  }
  const c = carryOverFromLegacy(holobot.moveProgress);
  const liveMoves: StoredLiveMoves = {
    schemaVersion: LIVE_MOVES_SCHEMA, ranks: c.ranks, carryOver: { spentSp: c.spentSp, carriedSp: c.carriedSp, refundSp: c.refundSp },
  };
  const next = [...holobots];
  next[index] = { ...holobot, liveMoves, moveSystemVersion: LIVE_MOVE_SYSTEM_VERSION };
  return { migrated: true, refundSp: c.refundSp, liveMoves, updates: { holobots: next, syncPoints: balanceOf(userData) + c.refundSp } };
}

function storedLiveMoves(h: RawHolobot): StoredLiveMoves {
  const lm = (h.liveMoves && typeof h.liveMoves === "object" ? h.liveMoves : {}) as { carryOver?: Record<string, unknown> };
  const co = lm.carryOver ?? {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { schemaVersion: LIVE_MOVES_SCHEMA, ranks: liveMoveRanksOf(h), carryOver: { spentSp: n(co.spentSp), carriedSp: n(co.carriedSp), refundSp: n(co.refundSp) } };
}

const balanceOf = (userData: Record<string, unknown>) => Math.max(0, Number(userData.syncPoints) || 0);

// ---------------------------------------------------------------- the upgrade request (callable upgradeHolobotMove)

export type LiveMoveUpgradeRequest = {
  holobotName?: unknown; liveMoveSlot?: unknown; expectedRank?: unknown; migrate?: unknown;
  moveTemplateId?: unknown; branchId?: unknown;
};

export type LiveUpgradeResponse = {
  form: "live"; slot: LiveMoveSlot; cost: number; nextRank: MoveRank; refundSp: number; syncPoints: number;
  liveMoves: StoredLiveMoves; modifiers: LiveMoveModifiers;
};
export type MigrateResponse = { form: "migrate"; refundSp: number; syncPoints: number; liveMoves: StoredLiveMoves; modifiers: LiveMoveModifiers };
export type LegacyUpgradeResponse = { cost: number; nextRank: number; syncPoints: number };

/**
 * One upgradeHolobotMove request against the stored user doc. Three forms:
 * - live:    { holobotName, liveMoveSlot, expectedRank } -> migrate the Holobot if needed (refund once), then buy rank+1 of the slot.
 * - migrate: { holobotName, migrate: true }              -> migrate only (the phone calls it when the Move Lab opens).
 * - legacy:  { holobotName, moveTemplateId, expectedRank, branchId? } -> the old card upgrade, unchanged, but refused for a
 *            Holobot already on live moves (its card ranks no longer reach anything, so the SP would be lost).
 * Returns `updates` to merge into users/{uid} (null = nothing to write). Throws plain Errors (the callable maps them).
 */
export function transactMoveUpgrade(userData: Record<string, unknown>, req: LiveMoveUpgradeRequest): {
  response: LiveUpgradeResponse | MigrateResponse | LegacyUpgradeResponse; updates: Record<string, unknown> | null;
} {
  const holobotName = typeof req.holobotName === "string" ? req.holobotName : "";
  if (!holobotName.trim()) throw new Error("A holobot name is required.");

  if (req.liveMoveSlot === undefined && req.migrate === true) {
    const m = migrateHolobotLiveMoves(userData, holobotName);
    const liveMoves = m.liveMoves as StoredLiveMoves;
    return {
      response: { form: "migrate", refundSp: m.refundSp, syncPoints: m.updates ? m.updates.syncPoints : balanceOf(userData), liveMoves, modifiers: liveMoveModifiers(liveMoves.ranks) },
      updates: m.updates,
    };
  }

  if (req.liveMoveSlot !== undefined) {
    const slot = req.liveMoveSlot as LiveMoveSlot;
    if (typeof req.liveMoveSlot !== "string" || !(LIVE_MOVE_SLOTS as readonly string[]).includes(slot)) {
      throw new Error("That is not a live move slot.");
    }
    const expectedRank = req.expectedRank;
    if (typeof expectedRank !== "number" || !Number.isInteger(expectedRank)) throw new Error("The current rank is required.");
    const m = migrateHolobotLiveMoves(userData, holobotName);
    const doc = m.updates ? { ...userData, ...m.updates } : userData;
    const holobots = holobotsOf(doc);
    const index = indexByName(holobots, holobotName);
    const current = storedLiveMoves(holobots[index]);
    const rank = current.ranks[slot];
    if (rank !== expectedRank) throw new Error("Move rank changed elsewhere. Reload and try again.");
    if (rank >= LIVE_MOVE_MAX_RANK) throw new Error("That move is already at max rank.");
    const nextRank = (rank + 1) as MoveRank;
    const cost = LIVE_MOVE_RANK_SP_COSTS[nextRank as 1 | 2 | 3];
    const balance = balanceOf(doc);
    if (balance < cost) throw new Error(`Not enough Sync Points (need ${cost}).`);
    const liveMoves: StoredLiveMoves = { ...current, ranks: { ...current.ranks, [slot]: nextRank } };
    const next = [...holobots];
    next[index] = { ...holobots[index], liveMoves, moveSystemVersion: LIVE_MOVE_SYSTEM_VERSION };
    const syncPoints = balance - cost;
    return {
      response: { form: "live", slot, cost, nextRank, refundSp: m.refundSp, syncPoints, liveMoves, modifiers: liveMoveModifiers(liveMoves.ranks) },
      updates: { holobots: next, syncPoints },
    };
  }

  const moveTemplateId = typeof req.moveTemplateId === "string" ? req.moveTemplateId : "";
  const expectedRank = Number(req.expectedRank);
  if (!moveTemplateId.trim() || !Number.isInteger(expectedRank)) {
    throw new Error("A holobot name, move id, and current rank are required.");
  }
  const holobots = holobotsOf(userData);
  const index = indexByName(holobots, holobotName);
  if (index >= 0 && isMigrated(holobots[index])) {
    throw new Error("This Holobot's Move Lab now upgrades live moves. Update the app and try again.");
  }
  const result = buildMoveUpgradeUpdatesRaw(userData, holobotName, moveTemplateId, expectedRank,
    typeof req.branchId === "string" ? req.branchId : undefined);
  return {
    response: { cost: result.cost, nextRank: result.nextRank, syncPoints: Number(result.updates.syncPoints) },
    updates: result.updates as unknown as Record<string, unknown>,
  };
}
