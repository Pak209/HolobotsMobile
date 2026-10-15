import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocalStoryFlagStore, getStoryStorageKey } from '@/lib/story/storyFlags';
import type { StoryCheckpoint } from '@/lib/story/storyBridge';

// Native persistence is the boundary; the real store, parser, and objective logic run below.
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn() },
}));

const checkpoint: StoryCheckpoint = { mapId: 'hangar-town', x: 4, y: 7, facing: 'left' };
function memoryStorage(entries: Array<[string, string]> = []) {
  const values = new Map(entries);
  return {
    values,
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('local boolean story cache (not the host account storyFlags contract)', () => {
  it('starts empty without I/O and derives the Guide objective', () => {
    const storage = memoryStorage();
    const store = createLocalStoryFlagStore('throwaway-a', storage);
    expect(store.getFlags()).toEqual({});
    expect(store.getCheckpoint()).toBeNull();
    expect(store.getObjective()).toEqual({ id: 'meet-guide', text: 'Meet the Guide' });
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('uses separate persisted keys for separate pilots', async () => {
    const storage = memoryStorage();
    const first = createLocalStoryFlagStore('throwaway-a', storage);
    const second = createLocalStoryFlagStore('throwaway-b', storage);
    expect(getStoryStorageKey('throwaway-a')).toBe('story:v1:throwaway-a');
    expect(getStoryStorageKey('throwaway-b')).toBe('story:v1:throwaway-b');
    await first.load(); await second.load();
    await first.setFlag('npc.guide.met', true);
    await second.setFlag('ui.dpad_seen', false);
    const reloadedA = createLocalStoryFlagStore('throwaway-a', storage);
    const reloadedB = createLocalStoryFlagStore('throwaway-b', storage);
    await reloadedA.load(); await reloadedB.load();
    expect(reloadedA.getFlags()).toEqual({ 'npc.guide.met': true });
    expect(reloadedB.getFlags()).toEqual({ 'ui.dpad_seen': false });
  });

  it('round-trips flags and checkpoint together through a fresh store', async () => {
    const storage = memoryStorage();
    const store = createLocalStoryFlagStore('throwaway-a', storage);
    await store.load();
    await store.setFlag('npc.guide.met', true);
    await store.setFlag('ui.dpad_seen', false);
    await store.setCheckpoint(checkpoint);
    expect(JSON.parse(storage.values.get('story:v1:throwaway-a')!)).toEqual({
      flags: { 'npc.guide.met': true, 'ui.dpad_seen': false }, checkpoint,
    });
    const reloaded = createLocalStoryFlagStore('throwaway-a', storage);
    await reloaded.load();
    expect(reloaded.getFlags()).toEqual(store.getFlags());
    expect(reloaded.getCheckpoint()).toEqual(checkpoint);
    expect(reloaded.getObjective()).toEqual({ id: 'visit-gacha', text: 'Visit the Gacha Hangar' });
  });

  it('keeps true and false flags while dropping nonboolean persisted values', async () => {
    const raw = JSON.stringify({ flags: { yes: true, no: false, number: 2, string: 'true', nil: null, object: {}, list: [] }, checkpoint });
    const storage = memoryStorage([['story:v1:throwaway-a', raw]]);
    const store = createLocalStoryFlagStore('throwaway-a', storage);
    await store.load();
    expect(store.getFlags()).toEqual({ yes: true, no: false });
    expect(store.getCheckpoint()).toEqual(checkpoint);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([null, '', '{broken', 'null', '17', '"text"', '[]'])('tolerates absent or malformed persisted root %s', async raw => {
    const storage = memoryStorage(raw === null ? [] : [['story:v1:throwaway-a', raw]]);
    const store = createLocalStoryFlagStore('throwaway-a', storage);
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.getFlags()).toEqual({});
    expect(store.getCheckpoint()).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it.each([null, false, 2, 'true'])('ignores non-object flag maps %s', async flags => {
    const storage = memoryStorage([['story:v1:throwaway-a', JSON.stringify({ flags, checkpoint })]]);
    const store = createLocalStoryFlagStore('throwaway-a', storage);
    await store.load();
    expect(store.getFlags()).toEqual({});
    expect(store.getCheckpoint()).toEqual(checkpoint);
  });

  it.each([
    null, [], 'checkpoint', {},
    { mapId: 'hangar-town', x: 1.5, y: 2, facing: 'up' },
    { mapId: 'hangar-town', x: 1, y: '2', facing: 'up' },
    { mapId: 'hangar-town', x: 1, y: 2, facing: 'diagonal' },
  ])('drops a malformed checkpoint while retaining valid flags: %j', async invalid => {
    const storage = memoryStorage([['story:v1:throwaway-a', JSON.stringify({ flags: { known: true }, checkpoint: invalid })]]);
    const store = createLocalStoryFlagStore('throwaway-a', storage);
    await store.load();
    expect(store.getFlags()).toEqual({ known: true });
    expect(store.getCheckpoint()).toBeNull();
  });

  it('sequential load is idempotent and does not overwrite newer in-memory changes', async () => {
    const storage = memoryStorage([['story:v1:throwaway-a', JSON.stringify({ flags: { saved: true } })]]);
    const store = createLocalStoryFlagStore('throwaway-a', storage);
    const listener = vi.fn(); store.subscribe(listener);
    await store.load();
    await store.setFlag('newer', true);
    storage.values.set('story:v1:throwaway-a', JSON.stringify({ flags: { stale: true } }));
    await store.load();
    expect(storage.getItem).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getFlags()).toEqual({ saved: true, newer: true });
  });

  it('notifies after load state is visible and suppresses repeated same-value flags', async () => {
    const storage = memoryStorage([['story:v1:throwaway-a', JSON.stringify({ flags: { known: false } })]]);
    const store = createLocalStoryFlagStore('throwaway-a', storage);
    const observed: Array<Record<string, boolean>> = [];
    store.subscribe(() => observed.push(store.getFlags()));
    await store.load();
    await store.setFlag('known', false);
    expect(observed).toEqual([{ known: false }]);
    expect(storage.setItem).not.toHaveBeenCalled();
    await store.setFlag('known', true);
    await store.setFlag('known', true);
    expect(observed).toEqual([{ known: false }, { known: true }]);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('deduplicates listener identity and supports independent, repeated unsubscribe', async () => {
    const store = createLocalStoryFlagStore('throwaway-a', memoryStorage());
    const first = vi.fn(), second = vi.fn();
    const stopFirst = store.subscribe(first); store.subscribe(first);
    const stopSecond = store.subscribe(second);
    await store.load();
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    stopFirst(); stopFirst();
    await store.setFlag('next', true);
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
    await store.setCheckpoint(checkpoint);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('getFlags returns a defensive copy that cannot alter later persistence', async () => {
    const storage = memoryStorage();
    const store = createLocalStoryFlagStore('throwaway-a', storage);
    await store.setFlag('known', true);
    const flags = store.getFlags(); flags.known = false; flags.injected = true;
    expect(store.getFlags()).toEqual({ known: true });
    await store.setCheckpoint(checkpoint);
    expect(JSON.parse(storage.values.get('story:v1:throwaway-a')!).flags).toEqual({ known: true });
  });

  it('clones the checkpoint on both set and get', async () => {
    const store = createLocalStoryFlagStore('throwaway-a', memoryStorage());
    const supplied = { ...checkpoint };
    await store.setCheckpoint(supplied); supplied.x = 50;
    const received = store.getCheckpoint(); expect(received).toEqual(checkpoint);
    if (!received) throw new Error('checkpoint expected');
    received.y = 30;
    expect(store.getCheckpoint()).toEqual(checkpoint);
  });

  it('load errors warn and leave a usable empty cache', async () => {
    const storage = memoryStorage(), failure = new Error('storage unavailable');
    storage.getItem.mockRejectedValueOnce(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createLocalStoryFlagStore('throwaway-a', storage), listener = vi.fn();
    store.subscribe(listener);
    await expect(store.load()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[storyFlags] load failed', failure);
    expect(store.getFlags()).toEqual({}); expect(store.getCheckpoint()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    await store.setFlag('npc.guide.met', true);
    expect(store.getObjective()?.id).toBe('visit-gacha');
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('persist errors warn without discarding visible state, and a later change can persist it', async () => {
    const storage = memoryStorage(), failure = new Error('disk full');
    storage.setItem.mockRejectedValueOnce(failure);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createLocalStoryFlagStore('throwaway-a', storage), listener = vi.fn();
    store.subscribe(listener);
    await expect(store.setFlag('npc.guide.met', true)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[storyFlags] persist failed', failure);
    expect(store.getFlags()).toEqual({ 'npc.guide.met': true }); expect(listener).toHaveBeenCalledTimes(1);
    await store.setCheckpoint(checkpoint);
    expect(JSON.parse(storage.values.get('story:v1:throwaway-a')!)).toEqual({ flags: { 'npc.guide.met': true }, checkpoint });
  });

  it('uses AsyncStorage by default without requiring a native runtime in this suite', async () => {
    vi.mocked(AsyncStorage.getItem).mockResolvedValueOnce(JSON.stringify({ flags: { 'npc.guide.met': true }, checkpoint }));
    vi.mocked(AsyncStorage.setItem).mockResolvedValueOnce();
    const store = createLocalStoryFlagStore('throwaway-default');
    await store.load(); await store.setFlag('ui.dpad_seen', true);
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('story:v1:throwaway-default');
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const [key, serialized] = vi.mocked(AsyncStorage.setItem).mock.calls[0];
    expect(key).toBe('story:v1:throwaway-default');
    expect(JSON.parse(serialized)).toEqual({ checkpoint, flags: { 'npc.guide.met': true, 'ui.dpad_seen': true } });
  });
});
