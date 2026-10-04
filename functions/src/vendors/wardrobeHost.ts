import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { WardrobeError } from '../lib/wardrobe';
import { transactWardrobe } from './wardrobeStore';

const HTTPS_CODE = {
  invalid_request: 'invalid-argument',
  not_owned: 'failed-precondition',
  already_owned: 'already-exists',
  not_enough_holos: 'failed-precondition',
  sequence_conflict: 'already-exists',
  unavailable: 'unavailable',
} as const;

/** DECISIONS #48, wardrobe-3. Operations: status | purchase{itemId, requestId} | equip{loadout, recipe, requestId}. */
export const wardrobeHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to use your wardrobe.');
  try {
    return await transactWardrobe(db, uid, request.data);
  } catch (error) {
    if (error instanceof WardrobeError) {
      // Keep the existing economy refusal copy for Holos.
      throw new HttpsError(HTTPS_CODE[error.code], error.code === 'not_enough_holos' ? 'Not enough Holos.' : error.code, { rejectionCode: error.code });
    }
    throw error;
  }
});
