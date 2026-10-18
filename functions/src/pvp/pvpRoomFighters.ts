/** pvp-room-fighters-1: host-minted PvP fighter snapshots (Documentation/QA/2026-10-17-lite-pvp-fighters-1/CONTRACT.md).
 * Presentation only. The caller's OWNED bot level is minted into the server-only `pvpRoomSeats/{roomId}` doc
 * (no client rule: firestore.rules' default deny; Admin SDK only) and both seats come back in the callable reply.
 * The `battle_rooms` doc itself stays client-authored (SECURITY_AUDIT.md C4) and is only read here, never written.
 * Nothing here settles, rewards or validates combat.
 */
import { Firestore } from 'firebase-admin/firestore';
import { arenaFighterSnapshot, ArenaFighterSnapshot } from '../lib/arenaFighterSnapshot';
import { buildPlayerCombatants } from '../lib/rivalLadder';
import { HOLOBOT_BASE_STATS } from '../lib/progression';
import { toHolobotKey } from '../lib/mintingEconomy';

export const PVP_ROOM_FIGHTERS_SCHEMA = 'pvp-room-fighters-1';
/** Server-only collection. Deliberately absent from firestore.rules, so every client read and write is denied. */
export const PVP_ROOM_SEATS = 'pvpRoomSeats';
/** PvP rooms have no host ladder, stakes or tier. 0 is a host constant meaning "unranked room" (a Pak call). */
export const PVP_ROOM_TIER = 0;
export const PVP_ROOM_ID = /^[A-Za-z0-9]{20}$/; // Firestore auto-ID; both room writers use doc(collection(...)).
export class PvpRoomError extends Error { constructor(public code: string) { super(code); } }
/** Every refusal code and its callable status. The host never invents a level on any of them. */
export const PVP_ROOM_REFUSALS = {
  invalid_request: 'invalid-argument', unknown_room: 'not-found', not_participant: 'permission-denied',
  room_closed: 'failed-precondition', not_seated: 'failed-precondition', not_owned: 'failed-precondition', unavailable: 'unavailable',
} as const;

type Data = Record<string, any>;
export type PvpRole = 'p1' | 'p2';
export type PvpSeatFighters = { uid: string; fighters: Record<string, ArenaFighterSnapshot> };
export type PvpSeats = { p1?: PvpSeatFighters; p2?: PvpSeatFighters };
export type PvpRoomFighterRequest = { operation: 'seat'; roomId: string; holobotId: string } | { operation: 'read'; roomId: string };
export type PvpRoomFighterMint = { role: PvpRole; fighter: ArenaFighterSnapshot; alreadyProcessed: boolean; seats: PvpSeats };
const object = (x: unknown): x is Data => !!x && typeof x === 'object' && !Array.isArray(x);
const fail = (code: keyof typeof PVP_ROOM_REFUSALS): never => { throw new PvpRoomError(code); };
const ROLES: readonly PvpRole[] = ['p1', 'p2'];

/** The whole request. The uid comes only from request.auth; a level, tier, uid or role in the body is refused. */
export function pvpRoomFighterRequest(raw: unknown): PvpRoomFighterRequest {
  if (!object(raw) || typeof raw.roomId !== 'string' || !PVP_ROOM_ID.test(raw.roomId)) return fail('invalid_request');
  const keys = Object.keys(raw);
  if (raw.operation === 'read' && keys.every(k => k === 'operation' || k === 'roomId')) return { operation: 'read', roomId: raw.roomId };
  if (raw.operation === 'seat' && keys.every(k => k === 'operation' || k === 'roomId' || k === 'holobotId')
    && typeof raw.holobotId === 'string' && /^[a-z][a-z0-9_]{0,39}$/.test(raw.holobotId)) return { operation: 'seat', roomId: raw.roomId, holobotId: raw.holobotId };
  return fail('invalid_request');
}

