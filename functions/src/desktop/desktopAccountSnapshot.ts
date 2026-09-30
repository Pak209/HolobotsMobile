import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { BLUEPRINT_TIERS } from '../lib/mintingEconomy';
import { readTravelSquad } from '../acquisition/captureOwnership';
/** Read-only view of the same account used by mobile. No secondary inventory or transfer ledger. */
export const desktopAccountSnapshot = onCall(async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to view your Holobots.');
  const snapshot = await db.doc(`users/${request.auth.uid}`).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'Account profile not found.');
  const profile = snapshot.data()!;
  return {
    schemaVersion: 'desktop-account-1',
    uid: request.auth.uid,
    holobots: Array.isArray(profile.holobots) ? profile.holobots : [],
    blueprints: profile.blueprints ?? {},
    travelSquad: readTravelSquad(profile),
    blueprintTiers: BLUEPRINT_TIERS,
  };
});
