import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { MissionBoardError } from '../lib/missionBoard';
import { transactMissionBoard } from './missionBoardStore';

/** mission-board-1 (contract: ./README.md). Operations: status | claim{postingId, requestId, destinationId?}. The server owns postings, verification and rewards. */
export const missionBoardHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to use the Mission Board.', { rejectionCode: 'unauthenticated' });
  try {
    return await transactMissionBoard(db, uid, request.data);
  } catch (error) {
    if (error instanceof MissionBoardError) {
      const code = error.code === 'invalid_request' ? 'invalid-argument' : error.code === 'unknown_posting' ? 'not-found' : error.code === 'already_claimed' ? 'already-exists' : error.code === 'unavailable' ? 'unavailable' : 'failed-precondition';
      throw new HttpsError(code, error.code, { ...(error.detail ?? {}), rejectionCode: error.code });
    }
    throw error;
  }
});