const seatUid = (room: Data, role: PvpRole): string => {
  const uid = object(room.players) && object(room.players[role]) ? room.players[role].uid : undefined;
  return typeof uid === 'string' ? uid : '';
};
/** The caller's seat, read from the client-authored room with the Admin SDK. One account in both seats is not a duel. */
function callerRole(room: Data, uid: string): PvpRole {
  const p1 = seatUid(room, 'p1'), p2 = seatUid(room, 'p2');
  if (!uid || p1 === p2) return fail('not_participant');
  return uid === p1 ? 'p1' : uid === p2 ? 'p2' : fail('not_participant');
}
/** Bots the seat put in this room: the live fighter, plus the 3v3 lineup. Names are client-authored. */
function seatedIds(room: Data, role: PvpRole): string[] {
  const names: unknown[] = [room.players[role].holobotName];
  if (room.mode === '3v3') {
    const members = object(room.teams) && object(room.teams[role]) ? room.teams[role].members : undefined;
    if (!Array.isArray(members) || members.length > 3) return fail('unavailable');
    for (const m of members) names.push(object(m) ? m.holobotName : undefined);
  }
  return names.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map(toHolobotKey);
}
const snapshotOk = (s: unknown, id: string): s is ArenaFighterSnapshot => {
  if (!object(s) || Object.keys(s).length !== 4 || s.holobotId !== id) return false;
  try { const fresh = arenaFighterSnapshot({ holobotId: id, level: s.level }, s.tier); return fresh.displayName === s.displayName && fresh.tier === PVP_ROOM_TIER; }
  catch { return false; }
};
/** The stored seats doc. Only this host writes it, so anything malformed is corruption: fail closed. */
export function readPvpRoomSeats(raw: unknown, roomId: string): PvpSeats {
  if (raw === undefined) return {};
  if (!object(raw) || raw.schemaVersion !== PVP_ROOM_FIGHTERS_SCHEMA || raw.roomId !== roomId
    || Object.keys(raw).some(k => !['schemaVersion', 'roomId', 'p1', 'p2'].includes(k))) return fail('unavailable');
  const seats: PvpSeats = {};
  for (const role of ROLES) {
    const seat = raw[role];
    if (seat === undefined) continue;
    if (!object(seat) || Object.keys(seat).length !== 2 || typeof seat.uid !== 'string' || !seat.uid || !object(seat.fighters)
      || Object.entries(seat.fighters).some(([id, s]) => !snapshotOk(s, id))) return fail('unavailable');
    seats[role] = seat as PvpSeatFighters;
  }
  return seats;
}
/** Seats minted for the uid now in that seat. A seat left by an earlier room with a reused id is dropped, not shown. */
function currentSeats(seats: PvpSeats, room: Data): PvpSeats {
  const out: PvpSeats = {};
  for (const role of ROLES) if (seats[role] && seats[role]!.uid === seatUid(room, role)) out[role] = seats[role];
  return out;
}
/** Exactly one owned record for a catalog bot. Mirrors arenaMatchStore uniqueEntrant (missing level is 1), but a null level is refused. */
function ownedLevel(profile: unknown, id: string): number {
  if (!object(profile) || !Array.isArray(profile.holobots)) return fail('unavailable');
  const found = profile.holobots.filter((h: unknown) => object(h) && typeof h.name === 'string' && toHolobotKey(h.name) === id);
  if (found.length === 0 || !Object.hasOwn(HOLOBOT_BASE_STATS, id.toUpperCase())) return fail('not_owned');
  if (found.length > 1) return fail('unavailable');
  const level = found[0].level === undefined ? 1 : found[0].level; // Owner-writable: validate before playerCombatant floors it.
  if (!Number.isSafeInteger(level) || level < 1) return fail('unavailable');
  return level;
}

