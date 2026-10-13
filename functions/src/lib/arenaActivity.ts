import {RepairError} from './repairItems';
/**
 * The ONE activity-guard module (PR #78 merge, rule 1). `healingGuards.ts` re-exports it.
 * An expired open lease still owns HP. ActivityError extends RepairError so healing callers
 * (which map RepairError) and Arena/rival/zone callers (which map ActivityError) both fail closed.
 */
export class ActivityError extends RepairError {
  constructor(code = 'unavailable') { super(code); }
}
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ActivityError();
  return raw as Record<string, unknown>;
}
/** Absence = no host-recorded arena. Any malformed existing record fails closed. */
export function arenaOpen(raw: unknown): boolean {
  if (raw === undefined) return false;
  const r = record(raw);
  if (r.schemaVersion !== 'arena-healing-1' || typeof r.matchId !== 'string' || !r.matchId || typeof r.open !== 'boolean') throw new ActivityError();
  return r.open;
}
export function duelOpen(raw: unknown): boolean {
  if (raw === undefined) return false;
  const r = record(raw);
  if (r.schemaVersion !== 'duel-healing-1' || typeof r.runId !== 'string' || typeof r.open !== 'boolean') throw new ActivityError();
  return r.open;
}
/** The account-parent lease read shared by rival / zone issue: which activity (if any) holds HP. */
export function leaseHolder(arenaRaw: unknown, duelRaw: unknown): 'arena' | 'duel' | null {
  if (arenaOpen(arenaRaw)) return 'arena';
  if (duelOpen(duelRaw)) return 'duel';
  return null;
}
