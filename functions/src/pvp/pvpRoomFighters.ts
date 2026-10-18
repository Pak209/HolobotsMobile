/** pvp-room-fighters-1: host-minted PvP fighter snapshots (Documentation/QA/2026-10-17-lite-pvp-fighters-1/CONTRACT.md).
 * Presentation only. The caller's OWNED bot level is minted into the host-only `battle_rooms/{roomId}.hostFighters`
 * field; the client-authored `players.*` combat docs stay as they are (SECURITY_AUDIT.md C4). Nothing here settles,
 * rewards or validates combat.
 */
import { Firestore } from 'firebase-admin/firestore';
import { arenaFighterSnapshot, ArenaFighterSnapshot } from '../lib/arenaFighterSnapshot';
import { buildPlayerCombatants } from '../lib/rivalLadder';
import { HOLOBOT_BASE_STATS } from '../lib/progression';
import { toHolobotKey } from '../lib/mintingEconomy';

export const PVP_ROOM_FIGHTERS_SCHEMA = 'pvp-room-fighters-1';
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
export type PvpRoomFighterMint = { role: PvpRole; fighter: ArenaFighterSnapshot; alreadyProcessed: boolean };
const object = (x: unknown): x is Data => !!x && typeof x === 'object' && !Array.isArray(x);
const fail = (code: keyof typeof PVP_ROOM_REFUSALS): never => { throw new PvpRoomError(code); };

/** The whole request. The uid comes only from request.auth; a level, tier, uid or role in the body is refused. */
export function pvpRoomFighterRequest(raw: unknown): { roomId: string; holobotId: string } {
  if (!object(raw) || Object.keys(raw).some(k => k !== 'roomId' && k !== 'holobotId')
    || typeof raw.roomId !== 'string' || !PVP_ROOM_ID.test(raw.roomId)
    || typeof raw.holobotId !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(raw.holobotId)) return fail('invalid_request');
  return { roomId: raw.roomId, holobotId: raw.holobotId };
}

const seatUid = (room: Data, role: PvpRole): string => {
  const uid = object(room.players) && object(room.players[role]) ? room.players[role].uid : undefined;
  return typeof uid === 'string' ? uid : '';
};
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
/** Host-written seat record. Only this host writes it, so anything malformed is corruption: fail closed. */
export function readPvpSeatFighters(hostFighters: unknown, role: PvpRole): PvpSeatFighters | null {
  if (hostFighters === undefined) return null;
  if (!object(hostFighters) || hostFighters.schemaVersion !== PVP_ROOM_FIGHTERS_SCHEMA) return fail('unavailable');
  const seat = hostFighters[role];
  if (seat === undefined) return null;
  if (!object(seat) || typeof seat.uid !== 'string' || !seat.uid || !object(seat.fighters)
    || Object.entries(seat.fighters).some(([id, s]) => !snapshotOk(s, id))) return fail('unavailable');
  return seat as PvpSeatFighters;
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

/** Pure ruling for one seat. Same owned-bot path as Arena issue: profile.holobots -> buildPlayerCombatants. */
export function mintPvpRoomFighter(room: unknown, profile: unknown, uid: string, holobotId: string): PvpRoomFighterMint {
  if (!object(room) || !object(room.players)) return fail('unavailable');
  if (room.status !== 'waiting' && room.status !== 'active') return fail('room_closed');
  const p1 = seatUid(room, 'p1'), p2 = seatUid(room, 'p2');
  if (!uid || p1 === p2) return fail('not_participant'); // One account in both seats is not a duel.
  const role: PvpRole | null = uid === p1 ? 'p1' : uid === p2 ? 'p2' : null;
  if (!role) return fail('not_participant');
  if (!seatedIds(room, role).includes(holobotId)) return fail('not_seated');
  const seat = readPvpSeatFighters(room.hostFighters, role);
  if (seat && seat.uid !== uid) return fail('unavailable');
  // Frozen at first mint, like an Arena admission: a later level-up does not rewrite this room's badge.
  if (seat && Object.hasOwn(seat.fighters, holobotId)) return { role, fighter: seat.fighters[holobotId], alreadyProcessed: true };
  const level = ownedLevel(profile, holobotId);
  const combatant = buildPlayerCombatants(profile as Data, [holobotId])[0];
  if (!combatant || combatant.level !== level) return fail('unavailable');
  try { return { role, fighter: arenaFighterSnapshot(combatant, PVP_ROOM_TIER), alreadyProcessed: false }; }
  catch { return fail('unavailable'); } // Level above 99: refuse, never clamp.
}

export function pvpRoomFighterReply(roomId: string, mint: PvpRoomFighterMint) {
  return { schemaVersion: PVP_ROOM_FIGHTERS_SCHEMA, roomId, role: mint.role, alreadyProcessed: mint.alreadyProcessed, fighter: mint.fighter };
}

export async function transactPvpRoomFighter(firestore: Firestore, uid: string, raw: unknown) {
  if (typeof uid !== 'string' || !uid) return fail('invalid_request');
  const { roomId, holobotId } = pvpRoomFighterRequest(raw);
  const roomRef = firestore.doc(`battle_rooms/${roomId}`), userRef = firestore.doc(`users/${uid}`);
  return firestore.runTransaction(async tx => {
    const [roomSnap, userSnap] = await tx.getAll(roomRef, userRef);
    if (!roomSnap.exists) return fail('unknown_room');
    const mint = mintPvpRoomFighter(roomSnap.data(), userSnap.exists ? userSnap.data() : undefined, uid, holobotId);
    if (!mint.alreadyProcessed) {
      tx.update(roomRef, {
        'hostFighters.schemaVersion': PVP_ROOM_FIGHTERS_SCHEMA,
        [`hostFighters.${mint.role}.uid`]: uid,
        [`hostFighters.${mint.role}.fighters.${holobotId}`]: mint.fighter,
      });
    }
    return pvpRoomFighterReply(roomId, mint);
  });
}
