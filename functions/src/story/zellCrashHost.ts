import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { StoryError } from './storyFlags';
import { transactZellCrash } from './zellCrash';

/** zell-crash-1 callable (default off: HOLOCITY_ZELL_CRASH=1). The uid is the authenticated caller's, never a request field. */
export const zellCrashHost = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to continue the story.');
  try { return await transactZellCrash(db, request.auth.uid, request.data); }
  catch (e) {
    if (e instanceof StoryError) {
      const kind = e.code === 'invalid_request' || e.code === 'invalid_log' ? 'invalid-argument' : e.code === 'unavailable' ? 'unavailable' : 'failed-precondition';
      throw new HttpsError(kind, e.code, { rejectionCode: e.code });
    }
    throw e;
  }
});
