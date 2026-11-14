import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { RivalError } from '../lib/rivalLadder';
import { PvpError } from '../lib/pvpDaily';
import { pvpErrorCode, transactPvpDaily } from './pvpDailyStore';

/**
 * pvp-daily-1 callable (rivalLadder family): { operation: 'list' } -> the day's three opponents;
 * { operation: 'issue', opponentId, duelInputs?, fightRules? } -> an ordinary rival issue reply bound to that opponent (+ `pvp`).
 *   fightRules ('duel-rules-6' / '-7' / '-8', only beside duelInputs) is forwarded to the rival issue as its rules ask.
 * Settle the returned battleId through rivalBattleHost. Not deployed; deploy with
 *   firebase deploy --only functions:pvpDaily
 * on Pak's word.
 */
export const pvpDaily = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to battle rivals.');
  try {
    return await transactPvpDaily(db, uid, request.data);
  } catch (error) {
    if (error instanceof PvpError || error instanceof RivalError) {
      const retryAfterMs = error instanceof RivalError ? error.retryAfterMs : undefined;
      throw new HttpsError(pvpErrorCode(error), error.code, retryAfterMs !== undefined ? { rejectionCode: error.code, retryAfterMs } : { ...(error instanceof RivalError && error.code === 'holobot_ko' ? error.detail ?? {} : {}), rejectionCode: error.code }); // ko-return-25 readiness detail
    }
    throw error;
  }
});
