import { HttpsError, onCall } from 'firebase-functions/v2/https';
/** Closed legacy bypass. Migrate callers to arenaMatchHost issue/start/resume before deploying. */
export const chargeArenaEntry = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated','Sign in to use the Arena.');
  throw new HttpsError('failed-precondition','arena_match_required',{rejectionCode:'arena_match_required'});
});
