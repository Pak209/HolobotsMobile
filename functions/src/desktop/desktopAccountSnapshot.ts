import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { BLUEPRINT_TIERS } from '../lib/mintingEconomy';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { BUDDY_UNITS_FIELD, readBuddyUnits } from '../lib/rivalLadder';
/**
 * View of the same account used by mobile. No secondary inventory or transfer ledger.
 * DECISIONS #43: also reports buddyUnits; a pilot the server has never seen is granted
 * the starter Units here exactly once (the only write this callable ever makes).
 */
export const desktopAccountSnapshot = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to view your Holobots.');
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Account profile not found.');
    const profile = snapshot.data()!;
    const units = readBuddyUnits(profile);
    if (!units) throw new HttpsError('unavailable', 'unavailable', { rejectionCode: 'unavailable' });
    if (units.grantStarter) tx.update(userRef, { [BUDDY_UNITS_FIELD]: units.units });
    return {
      schemaVersion: 'desktop-account-1',
      uid,
      holobots: Array.isArray(profile.holobots) ? profile.holobots : [],
      blueprints: profile.blueprints ?? {},
      travelSquad: readTravelSquad(profile),
      blueprintTiers: BLUEPRINT_TIERS,
      buddyUnits: units.units,
    };
  });
});
