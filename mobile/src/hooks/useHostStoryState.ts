import { useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { desktopStoryStoreForUid } from '@/lib/hostState/firebase';
/** Read-only host state. It must never be merged into the local boolean Story Mode cache. */
export function useHostStoryState(uid: string | null) {
  const store = useMemo(() => desktopStoryStoreForUid(uid ?? ''), [uid]);
  const state = useStore(store);
  useEffect(() => { store.activate(); void store.refresh(); return () => store.dispose(); }, [store]);
  return { ...state, refresh: store.refresh };
}
