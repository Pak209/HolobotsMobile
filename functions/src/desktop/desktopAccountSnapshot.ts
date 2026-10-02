import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { BLUEPRINT_TIERS } from '../lib/mintingEconomy';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { readBuddyInventory, totalBuddyUnits } from '../lib/buddyUnits';

/** Deployed 2026-09-30: buddyUnits is an int. Still served to clients that don't ask for v2. */
export const DESKTOP_ACCOUNT_V1 = 'desktop-account-1';
/** DECISIONS #44: buddyUnits is {light, medium, heavy}. Served when the request carries this schemaVersion. */
export const DESKTOP_ACCOUNT_V2 = 'desktop-account-2';

/** Request `{schemaVersion?}`: missing / v1 → the deployed v1 shape; v2 → tier object; anything else is invalid-argument. */
export function desktopAccountVersion(data: unknown): typeof DESKTOP_ACCOUNT_V1 | typeof DESKTOP_ACCOUNT_V2 {
  const requested = data && typeof data === 'object' ? (data as Record<string, unknown>).schemaVersion : undefined;
  if (requested === undefined || requested === DESKTOP_ACCOUNT_V1) return DESKTOP_ACCOUNT_V1;
  if (requested === DESKTOP_ACCOUNT_V2) return DESKTOP_ACCOUNT_V2;
  throw new HttpsError('invalid-argument', 'invalid_request', { rejectionCode: 'invalid_request' });
}

/**
 * View of the same account used by mobile. No secondary inventory or transfer ledger.
 * DECISIONS #43/#44: also reports buddyUnits; a pilot the server has never seen is granted the
 * starter Unit here exactly once, and a #43 integer is migrated to the tier map (the only writes
 * this callable ever makes). v1 reports the TOTAL across tiers as an int (the shipped Unity build
 * parses an int); v2 reports the {light, medium, heavy} object.
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
    if (Object.keys(inv.updates).length) tx.update(userRef, inv.updates);
    return {
      schemaVersion: version,
      uid,
      holobots: Array.isArray(profile.holobots) ? profile.holobots : [],
      blueprints: profile.blueprints ?? {},
      travelSquad: readTravelSquad(profile),
      blueprintTiers: BLUEPRINT_TIERS,
      buddyUnits: version === DESKTOP_ACCOUNT_V2 ? inv.units : totalBuddyUnits(inv.units),
    };
  });
});
