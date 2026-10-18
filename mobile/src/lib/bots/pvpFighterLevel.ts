import { levelBadge } from './hostFighterLevel';
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const own = (o: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(o, key);
export const PVP_ROOM_FIGHTERS_SCHEMA = 'pvp-room-fighters-1';
export type PvpSeatRole = 'p1' | 'p2';
/** Same key the host derives from a seat's holobotName (toHolobotKey). */
export function pvpHolobotId(holobotName: string): string { return holobotName.trim().toLowerCase().replace(/\s+/g, '-'); }

/** What the client keeps from pvpRoomFighterHost replies: both seats, merged across seat/read calls for ONE room. */
export type PvpHostView = { schemaVersion: typeof PVP_ROOM_FIGHTERS_SCHEMA; roomId: string; seats: Partial<Record<PvpSeatRole, { uid: string; fighters: Record<string, unknown> }>> };

/**
 * Folds one host reply into the view. Only a pvp-room-fighters-1 seat/read reply for this exact room is taken;
 * anything else leaves the view as it was. Snapshots are frozen host-side, so fighters for the same seat uid are
 * unioned; a different uid for a seat replaces it. Per-fighter strictness is left to pvpFighterLevel.
 */
export function mergePvpHostReply(view: PvpHostView | null, reply: unknown, roomId: string): PvpHostView | null {
  const r = record(reply), seats = record(r.seats);
  if (r.schemaVersion !== PVP_ROOM_FIGHTERS_SCHEMA || (r.operation !== 'seat' && r.operation !== 'read') || r.roomId !== roomId
    || (r.role !== 'p1' && r.role !== 'p2') || r.seats === null || typeof r.seats !== 'object' || Array.isArray(r.seats)) return view;
  const base: PvpHostView = view && view.roomId === roomId ? view : { schemaVersion: PVP_ROOM_FIGHTERS_SCHEMA, roomId, seats: {} };
  const next: PvpHostView = { ...base, seats: { ...base.seats } };
  for (const role of ['p1', 'p2'] as const) {
    if (!own(seats, role)) continue;
    const seat = record(seats[role]);
    if (typeof seat.uid !== 'string' || !seat.uid || seat.fighters === null || typeof seat.fighters !== 'object' || Array.isArray(seat.fighters)) continue;
    const prior = next.seats[role];
    next.seats[role] = { uid: seat.uid, fighters: { ...(prior && prior.uid === seat.uid ? prior.fighters : {}), ...(seat.fighters as Record<string, unknown>) } };
  }
  return next;
}

/** Read a pvp-room-fighters-1 level ONLY from the host's reply view, for the exact room, seat, the uid now in that
 * room seat and the displayed bot. The room's client-authored `players.*.level` and the local profile are
 * deliberately not sources: there is no fallback.
 */
export function pvpFighterLevel(view: unknown, room: unknown, role: PvpSeatRole, holobotName: string | null | undefined): number | undefined {
  if (typeof holobotName !== 'string' || !holobotName.trim()) return undefined;
  const id = pvpHolobotId(holobotName);
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(id)) return undefined;
  const v = record(view), r = record(room), seat = record(record(v.seats)[role]), fighters = record(seat.fighters);
  const seatedUid = record(record(r.players)[role]).uid;
  if (v.schemaVersion !== PVP_ROOM_FIGHTERS_SCHEMA || typeof v.roomId !== 'string' || v.roomId !== r.roomId
    || typeof seat.uid !== 'string' || !seat.uid || seat.uid !== seatedUid || !own(fighters, id)) return undefined;
  const fighter = record(fighters[id]);
  if (Object.keys(fighter).length !== 4 || fighter.holobotId !== id || fighter.displayName !== id.toUpperCase()
    || typeof fighter.tier !== 'number' || !Number.isSafeInteger(fighter.tier) || fighter.tier < 0 || fighter.tier > 1000000
    || levelBadge(fighter.level) === null) return undefined;
  return fighter.level as number;
}

/** My seat's host call: idle (no room), pending (asked), ready (host answered), unavailable (not deployed / refused / offline). */
export type PvpHostFighterStatus = 'idle' | 'pending' | 'ready' | 'unavailable';
export type PvpSeatBadge = { kind: 'host' | 'pending' | 'absent'; text: string; accessibilityLabel: string };

/** The only PvP level a card may print. Host value, or an honest pending/absent state; never a local level.
 * PLACEHOLDER copy (DECISIONS #71: on screen the authority is "the City", never "host"; Lex finalizes). */
export function pvpSeatBadge(view: unknown, room: unknown, role: PvpSeatRole, holobotName: string | null | undefined, pending: boolean): PvpSeatBadge {
  const level = pvpFighterLevel(view, room, role, holobotName);
  if (level !== undefined) return { kind: 'host', text: levelBadge(level)!, accessibilityLabel: `Level ${level}, from the City` };
  if (pending) return { kind: 'pending', text: 'LV …', accessibilityLabel: 'Level pending from the City' };
  return { kind: 'absent', text: 'LV —', accessibilityLabel: 'Level not available from the City' };
}

/** Bounded re-reads for the opponent's snapshot, which lands only after THEY seat: about 22 s in all, then absent. */
export const PVP_OPPONENT_READ_DELAYS_MS = [1500, 3000, 6000, 12000] as const;

/** Delay before the next `read` for the opponent's displayed bot, or null when none is due (have it, gave up, no host). */
export function pvpOpponentReadDelay(status: PvpHostFighterStatus, view: unknown, room: unknown, opponentRole: PvpSeatRole, attempts: number): number | null {
  if (status !== 'ready' || attempts >= PVP_OPPONENT_READ_DELAYS_MS.length) return null;
  const opponent = record(record(record(room).players)[opponentRole]);
  if (typeof opponent.uid !== 'string' || !opponent.uid || typeof opponent.holobotName !== 'string' || !opponent.holobotName.trim()) return null;
  return pvpFighterLevel(view, room, opponentRole, opponent.holobotName) === undefined ? PVP_OPPONENT_READ_DELAYS_MS[attempts] : null;
}

/** Whether a seat's missing badge is still honestly "pending" rather than "absent". */
export function pvpSeatPending(role: PvpSeatRole, myRole: PvpSeatRole, status: PvpHostFighterStatus, opponentReadsLeft: number): boolean {
  if (role === myRole) return status === 'pending';
  return (status === 'pending' || status === 'ready') && opponentReadsLeft > 0;
}
