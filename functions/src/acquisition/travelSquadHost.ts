import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { HostError } from './wildEncounterDomain';
import { transactTravelSquad } from './travelSquadStore';
export const travelSquadHost = onCall(async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to change your travel squad.');
  try { return await transactTravelSquad(db, request.auth.uid, request.data); }
  catch (error) {
    if (error instanceof HostError) throw new HttpsError(error.code === 'invalid_request' ? 'invalid-argument' : error.code === 'sequence_conflict' ? 'already-exists' : error.code === 'unavailable' ? 'unavailable' : 'failed-precondition', error.code, { rejectionCode: error.code });
    throw error;
  }
});
