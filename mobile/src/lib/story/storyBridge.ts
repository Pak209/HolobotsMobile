import {
  CLIENT_WRITABLE_STORY_FLAGS,
  STORY_BUILDING_IDS,
  STORY_MAP_ID,
  STORY_MAP_SIZE,
  STORY_NPC_IDS,
  STORY_PROTOCOL_VERSION,
} from "@/config/storyMode";

/**
 * Native side of the Story Mode WebView bridge — pure, dependency-free core.
 * Implements docs/STORY_BRIDGE_CONTRACT.md §B–§D. The screen owns side effects
 * (navigation, overlays, persistence); this module only parses, validates and
 * builds messages so it can be unit-tested in Node.
 */

export const STORY_BRIDGE_MAX_BYTES = 4096;
export const STORY_BRIDGE_MAX_PER_SECOND = 20;
const RATE_WINDOW_MS = 1000;
const MAX_SEEN_IDS = 2000;

export type StoryEnvelope = { v: 1; id: string; type: string; payload: unknown };
export type StoryAck = { v: 1; replyTo: string; ok: boolean; error?: string };
export type StoryFacing = "up" | "down" | "left" | "right";
export type StoryCheckpoint = { mapId: string; x: number; y: number; facing: StoryFacing };

export type StoryEnvelopeError =
  | "INVALID_ENVELOPE"
  | "TOO_LARGE"
  | "RATE_LIMITED"
  | "DUPLICATE"
  | "UNSUPPORTED_VERSION";

export type StoryCommandError =
  | "INVALID_PAYLOAD"
  | "UNKNOWN_TYPE"
  | "PROTOCOL_MISMATCH"
  | "UNKNOWN_BUILDING"
  | "UNKNOWN_NPC"
  | "SERVER_ONLY"
  | "INVALID_CHECKPOINT"
  | "LOCKED";

export type StoryBridgeContext = { seenIds: Set<string>; rateWindow: number[]; now: number };

export type InboundCommand =
  | { type: "BRIDGE_HELLO"; protocolVersion: number; buildHash: string }
  | { type: "TALK_NPC"; npcId: string }
  | { type: "ENTER_BUILDING"; buildingId: string }
  | { type: "SET_STORY_FLAG"; flag: string; value: boolean }
  | { type: "SAVE_CHECKPOINT"; checkpoint: StoryCheckpoint }
  | { type: "REQUEST_REGION_ACCESS"; regionId: string }
  | { type: "START_ENCOUNTER"; encounterId: string };

export type ParseResult =
  | { ok: true; envelope: StoryEnvelope }
  | { ok: false; error: StoryEnvelopeError };

export type InterpretResult =
  | { ok: true; command: InboundCommand }
  | { ok: false; error: StoryCommandError };

export function createStoryBridgeContext(now = Date.now()): StoryBridgeContext {
  return { now, rateWindow: [], seenIds: new Set<string>() };
}

const FACINGS: readonly StoryFacing[] = ["up", "down", "left", "right"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1; // surrogate pair
    } else bytes += 3;
  }
  return bytes;
}

export function isStoryCheckpoint(value: unknown): value is StoryCheckpoint {
  return (
    isRecord(value) &&
    typeof value.mapId === "string" &&
    typeof value.x === "number" &&
    Number.isInteger(value.x) &&
    typeof value.y === "number" &&
    Number.isInteger(value.y) &&
    typeof value.facing === "string" &&
    (FACINGS as readonly string[]).includes(value.facing)
  );
}

export function isValidCheckpoint(checkpoint: StoryCheckpoint): boolean {
  return (
    checkpoint.mapId === STORY_MAP_ID &&
    checkpoint.x >= 0 &&
    checkpoint.x < STORY_MAP_SIZE.width &&
    checkpoint.y >= 0 &&
    checkpoint.y < STORY_MAP_SIZE.height
  );
}

/**
 * Envelope-level validation (contract §B). Mutates `ctx` (rate window, seen ids).
 * Never throws. Order: size → rate → shape → version → replay.
 */
export function parseInboundMessage(raw: string, ctx: StoryBridgeContext): ParseResult {
  if (typeof raw !== "string" || utf8ByteLength(raw) > STORY_BRIDGE_MAX_BYTES) {
    return { ok: false, error: "TOO_LARGE" };
  }

  const cutoff = ctx.now - RATE_WINDOW_MS;
  while (ctx.rateWindow.length > 0 && ctx.rateWindow[0] <= cutoff) {
    ctx.rateWindow.shift();
  }
  ctx.rateWindow.push(ctx.now);
  if (ctx.rateWindow.length > STORY_BRIDGE_MAX_PER_SECOND) {
    return { ok: false, error: "RATE_LIMITED" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "INVALID_ENVELOPE" };
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.id !== "string" ||
    parsed.id.length === 0 ||
    parsed.id.length > 128 ||
    typeof parsed.type !== "string" ||
    parsed.type.length === 0
  ) {
    return { ok: false, error: "INVALID_ENVELOPE" };
  }

  if (parsed.v !== 1) {
    return { ok: false, error: "UNSUPPORTED_VERSION" };
  }

  if (ctx.seenIds.has(parsed.id)) {
    return { ok: false, error: "DUPLICATE" };
  }
  ctx.seenIds.add(parsed.id);
  if (ctx.seenIds.size > MAX_SEEN_IDS) {
    const oldest = ctx.seenIds.values().next().value;
    if (typeof oldest === "string") ctx.seenIds.delete(oldest);
  }

  return {
    ok: true,
    envelope: { v: 1, id: parsed.id, type: parsed.type, payload: parsed.payload ?? {} },
  };
}

