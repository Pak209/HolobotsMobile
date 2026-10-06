import { randomBytes, randomInt } from 'node:crypto';
import { Firestore, Timestamp } from 'firebase-admin/firestore';
import { readTravelSquad } from '../acquisition/captureOwnership';
import { issueRivalBattle, rivalLineupScaleFor, rivalReplyForVersion, openBattlesAfterIssue, openBattlesAfterSettle, readOpenBattles, RIVAL_BATTLE_CLEANUP_FIELD, RIVAL_OPEN_BATTLES_FIELD, rivalBattleCleanupAtMs, RivalBattleRecord, RivalError, rivalStatus, settleRivalBattle, validateRivalCommand } from '../lib/rivalLadder';

/**
 * DECISIONS #43 rival host. users/{uid} holds buddyUnits / rivalWins / rivalRewardDay
 * (rules: server-only). Issued battles live at rivalBattles/{uid}/battles/{battleId},
 * outside client-writable user subcollections (default-denied by the catch-all rule).
 * The uid always comes from authentication, so a foreign battleId never resolves.
 * Replies: rival-battle-2 when the request asks for it, else the deployed rival-battle-1 shape (#44).
 * Each battle also carries `expireAt` (Timestamp) for TTL cleanup; see RIVAL_BATTLE_TTL_GRACE_MS.
 * The parent doc rivalBattles/{uid} is the open-battle ledger (≤ RIVAL_MAX_OPEN_BATTLES entries), so the
 * cap is a point read, not a query.
 * rival-battle-3 (DECISIONS #53): issue snapshots the travel squad into the record and serves
 * playerCombatants; settle{fielded} awards Holobot XP in the same transaction (users/{uid}.holobots).
 * #53 amendment 1: a rival-battle-3 issue fields WOLF's battle stats at level 1 + 4t (lineupScale on the
 * record); rival-battle-1 / -2 issues keep the #43 baseline x statScale.
 */

/** The travel squad ids for the player-side additions; [] when unreadable so v1/v2 rulings never depend on it. */
function squadIdsOf(profile: Record<string, unknown>): string[] {
  try {
    return readTravelSquad(profile).holobotIds;
  } catch {
    return [];
  }
}
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
      return rivalReplyForVersion(r.reply, command.schemaVersion);
    }
    if (command.operation === 'issue') {
      const open = readOpenBattles((await tx.get(ledgerRef)).data(), nowMs);
      let i = 0;
      // #53 amendment 1: rival-battle-3 opponents = WOLF at level 1 + 4t; v1 / v2 keep the #43 baseline (byte-identical replies).
      const r = issueRivalBattle(profile, nowMs, battleId, () => draws[i++ % draws.length], squadIdsOf(profile), rivalLineupScaleFor(command.schemaVersion));
      const nextOpen = openBattlesAfterIssue(open, r.battle);
      if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
      tx.set(ledgerRef, { [RIVAL_OPEN_BATTLES_FIELD]: nextOpen });
      // expireAt drives the Firestore TTL policy (functions/README.md); settle never changes it.
      tx.create(battleRef, { ...r.battle, [RIVAL_BATTLE_CLEANUP_FIELD]: Timestamp.fromMillis(rivalBattleCleanupAtMs(r.battle)) });
      return rivalReplyForVersion(r.reply, command.schemaVersion);
    }
    const battle = await tx.get(battleRef);
    const ledger = await tx.get(ledgerRef);
    const r = settleRivalBattle(profile, battle.exists ? (battle.data() as RivalBattleRecord) : undefined, command.battleId, command.didWin, nowMs, command.fielded, squadIdsOf(profile));
    if (Object.keys(r.userUpdates).length) tx.update(userRef, r.userUpdates);
    if (r.battleUpdates) {
      tx.update(battleRef, r.battleUpdates);
      tx.set(ledgerRef, { [RIVAL_OPEN_BATTLES_FIELD]: openBattlesAfterSettle(readOpenBattles(ledger.data(), nowMs), command.battleId) });
    }
    return rivalReplyForVersion(r.reply, command.schemaVersion);
  });
}
