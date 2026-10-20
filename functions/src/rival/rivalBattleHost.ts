import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { RivalError } from '../lib/rivalLadder';
import { transactRivalBattle } from './rivalBattleStore';

/** Host resolves pinned stats/seed and playerIntents. Legacy didWin requires the server migration flag; rewards and receipt settle once. */
export const rivalBattleHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to battle rivals.');
  try {
    return await transactRivalBattle(db, uid, request.data, undefined, undefined, { zellEnabled: process.env.HOLOCITY_ZELL_STORY === '1' });
  } catch (error) {
    if (error instanceof RivalError) {
      const code = error.code === 'invalid_request' ? 'invalid-argument' : error.code === 'unknown_battle' ? 'not-found' : error.code === 'battle_expired' || error.code === 'too_many_open' || error.code === 'too_fast' || error.code === 'activity_conflict' || error.code === 'rival_cooldown' || error.code === 'legacy_settlement_disabled' || error.code === 'squad_required' || error.code === 'replay_mismatch' ? 'failed-precondition' : 'unavailable';
      // fight-host-1: replay_mismatch (and an undecodable input-log) carry the first divergent window / field in details.
      throw new HttpsError(code, error.code, error.retryAfterMs !== undefined ? { rejectionCode: error.code, retryAfterMs: error.retryAfterMs } : { ...(error.detail ?? {}), rejectionCode: error.code });
    }
    throw error;
  }
});
