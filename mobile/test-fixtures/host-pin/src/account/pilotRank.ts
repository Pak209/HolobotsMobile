/** Host-owned rival-win counter. Missing legacy records start at zero, not rivalWins. */
export class PilotRankError extends Error {
  constructor() { super('unavailable'); }
}

export function readPilotRank(raw: unknown): number {
  if (raw === undefined) return 0;
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) throw new PilotRankError();
  return raw;
}

export function pilotRankAfterWin(raw: unknown): number {
  const current = readPilotRank(raw);
  if (current === Number.MAX_SAFE_INTEGER) throw new PilotRankError();
  return current + 1;
}
