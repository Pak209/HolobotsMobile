import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { ArenaError, transactArenaMatch } from './arenaMatchStore';
export const arenaMatchHost = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated','Sign in to use the Arena.');
  try { return await transactArenaMatch(db,request.auth.uid,request.data); }
  catch (e) {
    if (e instanceof ArenaError) throw new HttpsError(e.code === 'invalid_request' ? 'invalid-argument' : e.code === 'unknown_match' ? 'not-found' : e.code === 'unavailable' ? 'unavailable' : 'failed-precondition',e.code,{rejectionCode:e.code,...(e.retryAfterMs !== undefined ? {retryAfterMs:e.retryAfterMs} : {})});
    throw e;
  }
});
