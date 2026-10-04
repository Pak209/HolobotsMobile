import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { IntroQuestError } from '../lib/introQuests';
import { transactIntroQuest } from './introQuestStore';

/** DECISIONS #46. Operations: status | claim{stepId, requestId, destinationId?}. The server owns order, verification and rewards. */
export const introQuestHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to play the intro quests.');
  try {
    return await transactIntroQuest(db, uid, request.data);
  } catch (error) {
    if (error instanceof IntroQuestError) {
      const code = error.code === 'invalid_request' ? 'invalid-argument' : error.code === 'already_claimed' ? 'already-exists' : error.code === 'unavailable' ? 'unavailable' : 'failed-precondition';
      throw new HttpsError(code, error.code, { rejectionCode: error.code });
    }
    throw error;
  }
});
