import { timingSafeEqual } from "node:crypto";

import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";

import { db } from "../admin";
import {
  buildBattlePassUpdate,
  GENESIS_PURCHASE_EVENT_TYPES,
  isGenesisIapProduct,
  parseRevenueCatEvent,
} from "../lib/monetization";
import { buildGenesisSquadGrantRaw } from "../lib/referrals";

/**
 * RevenueCat server-to-server webhook — the ONLY purchase fulfillment path
 * (clients cannot write economy fields). Auth: RevenueCat sends the raw
 * Authorization header value configured in its dashboard; it must equal the
 * REVENUECAT_WEBHOOK_AUTH secret (`firebase functions:secrets:set`, see
 * mobile/docs/revenuecat-setup.md).
 *
 * Response contract: 2xx for anything permanently settled (fulfilled,
 * already claimed, unknown user, unparseable body) because RevenueCat
 * retries every non-2xx — only transient failures return 5xx.
 */

const webhookAuth = defineSecret("REVENUECAT_WEBHOOK_AUTH");

function safeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

type WebhookOutcome =
  | "unknown-user"
  | "genesis-granted"
  | "genesis-already-claimed"
  | "battle-pass-updated"
  | "no-op";

export const revenuecatWebhook = onRequest({ secrets: [webhookAuth] }, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).send("Method Not Allowed");
    return;
  }

  const expected = webhookAuth.value();
  const provided = request.get("authorization") ?? "";
  if (!expected || !safeEqual(provided, expected)) {
    response.status(401).send("Unauthorized");
    return;
  }

  const event = parseRevenueCatEvent(request.body);
  if (!event) {
    // Permanently malformed: acknowledge so RevenueCat does not retry-loop.
    logger.warn("revenuecatWebhook: unparseable event body; skipping");
    response.status(200).json({ handled: false, outcome: "unparseable" });
    return;
  }

  const userRef = db.doc(`users/${event.appUserId}`);

  try {
    const outcome = await db.runTransaction<WebhookOutcome>(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists) {
        return "unknown-user";
      }

      const userData = snapshot.data() ?? {};

      if (isGenesisIapProduct(event.productId)) {
        if (!(GENESIS_PURCHASE_EVENT_TYPES as readonly string[]).includes(event.type)) {
          return "no-op";
        }
        const grant = buildGenesisSquadGrantRaw(userData, "purchase");
        if (!grant) {
          // Idempotent via genesisSquadClaimed: retries and restores settle here.
          return "genesis-already-claimed";
        }
        transaction.set(userRef, grant.updates, { merge: true });
        return "genesis-granted";
      }

      const update = buildBattlePassUpdate(userData, event);
      if (!update) {
        // Unknown product, non-activation event (EXPIRATION/CANCELLATION lapse
        // naturally by timestamp), or an expiration we already recorded.
        return "no-op";
      }
      transaction.set(userRef, update, { merge: true });
      return "battle-pass-updated";
    });

    if (outcome === "unknown-user") {
      // Permanently bad (e.g. an anonymous RevenueCat id): log and acknowledge.
      logger.warn("revenuecatWebhook: no user doc for app_user_id; skipping", {
        appUserId: event.appUserId,
        type: event.type,
      });
    } else {
      logger.info("revenuecatWebhook: event settled", {
        appUserId: event.appUserId,
        outcome,
        productId: event.productId,
        type: event.type,
      });
    }

    response.status(200).json({ handled: outcome !== "unknown-user", outcome });
  } catch (error) {
    // Transient (Firestore contention/outage): 5xx so RevenueCat retries.
    logger.error("revenuecatWebhook: transaction failed", error);
    response.status(500).send("Internal error");
  }
});
