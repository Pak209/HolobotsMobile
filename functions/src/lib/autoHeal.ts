/**
 * auto-heal-1 (Pak 2026-11-12: "6 hours, gradually"). A damaged Holobot regenerates HP over time and is back to full
 * AUTO_HEAL_FULL_MS after 0 HP. Lazy: nothing ticks on the server. Each users/{uid}.holobotVitals row may carry
 * `hpUpdatedAt` (server ms, the moment `currentHealth` was last set) and every gameplay read works out the effective HP:
 *
 *   effective = min(max, stored + floor(max * max(0, now - hpUpdatedAt) / AUTO_HEAL_FULL_MS))
 *
 * - A row with no (finite) hpUpdatedAt counts as full (rows written before auto-heal, and every full row, which is written
 *   without a stamp so full-HP fight issue bytes stay what they were).
 * - The server clock only: callers pass their own `now` (the callable's Date.now() or a test's fixed time), never client time.
 * - A clock that runs backwards (now < hpUpdatedAt) is clamped to no regen, never negative.
 * - Writes go through commitVitals: a row whose HP changed is stamped `now`; a row that only carries the regen (or is
 *   untouched) keeps its stored value and stamp, so repeated writes never lose the fractional regen.
 * Patch / Kit / Full Restore still heal faster: repairUse applies the item on top of the effective HP.
 */
export const AUTO_HEAL_FULL_MS = 6 * 60 * 60 * 1000;

export type VitalsRow = { currentHealth: number; maxHealth: number; hpUpdatedAt?: number };
export type PlainVitals = Record<string, { currentHealth: number; maxHealth: number }>;

const stampOf = (row: { hpUpdatedAt?: unknown }): number | null =>
  typeof row.hpUpdatedAt === "number" && Number.isFinite(row.hpUpdatedAt) ? row.hpUpdatedAt : null;

/** The HP this row has at `nowMs` (server ms). */
export function effectiveHealth(row: VitalsRow, nowMs: number): number {
  const max = row.maxHealth, stamp = stampOf(row);
  if (stamp === null || !(row.currentHealth < max)) return max;
  const elapsed = Number.isFinite(nowMs) ? Math.max(0, nowMs - stamp) : 0;
  return Math.min(max, row.currentHealth + Math.floor((max * elapsed) / AUTO_HEAL_FULL_MS));
}

/** When the row reaches max HP by regen alone (server ms), or null when it is full at `nowMs`. */
export function fullAtMs(row: VitalsRow, nowMs: number): number | null {
  if (effectiveHealth(row, nowMs) >= row.maxHealth) return null;
  const stamp = stampOf(row)!;
  // floor(max*e/F) >= n  <=>  max*e/F >= n for whole n: the first whole ms with that many points regenerated.
  const points = Math.ceil(row.maxHealth - row.currentHealth);
  return stamp + Math.ceil((points * AUTO_HEAL_FULL_MS) / row.maxHealth);
}

/** The effective row with no stamp: { currentHealth, maxHealth } at `nowMs`. */
export function effectiveRow(row: VitalsRow, nowMs: number): { currentHealth: number; maxHealth: number } {
  return { currentHealth: effectiveHealth(row, nowMs), maxHealth: row.maxHealth };
}

/** Every row's effective value at `nowMs` (plain rows, no stamps). Malformed rows are copied as-is for the caller's own check. */
export function effectiveVitals(raw: unknown, nowMs: number): PlainVitals {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: PlainVitals = {};
  for (const [id, v] of Object.entries(raw as Record<string, VitalsRow>)) {
    out[id] = v && typeof v === "object" && typeof v.currentHealth === "number" && typeof v.maxHealth === "number"
      ? effectiveRow(v, nowMs) : (v as PlainVitals[string]);
  }
  return out;
}

/** The read-API row: effective HP, max and when regen finishes (null when full). */
export function autoHealStatus(row: VitalsRow, nowMs: number): { currentHealth: number; maxHealth: number; fullAtMs: number | null } {
  return { ...effectiveRow(row, nowMs), fullAtMs: fullAtMs(row, nowMs) };
}

