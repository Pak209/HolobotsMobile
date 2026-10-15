import React, { StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } as { uid: string } | null }, call: vi.fn() }));
vi.mock('@/config/firebase', () => ({ auth: m.auth, functions: {}, httpsCallable: () => m.call }));
import { useHostStoryState } from '@/hooks/useHostStoryState';
import { useRivalCooldown } from '@/hooks/useRivalCooldown';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mounted: ReactTestRenderer | undefined;
let account: ReturnType<typeof useHostStoryState>, rival: ReturnType<typeof useRivalCooldown>;
function Account({ uid }: { uid: string | null }) { account = useHostStoryState(uid); return null; }
function Rival({ uid }: { uid: string | null }) { rival = useRivalCooldown(uid, 'citizen_mina'); return null; }
beforeEach(() => { m.auth.currentUser = { uid: 'a' }; m.call.mockReset(); });
afterEach(async () => { if (mounted) await act(async () => mounted!.unmount()); mounted = undefined; vi.useRealTimers(); });
describe('real React host-state hook lifecycle', () => {
  it('survives StrictMode effect cleanup/setup and loads host progress', async () => {
    m.call.mockResolvedValue({ data: { uid: 'a', schemaVersion: 'desktop-account-3' } });
    await act(async () => { mounted = create(React.createElement(StrictMode, null, React.createElement(Account, { uid: 'a' }))); });
    expect(account.account?.uid).toBe('a'); expect(account.loading).toBe(false);
  });
  it('switches account without exposing the previous pilot progress', async () => {
    m.call.mockResolvedValue({ data: { uid: 'a', schemaVersion: 'desktop-account-3' } });
    await act(async () => { mounted = create(React.createElement(Account, { uid: 'a' })); });
    m.auth.currentUser = { uid: 'b' }; m.call.mockResolvedValue({ data: { uid: 'b', schemaVersion: 'desktop-account-3' } });
    await act(async () => mounted!.update(React.createElement(Account, { uid: 'b' })));
    expect(account.account?.uid).toBe('b');
    m.auth.currentUser = null; await act(async () => mounted!.update(React.createElement(Account, { uid: null })));
    expect(account.account).toBeNull();
  });
  it('renders the exact countdown, expires and cleans its timer on unmount', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    m.call.mockRejectedValue({ details: { rejectionCode: 'rival_cooldown', retryAfterMs: 1000 } });
    await act(async () => { mounted = create(React.createElement(Rival, { uid: 'a' })); });
    await act(async () => { await rival.request({ operation: 'issue', storySchema: 'arena-gathering-1', rivalId: 'citizen_mina' }).catch(() => {}); });
    expect(rival.retryAfterMs).toBe(1000);
    await act(async () => { await vi.advanceTimersByTimeAsync(750); }); expect(rival.retryAfterMs).toBe(250);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); }); expect(rival.retryAfterMs).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { await rival.request({ operation: 'issue', rivalId: 'citizen_mina', storySchema: 'arena-gathering-1' }).catch(() => {}); });
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => mounted!.unmount()); mounted = undefined; expect(vi.getTimerCount()).toBe(0);
  });
  it('rival session remains usable after StrictMode cleanup', async () => {
    m.call.mockResolvedValue({ data: { ok: true } });
    await act(async () => { mounted = create(React.createElement(StrictMode, null, React.createElement(Rival, { uid: 'a' }))); });
    await act(async () => { await expect(rival.request({ operation: 'status' })).resolves.toEqual({ ok: true }); });
  });
});