/**
 * Verb-level validation (contract §C + slice-0 amendment §H). Pure: returns the
 * command the screen should execute, or the contract error code to ACK with.
 */
export function interpretInbound(envelope: StoryEnvelope): InterpretResult {
  const payload = isRecord(envelope.payload) ? envelope.payload : {};

  switch (envelope.type) {
    case "BRIDGE_HELLO": {
      if (typeof payload.protocolVersion !== "number" || typeof payload.buildHash !== "string") {
        return { ok: false, error: "INVALID_PAYLOAD" };
      }
      if (payload.protocolVersion !== STORY_PROTOCOL_VERSION) {
        return { ok: false, error: "PROTOCOL_MISMATCH" };
      }
      return {
        ok: true,
        command: { type: "BRIDGE_HELLO", protocolVersion: payload.protocolVersion, buildHash: payload.buildHash },
      };
    }
    case "TALK_NPC": {
      if (typeof payload.npcId !== "string") return { ok: false, error: "INVALID_PAYLOAD" };
      if (!(STORY_NPC_IDS as readonly string[]).includes(payload.npcId)) {
        return { ok: false, error: "UNKNOWN_NPC" };
      }
      return { ok: true, command: { type: "TALK_NPC", npcId: payload.npcId } };
    }
    case "ENTER_BUILDING": {
      if (typeof payload.buildingId !== "string") return { ok: false, error: "INVALID_PAYLOAD" };
      if (!(STORY_BUILDING_IDS as readonly string[]).includes(payload.buildingId)) {
        return { ok: false, error: "UNKNOWN_BUILDING" };
      }
      return { ok: true, command: { type: "ENTER_BUILDING", buildingId: payload.buildingId } };
    }
    case "SET_STORY_FLAG": {
      if (typeof payload.flag !== "string" || typeof payload.value !== "boolean") {
        return { ok: false, error: "INVALID_PAYLOAD" };
      }
      if (!(CLIENT_WRITABLE_STORY_FLAGS as readonly string[]).includes(payload.flag)) {
        return { ok: false, error: "SERVER_ONLY" };
      }
      return { ok: true, command: { type: "SET_STORY_FLAG", flag: payload.flag, value: payload.value } };
    }
    case "SAVE_CHECKPOINT": {
      if (!isStoryCheckpoint(payload) || !isValidCheckpoint(payload)) {
        return { ok: false, error: "INVALID_CHECKPOINT" };
      }
      return {
        ok: true,
        command: {
          type: "SAVE_CHECKPOINT",
          checkpoint: { facing: payload.facing, mapId: payload.mapId, x: payload.x, y: payload.y },
        },
      };
    }
    case "REQUEST_REGION_ACCESS": {
      if (typeof payload.regionId !== "string") return { ok: false, error: "INVALID_PAYLOAD" };
      return { ok: true, command: { type: "REQUEST_REGION_ACCESS", regionId: payload.regionId } };
    }
    case "START_ENCOUNTER":
      // Not in slice 0 (docs/STORY_MODE_PLAN.md): always locked.
      return { ok: false, error: "LOCKED" };
    default:
      return { ok: false, error: "UNKNOWN_TYPE" };
  }
}

// ---------------------------------------------------------------------------
// Outbound builders (native → WebView), contract §D.
// ---------------------------------------------------------------------------

let outboundCounter = 0;

export function createOutboundId(now = Date.now()): string {
  outboundCounter = (outboundCounter + 1) % 1_000_000;
  return `native-${now.toString(36)}-${outboundCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeAck(replyTo: string, ok: boolean, error?: string): StoryAck {
  return error ? { v: 1, replyTo, ok, error } : { v: 1, replyTo, ok };
}

export function makeOutbound(type: string, payload: unknown, id = createOutboundId()): StoryEnvelope {
  return { v: 1, id, type, payload };
}

export type StoryStateSnapshot = {
  flags: Record<string, boolean>;
  regionsUnlocked: string[];
  checkpoint: StoryCheckpoint | null;
};

export function buildStoryStateMessage(snapshot: StoryStateSnapshot): StoryEnvelope {
  return makeOutbound("STORY_STATE", {
    checkpoint: snapshot.checkpoint,
    flags: snapshot.flags,
    protocolVersion: STORY_PROTOCOL_VERSION,
    regionsUnlocked: snapshot.regionsUnlocked,
  });
}

export function buildRegionAccessMessage(regionId: string, unlocked: boolean, reason?: string): StoryEnvelope {
  return makeOutbound("REGION_ACCESS", reason ? { reason, regionId, unlocked } : { regionId, unlocked });
}

export function buildAppEventMessage(kind: "background" | "foreground"): StoryEnvelope {
  return makeOutbound("APP_EVENT", { kind });
}
