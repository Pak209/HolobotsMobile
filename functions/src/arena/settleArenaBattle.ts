import { HttpsError, onCall } from 'firebase-functions/v2/https';
/** Closed legacy bypass: client-chosen battle IDs can never mint an unbound reward. */
export const settleArenaBattle = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated','Sign in to use the Arena.');
  throw new HttpsError('failed-precondition','arena_match_required',{rejectionCode:'arena_match_required'});
});
