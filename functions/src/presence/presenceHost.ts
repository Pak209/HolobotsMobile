import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { PresenceError } from './presenceDomain';
import { transactPresence } from './presenceStore';

export const presenceHost = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in.');
  // The server-token spec reserves server principals for settlement, never town presence.
  if (request.auth.token?.holoServer === true) throw new HttpsError('permission-denied', 'server_not_allowed');
  try { return await transactPresence(db, request.auth.uid, request.data); }
  catch (e) {
    if (e instanceof PresenceError) throw new HttpsError(e.code === 'invalid_request' ? 'invalid-argument' : 'unavailable', e.code, { rejectionCode: e.code });
    // Existing wardrobe/squad validation can fail closed with its existing unavailable code.
    if ((e as { code?: string })?.code === 'unavailable') throw new HttpsError('unavailable', 'unavailable', { rejectionCode: 'unavailable' });
    throw e;
  }
});
