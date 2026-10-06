import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { HoloZoneError } from '../lib/holoZoneRuns';
import { transactHoloZoneRun } from './holoZoneStore';

/**
 * DECISIONS #53 amendment 1: the beast counterpart of rivalBattleHost. Operations (schemaVersion "holozone-run-1"):
 * status | issue{zoneId} | settle{runId, kills, bossDefeated, fielded}. The server issues the run id, owns the zone
 * tier and the EXP, and settles once per runId; the client reports kills / boss / the fielded Holobots.
 * Spec: docs/HOLOCITY_PROGRESSION.md section 5.
 */
export const holoZoneHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to enter a HoloZone.');
  try {
    return await transactHoloZoneRun(db, uid, request.data);
  } catch (error) {
    if (error instanceof HoloZoneError) {
      const code = error.code === 'invalid_request' || error.code === 'unknown_zone' ? 'invalid-argument' : error.code === 'unknown_run' ? 'not-found' : error.code === 'run_expired' || error.code === 'run_closed' ? 'failed-precondition' : 'unavailable';
      throw new HttpsError(code, error.code, { rejectionCode: error.code });
    }
    throw error;
  }
});
