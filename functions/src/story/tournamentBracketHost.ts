import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { transactTournamentBracket } from './tournamentBracketStore';
import { StoryError } from './storyFlags';
export const tournamentBracketHost=onCall(async request=>{
  if (!request.auth) throw new HttpsError('unauthenticated','Sign in to advance a tournament.');
  try { return await transactTournamentBracket(db,request.auth.uid,request.data); }
  catch(e) {
    if (e instanceof StoryError) throw new HttpsError(e.code==='invalid_request'?'invalid-argument':e.code==='unavailable'?'unavailable':'failed-precondition',e.code,{rejectionCode:e.code});
    throw e;
  }
});
