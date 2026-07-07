import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildArenaSettlementUpdatesRaw,
  getArenaTier,
  type ArenaSettlement,
  type ArenaSettlementInput,
  type ArenaTierId,
} from "../lib/arenaEconomy";

type SettleArenaBattleResponse = {
  alreadyProcessed: boolean;
  settlement: ArenaSettlement | null;
};

/**
 * Server-authoritative battle settlement. The battle itself runs on the
 * client (the combat engine is not replayed server-side — SECURITY_AUDIT.md
 * C4), so the server cannot verify the outcome; what it does guarantee is
 * that rewards are derived from the tier table with clamped performance
 * bonuses, the blueprint target is a real opponent of that tier, and a
 * battle id settles at most once. A dishonest client can claim a win it
 * didn't earn, but can no longer invent reward amounts.
 */
export const settleArenaBattle = onCall(async (request): Promise<SettleArenaBattleResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to settle battles.");
  }

  const data = (request.data ?? {}) as Record<string, unknown>;
  const tierId = typeof data.tierId === "string" ? data.tierId : "";
  const battleId = typeof data.battleId === "string" ? data.battleId.trim() : "";
  const holobotName = typeof data.holobotName === "string" ? data.holobotName : "";

  if (!getArenaTier(tierId)) {
    throw new HttpsError("invalid-argument", "Unknown arena tier.");
  }
  if (!battleId) {
    throw new HttpsError("invalid-argument", "A battle id is required.");
  }
  if (!holobotName) {
    throw new HttpsError("invalid-argument", "A holobot name is required.");
  }

  const input: ArenaSettlementInput = {
    combosCompleted: Number(data.combosCompleted || 0),
    didWin: data.didWin === true,
    opponentName: typeof data.opponentName === "string" ? data.opponentName : "",
    perfectDefenses: Number(data.perfectDefenses || 0),
    tierId: tierId as ArenaTierId,
  };

  const userRef = db.doc(`users/${uid}`);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = snapshot.data() ?? {};

    if (userData.lastArenaBattleId === battleId) {
      return { alreadyProcessed: true, settlement: null };
    }

    const result = buildArenaSettlementUpdatesRaw(userData, holobotName, input);
    if (!result) {
      throw new HttpsError("invalid-argument", "Unknown arena tier.");
    }

    transaction.set(
      userRef,
      {
        ...result.updates,
        lastArenaBattleId: battleId,
      },
      { merge: true },
    );

    return { alreadyProcessed: false, settlement: result.settlement };
  });
});
