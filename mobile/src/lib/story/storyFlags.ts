import AsyncStorage from "@react-native-async-storage/async-storage";

import { isStoryCheckpoint, type StoryCheckpoint } from "@/lib/story/storyBridge";

/**
 * Story-flag service (slice 0: local persistence only).
 *
 * TODO(slice-1): progression flags must be written by server callables
 * `setStoryFlag` / `completeStoryEncounter` into users/{uid}/story/{chapterId}
 * (see docs/STORY_BRIDGE_CONTRACT.md §A.3); this local store then becomes a
 * read-through cache of server state. Those callables are NOT created in slice 0.
 *
 * Invariant kept here regardless of backend: the WebView never authors a
 * progression flag — the screen calls setFlag after native UI events; the
 * bridge only forwards flags on the CLIENT_WRITABLE_STORY_FLAGS allowlist.
 */

export interface StoryFlagStore {
  load(): Promise<void>;
  getFlags(): Record<string, boolean>;
  setFlag(flag: string, value: boolean): Promise<void>;
  getCheckpoint(): StoryCheckpoint | null;
  setCheckpoint(checkpoint: StoryCheckpoint): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export type StoryStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

type PersistedStoryState = { flags: Record<string, boolean>; checkpoint: StoryCheckpoint | null };

export function getStoryStorageKey(uid: string) {
  return `story:v1:${uid}`;
}

function parsePersisted(raw: string | null): PersistedStoryState {
  const empty: PersistedStoryState = { checkpoint: null, flags: {} };
  if (!raw) return empty;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return empty;
    const record = parsed as Record<string, unknown>;
    const flags: Record<string, boolean> = {};
    if (typeof record.flags === "object" && record.flags !== null) {
      for (const [key, value] of Object.entries(record.flags as Record<string, unknown>)) {
        if (typeof value === "boolean") flags[key] = value;
      }
    }
    const checkpoint = isStoryCheckpoint(record.checkpoint) ? record.checkpoint : null;
    return { checkpoint, flags };
  } catch {
    return empty;
  }
}

export function createLocalStoryFlagStore(uid: string, storage: StoryStorageLike = AsyncStorage): StoryFlagStore {
  const key = getStoryStorageKey(uid);
  const listeners = new Set<() => void>();
  let state: PersistedStoryState = { checkpoint: null, flags: {} };
  let loaded = false;

  const notify = () => listeners.forEach((listener) => listener());

  const persist = async () => {
    try {
      await storage.setItem(key, JSON.stringify(state));
    } catch (error) {
      console.warn("[storyFlags] persist failed", error);
    }
  };

  return {
    async load() {
      if (loaded) return;
      let raw: string | null = null;
      try {
        raw = await storage.getItem(key);
      } catch (error) {
        console.warn("[storyFlags] load failed", error);
      }
      state = parsePersisted(raw);
      loaded = true;
      notify();
    },
    getFlags() {
      return { ...state.flags };
    },
    async setFlag(flag, value) {
      if (state.flags[flag] === value) return;
      state = { ...state, flags: { ...state.flags, [flag]: value } };
      notify();
      await persist();
    },
    getCheckpoint() {
      return state.checkpoint ? { ...state.checkpoint } : null;
    },
    async setCheckpoint(checkpoint) {
      state = { ...state, checkpoint: { ...checkpoint } };
      notify();
      await persist();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
