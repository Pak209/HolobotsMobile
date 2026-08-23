import { describe, expect, it } from "vitest";

import {
  buildDialogueStateMessage,
  buildStoryStateMessage,
  createStoryBridgeContext,
  decodeWalkableMask,
  deriveObjective,
  interpretInbound,
  makeAck,
  parseInboundMessage,
  type StoryEnvelope,
} from "@/lib/story/storyBridge";
import { getHttpOrigin, isAllowedOverworldOrigin } from "@/config/storyMode";

const envelope = (type: string, payload: unknown, id = `id-${type}`): string =>
  JSON.stringify({ v: 1, id, type, payload });

const parsed = (type: string, payload: unknown): StoryEnvelope => ({ v: 1, id: `id-${type}`, type, payload });

describe("story bridge envelope parsing", () => {
  it("accepts a valid v1 envelope", () => {
    const ctx = createStoryBridgeContext(1_000);
    const result = parseInboundMessage(envelope("BRIDGE_HELLO", { protocolVersion: 1, buildHash: "dev" }), ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.type).toBe("BRIDGE_HELLO");
  });

  it("rejects bad JSON, wrong version, oversize, duplicates and floods", () => {
    const ctx = createStoryBridgeContext(1_000);
    expect(parseInboundMessage("{not json", ctx)).toEqual({ ok: false, error: "INVALID_ENVELOPE" });
    expect(parseInboundMessage(JSON.stringify({ v: 2, id: "x", type: "BRIDGE_HELLO", payload: {} }), ctx)).toEqual({
      ok: false,
      error: "UNSUPPORTED_VERSION",
    });
    expect(parseInboundMessage(JSON.stringify({ v: 1, type: "NO_ID", payload: {} }), ctx)).toEqual({
      ok: false,
      error: "INVALID_ENVELOPE",
    });
    const big = JSON.stringify({ v: 1, id: "big", type: "TALK_NPC", payload: { pad: "x".repeat(4100) } });
    expect(parseInboundMessage(big, ctx)).toEqual({ ok: false, error: "TOO_LARGE" });

    const dupCtx = createStoryBridgeContext(1_000);
    expect(parseInboundMessage(envelope("TALK_NPC", { npcId: "guide" }, "same"), dupCtx).ok).toBe(true);
    expect(parseInboundMessage(envelope("TALK_NPC", { npcId: "guide" }, "same"), dupCtx)).toEqual({
      ok: false,
      error: "DUPLICATE",
    });

    const floodCtx = createStoryBridgeContext(5_000);
    for (let i = 0; i < 20; i += 1) {
      expect(parseInboundMessage(envelope("TALK_NPC", { npcId: "guide" }, `f${i}`), floodCtx).ok).toBe(true);
    }
    expect(parseInboundMessage(envelope("TALK_NPC", { npcId: "guide" }, "f20"), floodCtx)).toEqual({
      ok: false,
      error: "RATE_LIMITED",
    });
    floodCtx.now = 6_100; // window rolled over → accepted again
    expect(parseInboundMessage(envelope("TALK_NPC", { npcId: "guide" }, "f21"), floodCtx).ok).toBe(true);
  });
});

describe("story bridge verb interpretation", () => {
  it("enforces the protocol handshake and allowlists", () => {
    expect(interpretInbound(parsed("BRIDGE_HELLO", { protocolVersion: 3, buildHash: "x" }))).toEqual({
      ok: false,
      error: "PROTOCOL_MISMATCH",
    });
    expect(interpretInbound(parsed("BRIDGE_HELLO", { protocolVersion: 1, buildHash: "x" })).ok).toBe(true);
    expect(interpretInbound(parsed("BRIDGE_HELLO", { protocolVersion: 2, buildHash: "x" })).ok).toBe(true);
    expect(interpretInbound(parsed("ENTER_BUILDING", { buildingId: "arena" }))).toEqual({
      ok: false,
      error: "UNKNOWN_BUILDING",
    });
    expect(interpretInbound(parsed("ENTER_BUILDING", { buildingId: "gacha" })).ok).toBe(true);
    expect(interpretInbound(parsed("TALK_NPC", { npcId: "mayor" }))).toEqual({ ok: false, error: "UNKNOWN_NPC" });
    expect(interpretInbound(parsed("TALK_NPC", { npcId: "guide" })).ok).toBe(true);
  });

  it("never lets the WebView author progression flags", () => {
    expect(interpretInbound(parsed("SET_STORY_FLAG", { flag: "npc.guide.met", value: true }))).toEqual({
      ok: false,
      error: "SERVER_ONLY",
    });
    expect(interpretInbound(parsed("SET_STORY_FLAG", { flag: "ui.dpad_seen", value: true })).ok).toBe(true);
    expect(interpretInbound(parsed("GRANT_REWARD", { holos: 999 }))).toEqual({ ok: false, error: "UNKNOWN_TYPE" });
    expect(interpretInbound(parsed("START_ENCOUNTER", { encounterId: "rival-1" }))).toEqual({
      ok: false,
      error: "LOCKED",
    });
  });

  it("validates checkpoints against the slice-0 map", () => {
    expect(interpretInbound(parsed("SAVE_CHECKPOINT", { mapId: "hangar-town", x: 25, y: 3, facing: "up" }))).toEqual({
      ok: false,
      error: "INVALID_CHECKPOINT",
    });
    expect(interpretInbound(parsed("SAVE_CHECKPOINT", { mapId: "other", x: 1, y: 1, facing: "up" }))).toEqual({
      ok: false,
      error: "INVALID_CHECKPOINT",
    });
    const good = interpretInbound(parsed("SAVE_CHECKPOINT", { mapId: "hangar-town", x: 10, y: 9, facing: "left" }));
    expect(good.ok).toBe(true);
  });

  it("builds contract-shaped outbound messages", () => {
    expect(makeAck("abc", false, "BUSY")).toEqual({ v: 1, replyTo: "abc", ok: false, error: "BUSY" });
    const state = buildStoryStateMessage({ checkpoint: null, flags: { "npc.guide.met": true }, regionsUnlocked: [] });
    expect(state.v).toBe(1);
    expect(state.type).toBe("STORY_STATE");
    expect(state.payload).toEqual({
      checkpoint: null,
      currentObjective: null,
      flags: { "npc.guide.met": true },
      protocolVersion: 2,
      regionsUnlocked: [],
    });
    const withObjective = buildStoryStateMessage({
      checkpoint: null,
      currentObjective: { id: "meet-guide", text: "Meet the Guide" },
      flags: {},
      regionsUnlocked: [],
    });
    expect((withObjective.payload as { currentObjective: unknown }).currentObjective).toEqual({
      id: "meet-guide",
      text: "Meet the Guide",
    });
    const dialogue = buildDialogueStateMessage(true, "guide");
    expect(dialogue.v).toBe(1);
    expect(dialogue.type).toBe("DIALOGUE_STATE");
    expect(dialogue.payload).toEqual({ npcId: "guide", open: true });
  });
});

