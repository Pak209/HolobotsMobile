import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { transactArenaGathering } from './arenaGathering';
import { StoryError } from './storyFlags';
export const arenaGatheringHost = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated','Sign in to attend the gathering.');
  try { return await transactArenaGathering(db,request.auth.uid,request.data); }
  catch (e) {
    if (e instanceof StoryError) throw new HttpsError(e.code === 'invalid_request' ? 'invalid-argument' : 'unavailable',e.code,{rejectionCode:e.code});
    throw e;
  }
});
