import { Firestore } from "firebase-admin/firestore";

import {
  buildQuantityPurchase,
  MARKETPLACE_RECEIPTS_COLLECTION,
  QuantityPurchaseRefusal,
  QuantityPurchaseReply,
  replayQuantityPurchase,
  validateQuantityPurchase,
} from "../lib/marketplaceQuantity";
import { REFUSALS } from "../lib/marketplaceRefusals";
import { onboardingAfterEvent } from "../lib/onboarding";

/**
 * market-quantity-host-1 (marketplace-item-purchase-1): one transaction reads users/{uid} and the receipt
 * vendorPurchases/{uid}/marketplaceItems/{requestId}; a stored receipt replays (or is sequence_conflict), otherwise
 * the Holos debit, the counter increment and the onboarding market beat are one users/{uid} write and the receipt
 * is the one ledger entry. Refusals throw QuantityPurchaseRefusal before any write.
 */
export async function transactMarketplaceQuantityPurchase(
  firestore: Firestore,
  uid: string,
  raw: unknown,
  nowMs: number = Date.now(),
): Promise<QuantityPurchaseReply> {
  const command = validateQuantityPurchase(raw);
  const userRef = firestore.doc(`users/${uid}`);
  const receiptRef = firestore.doc(`vendorPurchases/${uid}/${MARKETPLACE_RECEIPTS_COLLECTION}/${command.requestId}`);
  return firestore.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new QuantityPurchaseRefusal(REFUSALS.profileMissing);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) return replayQuantityPurchase(receipt.data(), command);
    const profile = user.data() ?? {};
    const purchase = buildQuantityPurchase(profile, command, nowMs);
    // onboarding-host-1 (#72.3–#72.5): the first vendor purchase completes the market beat (once per purchase, not per unit).
    tx.set(userRef, { ...purchase.updates, ...onboardingAfterEvent(profile, "vendor_purchase", nowMs) }, { merge: true });
    tx.create(receiptRef, purchase.receipt);
    return purchase.reply;
  });
}
