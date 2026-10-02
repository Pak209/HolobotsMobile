import { Firestore } from 'firebase-admin/firestore';
import { BUDDY_UNITS_FIELD, BuddyInventory, MAX_ADMIN_GRANT, readBuddyInventory, tierById, withTierDelta } from '../lib/buddyUnits';

/**
 * ADMIN / TEST-ONLY seam (DECISIONS #44). Medium and Heavy Units have no player-facing
 * source yet (marketplace / arena later); this grants any tier so emulator tests and
 * future admin tooling can exercise the full inventory and capture path.
 *
 * Deliberately NOT exported from src/index.ts: no callable, trigger or HTTP endpoint
 * reaches it. It runs only with Admin SDK credentials (emulator tests, or an operator's
 * own script). Migrates / applies the starter grant first, exactly like every reader.
 */
export async function grantBuddyUnitsAdmin(db: Firestore, uid: string, tierId: string, count: number): Promise<BuddyInventory> {
  const tier = tierById(tierId);
  if (!tier || !Number.isSafeInteger(count) || count < 1 || count > MAX_ADMIN_GRANT) throw new RangeError('invalid grant');
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new Error('unavailable');
    const read = readBuddyInventory(user.data()!);
    if (!read) throw new Error('unavailable');
    const units = withTierDelta(read.units, tier.key, count);
    tx.update(userRef, { [BUDDY_UNITS_FIELD]: units });
    return units;
  });
}
