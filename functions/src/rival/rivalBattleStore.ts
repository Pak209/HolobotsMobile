import { randomBytes, randomInt } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { issueRivalBattle, RivalBattleRecord, RivalError, rivalStatus, settleRivalBattle, validateRivalCommand } from '../lib/rivalLadder';

/**
 * DECISIONS #43 rival host. users/{uid} holds buddyUnits / rivalWins / rivalRewardDay
 * (rules: server-only). Issued battles live at rivalBattles/{uid}/battles/{battleId},
 * outside client-writable user subcollections (default-denied by the catch-all rule).
 * The uid always comes from authentication, so a foreign battleId never resolves.
 */
export async function transactRivalBattle(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now(), random: () => number = () => randomInt(0, 0x100000000) / 0x100000000) {
  const command = validateRivalCommand(raw);
  const userRef = db.doc(`users/${uid}`);
  // Pin the battle id and draws outside the transaction so retries rule identically.
  const battleId = command.operation === 'settle' ? command.battleId : `rb_${randomBytes(12).toString('hex')}`;
  const draws = Array.from({ length: 8 }, random);
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
      let i = 0;
      const r = issueRivalBattle(profile, nowMs, battleId, () => draws[i++ % draws.length]);
      if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
      tx.create(battleRef, r.battle);
      return r.reply;
    }
    const battle = await tx.get(battleRef);
    const r = settleRivalBattle(profile, battle.exists ? (battle.data() as RivalBattleRecord) : undefined, command.battleId, command.didWin, nowMs);
    if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
    if (r.battleUpdates) tx.update(battleRef, r.battleUpdates);
    return r.reply;
  });
}
