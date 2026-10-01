import { createHash } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { emptySnapshot, execute, HostError, Reply, Session, validateCommand, replayReceipt, currentReceiptReply } from './wildEncounterDomain';
import { projectCapture, readTravelSquad } from './captureOwnership';
import { BUDDY_UNITS_FIELD, readBuddyUnits } from '../lib/rivalLadder';

/** DECISIONS #43: the player's Buddy Units; a never-seen pilot is granted the starter Units exactly once (persisted by the caller). */
export function readPlayerUnits(profile: Record<string, unknown>): { units: number; starterUpdates: Record<string, unknown> } {
  const read = readBuddyUnits(profile);
  if (!read) throw new HostError('unavailable');
  return { units: read.units, starterUpdates: read.grantStarter ? { [BUDDY_UNITS_FIELD]: read.units } : {} };
}

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
        const profile = userSnapshot.data()!;
        const travelSquad = readTravelSquad(profile);
        const { units, starterUpdates } = readPlayerUnits(profile);
        const empty = emptySnapshot(units);
        empty.travelSquad = travelSquad;
        if (Object.keys(starterUpdates).length) tx.update(userRef, starterUpdates);
        return empty;
      }
      if (!snapshot.exists || snapshot.data()?.enabled !== true) throw new HostError('unavailable');
      const userSnapshot = await tx.get(userRef);
      if (!userSnapshot.exists) throw new HostError('unavailable');
      const profile = userSnapshot.data()!;
      const travelSquad = readTravelSquad(profile);
      const { units, starterUpdates } = readPlayerUnits(profile);
      if (receiptRef) {
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) {
          const current = currentReceiptReply(snapshot.data() as Session, command, replayReceipt(receipt.data() as { digest: string; reply: Reply }, digest)!, units);
          current.travelSquad = travelSquad;
          if (Object.keys(starterUpdates).length) tx.update(userRef, starterUpdates);
          return current;
        }
      }
      const result = execute(snapshot.data() as Session, command, draw, units);
      result.reply.travelSquad = travelSquad;
      const userUpdates: Record<string, unknown> = { ...starterUpdates };
      if (result.reply.captureResult?.captured) {
        const projection = projectCapture(profile, result.reply.captureResult.holobotId);
        result.reply.captureResult.ownershipOutcome = projection.ownershipOutcome;
        result.reply.captureResult.blueprintDelta = projection.blueprintDelta;
        result.reply.travelSquad = projection.travelSquad;
        Object.assign(userUpdates, projection.updates);
      }
      // The Unit is spent in the same transaction as the ownership write.
      if (result.unitsAfter !== units) userUpdates[BUDDY_UNITS_FIELD] = result.unitsAfter;
      if (Object.keys(userUpdates).length) tx.update(userRef, userUpdates);
      // no_buddy_units is a ruling on nothing: no session change and no receipt, so the same request can succeed once the player holds a Unit.
      if (receiptRef && result.reply.captureResult?.outcome !== 'no_buddy_units') {
        tx.set(sessionRef, result.session);
        tx.create(receiptRef, { digest, reply: result.reply });
      }
      return result.reply;
    });
}
