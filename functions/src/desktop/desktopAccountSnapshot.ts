import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { projectFirstTravelHolobot } from '../acquisition/captureOwnership';
import { readBuddyInventory } from '../lib/buddyUnits';
import { buildDesktopAccountReply, DESKTOP_ACCOUNT_V1, DESKTOP_ACCOUNT_V2, DESKTOP_ACCOUNT_V3, desktopAccountVersionOf } from './desktopAccountReply';

export { DESKTOP_ACCOUNT_V1, DESKTOP_ACCOUNT_V2, DESKTOP_ACCOUNT_V3 };

/** Request `{schemaVersion?}`: missing / v1 → the deployed v1 shape; v2 → tier object; v3 → + normalised holobots with battleStats / displayStats; anything else is invalid-argument. */
export function desktopAccountVersion(data: unknown) {
  const version = desktopAccountVersionOf(data);
  if (!version) throw new HttpsError('invalid-argument', 'invalid_request', { rejectionCode: 'invalid_request' });
  return version;
}

/**
 * View of the same account used by mobile. No secondary inventory or transfer ledger.
 * DECISIONS #43/#44: also reports buddyUnits; a pilot the server has never seen is granted the
 * starter Unit here exactly once, and a #43 integer is migrated to the tier map (alongside empty travel-squad initialisation). v1 reports the TOTAL across tiers as an int (the shipped Unity build
 * parses an int); v2 / v3 report the {light, medium, heavy} object. v3 (DECISIONS #53 amendment 1 + 2):
 * see desktopAccountReply.ts.
 */
export const desktopAccountSnapshot = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to view your Holobots.');
  const version = desktopAccountVersion(request.data);
  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async tx => {
    const snapshot = await tx.get(userRef);
    if (!snapshot.exists) throw new HttpsError('not-found', 'Account profile not found.');
    const profile = snapshot.data()!;
    const inv = readBuddyInventory(profile);
    if (!inv) throw new HttpsError('unavailable', 'unavailable', { rejectionCode: 'unavailable' });
    const squad = projectFirstTravelHolobot(profile);
    const updates = { ...inv.updates, ...squad.updates };
    if (Object.keys(updates).length) tx.update(userRef, updates);
    return buildDesktopAccountReply({ ...profile, ...updates }, uid, version, inv.units);
  });
});
