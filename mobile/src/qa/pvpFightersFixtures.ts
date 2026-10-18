import fixture from "./fixtures/pvp-room-fighters-1.json";
import { mergePvpHostReply, type PvpHostView } from "@/lib/bots/pvpFighterLevel";
import type { BattleRoom, PlayerRole } from "@/types/battle-room";

/** Offline PvP level-badge witness cells, known-bad first. Recorded pvpRoomFighterHost replies only; no host call.
 * On-screen copy says "the City" (DECISIONS #71); PLACEHOLDER until Lex. */
export const PVP_FIGHTERS_PREVIEW_ROUTES = ["PvpFightersKnownBad", "PvpFightersPending", "PvpFightersCity"] as const;
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
    caption: "Client-written room only; its players carry local levels. No City reply.",
    room, view: null, pending: { p1: false, p2: false },
  },
  PvpFightersPending: {
    title: "PENDING",
    caption: "City seat reply for YOU; RIVAL has not seated with the City yet.",
    room, view: fold(fixture.replies.seatP1), pending: { p1: false, p2: true },
  },
  PvpFightersCity: {
    title: "CITY",
    caption: "City seat + read replies for both seats (recorded emulator run).",
    room, view: fold(fixture.replies.seatP1, fixture.replies.readP1), pending: { p1: false, p2: false },
  },
};
