import { createHash } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { execute, HostError, Reply, Session, validateCommand, replayReceipt } from './wildEncounterDomain';
export async function transactWildEncounter(db: Firestore, uid: string, raw: unknown, draw: number): Promise<Reply> {
    const command = validateCommand(raw);
    const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const sessionRef = db.doc(`wildEncounterSessions/${uid}`);
    const receiptRef = command.intent ? sessionRef.collection('receipts').doc(command.intent.requestId) : undefined;
    // Pin the draw across Firestore transaction retries; a replay uses the persisted ruling.

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
}
