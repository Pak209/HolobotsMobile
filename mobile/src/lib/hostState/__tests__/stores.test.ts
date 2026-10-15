import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDesktopStoryStore, createRivalCooldownStore } from '../stores';
const reply = (uid = 'a') => ({ uid, schemaVersion: 'desktop-account-3' });
const cooldown = (retryAfterMs: number) => ({ details: { rejectionCode: 'rival_cooldown', retryAfterMs } });
const issue = (rivalId = 'citizen_mina') => ({ operation: 'issue' as const, rivalId, storySchema: 'arena-gathering-1' as const });
function deferred() { let resolve!: (v: unknown) => void, reject!: (e: unknown) => void; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
afterEach(() => vi.useRealTimers());
describe('desktop story consumer store', () => {
  it('deduplicates loads and publishes only a parsed host reply', async () => {
    const d = deferred(), invoke = vi.fn(() => d.promise), store = createDesktopStoryStore('a', invoke), observer = vi.fn();
    const off = store.subscribe(observer), first = store.refresh(), second = store.refresh();
    expect(first).toBe(second); expect(store.getState().loading).toBe(true);
    d.resolve(reply()); await first;
    expect(invoke).toHaveBeenCalledTimes(1); expect(store.getState()).toMatchObject({ loading: false, error: null, account: { uid: 'a' } });
    off(); const count = observer.mock.calls.length; await store.refresh(); expect(observer).toHaveBeenCalledTimes(count);
  });
  it('clears stale gates on malformed refresh and recovers on retry', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply('other')).mockResolvedValueOnce(reply());
    const store = createDesktopStoryStore('a', invoke); await store.refresh(); await store.refresh();
    expect(store.getState()).toMatchObject({ account: null, loading: false, error: expect.any(String) });
    await store.refresh(); expect(store.getState().account?.uid).toBe('a');
  });
  it('disposal drops pending account data and removes prior progress', async () => {
    const d = deferred(), store = createDesktopStoryStore('a', () => d.promise);
    const pending = store.refresh(); store.dispose(); d.resolve(reply()); await pending;
    expect(store.getState()).toEqual({ account: null, loading: false, error: null });
  });
  it('times out a stalled read and ignores its late result', async () => {
    vi.useFakeTimers(); const d = deferred(), store = createDesktopStoryStore('a', () => d.promise);
    const pending = store.refresh(); await vi.advanceTimersByTimeAsync(15000); await pending;
    expect(store.getState()).toMatchObject({ account: null, loading: false, error: expect.any(String) });
    d.resolve(reply()); await Promise.resolve(); expect(store.getState().account).toBeNull();
  });
  it('reactivation cannot publish an old generation or end the new load', async () => {
    const a = deferred(), b = deferred(), invoke = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const store = createDesktopStoryStore('a', invoke), first = store.refresh();
    await Promise.resolve(); store.dispose(); store.activate(); const second = store.refresh();
    a.resolve({ ...reply(), pilotRank: 99 }); await first;
    expect(store.getState()).toMatchObject({ account: null, loading: true });
    b.resolve({ ...reply(), pilotRank: 2 }); await second; expect(store.getState().account?.pilotRank).toBe(2);
  });
  it('does not issue a signed-out request', async () => {
    const invoke = vi.fn(), store = createDesktopStoryStore('', invoke); await store.refresh(); expect(invoke).not.toHaveBeenCalled();
  });
});
describe('rival issue refusal consumer', () => {
  it('anchors retryAfterMs to receipt time, not request time', async () => {
    let now = 100; const d = deferred(), invoke = vi.fn(() => d.promise), store = createRivalCooldownStore(invoke, () => now);
    const result = store.request(issue()); now = 10000; d.reject(cooldown(2500));
    await expect(result).rejects.toEqual(cooldown(2500)); expect(store.getState().deadlines.citizen_mina).toBe(12500);
    expect(invoke).toHaveBeenCalledWith({ ...issue(), schemaVersion: 'rival-battle-3' });
  });
  it('isolates rivals and clears only a successful issue; status does not clear', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(cooldown(1000)).mockRejectedValueOnce(cooldown(2000)).mockResolvedValue({ ok: true });
    const store = createRivalCooldownStore(invoke, () => 100);
    await expect(store.request(issue())).rejects.toBeDefined(); await expect(store.request(issue('citizen_ren'))).rejects.toBeDefined();
    await store.request({ operation: 'status' }); expect(Object.keys(store.getState().deadlines)).toHaveLength(2);
    await store.request(issue()); expect(store.getState().deadlines).toEqual({ citizen_ren: 2100 });
    expect(invoke).toHaveBeenCalledTimes(4); // Local deadline never blocks the authoritative request.
  });
  it('latest request wins over an out-of-order cooldown refusal', async () => {
    const a = deferred(), b = deferred(), invoke = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const store = createRivalCooldownStore(invoke, () => 100), first = store.request(issue()), second = store.request(issue());
    b.resolve({ ok: true }); await second; a.reject(cooldown(5000)); await expect(first).rejects.toBeDefined();
    expect(store.getState().deadlines).toEqual({});
  });
  it('preserves known cooldown on network or malformed errors', async () => {
    const invoke = vi.fn().mockRejectedValueOnce(cooldown(1000)).mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(cooldown(-1));
    const store = createRivalCooldownStore(invoke, () => 100);
    for (let i = 0; i < 3; i++) await expect(store.request(issue())).rejects.toBeDefined();
    expect(store.getState().deadlines).toEqual({ citizen_mina: 1100 });
  });
  it('reactivation isolates an old refusal even when the request key repeats', async () => {
    const a = deferred(), b = deferred(), invoke = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const store = createRivalCooldownStore(invoke, () => 100), first = store.request(issue());
    await Promise.resolve(); store.dispose(); store.activate(); const second = store.request(issue());
    b.reject(cooldown(1000)); await expect(second).rejects.toBeDefined();
    a.reject(cooldown(99999)); await expect(first).rejects.toBeDefined();
    expect(store.getState().deadlines.citizen_mina).toBe(1100);
  });
  it('drops pending refusals after disposal and refuses new requests', async () => {
    const d = deferred(), store = createRivalCooldownStore(() => d.promise), pending = store.request(issue());
    store.dispose(); d.reject(cooldown(1000)); await expect(pending).rejects.toBeDefined();
    expect(store.getState().deadlines).toEqual({}); await expect(store.request(issue())).rejects.toThrow('session_closed');
  });
});