/** Pure `seat` ruling. Same owned-bot path as Arena issue: profile.holobots -> buildPlayerCombatants. */
export function mintPvpRoomFighter(room: unknown, profile: unknown, seatsDoc: unknown, uid: string, roomId: string, holobotId: string): PvpRoomFighterMint {
  if (!object(room) || !object(room.players)) return fail('unavailable');
  if (room.status !== 'waiting' && room.status !== 'active') return fail('room_closed');
  const role = callerRole(room, uid);
  if (!seatedIds(room, role).includes(holobotId)) return fail('not_seated');
  const seats = currentSeats(readPvpRoomSeats(seatsDoc, roomId), room), mine = seats[role];
  // Frozen at first mint, like an Arena admission: a later level-up does not rewrite this room's badge.
  if (mine && Object.hasOwn(mine.fighters, holobotId)) return { role, fighter: mine.fighters[holobotId], alreadyProcessed: true, seats };
  const level = ownedLevel(profile, holobotId);
  const combatant = buildPlayerCombatants(profile as Data, [holobotId])[0];
  if (!combatant || combatant.level !== level) return fail('unavailable');
  let fighter: ArenaFighterSnapshot;
  try { fighter = arenaFighterSnapshot(combatant, PVP_ROOM_TIER); }
  catch { return fail('unavailable'); } // Level above 99: refuse, never clamp.
  return { role, fighter, alreadyProcessed: false, seats: { ...seats, [role]: { uid, fighters: { ...(mine?.fighters ?? {}), [holobotId]: fighter } } } };
}
/** Pure `read` ruling: both current seats, for a participant only. Any room status, so a result screen still badges. */
export function readPvpRoomFighters(room: unknown, seatsDoc: unknown, uid: string, roomId: string): { role: PvpRole; seats: PvpSeats } {
  if (!object(room) || !object(room.players)) return fail('unavailable');
  const role = callerRole(room, uid);
  return { role, seats: currentSeats(readPvpRoomSeats(seatsDoc, roomId), room) };
}

export function pvpRoomSeatReply(roomId: string, mint: PvpRoomFighterMint) {
  return { schemaVersion: PVP_ROOM_FIGHTERS_SCHEMA, operation: 'seat', roomId, role: mint.role, alreadyProcessed: mint.alreadyProcessed, fighter: mint.fighter, seats: mint.seats };
}
export function pvpRoomReadReply(roomId: string, read: { role: PvpRole; seats: PvpSeats }) {
  return { schemaVersion: PVP_ROOM_FIGHTERS_SCHEMA, operation: 'read', roomId, role: read.role, seats: read.seats };
}

export async function transactPvpRoomFighter(firestore: Firestore, uid: string, raw: unknown) {
  if (typeof uid !== 'string' || !uid) return fail('invalid_request');
  const request = pvpRoomFighterRequest(raw), roomId = request.roomId;
  const roomRef = firestore.doc(`battle_rooms/${roomId}`), seatsRef = firestore.doc(`${PVP_ROOM_SEATS}/${roomId}`);
  if (request.operation === 'read') {
    const [roomSnap, seatsSnap] = await firestore.getAll(roomRef, seatsRef);
    if (!roomSnap.exists) return fail('unknown_room');
    return pvpRoomReadReply(roomId, readPvpRoomFighters(roomSnap.data(), seatsSnap.exists ? seatsSnap.data() : undefined, uid, roomId));
  }
  const userRef = firestore.doc(`users/${uid}`);
  return firestore.runTransaction(async tx => {
    const [roomSnap, userSnap, seatsSnap] = await tx.getAll(roomRef, userRef, seatsRef);
    if (!roomSnap.exists) return fail('unknown_room');
    const mint = mintPvpRoomFighter(roomSnap.data(), userSnap.exists ? userSnap.data() : undefined,
      seatsSnap.exists ? seatsSnap.data() : undefined, uid, roomId, request.holobotId);
    // Whole-doc set: also drops a seat left behind by an earlier room that reused this id.
    if (!mint.alreadyProcessed) tx.set(seatsRef, { schemaVersion: PVP_ROOM_FIGHTERS_SCHEMA, roomId, ...mint.seats });
    return pvpRoomSeatReply(roomId, mint);
  });
}
