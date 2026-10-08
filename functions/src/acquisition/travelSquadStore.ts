import { createHash } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { readTravelSquad, ownsCaptureBot, projectFirstTravelHolobot } from './captureOwnership';
import { HostError, TravelSquad } from './wildEncounterDomain';

export type SquadCommand = { operation: 'refresh' } | { operation: 'setSlot'; intent: { schemaVersion: 'travel-squad-1'; requestId: string; expectedRevision: number; slotIndex: number; holobotId: string } };
export type SquadReply = { schemaVersion: 'travel-squad-1'; requestId: string; travelSquad: TravelSquad };
export function validateSquadCommand(raw: unknown): SquadCommand {
  if (!raw || typeof raw !== 'object') throw new HostError('invalid_request');
  const c = raw as SquadCommand;
  if (c.operation === 'refresh') return { operation: 'refresh' };
  if (c.operation !== 'setSlot') throw new HostError('invalid_request');
  const i = c.intent;
  if (!i || i.schemaVersion !== 'travel-squad-1' || typeof i.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(i.requestId) || !Number.isInteger(i.expectedRevision) || i.expectedRevision < 0 || i.expectedRevision > 2147483647 || !Number.isInteger(i.slotIndex) || i.slotIndex < 0 || i.slotIndex > 2 || typeof i.holobotId !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(i.holobotId)) throw new HostError('invalid_request');
  return { operation: 'setSlot', intent: { schemaVersion: 'travel-squad-1', requestId: i.requestId, expectedRevision: i.expectedRevision, slotIndex: i.slotIndex, holobotId: i.holobotId } };
}
export function applySquadSelection(profile: Record<string, unknown>, command: Extract<SquadCommand, {operation:'setSlot'}>): TravelSquad {
  const s = readTravelSquad(profile), i = command.intent;
  if (s.revision !== i.expectedRevision) throw new HostError('stale_revision');
  if (!ownsCaptureBot(profile, i.holobotId) || i.slotIndex > s.holobotIds.length) throw new HostError('not_allowed');
  const assigned = s.holobotIds.indexOf(i.holobotId);
  if (assigned >= 0 && assigned !== i.slotIndex) throw new HostError('not_allowed');
  if (assigned === i.slotIndex) return s;
  if (s.revision === 2147483647) throw new HostError('unavailable');
  s.holobotIds[i.slotIndex] = i.holobotId;
  s.revision++;
  return s;
}
/** Receipt namespace is outside client-owned users subcollections. */
export async function transactTravelSquad(db: Firestore, uid: string, raw: unknown): Promise<SquadReply> {
  const command = validateSquadCommand(raw);
  const userRef = db.doc(`users/${uid}`);
  const receiptRef = command.operation === 'setSlot' ? db.doc(`travelSquadCommands/${uid}/receipts/${command.intent.requestId}`) : undefined;
  const digest = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return db.runTransaction(async tx => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HostError('unavailable');
    const profile = user.data()!;
    const current = readTravelSquad(profile);
    const reply: SquadReply = { schemaVersion: 'travel-squad-1', requestId: command.operation === 'setSlot' ? command.intent.requestId : '', travelSquad: current };
    if (command.operation === 'refresh') {
      const initial = projectFirstTravelHolobot(profile);
      if (Object.keys(initial.updates).length) tx.update(userRef, initial.updates);
      reply.travelSquad = initial.travelSquad;
      return reply;
    }
    if (!receiptRef) return reply;
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data()?.digest !== digest) throw new HostError('sequence_conflict');
      return reply;
    }
    reply.travelSquad = applySquadSelection(profile, command);
    if (reply.travelSquad.revision !== current.revision) tx.update(userRef, { travelSquad: reply.travelSquad });
    tx.create(receiptRef, { digest, acceptedRevision: reply.travelSquad.revision });
    return reply;
  });
}
