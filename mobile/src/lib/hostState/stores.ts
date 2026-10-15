import { createStore } from 'zustand/vanilla';
import { CALLABLE_TIMEOUT_MS, withTimeout } from '@/lib/async';
import { readDesktopStoryState, readRivalRetryAfterMs, type DesktopStoryState } from './readers';

type AccountState = { account: DesktopStoryState | null; loading: boolean; error: string | null };
/** One instance per authenticated uid; disposing invalidates every in-flight response. */
export function createDesktopStoryStore(uid: string, invoke: () => Promise<unknown>) {
  const store = createStore<AccountState>(() => ({ account: null, loading: false, error: null }));
  let disposed = false;
  let generation = 0;
  let pending: Promise<void> | null = null;
  function refresh(): Promise<void> {
    if (disposed || !uid) return Promise.resolve();
    if (pending) return pending;
    const revision = generation;
    store.setState({ loading: true, error: null });
    pending = (async () => {
      try {
        const raw = await withTimeout(Promise.resolve().then(invoke), CALLABLE_TIMEOUT_MS, 'unavailable');
        if (!disposed && generation === revision) store.setState({ account: readDesktopStoryState(raw, uid) });
      } catch {
        if (!disposed && generation === revision) store.setState({ account: null, error: 'Account progress unavailable. Try again.' });
      } finally {
        if (generation === revision) pending = null;
        if (!disposed && generation === revision) store.setState({ loading: false });
      }
    })();
    return pending;
  }
  return { ...store, refresh, activate() { disposed = false; }, dispose() { disposed = true; generation++; pending = null; store.setState({ account: null, loading: false, error: null }); } };
}
export type RivalReadCommand = { operation: 'status' } | {
  operation: 'issue'; storySchema?: 'arena-gathering-1' | 'story-zell-1'; rivalId?: string;
};
/** A cooldown is a display hint for an issue request; it never authorizes or blocks a host request. */
export function createRivalCooldownStore(invoke: (command: RivalReadCommand & { schemaVersion: 'rival-battle-3' }) => Promise<unknown>, now = Date.now) {
  const store = createStore<{ deadlines: Readonly<Record<string, number>> }>(() => ({ deadlines: Object.freeze({}) }));
  let disposed = false;
  let generation = 0;
  // Most recently requested response wins for a given rival, even if transport completes out of order.
  const sequence = new Map<string, number>();
  async function request(command: RivalReadCommand): Promise<unknown> {
    if (disposed) throw new Error('session_closed');
    const epoch = generation;
    const key = command.operation === 'issue' ? command.rivalId ?? 'ladder' : null;
    const revision = key === null ? 0 : (sequence.get(key) ?? 0) + 1;
    if (key !== null) sequence.set(key, revision);
    try {
      const reply = await withTimeout(Promise.resolve().then(() => invoke({ ...command, schemaVersion: 'rival-battle-3' })), CALLABLE_TIMEOUT_MS, 'unavailable');
      if (disposed || epoch !== generation) throw new Error('session_closed');
      if (key !== null && sequence.get(key) === revision) {
        const deadlines = { ...store.getState().deadlines }; delete deadlines[key];
        store.setState({ deadlines: Object.freeze(deadlines) });
      }
      return reply;
    } catch (error) {
      if (!disposed && epoch === generation && key !== null && sequence.get(key) === revision) {
        const delay = readRivalRetryAfterMs(error), deadline = delay === null ? null : now() + delay;
        if (deadline !== null && Number.isSafeInteger(deadline)) {
          store.setState({ deadlines: Object.freeze({ ...store.getState().deadlines, [key]: deadline }) });
        }
      }
      throw error;
    }
  }
  return { ...store, request, activate() { disposed = false; }, dispose() { disposed = true; generation++; sequence.clear(); store.setState({ deadlines: Object.freeze({}) }); } };
}
