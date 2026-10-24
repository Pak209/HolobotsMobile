import { transactExpedition } from './expeditionStore';
import { expeditionRejection } from './expeditionErrors';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { HoloZoneError } from '../lib/holoZoneRuns';
import { transactHoloZoneRun } from './holoZoneStore';

/**
 * DECISIONS #53 amendment 1: the beast counterpart of rivalBattleHost. Operations (schemaVersion "holozone-run-1", or
 * "holozone-run-2" for the population on issue / status — DECISIONS #54 plan §P1 item 2, additive):
 * status | issue{zoneId} | settle{runId, kills, bossDefeated, fielded}. The server issues the run id, owns the zone
 * tier, the beast roster / spawn counts / respawn rule (by zone and tier) and the EXP, and settles once per runId; the
 * client places the bodies and reports kills / boss / the fielded Holobots.
 * Spec: docs/HOLOCITY_PROGRESSION.md section 5 (+ 5a for holozone-run-2). Expeditions: zone-run-3 / zone-run-4 (utility
 * results + layout preview copy, additive) / zone-extract-1 — functions/src/holozone/expedition.ts.
 */
export const holoZoneHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to enter a HoloZone.');
  const expeditionRequest=['zone-run-3','zone-run-4','zone-run-6','zone-extract-1'].includes(request.data?.schemaVersion);
  try {
    if(expeditionRequest)return await transactExpedition(db,uid,request.data);
    return await transactHoloZoneRun(db, uid, request.data);
  } catch (error) {
    if(expeditionRequest){const rejection=expeditionRejection(error);if(rejection)throw rejection;}
    if (error instanceof HoloZoneError) {
      const code = error.code === 'invalid_request' || error.code === 'unknown_zone' ? 'invalid-argument' : error.code === 'unknown_run' ? 'not-found' : error.code === 'run_expired' || error.code === 'run_closed' || error.code === 'holobot_ko' || error.code === 'activity_conflict' || error.code === 'zone_cooldown' || error.code === 'zone_locked' ? 'failed-precondition' : 'unavailable';
      throw new HttpsError(code, error.code, { rejectionCode: error.code, ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}) });
    }
    throw error;
  }
});
