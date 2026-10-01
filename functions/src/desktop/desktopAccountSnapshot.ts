import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { BLUEPRINT_TIERS } from '../lib/mintingEconomy';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { readBuddyInventory } from '../lib/buddyUnits';
/**
 * View of the same account used by mobile. No secondary inventory or transfer ledger.
 * DECISIONS #43/#44: also reports buddyUnits ({light, medium, heavy}); a pilot the server has
 * never seen is granted the starter Unit here exactly once, and a #43 integer is migrated to the
 * tier map (the only writes this callable ever makes).
 */
export const desktopAccountSnapshot = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to view your Holobots.');
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Account profile not found.');
    const profile = snapshot.data()!;
    const inv = readBuddyInventory(profile);
    if (!inv) throw new HttpsError('unavailable', 'unavailable', { rejectionCode: 'unavailable' });
    if (Object.keys(inv.updates).length) tx.update(userRef, inv.updates);
    return {
      schemaVersion: 'desktop-account-1',
      uid,
      holobots: Array.isArray(profile.holobots) ? profile.holobots : [],
      blueprints: profile.blueprints ?? {},
      travelSquad: readTravelSquad(profile),
      blueprintTiers: BLUEPRINT_TIERS,
      buddyUnits: inv.units,
    };
  });
});
