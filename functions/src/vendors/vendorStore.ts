import { Firestore } from 'firebase-admin/firestore';
import { buildBuddyUnitPurchase, buildCatalog, BuddyPurchaseReply, validateBuddyPurchase, validateCatalogCommand, VendorError } from '../lib/vendors';

/** DECISIONS #47 read: one point read of users/{uid}; never writes. */
export async function readVendorCatalog(db: Firestore, uid: string, raw: unknown, nowMs: number = Date.now()) {
  const command = validateCatalogCommand(raw);
  const user = await db.doc(`users/${uid}`).get();
  if (!user.exists) throw new VendorError('unavailable');
  const wardrobe = await db.doc(`wardrobes/${uid}`).get();
  return buildCatalog({...user.data()!, wardrobeEntitlements:wardrobe.get('entitlements') ?? []}, command.vendorId, nowMs);
}

/**
 * Medium / Heavy Buddy Unit purchase. The Holos spend and the tier increment are one update in one
 * transaction with the receipt at vendorPurchases/{uid}/receipts/{requestId} (server-only, outside the
 * client-writable users/{uid} subcollections). A retry of the same requestId replays the stored reply
 * (alreadyProcessed: true) and never buys twice; the same requestId for another tier is sequence_conflict.
 * "Not enough Holos." writes nothing (no receipt), so the same request can succeed later.
 */
export async function transactBuddyUnitPurchase(db: Firestore, uid: string, raw: unknown): Promise<BuddyPurchaseReply> {
  const command = validateBuddyPurchase(raw);
  const userRef = db.doc(`users/${uid}`);
  const receiptRef = db.doc(`vendorPurchases/${uid}/receipts/${command.requestId}`);
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new VendorError('unavailable');
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      const stored = receipt.data() as { tierId: string; reply: BuddyPurchaseReply };
      if (stored.tierId !== command.tierId) throw new VendorError('sequence_conflict');
      return { ...stored.reply, alreadyProcessed: true };
    }
    const r = buildBuddyUnitPurchase(user.data()!, command);
    tx.update(userRef, r.updates);
    tx.create(receiptRef, { tierId: command.tierId, reply: r.reply });
    return r.reply;
  });
}
