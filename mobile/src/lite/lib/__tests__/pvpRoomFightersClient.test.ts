import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  auth: { currentUser: { uid: "demo_pvp_fighters_p1" } as { uid: string } | null },
  calls: [] as Array<[string, unknown]>,
  reply: async (_request: unknown): Promise<unknown> => ({}),
}));
vi.mock("@/config/firebase", () => ({
  auth: fake.auth,
  functions: {},
  httpsCallable: (_functions: unknown, name: string) => async (request: unknown) => {
    fake.calls.push([name, request]);
    return { data: await fake.reply(request) };
  },
}));

import fixture from "../../qa/fixtures/pvp-room-fighters-1.json";
import { mergePvpHostReply, pvpSeatBadge, type PvpHostView } from "../bots/pvpFighterLevel";
import { pvpRoomFighterCallForUid, readHostFighters, seatHostFighters } from "../pvpRoomFightersClient";

const UID = fixture.profiles.p1.uid, ROOM = fixture.knownBad.room.roomId, R = fixture.replies;
const hostError = (code: string, rejectionCode?: string) =>
  Object.assign(new Error(code), { code, ...(rejectionCode ? { details: { rejectionCode } } : {}) });
const fold = (replies: unknown[]) => replies.reduce<PvpHostView | null>((view, reply) => mergePvpHostReply(view, reply, ROOM), null);

describe("pvpRoomFighterHost client", () => {
  beforeEach(() => {
    fake.auth.currentUser = { uid: UID };
    fake.calls.length = 0;
    fake.reply = async (request) => ((request as { operation: string }).operation === "read" ? R.readP1 : R.seatP1);
  });

  it("seat sends exactly {operation, roomId, holobotId} per distinct lineup bot: never a level, uid, role or tier", async () => {
    const outcome = await seatHostFighters(pvpRoomFighterCallForUid(UID), ROOM, ["ACE", "HARE", "ace", ""]);
    expect(outcome).toEqual({ status: "ready", replies: [R.seatP1, R.seatP1], refused: 0 });
    expect(fake.calls).toEqual([
      ["pvpRoomFighterHost", { operation: "seat", roomId: ROOM, holobotId: "ace" }],
      ["pvpRoomFighterHost", { operation: "seat", roomId: ROOM, holobotId: "hare" }],
    ]);
  });

  it("read sends exactly {operation, roomId} and returns both seats for the badge", async () => {
    const outcome = await readHostFighters(pvpRoomFighterCallForUid(UID), ROOM);
    expect(fake.calls).toEqual([["pvpRoomFighterHost", { operation: "read", roomId: ROOM }]]);
    expect(outcome).toEqual({ status: "ready", reply: R.readP1 });
    const view = fold([R.seatP1, outcome.status === "ready" ? outcome.reply : null]);
    expect(pvpSeatBadge(view, fixture.knownBad.room, "p2", "KUMA", false)).toMatchObject({ kind: "level", text: "LV 12" });
  });

  it("NOT DEPLOYED: a missing callable resolves (never throws), so the room plays on with no level tab", async () => {
    fake.reply = async () => { throw hostError("functions/not-found"); };
    const seat = await seatHostFighters(pvpRoomFighterCallForUid(UID), ROOM, ["ACE"]);
    expect(seat).toEqual({ status: "unavailable", reason: "not_deployed", replies: [] });
    await expect(readHostFighters(pvpRoomFighterCallForUid(UID), ROOM)).resolves.toEqual({ status: "unavailable", reason: "not_deployed" });
    // What the cards then show for the room the client wrote itself: no tab at all, and never the local 99 / 50.
    for (const [role, name] of [["p1", "ACE"], ["p2", "KUMA"]] as const) {
      expect(pvpSeatBadge(fold(seat.replies), fixture.knownBad.room, role, name, false)).toBeNull();
    }
  });

  it("a refused bot does not stop the lineup, and the City still counts as answering (opponent reads may run)", async () => {
    fake.reply = async (request) => {
      if ((request as { holobotId?: string }).holobotId === "ace") throw hostError("functions/failed-precondition", "profile_invalid"); // e.g. stored level 120
      return R.seatP1;
    };
    const outcome = await seatHostFighters(pvpRoomFighterCallForUid(UID), ROOM, ["ACE", "HARE"]);
    expect(fake.calls.map(([, request]) => (request as { holobotId: string }).holobotId)).toEqual(["ace", "hare"]);
    expect(outcome).toEqual({ status: "ready", replies: [R.seatP1], refused: 1 });
    // An outage mid-lineup still stops at once.
    fake.calls.length = 0;
    fake.reply = async () => { throw hostError("functions/unavailable"); };
    await expect(seatHostFighters(pvpRoomFighterCallForUid(UID), ROOM, ["ACE", "HARE"])).resolves.toEqual({ status: "unavailable", reason: "offline", replies: [] });
    expect(fake.calls).toHaveLength(1);
  });

  it("separates host refusals (details.rejectionCode, including unknown_room's not-found) from outages", async () => {
    const cases: Array<[unknown, string]> = [
      [hostError("functions/not-found", "unknown_room"), "refused"],
      [hostError("functions/permission-denied", "not_participant"), "refused"],
      [hostError("functions/failed-precondition", "not_owned"), "refused"],
      [hostError("functions/failed-precondition", "profile_invalid"), "refused"],
      [hostError("functions/data-loss", "seats_invalid"), "refused"],
      [hostError("functions/unavailable"), "offline"],
      [hostError("functions/deadline-exceeded"), "offline"],
      [new Error("network down"), "offline"],
    ];
    for (const [error, reason] of cases) {
      fake.reply = async () => { throw error; };
      await expect(seatHostFighters(pvpRoomFighterCallForUid(UID), ROOM, ["ACE"])).resolves.toEqual(
        reason === "refused" ? { status: "ready", replies: [], refused: 1 } : { status: "unavailable", reason, replies: [] });
      await expect(readHostFighters(pvpRoomFighterCallForUid(UID), ROOM)).resolves.toEqual({ status: "unavailable", reason });
    }
  });

  it("drops a reply that lands after the session changed, and never calls when signed out", async () => {
    fake.reply = async () => { fake.auth.currentUser = { uid: "pilot-b" }; return R.seatP1; };
    await expect(seatHostFighters(pvpRoomFighterCallForUid(UID), ROOM, ["ACE"])).resolves.toEqual({ status: "unavailable", reason: "session_changed", replies: [] });
    fake.auth.currentUser = null;
    fake.calls.length = 0;
    await expect(readHostFighters(pvpRoomFighterCallForUid(UID), ROOM)).resolves.toEqual({ status: "unavailable", reason: "session_changed" });
    expect(fake.calls).toEqual([]);
  });

  it("asks for nothing without a room or a named bot", async () => {
    await expect(seatHostFighters(pvpRoomFighterCallForUid(UID), "", ["ACE"])).resolves.toMatchObject({ status: "unavailable" });
    await expect(seatHostFighters(pvpRoomFighterCallForUid(UID), ROOM, [" "])).resolves.toMatchObject({ status: "unavailable" });
    await expect(readHostFighters(pvpRoomFighterCallForUid(UID), "")).resolves.toMatchObject({ status: "unavailable" });
    expect(fake.calls).toEqual([]);
  });
});
