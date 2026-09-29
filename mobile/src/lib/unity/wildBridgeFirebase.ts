import { onAuthStateChanged } from 'firebase/auth';
import { auth, functions, httpsCallable } from '@/config/firebase';
import { connectWildBridge, type Command, type NativeWildPort } from './wildBridge';
/** Native Unity embedding supplies the port and a fresh session nonce. No web origin can attach it. */
export function connectFirebaseWildBridge(port: NativeWildPort, sessionId: string): () => void {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('unauthenticated');
  const call = httpsCallable<Command, unknown>(functions, 'wildEncounterHost');
  const disconnect = connectWildBridge({ port, sessionId, isSignedIn: () => auth.currentUser?.uid === uid,
    invoke: async command => (await call(command)).data });
  const stopAuth = onAuthStateChanged(auth, user => { if (user?.uid !== uid) disconnect(); });
  return () => { stopAuth(); disconnect(); };
}
