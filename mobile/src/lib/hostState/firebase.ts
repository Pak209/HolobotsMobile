import { auth, functions, httpsCallable } from '@/config/firebase';
import { createDesktopStoryStore, createRivalCooldownStore } from './stores';
/** Match auth on both sides of the await; logout/account switches cannot publish stale progress. */
function invokeForUid(uid: string, name: string) {
  const call = httpsCallable<Record<string, unknown>, unknown>(functions, name);
  return async (command: Record<string, unknown>) => {
    if (!uid || auth.currentUser?.uid !== uid) throw new Error('unauthenticated');
    try {
      const reply = await call(command);
      if (auth.currentUser?.uid !== uid) throw new Error('unauthenticated');
      return reply.data;
    } catch (error) {
      if (auth.currentUser?.uid !== uid) throw new Error('unauthenticated');
      throw error;
    }
  };
}
export function desktopStoryStoreForUid(uid: string) {
  const invoke = invokeForUid(uid, 'desktopAccountSnapshot');
  return createDesktopStoryStore(uid, () => invoke({ schemaVersion: 'desktop-account-3' }));
}
export function rivalCooldownStoreForUid(uid: string) {
  return createRivalCooldownStore(invokeForUid(uid, 'rivalBattleHost'));
}
