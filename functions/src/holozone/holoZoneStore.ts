import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { HoloZoneError, holoZoneStatus, issueHoloZoneRun, readHoloZoneRuns, settleHoloZoneRun, validateHoloZoneCommand } from '../lib/holoZoneRuns';

/**
 * DECISIONS #53 amendment 1 HoloZone run host (lib/holoZoneRuns.ts has the rules). Runs live at
 * holoZoneRuns/{uid} (server-only; default-denied and explicit in firestore.rules), outside the
 * client-writable users/{uid}. The uid always comes from authentication, so a foreign runId never
 * resolves. settle writes the Holobot XP (users/{uid}.holobots) and the ruling in one transaction.
 */
export async function transactHoloZoneRun(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), newRunId: () => string = randomUUID) {
  const command = validateHoloZoneCommand(raw);
  // Pin the run id outside the transaction so retries rule identically.
  const runId = command.operation === 'issue' ? newRunId() : '';
  const userRef = db.doc(`users/${uid}`);
  const runsRef = db.doc(`holoZoneRuns/${uid}`);
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HoloZoneError('unavailable');
    const profile = user.data()!;
    const runs = readHoloZoneRuns((await tx.get(runsRef)).data());
    if (command.operation === 'status') return holoZoneStatus(runs, nowMs);
    if (command.operation === 'issue') {
      let squadIds: string[];
      try {
        squadIds = readTravelSquad(profile).holobotIds;
      } catch {
        throw new HoloZoneError('unavailable');
      }
      const r = issueHoloZoneRun(runs, command.zoneId, squadIds, runId, nowMs);
      tx.set(runsRef, r.doc);
      return r.reply;
    }
    const r = settleHoloZoneRun(profile, runs, command, nowMs);
    if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
    if (r.doc) tx.set(runsRef, r.doc);
    return r.reply;
  });
}
