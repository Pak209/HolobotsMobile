import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  mergePvpHostReply,
  pvpFighterLevel,
  pvpOpponentReadDelay,
  pvpSeatBadge,
  pvpSeatPending,
  PVP_OPPONENT_READ_DELAYS_MS,
  type PvpHostView,
} from "../bots/pvpFighterLevel";
import fixture from "../../qa/fixtures/pvp-room-fighters-1.json";

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), "utf8");
/** Player-visible text in a source file: string literals and JSX text, with comments stripped. */
function onScreenText(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const strings = [...code.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
  // JSX text, including text next to a {expression}: between > or } and < or {.
  const jsx = [...code.matchAll(/[>}]([^<>{}]+)[<{]/g)].map((m) => m[1].trim()).filter((text) => /[A-Za-z]/.test(text));
  return [...strings, ...jsx];
}
const PVP_SCREEN_FILES = [
  "../../components/arena/PvpArenaModal.tsx",
  "../../components/arena/PvpSeatBadges.tsx",
  "../bots/pvpFighterLevel.ts",
  "../pvpRoomFightersClient.ts",
  "../pvpHostSeatState.ts",
  "../../hooks/useRealtimeArena.ts",
  "../../qa/PvpFightersPreview.tsx",
  "../../qa/pvpFightersFixtures.ts",
];
const room = fixture.knownBad.room, R = fixture.replies, roomId = room.roomId;
type AnyView = any; // eslint-disable-line @typescript-eslint/no-explicit-any -- tamper copies
const fold = (...replies: unknown[]) => replies.reduce<PvpHostView | null>((view, reply) => mergePvpHostReply(view, reply, roomId), null);
const view = fold(R.seatP1, R.readP1)!;
const tampered = (edit: (copy: AnyView) => void) => { const copy: AnyView = structuredClone(view); edit(copy); return copy; };
const reseated = (role: "p1" | "p2", uid: string) => ({ ...room, players: { ...room.players, [role]: { ...room.players[role], uid } } });

describe("pvp-room-fighters-1 fixture", () => {
  it("is the host fixture copied verbatim (main 4c2d5d4 functions/scripts/fixtures/pvp-room/room-fighters-1.json)", () => {
    expect(createHash("sha256").update(read("../../qa/fixtures/pvp-room-fighters-1.json")).digest("hex"))
      .toBe("27f2c55082ffcbf31b0efb899671bdac160cd3c20c6e2c288ce471080cfa673c");
  });
});

describe("pvpFighterLevel (strict host-reply reader)", () => {
  it("KNOWN-BAD first: the client-authored room's local level (99 / 50) never reaches the reader or a badge", () => {
    expect([room.players.p1.level, room.players.p2.level]).toEqual([99, 50]);
    for (const source of [null, undefined, room, { holobots: [{ name: "ACE", level: 99 }] }]) {
      expect(pvpFighterLevel(source, room, "p1", "ACE")).toBeUndefined();
      expect(pvpFighterLevel(source, room, "p2", "KUMA")).toBeUndefined();
    }
    // A host-looking field a client wrote onto the room doc is not a source either (the room is client-authored).
    const forged = { ...room, hostFighters: { schemaVersion: "pvp-room-fighters-1", roomId, seats: { p1: { uid: room.players.p1.uid, fighters: { ace: { holobotId: "ace", level: 99, displayName: "ACE", tier: 0 } } } } } };
    expect(pvpFighterLevel(forged, forged, "p1", "ACE")).toBeUndefined();
    for (const [role, name] of [["p1", "ACE"], ["p2", "KUMA"]] as const) {
      expect(pvpSeatBadge(null, room, role, name, false)).toBeNull(); // No snapshot, no tab.
      expect(pvpSeatBadge(null, room, role, name, true)).toEqual({ kind: "pending", text: "LV …", accessibilityLabel: "Level pending" });
    }
  });

  it("accepts each seat's host snapshot for the exact room, seat, seated uid and displayed bot", () => {
    expect(pvpFighterLevel(view, room, "p1", "ACE")).toBe(21);
    expect(pvpFighterLevel(view, room, "p2", "KUMA")).toBe(12);
    expect(pvpFighterLevel(R.readP2, room, "p1", " ace ")).toBe(21); // A raw read reply is a view too.
    expect(pvpFighterLevel(tampered((c) => { c.seats.p1.fighters.ace.tier = 1000000; }), room, "p1", "ACE")).toBe(21);
  });

  const REFUSE: Array<[string, unknown, unknown, "p1" | "p2", unknown]> = [
    ["other seat's bot on my seat", view, room, "p1", "KUMA"],
    ["my bot on the other seat", view, room, "p2", "ACE"],
    ["unminted bot", view, room, "p1", "HARE"],
    ["opponent not yet seated with the host", fold(R.seatP1), room, "p2", "KUMA"],
    ["no name", view, room, "p1", ""],
    ["null name", view, room, "p1", null],
    ["prototype key __proto__", view, room, "p1", "__proto__"],
    ["prototype key constructor", view, room, "p1", "constructor"],
    ["prototype key toString", view, room, "p1", "toString"],
    ["array view", [view], room, "p1", "ACE"],
    ["view for another room", tampered((c) => { c.roomId = "B".repeat(20); }), room, "p1", "ACE"],
    ["room without an id", view, { ...room, roomId: undefined }, "p1", "ACE"],
    ["missing schemaVersion", tampered((c) => { delete c.schemaVersion; }), room, "p1", "ACE"],
    ["older schemaVersion", tampered((c) => { c.schemaVersion = "pvp-room-fighters-0"; }), room, "p1", "ACE"],
    ["seat minted for a uid no longer in that room seat", view, reseated("p1", "someone_else"), "p1", "ACE"],
    ["seat without uid", tampered((c) => { delete c.seats.p1.uid; }), room, "p1", "ACE"],
    ["snapshot with a fifth key", tampered((c) => { c.seats.p1.fighters.ace.uid = room.players.p1.uid; }), room, "p1", "ACE"],
    ["snapshot for a different bot", tampered((c) => { c.seats.p1.fighters.ace.holobotId = "kuma"; }), room, "p1", "ACE"],
    ["non-canonical displayName", tampered((c) => { c.seats.p1.fighters.ace.displayName = "Ace"; }), room, "p1", "ACE"],
    ...([undefined, null, "21", 0, 100, 1.5, Number.NaN] as unknown[]).map((level): [string, unknown, unknown, "p1", string] =>
      [`level ${String(level)}`, tampered((c) => { c.seats.p1.fighters.ace.level = level; }), room, "p1", "ACE"]),
    ...([undefined, "0", -1, 1.5, 1000001] as unknown[]).map((tier): [string, unknown, unknown, "p1", string] =>
      [`tier ${String(tier)}`, tampered((c) => { c.seats.p1.fighters.ace.tier = tier; }), room, "p1", "ACE"]),
  ];
  it.each(REFUSE)("refuses: %s", (_name, input, inRoom, role, name) => {
    expect(pvpFighterLevel(input, inRoom, role, name as string)).toBeUndefined();
  });
});

describe("mergePvpHostReply", () => {
  it("folds seat then read replies for one room; the opponent arrives with the read", () => {
    expect(Object.keys(fold(R.seatP1)!.seats)).toEqual(["p1"]);
    expect(view.seats).toEqual(R.readP1.seats);
  });
  it("ignores anything that is not a pvp-room-fighters-1 seat/read reply for this room", () => {
    for (const bad of [null, "x", [], { ...R.readP1, schemaVersion: "pvp-room-fighters-0" }, { ...R.readP1, operation: "mint" },
      { ...R.readP1, roomId: "B".repeat(20) }, { ...R.readP1, role: "p3" }, { ...R.readP1, seats: [] }, room]) {
      expect(mergePvpHostReply(view, bad, roomId)).toBe(view);
    }
    expect(mergePvpHostReply(null, { ...R.readP1, seats: { p1: { fighters: {} } } }, roomId)?.seats).toEqual({});
  });
  it("unions frozen fighters for the same seat uid; a different uid replaces the seat; another room starts fresh", () => {
    const hare = { ...R.seatP1, seats: { p1: { uid: room.players.p1.uid, fighters: { hare: { holobotId: "hare", level: 4, displayName: "HARE", tier: 0 } } } } };
    expect(Object.keys(mergePvpHostReply(view, hare, roomId)!.seats.p1!.fighters).sort()).toEqual(["ace", "hare"]);
    const other = { ...R.seatP1, seats: { p1: { uid: "someone_else", fighters: {} } } };
    expect(mergePvpHostReply(view, other, roomId)!.seats.p1).toEqual({ uid: "someone_else", fighters: {} });
    const elsewhere = { ...R.readP1, roomId: "C".repeat(20) };
    expect(mergePvpHostReply(view, elsewhere, "C".repeat(20))!.seats).toEqual(R.readP1.seats);
    expect(mergePvpHostReply(view, elsewhere, "C".repeat(20))!.roomId).toBe("C".repeat(20));
  });
});

describe("pvpSeatBadge (the only PvP level a card prints)", () => {
  it("the snapshot level when present; LV … while it may still land; otherwise NO tab (never a bare dash, L22)", () => {
    expect(pvpSeatBadge(view, room, "p1", "ACE", false)).toEqual({ kind: "level", text: "LV 21", accessibilityLabel: "Level 21" });
    expect(pvpSeatBadge(view, room, "p2", "KUMA", true)).toMatchObject({ kind: "level", text: "LV 12" });
    expect(pvpSeatBadge(fold(R.seatP1), room, "p2", "KUMA", true)).toMatchObject({ kind: "pending", text: "LV …" });
    expect(pvpSeatBadge(fold(R.seatP1), room, "p2", "KUMA", false)).toBeNull();
  });
});

describe("opponent re-read pacing (bounded)", () => {
  const mine = fold(R.seatP1);
  it("reads only after my seat is ready, while the seated opponent's snapshot is missing, at most four times", () => {
    expect(PVP_OPPONENT_READ_DELAYS_MS).toEqual([1500, 3000, 6000, 12000]);
    PVP_OPPONENT_READ_DELAYS_MS.forEach((ms, attempts) => expect(pvpOpponentReadDelay("ready", mine, room, "p2", attempts)).toBe(ms));
    expect(pvpOpponentReadDelay("ready", mine, room, "p2", 4)).toBeNull();
    for (const status of ["idle", "pending", "unavailable"] as const) expect(pvpOpponentReadDelay(status, mine, room, "p2", 0)).toBeNull();
    expect(pvpOpponentReadDelay("ready", view, room, "p2", 0)).toBeNull(); // Already have it.
    expect(pvpOpponentReadDelay("ready", mine, reseated("p2", ""), "p2", 0)).toBeNull(); // Nobody to read for yet.
  });
  it("a missing badge stays pending only while my call is out or opponent reads remain", () => {
    expect(pvpSeatPending("p1", "p1", "pending", 4)).toBe(true);
    expect(pvpSeatPending("p1", "p1", "ready", 4)).toBe(false);
    expect(pvpSeatPending("p2", "p1", "ready", 1)).toBe(true);
    expect(pvpSeatPending("p2", "p1", "ready", 0)).toBe(false);
    expect(pvpSeatPending("p2", "p1", "unavailable", 4)).toBe(false);
    expect(pvpSeatPending("p2", "p1", "idle", 4)).toBe(false);
  });
});

describe("DECISIONS #71 and S4 copy on PvP cards", () => {
  it("badges are neutral: no host, no City authority claim (the level source is owner-writable until S4 closes)", () => {
    for (const [v, pending] of [[view, false], [null, true]] as const) {
      for (const [role, name] of [["p1", "ACE"], ["p2", "KUMA"]] as const) {
        const badge = pvpSeatBadge(v, room, role, name, pending)!;
        expect(`${badge.text} ${badge.accessibilityLabel}`).not.toMatch(/host|city/i);
      }
    }
  });
  it("no player-visible string or JSX text in any PvP file says host; none claims the City sets or vouches for a level", () => {
    const seen: string[] = [];
    for (const file of PVP_SCREEN_FILES) {
      for (const text of onScreenText(read(file))) {
        seen.push(text);
        expect(text, file).not.toMatch(/\bhost\b/i);
        // Until S4 closes no PvP string may mention the City at all (the City label returns with S4).
        expect(text, file).not.toMatch(/\bcity\b/i);
      }
    }
    // Control: the scanner does see real copy, so an empty scan cannot pass vacuously.
    expect(seen).toContain("Tap to change Holobot");
    expect(seen).toContain("Level pending");
    expect(onScreenText('<Text>Level set by the host</Text>')).toContain("Level set by the host");
    expect(onScreenText("<Text>LV {n} from the host</Text>")).toContain("from the host");
    expect(onScreenText("<Text>{label} City</Text>")).toContain("City");
  });
  it("no bare placeholder dash in PvP badge copy, and the LV tab sits on the portrait's lower-left corner", () => {
    for (const file of ["../../components/arena/PvpSeatBadges.tsx", "../bots/pvpFighterLevel.ts"]) {
      for (const text of onScreenText(read(file))) expect(text, file).not.toMatch(/—/);
    }
    expect(read("../../components/arena/PvpSeatBadges.tsx")).toMatch(/tab: \{[^}]*bottom: 0[^}]*left: 0[^}]*position: "absolute"/);
  });
});

describe("PvP cards print no local level", () => {
  it("PvpArenaModal and PvpSeatBadges never read a fighter/profile .level; badges come from pvpSeatBadge", () => {
    const modal = read("../../components/arena/PvpArenaModal.tsx");
    const seats = read("../../components/arena/PvpSeatBadges.tsx");
    for (const source of [modal, seats]) {
      expect(source).not.toMatch(/\.level\b/);
      expect(source).not.toMatch(/\bLv \$\{/i);
    }
    expect(modal).toContain("<PvpSeatBadges");
    expect(seats).toContain("pvpSeatBadge(view, room, role, name, pending[role])");
  });
});
