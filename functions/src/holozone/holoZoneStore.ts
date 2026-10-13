import { ActivityError, arenaOpen } from '../lib/arenaActivity';
import { randomUUID } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { HoloZoneError, holoZoneStatus, issueHoloZoneRun, readHoloZoneRuns, settleHoloZoneRun, validateHoloZoneCommand } from '../lib/holoZoneRuns';
import { holoZoneIssueReplyForVersion, holoZoneSettleReplyForVersion, holoZoneStatusReplyForVersion } from '../lib/holoZoneWire';

/**
 * DECISIONS #53 amendment 1 HoloZone run host (lib/holoZoneRuns.ts has the rules). Runs live at
 * holoZoneRuns/{uid} (server-only; default-denied and explicit in firestore.rules), outside the
 * client-writable users/{uid}. The uid always comes from authentication, so a foreign runId never
 * resolves. settle writes the Holobot XP (users/{uid}.holobots) and the ruling in one transaction.
 * Replies: holozone-run-2 (population on issue / status) when the request asks for it, else the deployed
 * holozone-run-1 shape, byte-identical (lib/holoZoneWire.ts). The stored record never changes with the wire version.
 * rival-health-1 (DECISIONS #54 amendment 2): a request carrying `healthSchema` uses the ONE host-owned health ledger
 * users/{uid}.holobotVitals the rival host writes (lib/rivalHealth.ts) — issue serves playerCombatants[] with
 * currentHealth and writes the ledger; settle{health[]} writes the reports (downward only) with the ruling. Without the
 * flag the ledger is read for KO admission but never written. Zone issue refuses ledger-zero travel-squad members
 * with holobot_ko before writing or closing any run (DECISIONS #56 amendment 5).
 */
/** Existing malformed Arena state fails closed; elapsed time alone never releases its lease. */
function requireArenaClosed(raw: unknown): void {
  let open: boolean;
  try {
    open = arenaOpen(raw);
  } catch (error) {
    if (error instanceof ActivityError) throw new HoloZoneError('unavailable');
    throw error;
  }
  if (open) throw new HoloZoneError('activity_conflict');
}
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
    if (command.operation === 'status') return holoZoneStatusReplyForVersion(holoZoneStatus(runs, nowMs), command.schemaVersion);
    if (command.operation === 'issue') {
      // Arena and every zone issue (including health flag-off clients) share this transaction read.
      requireArenaClosed((await tx.get(db.doc(`arenaMatches/${uid}`))).data());
      let squadIds: string[];
      try {
        squadIds = readTravelSquad(profile).holobotIds;
      } catch {
        throw new HoloZoneError('unavailable');
      }
      const r = issueHoloZoneRun(runs, command.zoneId, squadIds, runId, nowMs, { profile, includeHealth: command.healthSchema !== undefined });
      if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
      tx.set(runsRef, r.doc);
      return holoZoneIssueReplyForVersion(r.reply, command.schemaVersion);
    }
    const r = settleHoloZoneRun(profile, runs, command, nowMs);
    if (r.reply.alreadyProcessed) return holoZoneSettleReplyForVersion(r.reply, command.schemaVersion);
    // Preserve receipt replay, but refuse all first-time reward/HP writes during an Arena match.
    requireArenaClosed((await tx.get(db.doc(`arenaMatches/${uid}`))).data());
    if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
    if (r.doc) tx.set(runsRef, r.doc);
    return holoZoneSettleReplyForVersion(r.reply, command.schemaVersion);
  });
}
