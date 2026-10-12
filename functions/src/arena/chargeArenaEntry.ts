import {randomUUID} from "node:crypto";
import {arenaOpen,duelOpen} from "../lib/healingGuards";
import { HttpsError, onCall } from "firebase-functions/v2/https";

import { db } from "../admin";
import { buildArenaEntryUpdatesRaw, getArenaTier } from "../lib/arenaEconomy";

type ChargeArenaEntryResponse = {
  matchId:string;
  currentVitals:Record<string,unknown>;
  arenaPasses: number;
  holosTokens: number;
};

/** Server-authoritative arena entry fee (Holos or an Arena Pass). */
export const chargeArenaEntry = onCall(async (request): Promise<ChargeArenaEntryResponse> => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to enter the Arena.");
  }

  const data = (request.data ?? {}) as { paymentMethod?: unknown; tierId?: unknown };
  const tierId = typeof data.tierId === "string" ? data.tierId : "";
  const paymentMethod = data.paymentMethod === "pass" ? "pass" : data.paymentMethod === "tokens" ? "tokens" : null;

  if (!getArenaTier(tierId) || !paymentMethod) {
    throw new HttpsError("invalid-argument", "Unknown arena tier or payment method.");
  }

  const userRef = db.doc(`users/${uid}`);

  const matchId=randomUUID(),matchRef=db.doc(`arenaMatches/${uid}`);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(userRef);
    const match=await transaction.get(matchRef),duel=await transaction.get(db.doc(`duelHealingRuns/${uid}`));
    if(arenaOpen(match.data())||duelOpen(duel.data()))throw new HttpsError("failed-precondition","battle_open",{rejectionCode:"battle_open"});
    if (!snapshot.exists) {
      throw new HttpsError("not-found", "User profile not found.");
    }

    const userData = snapshot.data() ?? {};
    const updates = buildArenaEntryUpdatesRaw(userData, tierId, paymentMethod);

    if (!updates) {
      throw new HttpsError(
        "failed-precondition",
        paymentMethod === "pass" ? "No Arena Passes available." : "Not enough Holos.",
      );
    }

    transaction.set(userRef, updates, { merge: true });
    transaction.set(matchRef,{schemaVersion:"arena-healing-1",matchId,tierId,open:true,issuedAtMs:Date.now(),currentVitals:userData.holobotVitals??{}});

    return {
      matchId,currentVitals:userData.holobotVitals as Record<string,unknown>??{},
      arenaPasses:
        updates.arenaPassses !== undefined
          ? Number(updates.arenaPassses)
          : Number(userData.arenaPassses || 0),
      holosTokens:
        updates.holosTokens !== undefined
          ? Number(updates.holosTokens)
          : Number(userData.holosTokens || 0),
    };
  });
});
