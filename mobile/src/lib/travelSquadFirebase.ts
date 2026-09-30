import { auth, functions, httpsCallable } from '@/config/firebase';
import { readTravelSquad, type SquadCommand, type TravelSquad } from './travelSquadClient';
export type TravelSquadUpdate = { uid: string; snapshot: TravelSquad };
const listeners = new Set<(update: TravelSquadUpdate) => void>();
/** Native embedding may subscribe, filter its session uid, and send the confirmed squad. */
export function subscribeTravelSquadSnapshots(listener: (update: TravelSquadUpdate) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
/** Accept only snapshots supplied by an authenticated host response; never user selection. */
export function publishTravelSquadSnapshot(uid: string, value: unknown) {
  if (!uid || auth.currentUser?.uid !== uid) return;
  const snapshot = readTravelSquad(value);
  for (const listener of listeners) { try { listener({ uid, snapshot: readTravelSquad(snapshot) }); } catch { /* observer teardown cannot turn a committed swap into a retry */ } }
}
export function travelSquadInvoker(uid: string): (command: SquadCommand) => Promise<unknown> {
  const call = httpsCallable<SquadCommand, unknown>(functions, 'travelSquadHost');
  return async command => {
    if (!uid || auth.currentUser?.uid !== uid) throw { code: 'unauthenticated' };
    const result = await call(command);
    if (auth.currentUser?.uid !== uid) throw { code: 'unauthenticated' };
    return result.data;
  };
}
