import fixture from "./fixtures/pvp-room-fighters-1.json";
import { mergePvpHostReply, type PvpHostView } from "@/lib/bots/pvpFighterLevel";
import type { BattleRoom, PlayerRole } from "@/types/battle-room";

/** Offline PvP level-badge witness cells, known-bad first. Recorded pvpRoomFighterHost replies only; no network call.
 * Neutral on-screen copy: never "host" (DECISIONS #71), and no claim that the City vouches for the level (S4 open). */
export const PVP_FIGHTERS_PREVIEW_ROUTES = ["PvpFightersKnownBad", "PvpFightersPending", "PvpFightersSeated"] as const;
export type PvpFightersPreviewRoute = (typeof PVP_FIGHTERS_PREVIEW_ROUTES)[number];
export type PvpFightersPreviewFixture = {
  title: string;
  caption: string;
  room: BattleRoom;
  view: PvpHostView | null;
  pending: Record<PlayerRole, boolean>;
};

// The recorded client-authored room: its players.* carry LOCAL levels, which no cell may print.
const room = fixture.knownBad.room as unknown as BattleRoom;
const fold = (...replies: unknown[]) => replies.reduce<PvpHostView | null>((view, reply) => mergePvpHostReply(view, reply, room.roomId), null);

export const pvpFightersFixtures: Record<PvpFightersPreviewRoute, PvpFightersPreviewFixture> = {
  PvpFightersKnownBad: {
    title: "KNOWN BAD",
    caption: "Client-written room only; its players carry local levels. No seat reply, so no level tab.",
    room, view: null, pending: { p1: false, p2: false },
  },
  PvpFightersPending: {
    title: "PENDING",
    caption: "Seat reply for YOU only; RIVAL has not seated yet.",
    room, view: fold(fixture.replies.seatP1), pending: { p1: false, p2: true },
  },
  PvpFightersSeated: {
    title: "SEATED",
    caption: "Seat + read replies for both seats (recorded emulator run).",
    room, view: fold(fixture.replies.seatP1, fixture.replies.readP1), pending: { p1: false, p2: false },
  },
};
