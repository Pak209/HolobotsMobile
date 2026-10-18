import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { PVP_ROOM_REFUSALS, PvpRoomError, transactPvpRoomFighter } from './pvpRoomFighters';
/** pvp-room-fighters-1: seat the caller's host-minted fighter snapshot on a PvP room they are in. */
export const pvpRoomFighterHost = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in to enter PvP.');
  try { return await transactPvpRoomFighter(db, request.auth.uid, request.data); }
  catch (e) {
    if (e instanceof PvpRoomError) {
      throw new HttpsError(PVP_ROOM_REFUSALS[e.code as keyof typeof PVP_ROOM_REFUSALS] ?? 'unavailable', e.code, { rejectionCode: e.code });
    }
    throw e;
  }
});
