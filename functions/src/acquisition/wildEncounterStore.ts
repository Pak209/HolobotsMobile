import { createHash } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { emptySnapshot, execute, HostError, Reply, Session, validateCommand, replayReceipt, currentReceiptReply } from './wildEncounterDomain';
import { projectCapture, readTravelSquad } from './captureOwnership';
export async function transactWildEncounter(db: Firestore, uid: string, raw: unknown, draw: number): Promise<Reply> {
    const command = validateCommand(raw);
    const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const sessionRef = db.doc(`wildEncounterSessions/${uid}`);
    const receiptRef = command.intent ? sessionRef.collection('receipts').doc(command.intent.requestId) : undefined;
    // Pin the draw across Firestore transaction retries; a replay uses the persisted ruling.

    return await db.runTransaction(async tx => {
      const snapshot = await tx.get(sessionRef);
      const userRef = db.doc(`users/${uid}`);
      if (!snapshot.exists && command.operation === 'refresh') {
        // No encounter data yet is the normal state for a new pilot: empty presentation, no session created.
        const userSnapshot = await tx.get(userRef);
        if (!userSnapshot.exists) throw new HostError('unavailable');
        const empty = emptySnapshot();
        empty.travelSquad = readTravelSquad(userSnapshot.data()!);
        return empty;
      }
      if (!snapshot.exists || snapshot.data()?.enabled !== true) throw new HostError('unavailable');
      const userSnapshot = await tx.get(userRef);
      if (!userSnapshot.exists) throw new HostError('unavailable');
      const profile = userSnapshot.data()!;
      const travelSquad = readTravelSquad(profile);
      if (receiptRef) {
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) {
          const current = currentReceiptReply(snapshot.data() as Session, command, replayReceipt(receipt.data() as { digest: string; reply: Reply }, digest)!);
          current.travelSquad = travelSquad;
          return current;
        }
      }
      const result = execute(snapshot.data() as Session, command, draw);
      result.reply.travelSquad = travelSquad;
      if (result.reply.captureResult?.captured) {
        const projection = projectCapture(profile, result.reply.captureResult.holobotId);
        result.reply.captureResult.ownershipOutcome = projection.ownershipOutcome;
        result.reply.captureResult.blueprintDelta = projection.blueprintDelta;
        result.reply.travelSquad = projection.travelSquad;
        tx.update(userRef, projection.updates);
      }
      if (receiptRef) {
        tx.set(sessionRef, result.session);
        tx.create(receiptRef, { digest, reply: result.reply });
      }
      return result.reply;
    });
}
