import { createHash } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { emptySnapshot, execute, HostError, newRollSeed, Reply, Session, validateCommand, replayReceipt, currentReceiptReply } from './wildEncounterDomain';
import { projectCapture, readTravelSquad } from './captureOwnership';
import { BUDDY_UNITS_FIELD, BuddyInventory, readBuddyInventory } from '../lib/buddyUnits';

/**
 * DECISIONS #43/#44: the player's per-tier Buddy Units. A never-seen pilot gets the starter
 * Unit exactly once and a #43 integer is migrated to the tier map; both are returned as
 * `inventoryUpdates` for the caller to persist in the same transaction.
 */
export function readPlayerUnits(profile: Record<string, unknown>): { units: BuddyInventory; inventoryUpdates: Record<string, unknown> } {
  const read = readBuddyInventory(profile);
  if (!read) throw new HostError('unavailable');
  return { units: read.units, inventoryUpdates: read.updates };
}

const sameInventory = (a: BuddyInventory, b: BuddyInventory) => a.light === b.light && a.medium === b.medium && a.heavy === b.heavy;

/** `seedIfMissing` is pinned outside the transaction so retries see one candidate capture-roll secret. */
export async function transactWildEncounter(db: Firestore, uid: string, raw: unknown, seedIfMissing: string = newRollSeed()): Promise<Reply> {
    const command = validateCommand(raw);
    const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const sessionRef = db.doc(`wildEncounterSessions/${uid}`);
    const receiptRef = command.intent ? sessionRef.collection('receipts').doc(command.intent.requestId) : undefined;

    return await db.runTransaction(async tx => {
      const snapshot = await tx.get(sessionRef);
      const userRef = db.doc(`users/${uid}`);
      if (!snapshot.exists && command.operation === 'refresh') {
        // No encounter data yet is the normal state for a new pilot: empty presentation, no session created.
        const userSnapshot = await tx.get(userRef);
        if (!userSnapshot.exists) throw new HostError('unavailable');
        const profile = userSnapshot.data()!;
        const travelSquad = readTravelSquad(profile);
        const { units, inventoryUpdates } = readPlayerUnits(profile);
        const empty = emptySnapshot(units);
        empty.travelSquad = travelSquad;
        if (Object.keys(inventoryUpdates).length) tx.update(userRef, inventoryUpdates);
        return empty;
      }
      if (!snapshot.exists || snapshot.data()?.enabled !== true) throw new HostError('unavailable');
      const userSnapshot = await tx.get(userRef);
      if (!userSnapshot.exists) throw new HostError('unavailable');
      const profile = userSnapshot.data()!;
      const travelSquad = readTravelSquad(profile);
      const { units, inventoryUpdates } = readPlayerUnits(profile);
      if (receiptRef) {
        const receipt = await tx.get(receiptRef);
        if (receipt.exists) {
          // Replays never re-roll or re-spend: the stored ruling, current presentation.
          const current = currentReceiptReply(snapshot.data() as Session, command, replayReceipt(receipt.data() as { digest: string; reply: Reply }, digest)!, units);
          current.travelSquad = travelSquad;
          if (Object.keys(inventoryUpdates).length) tx.update(userRef, inventoryUpdates);
          return current;
        }
      }
      const session = snapshot.data() as Session;
      const result = execute(session.rollSeed === undefined ? { ...session, rollSeed: seedIfMissing } : session, command, units);
      result.reply.travelSquad = travelSquad;
      const userUpdates: Record<string, unknown> = { ...inventoryUpdates };
      if (result.reply.captureResult?.captured) {
        const projection = projectCapture(profile, result.reply.captureResult.holobotId);
        result.reply.captureResult.ownershipOutcome = projection.ownershipOutcome;
        result.reply.captureResult.blueprintDelta = projection.blueprintDelta;
        result.reply.travelSquad = projection.travelSquad;
        Object.assign(userUpdates, projection.updates);
      }
      // The tier is spent (captured or refused) in the same transaction as the ownership write and the receipt.
      if (!sameInventory(result.unitsAfter, units)) userUpdates[BUDDY_UNITS_FIELD] = { ...result.unitsAfter };
      if (Object.keys(userUpdates).length) tx.update(userRef, userUpdates);
      // no_buddy_units is a ruling on nothing: no session change and no receipt, so the same request can succeed once the player holds that tier.
      if (receiptRef && result.reply.captureResult?.outcome !== 'no_buddy_units') {
        tx.set(sessionRef, result.session);
        tx.create(receiptRef, { digest, reply: result.reply });
      }
      return result.reply;
    });
}
