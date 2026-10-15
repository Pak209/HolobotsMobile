import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { transactTournamentResult } from './tournamentResultStore';
import { StoryError } from './storyFlags';
export const tournamentResultHost = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated','Sign in to record a tournament win.');
  try { return await transactTournamentResult(db,request.auth.uid,request.data); }
  catch (e) {
    if (e instanceof StoryError) throw new HttpsError(e.code === 'invalid_request' ? 'invalid-argument' : e.code === 'unknown_match' ? 'not-found' : e.code === 'unavailable' ? 'unavailable' : 'failed-precondition',e.code,{rejectionCode:e.code});
    throw e;
  }
});