/**
 * The ledger to WRITE. `next` holds the rows the caller wants (plain effective rows, stored rows spread back, or a mix);
 * `storedRaw` is the ledger as read in this transaction. Per row:
 * - identical to the stored row (value and stamp), or a damaged row equal to the stored row's effective value at `nowMs` ->
 *   the stored row is kept as it was (regen keeps counting from its own stamp, nothing is rounded away);
 * - a row regenerated to full is written as a plain full row (the stamp is dropped);
 * - otherwise the HP changed now: full rows are written without a stamp, damaged rows with hpUpdatedAt = nowMs.
 */
export function commitVitals(storedRaw: unknown, next: Record<string, VitalsRow>, nowMs: number): Record<string, VitalsRow> {
  const stored = storedRaw && typeof storedRaw === "object" && !Array.isArray(storedRaw) ? (storedRaw as Record<string, VitalsRow>) : {};
  const out: Record<string, VitalsRow> = {};
  for (const [id, row] of Object.entries(next)) {
    const prev = Object.hasOwn(stored, id) ? stored[id] : undefined;
    if (prev && typeof prev === "object" && prev.maxHealth === row.maxHealth) {
      const same = prev.currentHealth === row.currentHealth && stampOf(prev) === stampOf(row);
      const regenOnly = row.currentHealth < row.maxHealth && stampOf(prev) !== null && effectiveHealth(prev, nowMs) === row.currentHealth;
      if (same || regenOnly) { out[id] = prev; continue; }
    }
    const { hpUpdatedAt: _old, ...plain } = row;
    void _old;
    out[id] = plain.currentHealth < plain.maxHealth ? { ...plain, hpUpdatedAt: nowMs } : plain;
  }
  return out;
}

/** Drops the stamp (for copies kept on battle / run records, which stay in their deployed {currentHealth, maxHealth} shape). */
export function plainRow(row: VitalsRow): { currentHealth: number; maxHealth: number } {
  return { currentHealth: row.currentHealth, maxHealth: row.maxHealth };
}

/**
 * ko-return-25 (Pak 2026-11-12): a Holobot whose EFFECTIVE HP is below this fraction of max is not admitted to a fight
 * (rival, Arena, Guild Court, expedition). It replaces the old "HP > 0" gate and the 40 % KO fallback at issue.
 */
export const KO_RETURN_FRACTION = 0.25;

/** True when the row's effective HP at `nowMs` is at least KO_RETURN_FRACTION of max. */
export function fightReady(row: VitalsRow, nowMs: number): boolean {
  return effectiveHealth(row, nowMs) >= row.maxHealth * KO_RETURN_FRACTION;
}

/** When regen alone makes the row fight-ready (server ms), or null when it already is. */
export function readyAtMs(row: VitalsRow, nowMs: number): number | null {
  if (fightReady(row, nowMs)) return null;
  const stamp = stampOf(row)!;
  const points = Math.ceil(row.maxHealth * KO_RETURN_FRACTION - row.currentHealth);
  return stamp + Math.ceil((points * AUTO_HEAL_FULL_MS) / row.maxHealth);
}

/** "1h 22m" / "45m" / "under 1m": minutes rounded up (the same words as the phone). */
export function waitWords(ms: number): string {
  const minutes = Math.ceil(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under 1m";
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/** The callable details of a holobot_ko refusal: who, the HP now, when it can fight again, when it is full, and the line. */
export function koRefusalDetail(holobotId: string, row: VitalsRow, nowMs: number): Record<string, unknown> {
  const at = readyAtMs(row, nowMs) ?? nowMs, full = fullAtMs(row, nowMs);
  const readyInMs = Math.max(0, at - nowMs);
  return { holobotId, currentHealth: effectiveHealth(row, nowMs), maxHealth: row.maxHealth, minHealthFraction: KO_RETURN_FRACTION,
    readyAtMs: at, readyInMs, fullAtMs: full, fullInMs: full === null ? null : Math.max(0, full - nowMs),
    message: `${holobotId.toUpperCase()} is still repairing. Ready to fight in ${waitWords(readyInMs)}.` };
}
