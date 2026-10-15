import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } as { uid: string } | null }, call: vi.fn(), names: [] as string[] }));
vi.mock('@/config/firebase', () => ({ auth: m.auth, functions: {}, httpsCallable: (_: unknown, name: string) => { m.names.push(name); return m.call; } }));
import { desktopStoryStoreForUid, rivalCooldownStoreForUid } from '../firebase';
beforeEach(() => { m.auth.currentUser = { uid: 'a' }; m.call.mockReset(); m.names.length = 0; });
describe('authenticated mobile host-state adapters', () => {
  it('reads the real desktop callable name and v3 schema without caller uid payload', async () => {
    m.call.mockResolvedValue({ data: { uid: 'a', schemaVersion: 'desktop-account-3' } });
    const store = desktopStoryStoreForUid('a'); await store.refresh();
    expect(m.names).toEqual(['desktopAccountSnapshot']); expect(m.call).toHaveBeenCalledWith({ schemaVersion: 'desktop-account-3' });
    expect(store.getState().account?.uid).toBe('a');
  });
  it('never calls for another uid or a signed-out user', async () => {
    await desktopStoryStoreForUid('b').refresh(); m.auth.currentUser = null; await desktopStoryStoreForUid('a').refresh();
    expect(m.call).not.toHaveBeenCalled();
  });
  it('drops account data after an auth switch during transport', async () => {
    m.call.mockImplementation(async () => { m.auth.currentUser = { uid: 'b' }; return { data: { uid: 'a', schemaVersion: 'desktop-account-3' } }; });
    const store = desktopStoryStoreForUid('a'); await store.refresh(); expect(store.getState().account).toBeNull();
  });
  it('preserves structured host cooldown errors for the bound pilot', async () => {
    const error = { code: 'functions/failed-precondition', details: { rejectionCode: 'rival_cooldown', retryAfterMs: 1234 } };
    m.call.mockRejectedValue(error); const store = rivalCooldownStoreForUid('a');
    await expect(store.request({ operation: 'issue' })).rejects.toBe(error);
    expect(m.names).toEqual(['rivalBattleHost']); expect(store.getState().deadlines.ladder).toBeGreaterThan(Date.now());
  });
  it('does not retain another account cooldown if auth changes on an error', async () => {
    m.call.mockImplementation(async () => { m.auth.currentUser = null; throw { details: { rejectionCode: 'rival_cooldown', retryAfterMs: 9999 } }; });
    const store = rivalCooldownStoreForUid('a'); await expect(store.request({ operation: 'issue' })).rejects.toThrow('unauthenticated');
    expect(store.getState().deadlines).toEqual({});
  });
});
