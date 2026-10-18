import { describe, expect, it } from "vitest";

import fixture from "../../qa/fixtures/pvp-room-fighters-1.json";
import { pvpFighterLevel, PVP_OPPONENT_READ_DELAYS_MS } from "../bots/pvpFighterLevel";
import {
  pvpHostSeatPending,
  pvpHostSeatReducer,
  pvpNextOpponentRead,
  pvpOpponentReadKey,
  pvpSeatHolobotNames,
  PVP_HOST_SEAT_IDLE,
  type PvpHostSeatEvent,
  type PvpHostSeatState,
} from "../pvpHostSeatState";

const R = fixture.replies, room = fixture.knownBad.room, ROOM = room.roomId, OTHER = "B".repeat(20);
const withOpponentBot = (holobotName: string) => ({ ...room, players: { ...room.players, p2: { ...room.players.p2, holobotName } } });
const run = (events: PvpHostSeatEvent[], from: PvpHostSeatState = PVP_HOST_SEAT_IDLE) => events.reduce(pvpHostSeatReducer, from);
const seated = () => run([
  { type: "seat_started", roomId: ROOM },
  { type: "seat_resolved", roomId: ROOM, outcome: { status: "ready", replies: [R.seatP1], refused: 0 } },
]);
// A read reply in which the opponent has not seated yet.
const readWithoutOpponent = { status: "ready" as const, reply: { ...R.readP1, seats: { p1: R.readP1.seats.p1 } } };

/** Drive the hook's loop without timers: schedule → resolve, until nothing is due. Returns delays used. */
function drain(state: PvpHostSeatState, seen: unknown, outcome = readWithoutOpponent): { state: PvpHostSeatState; delays: number[] } {
  const delays: number[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const next = pvpNextOpponentRead(state, seen as never, "p1");
    if (!next) break;
    delays.push(next.delayMs);
    state = pvpHostSeatReducer(state, { type: "read_resolved", roomId: ROOM, key: next.key, outcome });
  }
  return { state, delays };
}

