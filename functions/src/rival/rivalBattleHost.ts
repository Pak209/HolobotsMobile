import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { RivalError } from '../lib/rivalLadder';
import { transactRivalBattle } from './rivalBattleStore';

/** DECISIONS #43. Operations: status | issue | settle{battleId,didWin,fielded?}. Client claims the win; the server owns tier, lineup, grant and once-per-battleId settlement. rival-battle-3 (#53): issue adds playerCombatants, settle{fielded} awards Holobot XP (progression[]). */
export const rivalBattleHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to battle rivals.');
  try {
    return await transactRivalBattle(db, uid, request.data);
  } catch (error) {
    if (error instanceof RivalError) {
      const code = error.code === 'invalid_request' ? 'invalid-argument' : error.code === 'unknown_battle' ? 'not-found' : error.code === 'battle_expired' || error.code === 'too_many_open' || error.code === 'too_fast' ? 'failed-precondition' : 'unavailable';
      throw new HttpsError(code, error.code, { rejectionCode: error.code });
    }
    throw error;
  }
});
