import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { rivalCooldownStoreForUid } from '@/lib/hostState/firebase';
import { remainingCooldownMs } from '@/lib/hostState/readers';
/** One session per signed-in pilot; the host is still consulted on every issue. */
export function useRivalCooldown(uid: string | null, rivalId = 'ladder') {
  const store = useMemo(() => rivalCooldownStoreForUid(uid ?? ''), [uid]);
  const deadline = useStore(store, state => state.deadlines[rivalId] ?? null);
  const [nowMs, setNowMs] = useState(Date.now);
  useEffect(() => { store.activate(); return () => store.dispose(); }, [store]);
  useEffect(() => {
    setNowMs(Date.now());
    if (deadline === null || deadline <= Date.now()) return;
    const timer = setInterval(() => {
      const now = Date.now(); setNowMs(now);
      if (now >= deadline) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [deadline]);
  return { retryAfterMs: remainingCooldownMs(deadline, nowMs), request: store.request };
}
