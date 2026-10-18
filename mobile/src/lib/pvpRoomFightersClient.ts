import { auth, functions, httpsCallable } from "@/config/firebase";
import { CALLABLE_TIMEOUT_MS, withTimeout } from "./async";
import { pvpHolobotId } from "./bots/pvpFighterLevel";

/** pvp-room-fighters-1 host (functions/src/pvp/pvpRoomFighterHost.ts on main). */
export const PVP_ROOM_FIGHTER_CALLABLE = "pvpRoomFighterHost";
export type PvpHostRequest = { operation: "seat"; roomId: string; holobotId: string } | { operation: "read"; roomId: string };
export type PvpHostCall = (request: PvpHostRequest) => Promise<unknown>;
export type PvpHostUnavailable = { status: "unavailable"; reason: "not_deployed" | "refused" | "offline" | "session_changed" };
/**
 * `replies` are raw host replies, folded in with mergePvpHostReply (which drops anything malformed). "ready" means
 * the City answered every call (a bot it refused, e.g. a stored level above 99, just stays absent); "unavailable"
 * is reserved for a missing callable, an outage or a session change.
 */
export type PvpSeatMintOutcome = { status: "ready"; replies: unknown[]; refused: number } | (PvpHostUnavailable & { replies: unknown[] });
export type PvpSeatReadOutcome = { status: "ready"; reply: unknown } | PvpHostUnavailable;

const SESSION_CHANGED = "pvp-session-changed";

function classify(error: unknown): PvpHostUnavailable["reason"] {
  const e = (typeof error === "object" && error ? error : {}) as { code?: unknown; message?: unknown; details?: unknown };
  if (e.message === SESSION_CHANGED) return "session_changed";
  // Host refusals carry details.rejectionCode (its unknown_room is also not-found); a missing callable does not.
  const details = (typeof e.details === "object" && e.details ? e.details : {}) as { rejectionCode?: unknown };
  if (typeof details.rejectionCode === "string") return "refused";
  if (e.code === "functions/not-found") return "not_deployed";
  if (!e.code || ["functions/unavailable", "functions/deadline-exceeded", "functions/internal"].includes(String(e.code))) return "offline";
  return "refused";
}

/**
 * Asks the host to seat each of my lineup bots. Each body is exactly {operation:"seat", roomId, holobotId}: never a
 * level, uid, role or tier. Never throws: the room plays on without it, with badges left pending/absent.
 */
export async function seatHostFighters(call: PvpHostCall, roomId: string, holobotNames: readonly string[]): Promise<PvpSeatMintOutcome> {
  const ids = [...new Set(holobotNames.filter((name) => typeof name === "string" && name.trim() !== "").map(pvpHolobotId))];
  const replies: unknown[] = [];
  let refused = 0;
  if (!roomId || ids.length === 0) return { status: "unavailable", reason: "refused", replies };
  // One at a time: every mint is a transaction on the same seats document. A refusal of one bot does not stop
  // the rest of the lineup; an outage, a missing callable or a session change does.
  for (const holobotId of ids) {
    try {
      replies.push(await call({ operation: "seat", roomId, holobotId }));
    } catch (error) {
      const reason = classify(error);
      if (reason !== "refused") return { status: "unavailable", reason, replies };
      refused += 1;
    }
  }
  return { status: "ready", replies, refused };
}

/** Both seats' current snapshots for a room I sit in: {operation:"read", roomId} and nothing else. Never throws. */
export async function readHostFighters(call: PvpHostCall, roomId: string): Promise<PvpSeatReadOutcome> {
  if (!roomId) return { status: "unavailable", reason: "refused" };
  try {
    return { status: "ready", reply: await call({ operation: "read", roomId }) };
  } catch (error) {
    return { status: "unavailable", reason: classify(error) };
  }
}

/** Session matched on both sides of the await: a reply that lands after logout / an account switch is dropped. */
export function pvpRoomFighterCallForUid(uid: string): PvpHostCall {
  const call = httpsCallable<PvpHostRequest, unknown>(functions, PVP_ROOM_FIGHTER_CALLABLE);
  return async (request) => {
    if (!uid || auth.currentUser?.uid !== uid) throw new Error(SESSION_CHANGED);
    const body: PvpHostRequest = request.operation === "seat"
      ? { operation: "seat", roomId: request.roomId, holobotId: request.holobotId }
      : { operation: "read", roomId: request.roomId };
    const reply = await withTimeout(call(body), CALLABLE_TIMEOUT_MS, "The PvP seat call timed out.");
    if (auth.currentUser?.uid !== uid) throw new Error(SESSION_CHANGED);
    return reply.data;
  };
}
