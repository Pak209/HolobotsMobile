import { Firestore } from 'firebase-admin/firestore';
import { applyEquip, applyPurchase, commandFingerprint, MutationReply, readWardrobeState, validateWardrobeCommand, wardrobeStatus, WardrobeError } from '../lib/wardrobe';

/**
 * DECISIONS #48 wardrobe. State at wardrobes/{uid} ({schemaVersion, entitlements, identity, loadouts:{city, field}}) and receipts
 * at wardrobes/{uid}/receipts/{requestId} ({fingerprint, reply}): top-level, server-only (rules deny
 * every client read and write), deleted with the account (deleteUserData).
 *
 * - status: two point reads, never writes, never grants (no doc → nothing owned; city = default outfit, field = copy of city).
 * - purchase / equip: one transaction. A receipt with the same fingerprint replays its reply
 *   (alreadyProcessed: true, nothing written); a different fingerprint is sequence_conflict. A purchase
 *   writes the Holos spend, the entitlement and the receipt together; equip never touches Holos.
 *   Rejections (already_owned, not_enough_holos, not_owned, invalid_request) write nothing, not even a receipt.
 */
export async function transactWardrobe(db: Firestore, uid: string, raw: unknown) {
  const command = validateWardrobeCommand(raw);
  const userRef = db.doc(`users/${uid}`);
  const wardrobeRef = db.doc(`wardrobes/${uid}`);
  if (command.operation === 'status') {
    const [user, wardrobe] = await Promise.all([userRef.get(), wardrobeRef.get()]);
    if (!user.exists) throw new WardrobeError('unavailable');
    return wardrobeStatus(user.data()!, readWardrobeState(wardrobe.exists ? wardrobe.data() : undefined));
  }
  const fingerprint = commandFingerprint(command);
  const receiptRef = db.doc(`wardrobes/${uid}/receipts/${command.requestId}`);
  return db.runTransaction(async tx => {
    const [user, wardrobe, receipt] = await Promise.all([tx.get(userRef), tx.get(wardrobeRef), tx.get(receiptRef)]);
    if (!user.exists) throw new WardrobeError('unavailable');
    if (receipt.exists) {
      if (receipt.get('fingerprint') !== fingerprint) throw new WardrobeError('sequence_conflict');
      return { ...(receipt.get('reply') as MutationReply), alreadyProcessed: true };
    }
    const state = readWardrobeState(wardrobe.exists ? wardrobe.data() : undefined);
    if (command.operation === 'purchase') {
      const r = applyPurchase(user.data()!, state, command);
      tx.update(userRef, { holosTokens: r.holosAfter });
      tx.set(wardrobeRef, r.state);
      tx.create(receiptRef, { fingerprint, reply: r.reply });
      return r.reply;
    }
    const r = applyEquip(user.data()!, state, command);
    tx.set(wardrobeRef, r.state);
    tx.create(receiptRef, { fingerprint, reply: r.reply });
    return r.reply;
  });
}