describe("pvpHostSeatReducer + pvpNextOpponentRead (the hook's read loop, without timers)", () => {
  it("at most 4 reads per (room, opponent uid, opponent bot); a 3v3 switch back keeps the spent budget", () => {
    let { state, delays } = drain(seated(), room);
    expect(delays).toEqual([...PVP_OPPONENT_READ_DELAYS_MS]);
    ({ state, delays } = drain(state, withOpponentBot("HARE")));
    expect(delays).toHaveLength(4); // A different displayed bot has its own budget.
    ({ state, delays } = drain(state, room));
    expect(delays).toEqual([]); // Back to KUMA: nothing left to spend.
    expect(Object.values(state.reads).every((n) => n <= 4)).toBe(true);
    expect(pvpHostSeatPending(state, room, "p1")).toEqual({ p1: false, p2: false }); // Gave up: no tab, not "LV …".
  });

  it("stops as soon as the opponent's snapshot arrives", () => {
    const { state, delays } = drain(seated(), room, { status: "ready", reply: R.readP1 });
    expect(delays).toEqual([1500]);
    expect(pvpFighterLevel(state.view, room, "p2", "KUMA")).toBe(12);
  });

  it("no reads after a refused or offline read (for ANY opponent bot), and none when the seat call found no host", () => {
    for (const reason of ["refused", "offline", "not_deployed", "session_changed"] as const) {
      const stopped = drain(seated(), room, { status: "unavailable", reason } as never);
      expect(stopped.delays, reason).toHaveLength(1);
      // The read names only the room, so a 3v3 rotation must not send it again.
      const rotated = drain(stopped.state, withOpponentBot("HARE"), readWithoutOpponent);
      expect(rotated.delays, reason).toEqual([]);
      expect(pvpHostSeatPending(rotated.state, withOpponentBot("HARE"), "p1"), reason).toEqual({ p1: false, p2: false });
    }
    for (const reason of ["not_deployed", "offline"] as const) {
      const state = run([{ type: "seat_started", roomId: ROOM }, { type: "seat_resolved", roomId: ROOM, outcome: { status: "unavailable", reason, replies: [] } }]);
      expect(state.status).toBe("unavailable");
      expect(pvpNextOpponentRead(state, room, "p1")).toBeNull();
    }
    expect(pvpNextOpponentRead(PVP_HOST_SEAT_IDLE, room, "p1")).toBeNull();
  });

  it("drops late answers for a room I already left", () => {
    const inOther = run([{ type: "seat_started", roomId: ROOM }, { type: "seat_started", roomId: OTHER }]);
    expect(pvpHostSeatReducer(inOther, { type: "seat_resolved", roomId: ROOM, outcome: { status: "ready", replies: [R.seatP1], refused: 0 } })).toBe(inOther);
    const key = pvpOpponentReadKey(room, "p1");
    expect(pvpHostSeatReducer(inOther, { type: "read_resolved", roomId: ROOM, key, outcome: { status: "ready", reply: R.readP1 } })).toBe(inOther);
    // Room guard, non-vacuous: a READY state seated for another room schedules nothing for the shown room...
    const readyElsewhere = run([{ type: "seat_started", roomId: OTHER }, { type: "seat_resolved", roomId: OTHER, outcome: { status: "ready", replies: [], refused: 0 } }]);
    expect(readyElsewhere.status).toBe("ready");
    expect(pvpNextOpponentRead(readyElsewhere, room, "p1")).toBeNull();
    // ...while the same shown room, seated for itself, does (control).
    expect(pvpNextOpponentRead(seated(), room, "p1")).toEqual({ key: pvpOpponentReadKey(room, "p1"), delayMs: 1500 });
    expect(run([{ type: "reset" }], seated())).toEqual(PVP_HOST_SEAT_IDLE);
  });

  it("a session change never folds the other account's replies, even ones received before the switch", () => {
    const state = run([
      { type: "seat_started", roomId: ROOM },
      { type: "seat_resolved", roomId: ROOM, outcome: { status: "unavailable", reason: "session_changed", replies: [R.seatP1] } },
    ]);
    expect(state).toMatchObject({ status: "unavailable", view: null });
  });

  it("a refused lineup bot still counts as the host answering, so opponent reads run", () => {
    const state = run([{ type: "seat_started", roomId: ROOM }, { type: "seat_resolved", roomId: ROOM, outcome: { status: "ready", replies: [], refused: 1 } }]);
    expect(state.status).toBe("ready");
    expect(pvpNextOpponentRead(state, room, "p1")).toEqual({ key: pvpOpponentReadKey(room, "p1"), delayMs: 1500 });
  });

  it("pending: my seat while seating; the rival while reads remain", () => {
    expect(pvpHostSeatPending(run([{ type: "seat_started", roomId: ROOM }]), room, "p1")).toEqual({ p1: true, p2: true });
    expect(pvpHostSeatPending(seated(), room, "p1")).toEqual({ p1: false, p2: true });
  });
});

describe("pvpSeatHolobotNames (joinRoomById's seat names)", () => {
  it("never throws on a malformed room and keeps only real names", () => {
    for (const bad of [null, undefined, 7, "room", [], {}, { players: null }, { players: { p1: "x" } }, { teams: { p1: { members: "x" } } }]) {
      expect(() => pvpSeatHolobotNames(bad, "p1")).not.toThrow();
      expect(pvpSeatHolobotNames(bad, "p1")).toEqual([]);
    }
    expect(pvpSeatHolobotNames({ players: { p1: { holobotName: "ACE" } }, teams: { p1: { members: [null, 5, { holobotName: " " }, { holobotName: "HARE" }] } } }, "p1"))
      .toEqual(["ACE", "HARE"]);
  });
});
