import {
  collection,
  doc,
  getDoc,
  runTransaction,
  type Firestore,
} from "firebase/firestore";

import type { BattlePoolEntry, BattleRoom } from "../types/battle-room";

export const BATTLE_ROOMS_COLLECTION = "battle_rooms";
export const BATTLE_POOL_COLLECTION = "battle_pool_entries";

// Pool entries older than this are treated as ghosts left behind by crashed
// or abandoned sessions and skipped during matchmaking.
export const POOL_ENTRY_MAX_AGE_MS = 5 * 60 * 1000;

export type MatchmakingClaim =
  | { outcome: "created"; roomId: string }
  | { outcome: "alreadyMatched"; roomId: string }
  | { outcome: "candidateGone" };

export function poolEntryAgeMs(entry: BattlePoolEntry, now: number = Date.now()): number {
  const createdAt = entry.createdAt as { toMillis?: () => number } | number | null | undefined;
  if (typeof createdAt === "number") return now - createdAt;
  if (createdAt && typeof createdAt.toMillis === "function") return now - createdAt.toMillis();
  return Number.POSITIVE_INFINITY;
}

export function isFreshPoolEntry(entry: BattlePoolEntry, now: number = Date.now()): boolean {
  return poolEntryAgeMs(entry, now) <= POOL_ENTRY_MAX_AGE_MS;
}

/**
 * Atomically claims an opponent's pool entry and creates the single shared
 * battle room, stamping the roomId on both players' pool entries in the same
 * transaction.
 *
 * Firestore transactions retry on write contention, so when two players
 * claim each other simultaneously exactly one transaction commits a room.
 * The loser's retry re-reads its own entry, finds the winner's roomId
 * already stamped there, and returns "alreadyMatched" so the caller joins
 * that room instead of creating a second one — the race that previously left
 * each device battling in its own room.
 */
export async function claimOpponentAndCreateRoom(
  db: Firestore,
  myUid: string,
  opponentEntryId: string,
  buildRoom: (roomId: string, opponent: BattlePoolEntry) => BattleRoom,
): Promise<MatchmakingClaim> {
  const myEntryRef = doc(db, BATTLE_POOL_COLLECTION, myUid);
  const opponentRef = doc(db, BATTLE_POOL_COLLECTION, opponentEntryId);

  try {
    return await runTransaction<MatchmakingClaim>(db, async (transaction) => {
      const myEntry = (await transaction.get(myEntryRef)).data() as BattlePoolEntry | undefined;
      if (myEntry?.roomId) {
        return { outcome: "alreadyMatched", roomId: myEntry.roomId };
      }

      const opponent = (await transaction.get(opponentRef)).data() as BattlePoolEntry | undefined;
      if (!opponent || !opponent.isActive || opponent.roomId) {
        return { outcome: "candidateGone" };
      }

      const roomRef = doc(collection(db, BATTLE_ROOMS_COLLECTION));
      transaction.set(roomRef, buildRoom(roomRef.id, opponent));
      transaction.update(opponentRef, { isActive: false, roomId: roomRef.id });
      transaction.update(myEntryRef, { isActive: false, roomId: roomRef.id });
      return { outcome: "created", roomId: roomRef.id };
    });
  } catch (error) {
    // When two commits race, the loser's claim is evaluated against the
    // winner's already-committed state and the security rules reject it with
    // permission-denied — which the SDK treats as terminal (no transaction
    // retry). Classify the loss by re-reading instead of surfacing an error.
    const myEntry = (await getDoc(myEntryRef)).data() as BattlePoolEntry | undefined;
    if (myEntry?.roomId) {
      return { outcome: "alreadyMatched", roomId: myEntry.roomId };
    }
    const opponent = (await getDoc(opponentRef)).data() as BattlePoolEntry | undefined;
    if (!opponent || !opponent.isActive || opponent.roomId) {
      return { outcome: "candidateGone" };
    }
    throw error;
  }
}
