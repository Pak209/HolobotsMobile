import type { MapDescriptor } from "./mapDescriptor";

export const STORY_PROTOCOL_VERSION = 2 as const;
export const STORY_SUPPORTED_PROTOCOL_VERSIONS = [1, 2] as const;

export type Ack = { v: 1 | 2; replyTo: string; ok: boolean; error?: string };
export type StoryCheckpoint = {
  mapId: string;
  x: number;
  y: number;
  facing: "up" | "down" | "left" | "right";
};
export type StoryStatePayload = {
  flags: Record<string, boolean>;
  regionsUnlocked: string[];
  checkpoint: StoryCheckpoint | null;
  protocolVersion: number;
};
export type DialogueStatePayload = { open: boolean; npcId: string };
export type NativeMessage = { v: 1 | 2; id: string; type: string; payload: Record<string, unknown> };

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

const makeId = () => globalThis.crypto?.randomUUID?.()
  ?? `story-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const isAck = (value: unknown): value is Ack => {
  const candidate = value as Partial<Ack> | null;
  return !!candidate && STORY_SUPPORTED_PROTOCOL_VERSIONS.includes(candidate.v as 1 | 2)
    && typeof candidate.replyTo === "string" && typeof candidate.ok === "boolean";
};

export const parseNativeMessage = (data: unknown): NativeMessage | null => {
  try {
    const value = typeof data === "string" ? JSON.parse(data) : data;
    const candidate = value as Partial<NativeMessage> | null;
    return !!candidate && STORY_SUPPORTED_PROTOCOL_VERSIONS.includes(candidate.v as 1 | 2)
      && typeof candidate.id === "string" && typeof candidate.type === "string"
      && !!candidate.payload && typeof candidate.payload === "object" ? candidate as NativeMessage : null;
  } catch {
    return null;
  }
};

const isFacing = (value: unknown): value is StoryCheckpoint["facing"] =>
  value === "up" || value === "down" || value === "left" || value === "right";

export const isStoryStatePayload = (value: unknown): value is StoryStatePayload => {
  const state = value as Partial<StoryStatePayload> | null;
  const point = state?.checkpoint as Partial<StoryCheckpoint> | null | undefined;
  return !!state && typeof state.protocolVersion === "number" && !!state.flags && typeof state.flags === "object"
    && Object.values(state.flags).every((flag) => typeof flag === "boolean")
    && Array.isArray(state.regionsUnlocked) && state.regionsUnlocked.every((region) => typeof region === "string")
    && (point === null || (!!point && typeof point.mapId === "string"
      && Number.isInteger(point.x) && Number.isInteger(point.y) && isFacing(point.facing)));
};

export const isDialogueStatePayload = (value: unknown): value is DialogueStatePayload => {
  const state = value as Partial<DialogueStatePayload> | null;
  return !!state && typeof state.open === "boolean" && typeof state.npcId === "string";
};

const listen = (handler: (event: MessageEvent) => void) => {
  window.addEventListener("message", handler);
  document.addEventListener("message", handler as EventListener);
  return () => {
    window.removeEventListener("message", handler);
    document.removeEventListener("message", handler as EventListener);
  };
};

export const isNativeBridgeAvailable = () => typeof window.ReactNativeWebView?.postMessage === "function";

export const isProtocolMismatchError = (error: unknown): boolean =>
  error instanceof Error && error.message === "PROTOCOL_MISMATCH";

export const send = (type: string, payload: Record<string, unknown>): Promise<Ack> => {
  const id = makeId();
  const envelope = { v: STORY_PROTOCOL_VERSION, id, type, payload };
  if (!isNativeBridgeAvailable()) {
    console.info("[StoryBridge] desktop", envelope);
    return Promise.resolve({ v: 1, replyTo: id, ok: true });
  }
  return new Promise((resolve, reject) => {
    const stop = listen((event) => {
      let value: unknown;
      try { value = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!isAck(value) || value.replyTo !== id) return;
      clearTimeout(timeout);
      stop();
      value.ok ? resolve(value) : reject(new Error(value.error ?? "BRIDGE_REJECTED"));
    });
    const timeout = window.setTimeout(() => {
      stop();
      reject(new Error("BRIDGE_TIMEOUT"));
    }, 5000);
    window.ReactNativeWebView?.postMessage(JSON.stringify(envelope));
  });
};

export const onMessage = (handler: (message: NativeMessage) => void) => listen((event) => {
  const message = parseNativeMessage(event.data);
  if (message) handler(message);
});

export const hello = (buildHash: string, map?: MapDescriptor) => send("BRIDGE_HELLO", {
  protocolVersion: STORY_PROTOCOL_VERSION,
  buildHash,
  map,
});
