/** Compatibility seam shared with pending healing PRs. An expired open lease still owns HP. */
export class ActivityError extends Error {
  constructor(public code = 'unavailable') { super(code); }
}
export function arenaOpen(raw: unknown): boolean {
  if (raw === undefined) return false;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ActivityError();
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 'arena-healing-1' || typeof r.matchId !== 'string' || !r.matchId || typeof r.open !== 'boolean') throw new ActivityError();
  return r.open;
}
