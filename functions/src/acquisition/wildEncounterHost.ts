import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { transactWildEncounter } from './wildEncounterStore';
import { HostError } from './wildEncounterDomain';

/** Admin-provisioned sessions only. These top-level collections are default-denied by rules. The capture roll is seeded server-side per requestId (#44). */
export const wildEncounterHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to meet wild Holobots.');
  try {
    return await transactWildEncounter(db, uid, request.data);
  } catch (error) {
    if (error instanceof HostError) {
      throw new HttpsError(error.code === 'invalid_request' ? 'invalid-argument' : error.code === 'sequence_conflict' ? 'already-exists' : error.code === 'unavailable' ? 'unavailable' : 'failed-precondition', error.code, { rejectionCode: error.code });
    }
    throw error;
  }
});
