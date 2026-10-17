/** Host progress is distinct from the local boolean Story Mode cache. */
export type HostStoryFlags = Readonly<{
  arenaGatheringSeen: boolean;
  tournamentsWon: number;
  arenaArcBuilt: boolean;
  holoZonesArcBuilt: boolean;
}>;
export type DesktopStoryState = Readonly<{
  uid: string;
  schemaVersion: 'desktop-account-1' | 'desktop-account-2' | 'desktop-account-3';
  storyFlags: HostStoryFlags;
  pilotRank: number;
}>;
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid_reply');
  return raw as Record<string, unknown>;
}
export function readHostStoryFlags(raw: unknown): HostStoryFlags {
  const r = raw === undefined ? {} : record(raw);
  const flags = {
    arenaGatheringSeen: r.arenaGatheringSeen ?? false,
    tournamentsWon: r.tournamentsWon ?? 0,
    arenaArcBuilt: r.arenaArcBuilt ?? false,
    holoZonesArcBuilt: r.holoZonesArcBuilt ?? false,
  };
  if (Object.values(r).some(v => v === null) ||
      typeof flags.arenaGatheringSeen !== 'boolean' || typeof flags.arenaArcBuilt !== 'boolean' ||
      typeof flags.holoZonesArcBuilt !== 'boolean' || typeof flags.tournamentsWon !== 'number' ||
      !Number.isInteger(flags.tournamentsWon) || flags.tournamentsWon < 0 || flags.tournamentsWon > 3 ||
      flags.arenaArcBuilt !== (flags.tournamentsWon === 3)) throw new Error('invalid_reply');
  return Object.freeze(flags as HostStoryFlags);
}
export function readDesktopStoryState(raw: unknown, uid: string): DesktopStoryState {
  const r = record(raw);
  if (!uid || r.uid !== uid || typeof r.schemaVersion !== 'string' || !['desktop-account-1', 'desktop-account-2', 'desktop-account-3'].includes(r.schemaVersion)) {
    throw new Error('invalid_reply');
  }
  const pilotRank = r.pilotRank === undefined ? 0 : r.pilotRank;
  if (typeof pilotRank !== 'number' || !Number.isSafeInteger(pilotRank) || pilotRank < 0) throw new Error('invalid_reply');
  return Object.freeze({ uid, schemaVersion: r.schemaVersion as DesktopStoryState['schemaVersion'],
    storyFlags: readHostStoryFlags(r.storyFlags), pilotRank });
}
/** Only the structured host refusal carries an actionable remaining time. */
export function readRivalRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const d = details as Record<string, unknown>;
  return d.rejectionCode === 'rival_cooldown' && typeof d.retryAfterMs === 'number' &&
    Number.isSafeInteger(d.retryAfterMs) && d.retryAfterMs >= 0 ? d.retryAfterMs : null;
}
export function remainingCooldownMs(deadline: number | null, nowMs: number): number {
  return deadline === null ? 0 : Math.max(0, deadline - nowMs);
}
