import { Firestore } from 'firebase-admin/firestore';
import { claimDailyPickup, dailyPickupsEnabled, dailyView, readDailyDoc, validateDailyCommand } from '../lib/dailyPickups';
import { MISSION_BOARD_SCHEMA, MissionBoardError, missionBoardBalances } from '../lib/missionBoard';

/**
 * Daily district pickups store (mission-board-1 `dailyStatus` / `dailyClaim`; contract: ./README.md "Daily pickups").
 * Ledger: cityDailyPickups/{uid} (top-level, server-only; firestore.rules deny every client read/write; deleted with the
 * account). Grants go to users/{uid} (holosTokens, buddyUnits) in the same transaction as the ledger write.
 * Flag HOLOCITY_DAILY_PICKUPS (default off): off answers `daily_off` before any read or write.
 */
export const DAILY_PICKUP_COLLECTION = 'cityDailyPickups';

export async function transactDailyPickup(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), env: NodeJS.ProcessEnv = process.env) {
  if (!dailyPickupsEnabled(env)) throw new MissionBoardError('daily_off');
  const command = validateDailyCommand(raw);
  const userRef = db.doc(`users/${uid}`), dailyRef = db.doc(`${DAILY_PICKUP_COLLECTION}/${uid}`);
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new MissionBoardError('unavailable');
    const profile = user.data()!;
    const snap = await tx.get(dailyRef);
    const doc = readDailyDoc(snap.exists ? snap.data() : undefined);
    if (command.operation === 'dailyStatus') {
      return { schemaVersion: MISSION_BOARD_SCHEMA, source: 'daily' as const, daily: dailyView(doc, uid, nowMs, command.utcOffsetMinutes), balances: missionBoardBalances(profile) };
    }
    const r = claimDailyPickup(doc, profile, uid, command, nowMs);
    if (r.doc) {
      tx.set(dailyRef, r.doc);
      tx.update(userRef, r.userUpdates);
    }
    return r.reply;
  });
}