describe("round D: HELLO map descriptor, PLAYER_POS, objectives", () => {
  it("parses a HELLO map descriptor and decodes the walkable bitmask", () => {
    // 2×3 grid, bits 1,0,1,1,0,1 → byte 0b10110100 → base64 "tA=="
    const hello = interpretInbound(
      parsed("BRIDGE_HELLO", {
        protocolVersion: 2,
        buildHash: "dev",
        map: { width: 2, height: 3, walkable: "tA==", pois: [{ id: "h3Core", x: 1, y: 2 }] },
      }),
    );
    expect(hello.ok).toBe(true);
    if (hello.ok && hello.command.type === "BRIDGE_HELLO") {
      expect(hello.command.map?.pois).toEqual([{ id: "h3Core", x: 1, y: 2 }]);
      expect(decodeWalkableMask(hello.command.map!.walkable, 2, 3)).toEqual([
        [true, false],
        [true, true],
        [false, true],
      ]);
    }
  });

  it("rejects a malformed map (poi out of bounds / short mask) but keeps HELLO without a map", () => {
    expect(
      interpretInbound(
        parsed("BRIDGE_HELLO", {
          protocolVersion: 2,
          buildHash: "dev",
          map: { width: 2, height: 3, walkable: "tA==", pois: [{ id: "arena", x: 5, y: 0 }] },
        }),
      ),
    ).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
    expect(
      interpretInbound(
        parsed("BRIDGE_HELLO", { protocolVersion: 2, buildHash: "dev", map: { width: 20, height: 20, walkable: "tA==", pois: [] } }),
      ),
    ).toEqual({ ok: false, error: "INVALID_PAYLOAD" });
    expect(interpretInbound(parsed("BRIDGE_HELLO", { protocolVersion: 2, buildHash: "dev" })).ok).toBe(true);
  });

  it("accepts PLAYER_POS with ints + facing + zone and rejects bad shapes", () => {
    const good = interpretInbound(parsed("PLAYER_POS", { x: 10, y: 9, facing: "up", zone: "H3 Plaza" }));
    expect(good).toEqual({ ok: true, command: { type: "PLAYER_POS", x: 10, y: 9, facing: "up", zone: "H3 Plaza" } });
    expect(interpretInbound(parsed("PLAYER_POS", { x: 1.5, y: 9, facing: "up", zone: "x" }))).toEqual({
      ok: false,
      error: "INVALID_PAYLOAD",
    });
    expect(interpretInbound(parsed("PLAYER_POS", { x: 1, y: 9, facing: "north", zone: "x" }))).toEqual({
      ok: false,
      error: "INVALID_PAYLOAD",
    });
    expect(interpretInbound(parsed("PLAYER_POS", { x: 1, y: 9, facing: "up", zone: "" }))).toEqual({
      ok: false,
      error: "INVALID_PAYLOAD",
    });
  });

  it("derives the quest objective from flags", () => {
    expect(deriveObjective({})).toEqual({ id: "meet-guide", text: "Meet the Guide" });
    expect(deriveObjective({ "npc.guide.met": true })).toEqual({ id: "visit-gacha", text: "Visit the Gacha Hangar" });
  });
});

describe("overworld origin gate", () => {
  it("allows the dev origin only in dev builds and never file://", () => {
    const devUrl = "http://192.168.1.23:5173/overworld.html";
    expect(getHttpOrigin(devUrl)).toBe("http://192.168.1.23:5173");
    expect(isAllowedOverworldOrigin("http://192.168.1.23:5173/overworld.html?x=1", { dev: true, devUrl })).toBe(true);
    expect(isAllowedOverworldOrigin("http://192.168.1.23:5173/overworld.html", { dev: false, devUrl })).toBe(false);
    expect(isAllowedOverworldOrigin("http://evil.example:5173/overworld.html", { dev: true, devUrl })).toBe(false);
    expect(isAllowedOverworldOrigin("file:///overworld.html", { dev: true, devUrl })).toBe(false);
    expect(isAllowedOverworldOrigin("https://play.holobots.fun/overworld/v1/", { dev: false, devUrl })).toBe(true);
  });
});
