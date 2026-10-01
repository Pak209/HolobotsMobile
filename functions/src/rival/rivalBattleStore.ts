import { randomBytes, randomInt } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { issueRivalBattle, openBattlesAfterIssue, openBattlesAfterSettle, readOpenBattles, RIVAL_BATTLE_CLEANUP_FIELD, RIVAL_OPEN_BATTLES_FIELD, rivalBattleCleanupAtMs, RivalBattleRecord, RivalError, rivalStatus, settleRivalBattle, validateRivalCommand } from '../lib/rivalLadder';

/**
 * DECISIONS #43 rival host. users/{uid} holds buddyUnits / rivalWins / rivalRewardDay
 * (rules: server-only). Issued battles live at rivalBattles/{uid}/battles/{battleId},
 * outside client-writable user subcollections (default-denied by the catch-all rule).
 * The uid always comes from authentication, so a foreign battleId never resolves.
 * Each battle also carries `expireAt` (Timestamp) for TTL cleanup; see RIVAL_BATTLE_TTL_GRACE_MS.
 * The parent doc rivalBattles/{uid} is the open-battle ledger (≤ RIVAL_MAX_OPEN_BATTLES entries), so the
 * cap is a point read, not a query.
 */
export async function transactRivalBattle(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), random: () => number = () => randomInt(0, 0x100000000) / 0x100000000) {
  const command = validateRivalCommand(raw);
  const userRef = db.doc(`users/${uid}`);
  // Pin the battle id and draws outside the transaction so retries rule identically.
  const battleId = command.operation === 'settle' ? command.battleId : `rb_${randomBytes(12).toString('hex')}`;
  const draws = Array.from({ length: 8 }, random);
  const ledgerRef = db.doc(`rivalBattles/${uid}`);
  const battleRef = db.doc(`rivalBattles/${uid}/battles/${battleId}`);
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new RivalError('unavailable');
    const profile = user.data()!;
    if (command.operation === 'status') {
      const r = rivalStatus(profile, nowMs);
      if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
      return r.reply;
    }
    if (command.operation === 'issue') {
      const open = readOpenBattles((await tx.get(ledgerRef)).data(), nowMs);
      let i = 0;
      const r = issueRivalBattle(profile, nowMs, battleId, () => draws[i++ % draws.length]);
      const nextOpen = openBattlesAfterIssue(open, r.battle);
      if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
      tx.set(ledgerRef, { [RIVAL_OPEN_BATTLES_FIELD]: nextOpen });
      // expireAt drives the Firestore TTL policy (functions/README.md); settle never changes it.
      tx.create(battleRef, { ...r.battle, [RIVAL_BATTLE_CLEANUP_FIELD]: Timestamp.fromMillis(rivalBattleCleanupAtMs(r.battle)) });
      return r.reply;
    }
    const battle = await tx.get(battleRef);
    const ledger = await tx.get(ledgerRef);
    const r = settleRivalBattle(profile, battle.exists ? (battle.data() as RivalBattleRecord) : undefined, command.battleId, command.didWin, nowMs);
    if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
    if (r.battleUpdates) {
      tx.update(battleRef, r.battleUpdates);
      tx.set(ledgerRef, { [RIVAL_OPEN_BATTLES_FIELD]: openBattlesAfterSettle(readOpenBattles(ledger.data(), nowMs), command.battleId) });
    }
    return r.reply;
  });
}
