import {
  mergePvpHostReply,
  pvpOpponentReadDelay,
  pvpSeatPending,
  PVP_OPPONENT_READ_DELAYS_MS,
  type PvpHostFighterStatus,
  type PvpHostView,
  type PvpSeatRole,
} from "./bots/pvpFighterLevel";
import type { PvpSeatMintOutcome, PvpSeatReadOutcome } from "./pvpRoomFightersClient";

/**
 * Pure state for useRealtimeArena's pvp-room-fighters-1 calls: which room the seat calls belong to, my seat
 * status, the merged reply view, and opponent re-reads spent per (room, opponent uid, opponent bot).
 */
export type PvpHostSeatState = {
  roomId: string | null;
  status: PvpHostFighterStatus;
  view: PvpHostView | null;
  reads: Record<string, number>;
};
export type PvpHostSeatEvent =
  | { type: "seat_started"; roomId: string }
  | { type: "seat_resolved"; roomId: string; outcome: PvpSeatMintOutcome }
  | { type: "read_resolved"; roomId: string; key: string; outcome: PvpSeatReadOutcome }
  | { type: "reset" };

export const PVP_HOST_SEAT_IDLE: PvpHostSeatState = { roomId: null, status: "idle", view: null, reads: {} };

const fold = (view: PvpHostView | null, replies: readonly unknown[], roomId: string) =>
  replies.reduce<PvpHostView | null>((next, reply) => mergePvpHostReply(next, reply, roomId), view);

export function pvpHostSeatReducer(state: PvpHostSeatState, event: PvpHostSeatEvent): PvpHostSeatState {
  switch (event.type) {
    case "reset":
      return PVP_HOST_SEAT_IDLE;
    case "seat_started":
      return { roomId: event.roomId, status: "pending", view: null, reads: {} };
    case "seat_resolved": {
      // A late answer for a room I already left is dropped.
      if (event.roomId !== state.roomId) return state;
      const { outcome } = event;
      // Another account's answers never reach this view.
      if (outcome.status === "unavailable" && outcome.reason === "session_changed") return { ...state, status: "unavailable" };
      const view = fold(state.view, outcome.replies, event.roomId);
      // "ready" = the host answered (a refused bot just shows no level). A missing host or an outage before any
      // answer means no opponent reads either.
      return { ...state, view, status: outcome.status === "ready" || outcome.replies.length > 0 ? "ready" : "unavailable" };
    }
    case "read_resolved": {
      if (event.roomId !== state.roomId) return state;
      const spent = state.reads[event.key] ?? 0;
      if (event.outcome.status !== "ready") {
        // A refused read, an outage, a missing host or a session change. A read names only the room, so the next
        // opponent bot would get the same answer: stop ALL opponent reads for this room, not just this bot's.
        return { ...state, status: "unavailable", reads: { ...state.reads, [event.key]: PVP_OPPONENT_READ_DELAYS_MS.length } };
      }
      return {
        ...state,
        view: mergePvpHostReply(state.view, event.outcome.reply, event.roomId),
        reads: { ...state.reads, [event.key]: spent + 1 },
      };
    }
    default:
      return state;
  }
}

type SeenRoom = { roomId?: unknown; players?: Partial<Record<PvpSeatRole, { uid?: unknown; holobotName?: unknown } | undefined>> } | null | undefined;
const other = (role: PvpSeatRole): PvpSeatRole => (role === "p1" ? "p2" : "p1");

/** Re-read budget key for the opponent fighter now shown. */
export function pvpOpponentReadKey(room: SeenRoom, myRole: PvpSeatRole): string {
  const opponent = room?.players?.[other(myRole)];
  return `${String(room?.roomId ?? "")}:${String(opponent?.uid ?? "")}:${String(opponent?.holobotName ?? "")}`;
}

/** The next opponent read to schedule, or null. Bounded: PVP_OPPONENT_READ_DELAYS_MS.length per key. */
export function pvpNextOpponentRead(state: PvpHostSeatState, room: SeenRoom, myRole: PvpSeatRole): { key: string; delayMs: number } | null {
  if (!room || typeof room.roomId !== "string" || room.roomId !== state.roomId) return null;
  const key = pvpOpponentReadKey(room, myRole);
  const delayMs = pvpOpponentReadDelay(state.status, state.view, room, other(myRole), state.reads[key] ?? 0);
  return delayMs === null ? null : { key, delayMs };
}

/** Per seat: is a missing badge still honestly "pending" (shown as LV …) rather than absent (no tab)? */
export function pvpHostSeatPending(state: PvpHostSeatState, room: SeenRoom, myRole: PvpSeatRole): Record<PvpSeatRole, boolean> {
  const readsLeft = PVP_OPPONENT_READ_DELAYS_MS.length - (state.reads[pvpOpponentReadKey(room, myRole)] ?? 0);
  return {
    p1: pvpSeatPending("p1", myRole, state.status, readsLeft),
    p2: pvpSeatPending("p2", myRole, state.status, readsLeft),
  };
}

/** Lineup names a seat put in a room (live fighter plus any 3v3 members). Never throws on a malformed room. */
export function pvpSeatHolobotNames(room: unknown, role: PvpSeatRole): string[] {
  const r = room !== null && typeof room === "object" ? (room as Record<string, any>) : {}; // eslint-disable-line @typescript-eslint/no-explicit-any -- untrusted doc
  const names: unknown[] = [r.players?.[role]?.holobotName];
  const members = r.teams?.[role]?.members;
  if (Array.isArray(members)) for (const member of members) names.push(member !== null && typeof member === "object" ? member.holobotName : undefined);
  return names.filter((name): name is string => typeof name === "string" && name.trim() !== "");
}
