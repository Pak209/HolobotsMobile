import { createHash, randomInt } from 'node:crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { db } from '../admin';
import { execute, HostError, Reply, Session, validateCommand, replayReceipt } from './wildEncounterDomain';

/** Admin-provisioned sessions only. These top-level collections are default-denied by rules. */
export const wildEncounterHost = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to meet wild Holobots.');
  try {
    const command = validateCommand(request.data);
    const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const sessionRef = db.doc(`wildEncounterSessions/${uid}`);
    const receiptRef = command.intent ? sessionRef.collection('receipts').doc(command.intent.requestId) : undefined;
    // Pin the draw across Firestore transaction retries; a replay uses the persisted ruling.
    const draw = randomInt(0, 0x100000000) / 0x100000000;
    return await db.runTransaction(async tx => {
      const snapshot = await tx.get(sessionRef);
      if (!snapshot.exists || snapshot.data()?.enabled !== true) throw new HostError('unavailable');
      if (receiptRef) {
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) {
          return replayReceipt(receipt.data() as { digest: string; reply: Reply }, digest)!;
        }
      }
      const result = execute(snapshot.data() as Session, command, draw);
      if (receiptRef) {
        tx.set(sessionRef, result.session);
        tx.create(receiptRef, { digest, reply: result.reply });
      }
      return result.reply;
    });
  } catch (error) {
    if (error instanceof HostError) {
      throw new HttpsError(error.code === 'invalid_request' ? 'invalid-argument' : error.code === 'sequence_conflict' ? 'already-exists' : error.code === 'unavailable' ? 'unavailable' : 'failed-precondition', error.code, { rejectionCode: error.code });
    }
    throw error;
  }
});
