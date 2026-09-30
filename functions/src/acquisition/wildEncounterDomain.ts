/** Server-only acquisition state. No default odds, spawn schedule, grants or inventory. */
export type Item = { itemId: string; kind: 'affinity_toy' | 'buddy_unit'; displayName: string; modelKey: string; remaining: number; useAllowed: boolean; affinityGain: number };
export type Encounter = { encounterId: string; holobotId: string; affinityTier: number; affinityMax: number; captureOpen: boolean; chanceByAffinity: number[]; items: Item[]; ended: boolean };
export type RosterEntry = { holobotId: string; availability: string; source: string; copies: number };
export type Session = { enabled: boolean; returnRefusedUnit: true; revision: number; rosterRevision: number; encounters: Encounter[]; entries: RosterEntry[] };
export type Command = { operation: 'refresh' | 'worldState' | 'offerToy' | 'capture'; encounterId?: string; intent?: { schemaVersion: string; requestId: string; encounterId: string; itemId?: string; toyId?: string; observedHealth01?: number } };
export type WorldState = { schemaVersion: 'capture-world-1'; encounterId: string; holobotId: string; revision: number; requestId: string; affinityTier: number; affinityMax: number; chanceKnown: boolean; captureChance01: number; items: Omit<Item, 'affinityGain'>[]; reaction: string };
export type TravelSquad = { schemaVersion: 'travel-squad-1'; revision: number; holobotIds: string[] };
export type Reply = { travelSquad: TravelSquad; revision: number; encounters: unknown[]; worldStates: WorldState[]; withdrawnEncounterIds: string[]; roster: { schemaVersion: 'acquisition-0'; revision: number; entries: RosterEntry[] }; captureResult?: { schemaVersion: 'acquisition-0'; requestId: string; encounterId: string; holobotId: string; captured: boolean; outcome: string; affinityTierAfter: number; retryGuaranteed: boolean; toyConsumedId: string; ownershipOutcome: '' | 'new_bot' | 'added_to_squad' | 'blueprints'; blueprintDelta: number } };
export class HostError extends Error { constructor(public code: 'invalid_request' | 'not_allowed' | 'unavailable' | 'sequence_conflict' | 'stale_revision') { super(code); } }
const id = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
export function validateCommand(raw: unknown): Command {
  if (!raw || typeof raw !== 'object') throw new HostError('invalid_request');
  const c = raw as Command;
  if (!['refresh', 'worldState', 'offerToy', 'capture'].includes(c.operation)) throw new HostError('invalid_request');
  if (c.operation === 'refresh') return { operation: c.operation };
  if (c.operation === 'worldState') { if (!id(c.encounterId)) throw new HostError('invalid_request'); return { operation: c.operation, encounterId: c.encounterId }; }
  const i = c.intent;
  if (!i || !id(i.requestId) || !id(i.encounterId) || i.schemaVersion !== (c.operation === 'capture' ? 'acquisition-0' : 'capture-world-1')) throw new HostError('invalid_request');
  if (c.operation === 'capture') {
    if (!id(i.toyId) || typeof i.observedHealth01 !== 'number' || !Number.isFinite(i.observedHealth01) || i.observedHealth01 < 0 || i.observedHealth01 > 1) throw new HostError('invalid_request');
    return { operation: c.operation, intent: { schemaVersion: i.schemaVersion, requestId: i.requestId, encounterId: i.encounterId, toyId: i.toyId, observedHealth01: i.observedHealth01 } };
  }
  if (!id(i.itemId)) throw new HostError('invalid_request');
  return { operation: c.operation, intent: { schemaVersion: i.schemaVersion, requestId: i.requestId, encounterId: i.encounterId, itemId: i.itemId } };
}
function world(s: Session, e: Encounter, requestId = '', reaction = ''): WorldState {
  return { schemaVersion: 'capture-world-1', encounterId: e.encounterId, holobotId: e.holobotId, revision: s.revision, requestId, affinityTier: e.affinityTier, affinityMax: e.affinityMax, chanceKnown: true, captureChance01: e.chanceByAffinity[e.affinityTier], items: e.items.map(({ affinityGain: _, ...item }) => ({ ...item, useAllowed: item.useAllowed && item.remaining > 0 && !e.ended && e.captureOpen })), reaction };
}
function snapshot(s: Session): Reply {
  return { travelSquad: { schemaVersion: 'travel-squad-1', revision: 0, holobotIds: [] }, revision: s.revision, encounters: s.encounters.filter(e => !e.ended).map(e => ({ schemaVersion: 'acquisition-0', encounterId: e.encounterId, holobotId: e.holobotId, affinityTier: e.affinityTier, affinityMax: e.affinityMax, captureOpen: e.captureOpen, allowedToyIds: e.items.filter(i => i.kind === 'buddy_unit' && i.useAllowed && i.remaining > 0).map(i => i.itemId) })), worldStates: s.encounters.filter(e => !e.ended).map(e => world(s, e)), withdrawnEncounterIds: s.encounters.filter(e => e.ended).map(e => e.encounterId), roster: { schemaVersion: 'acquisition-0', revision: s.rosterRevision, entries: s.entries } };
}
/** A signed-in pilot with no provisioned session yet (every new account): a normal empty state, not an error. Refresh only; no write. */
export function emptySnapshot(): Reply {
  return { travelSquad: { schemaVersion: 'travel-squad-1', revision: 0, holobotIds: [] }, revision: 0, encounters: [], worldStates: [], withdrawnEncounterIds: [], roster: { schemaVersion: 'acquisition-0', revision: 0, entries: [] } };
}
/** Caller supplies an authoritative provisioned session and server random draw. Never trusts observed health. */
export function execute(session: Session | undefined, raw: unknown, draw: number): { session: Session; reply: Reply } {
  const c = validateCommand(raw);
  if (!session?.enabled || session.returnRefusedUnit !== true) throw new HostError('unavailable');
  const s: Session = structuredClone(session);
  if (!Number.isInteger(s.revision) || s.revision < 0 || !Number.isInteger(s.rosterRevision) || s.rosterRevision < 0) throw new HostError('unavailable');
  for (const e of s.encounters) {
    if (!id(e.encounterId) || typeof e.holobotId !== 'string' || !(/^[a-z][a-z0-9_]{0,127}$/).test(e.holobotId) || !Number.isInteger(e.affinityTier) || !Number.isInteger(e.affinityMax) || e.affinityMax <= 0 || e.affinityTier < 0 || e.affinityTier > e.affinityMax || e.chanceByAffinity.length !== e.affinityMax + 1 || e.chanceByAffinity.some(n => !Number.isFinite(n) || n < 0 || n > 1) || new Set(e.items.map(i => i.kind)).size !== e.items.length || e.items.some(i => !id(i.itemId) || !['affinity_toy', 'buddy_unit'].includes(i.kind) || !Number.isInteger(i.remaining) || i.remaining < 0 || !Number.isInteger(i.affinityGain) || i.affinityGain < 0)) throw new HostError('unavailable');
  }
  if (new Set(s.encounters.map(e => e.encounterId)).size !== s.encounters.length) throw new HostError('unavailable');
  if (c.operation === 'refresh') return { session: s, reply: snapshot(s) };
  const e = s.encounters.find(e => e.encounterId === (c.encounterId ?? c.intent?.encounterId));
  if (!e || e.ended) throw new HostError('not_allowed');
  if (c.operation === 'worldState') { const r = snapshot(s); r.worldStates = [world(s, e)]; return { session: s, reply: r }; }
  if (!e.captureOpen) throw new HostError('not_allowed');
  const i = c.intent!;
  const item = e.items.find(x => x.itemId === (i.itemId ?? i.toyId) && x.kind === (c.operation === 'capture' ? 'buddy_unit' : 'affinity_toy'));
  if (!item?.useAllowed || item.remaining < 1) throw new HostError('not_allowed');
  s.revision++;
  if (c.operation === 'offerToy') {
    item.remaining--; e.affinityTier = Math.min(e.affinityMax, e.affinityTier + item.affinityGain);
    const r = snapshot(s); r.worldStates = [world(s, e, i.requestId, 'toy_accepted')]; return { session: s, reply: r };
  }
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new HostError('unavailable');
  const captured = draw < e.chanceByAffinity[e.affinityTier];
  // Refusals return the same Unit: guarantees another attempt without minting inventory.
  if (captured) { item.remaining--; e.ended = true; if (!s.entries.some(x => x.holobotId === e.holobotId && x.availability === 'owned')) { s.entries = s.entries.filter(x => x.holobotId !== e.holobotId); s.entries.push({ holobotId: e.holobotId, availability: 'owned', source: 'capture', copies: 1 }); } s.rosterRevision++; }
  const r = snapshot(s);
  r.captureResult = { schemaVersion: 'acquisition-0', requestId: i.requestId, encounterId: e.encounterId, holobotId: e.holobotId, captured, outcome: captured ? 'captured' : 'refused', affinityTierAfter: e.affinityTier, retryGuaranteed: !captured, toyConsumedId: captured ? item.itemId : '', ownershipOutcome: captured ? 'new_bot' : '', blueprintDelta: 0 };
  if (!captured) r.worldStates = [world(s, e, '', 'refused')];
  return { session: s, reply: r };
}

export function replayReceipt(receipt: { digest: string; reply: Reply } | undefined, digest: string): Reply | undefined {
  if (!receipt) return undefined;
  if (receipt.digest !== digest) throw new HostError('sequence_conflict');
  return receipt.reply;
}

/** Replay immutable intent outcome inside current presentation state; never replay stale odds/inventory. */
export function currentReceiptReply(session: Session, command: Command, receiptReply: Reply): Reply {
  const current = execute(session, { operation: 'refresh' }, 0).reply;
  if (receiptReply.captureResult) current.captureResult = structuredClone(receiptReply.captureResult);
  if (command.operation === 'offerToy') {
    const state = current.worldStates.find(s => s.encounterId === command.intent!.encounterId);
    if (state) {
      state.requestId = command.intent!.requestId;
      state.reaction = 'toy_accepted';
    }
  }
  return current;
}
