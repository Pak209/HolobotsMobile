/**
 * Server-only acquisition state. No default odds, spawn schedule or grants.
 * acquisition-2 (DECISIONS #44): Buddy Units come in three tiers (lib/buddyUnits.ts).
 * A capture names its tier (toyId = buddy_light | buddy_medium | buddy_heavy) and
 * spends that tier from the PLAYER's inventory (users/{uid}.buddyUnits, passed in as
 * `units`) whether the Holobot is captured or refuses. The chance comes from the tier
 * plus the encounter's affinity lift; the roll is seeded per requestId (session secret).
 * The provisioned encounter's single buddy_unit item now only gates whether Units can be
 * thrown at it (useAllowed); it is presented as one world item per tier.
 */
import { randomBytes } from 'node:crypto';
import { BUDDY_UNIT_TIERS, BUDDY_UNITS_PER_CAPTURE, BuddyInventory, BuddyTierId, captureChance01, captureRoll01, isValidInventory, ROLL_SEED, tierById, tierByKey, withTierDelta } from '../lib/buddyUnits';

export const ACQUISITION_SCHEMA = 'acquisition-2';
export type Item = { itemId: string; kind: 'affinity_toy' | 'buddy_unit'; displayName: string; modelKey: string; remaining: number; useAllowed: boolean; affinityGain: number };
export type Encounter = { encounterId: string; holobotId: string; affinityTier: number; affinityMax: number; captureOpen: boolean; chanceByAffinity: number[]; items: Item[]; ended: boolean };
export type RosterEntry = { holobotId: string; availability: string; source: string; copies: number };
/** `returnRefusedUnit` is the #40 refund flag, ignored since #44 (refusals consume). `rollSeed` is the server-only capture-roll secret. */
export type Session = { enabled: boolean; returnRefusedUnit?: boolean; rollSeed?: string; revision: number; rosterRevision: number; encounters: Encounter[]; entries: RosterEntry[] };
export type Command = { operation: 'refresh' | 'worldState' | 'offerToy' | 'capture'; encounterId?: string; intent?: { schemaVersion: string; requestId: string; encounterId: string; itemId?: string; toyId?: string; observedHealth01?: number } };
/** captureChance01 on an item: that tier's chance for buddy_unit items, 0 on affinity toys. */
export type WorldItem = Omit<Item, 'affinityGain'> & { captureChance01: number };
/** Top-level captureChance01 = the Light tier's chance (per-tier chances are on the items). */
export type WorldState = { schemaVersion: 'capture-world-1'; encounterId: string; holobotId: string; revision: number; requestId: string; affinityTier: number; affinityMax: number; chanceKnown: boolean; captureChance01: number; items: WorldItem[]; reaction: string };
export type TravelSquad = { schemaVersion: 'travel-squad-1'; revision: number; holobotIds: string[] };
export type CaptureOutcome = 'captured' | 'refused' | 'no_buddy_units';
export type CaptureResult = {
  schemaVersion: typeof ACQUISITION_SCHEMA; requestId: string; encounterId: string; holobotId: string;
  captured: boolean; outcome: CaptureOutcome; affinityTierAfter: number;
  /** Always false since #44: a refusal consumes the Unit. Kept for wire stability. */
  retryGuaranteed: false;
  toyConsumedId: string; ownershipOutcome: '' | 'new_bot' | 'added_to_squad' | 'blueprints'; blueprintDelta: number;
  buddyUnitTier: BuddyTierId; buddyUnitsSpent: number; rolled: boolean; roll: number; captureChance01: number;
};
export type Reply = { travelSquad: TravelSquad; buddyUnits: BuddyInventory; revision: number; encounters: unknown[]; worldStates: WorldState[]; withdrawnEncounterIds: string[]; roster: { schemaVersion: typeof ACQUISITION_SCHEMA; revision: number; entries: RosterEntry[] }; captureResult?: CaptureResult };
export class HostError extends Error { constructor(public code: 'invalid_request' | 'not_allowed' | 'unavailable' | 'sequence_conflict' | 'stale_revision') { super(code); } }
const id = (x: unknown): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x);
export function newRollSeed(): string { return randomBytes(32).toString('hex'); }
export function validateCommand(raw: unknown): Command {
  if (!raw || typeof raw !== 'object') throw new HostError('invalid_request');
  const c = raw as Command;
  if (!['refresh', 'worldState', 'offerToy', 'capture'].includes(c.operation)) throw new HostError('invalid_request');
  if (c.operation === 'refresh') return { operation: c.operation };
  if (c.operation === 'worldState') { if (!id(c.encounterId)) throw new HostError('invalid_request'); return { operation: c.operation, encounterId: c.encounterId }; }
  const i = c.intent;
  if (!i || !id(i.requestId) || !id(i.encounterId) || i.schemaVersion !== (c.operation === 'capture' ? ACQUISITION_SCHEMA : 'capture-world-1')) throw new HostError('invalid_request');
  if (c.operation === 'capture') {
    if (!tierById(i.toyId) || typeof i.observedHealth01 !== 'number' || !Number.isFinite(i.observedHealth01) || i.observedHealth01 < 0 || i.observedHealth01 > 1) throw new HostError('invalid_request');
    return { operation: c.operation, intent: { schemaVersion: i.schemaVersion, requestId: i.requestId, encounterId: i.encounterId, toyId: i.toyId, observedHealth01: i.observedHealth01 } };
  }
  if (!id(i.itemId)) throw new HostError('invalid_request');
  return { operation: c.operation, intent: { schemaVersion: i.schemaVersion, requestId: i.requestId, encounterId: i.encounterId, itemId: i.itemId } };
}
const throwable = (e: Encounter, gate: Pick<Item, 'useAllowed'>) => gate.useAllowed && !e.ended && e.captureOpen;
function worldItems(e: Encounter, units: BuddyInventory): WorldItem[] {
  return e.items.flatMap(({ affinityGain: _, ...item }): WorldItem[] => item.kind === 'buddy_unit'
    ? BUDDY_UNIT_TIERS.map(t => ({ itemId: t.id, kind: 'buddy_unit', displayName: t.displayName, modelKey: t.modelKey, remaining: units[t.key], useAllowed: throwable(e, item) && units[t.key] > 0, captureChance01: captureChance01(t, e.chanceByAffinity, e.affinityTier) }))
    : [{ ...item, useAllowed: item.useAllowed && item.remaining > 0 && !e.ended && e.captureOpen, captureChance01: 0 }]);
}
function world(s: Session, e: Encounter, units: BuddyInventory, requestId = '', reaction = ''): WorldState {
  return { schemaVersion: 'capture-world-1', encounterId: e.encounterId, holobotId: e.holobotId, revision: s.revision, requestId, affinityTier: e.affinityTier, affinityMax: e.affinityMax, chanceKnown: true, captureChance01: captureChance01(tierByKey('light'), e.chanceByAffinity, e.affinityTier), items: worldItems(e, units), reaction };
}
function allowedTierIds(e: Encounter, units: BuddyInventory): string[] {
  const gate = e.items.find(i => i.kind === 'buddy_unit');
  return gate?.useAllowed ? BUDDY_UNIT_TIERS.filter(t => units[t.key] > 0).map(t => t.id) : [];
}
function snapshot(s: Session, units: BuddyInventory): Reply {
  return { travelSquad: { schemaVersion: 'travel-squad-1', revision: 0, holobotIds: [] }, buddyUnits: { ...units }, revision: s.revision, encounters: s.encounters.filter(e => !e.ended).map(e => ({ schemaVersion: ACQUISITION_SCHEMA, encounterId: e.encounterId, holobotId: e.holobotId, affinityTier: e.affinityTier, affinityMax: e.affinityMax, captureOpen: e.captureOpen, allowedToyIds: allowedTierIds(e, units) })), worldStates: s.encounters.filter(e => !e.ended).map(e => world(s, e, units)), withdrawnEncounterIds: s.encounters.filter(e => e.ended).map(e => e.encounterId), roster: { schemaVersion: ACQUISITION_SCHEMA, revision: s.rosterRevision, entries: s.entries } };
}
/** A signed-in pilot with no provisioned session yet (every new account): a normal empty state, not an error. Refresh only; no session write. */
export function emptySnapshot(units: BuddyInventory): Reply {
  if (!isValidInventory(units)) throw new HostError('unavailable');
  return { travelSquad: { schemaVersion: 'travel-squad-1', revision: 0, holobotIds: [] }, buddyUnits: { ...units }, revision: 0, encounters: [], worldStates: [], withdrawnEncounterIds: [], roster: { schemaVersion: ACQUISITION_SCHEMA, revision: 0, entries: [] } };
}
/**
 * Caller supplies an authoritative provisioned session and the player's per-tier Buddy Units.
 * A capture needs session.rollSeed (the store adds one when missing; it is persisted with the
 * session write). Never trusts observed health. Returns `unitsAfter`; the caller persists it
 * only when it differs.
 */
export function execute(session: Session | undefined, raw: unknown, units: BuddyInventory): { session: Session; reply: Reply; unitsAfter: BuddyInventory } {
  const c = validateCommand(raw);
  if (!session?.enabled) throw new HostError('unavailable');
  if (!isValidInventory(units)) throw new HostError('unavailable');
  const s: Session = structuredClone(session);
  if (!Number.isInteger(s.revision) || s.revision < 0 || !Number.isInteger(s.rosterRevision) || s.rosterRevision < 0) throw new HostError('unavailable');
  if (s.rollSeed !== undefined && (typeof s.rollSeed !== 'string' || !ROLL_SEED.test(s.rollSeed))) throw new HostError('unavailable');
  for (const e of s.encounters) {
    if (!id(e.encounterId) || typeof e.holobotId !== 'string' || !(/^[a-z][a-z0-9_]{0,127}$/).test(e.holobotId) || !Number.isInteger(e.affinityTier) || !Number.isInteger(e.affinityMax) || e.affinityMax <= 0 || e.affinityTier < 0 || e.affinityTier > e.affinityMax || e.chanceByAffinity.length !== e.affinityMax + 1 || e.chanceByAffinity.some(n => !Number.isFinite(n) || n < 0 || n > 1) || new Set(e.items.map(i => i.kind)).size !== e.items.length || e.items.some(i => !id(i.itemId) || !['affinity_toy', 'buddy_unit'].includes(i.kind) || !Number.isInteger(i.remaining) || i.remaining < 0 || !Number.isInteger(i.affinityGain) || i.affinityGain < 0)) throw new HostError('unavailable');
  }
  if (new Set(s.encounters.map(e => e.encounterId)).size !== s.encounters.length) throw new HostError('unavailable');
  if (c.operation === 'refresh') return { session: s, reply: snapshot(s, units), unitsAfter: units };
  const e = s.encounters.find(e => e.encounterId === (c.encounterId ?? c.intent?.encounterId));
  if (!e || e.ended) throw new HostError('not_allowed');
  if (c.operation === 'worldState') { const r = snapshot(s, units); r.worldStates = [world(s, e, units)]; return { session: s, reply: r, unitsAfter: units }; }
  if (!e.captureOpen) throw new HostError('not_allowed');
  const i = c.intent!;
  if (c.operation === 'offerToy') {
    const toy = e.items.find(x => x.itemId === i.itemId && x.kind === 'affinity_toy');
    if (!toy?.useAllowed || toy.remaining < 1) throw new HostError('not_allowed');
    s.revision++;
    toy.remaining--; e.affinityTier = Math.min(e.affinityMax, e.affinityTier + toy.affinityGain);
    const r = snapshot(s, units); r.worldStates = [world(s, e, units, i.requestId, 'toy_accepted')]; return { session: s, reply: r, unitsAfter: units };
  }
  const gate = e.items.find(x => x.kind === 'buddy_unit');
  if (!gate?.useAllowed) throw new HostError('not_allowed');
  const tier = tierById(i.toyId)!;
  const chance = captureChance01(tier, e.chanceByAffinity, e.affinityTier);
  const base = { schemaVersion: ACQUISITION_SCHEMA as typeof ACQUISITION_SCHEMA, requestId: i.requestId, encounterId: e.encounterId, holobotId: e.holobotId, retryGuaranteed: false as const, ownershipOutcome: '' as const, blueprintDelta: 0, buddyUnitTier: tier.id, captureChance01: chance };
  if (units[tier.key] < BUDDY_UNITS_PER_CAPTURE) {
    // The player can meet a wild Holobot without that tier but cannot throw it. Typed outcome naming the tier;
    // nothing mutates (no revision, no receipt) and the roll is NOT revealed.
    const r = snapshot(s, units);
    r.captureResult = { ...base, captured: false, outcome: 'no_buddy_units', affinityTierAfter: e.affinityTier, toyConsumedId: '', buddyUnitsSpent: 0, rolled: false, roll: 0 };
    return { session: s, reply: r, unitsAfter: units };
  }
  if (!s.rollSeed) throw new HostError('unavailable');
  s.revision++;
  const roll = captureRoll01(s.rollSeed, e.encounterId, i.requestId);
  const captured = roll < chance;
  // #44: the Unit is spent whether the Holobot is captured or refuses.
  const unitsAfter = withTierDelta(units, tier.key, -BUDDY_UNITS_PER_CAPTURE);
  if (captured) { e.ended = true; if (!s.entries.some(x => x.holobotId === e.holobotId && x.availability === 'owned')) { s.entries = s.entries.filter(x => x.holobotId !== e.holobotId); s.entries.push({ holobotId: e.holobotId, availability: 'owned', source: 'capture', copies: 1 }); } s.rosterRevision++; }
  const r = snapshot(s, unitsAfter);
  r.captureResult = { ...base, captured, outcome: captured ? 'captured' : 'refused', affinityTierAfter: e.affinityTier, toyConsumedId: tier.id, ownershipOutcome: captured ? 'new_bot' : '', buddyUnitsSpent: BUDDY_UNITS_PER_CAPTURE, rolled: true, roll };
  if (!captured) r.worldStates = [world(s, e, unitsAfter, '', 'refused')];
  return { session: s, reply: r, unitsAfter };
}

export function replayReceipt(receipt: { digest: string; reply: Reply } | undefined, digest: string): Reply | undefined {
  if (!receipt) return undefined;
  if (receipt.digest !== digest) throw new HostError('sequence_conflict');
  return receipt.reply;
}

/** Replay immutable intent outcome inside current presentation state; never replay stale odds/inventory. */
export function currentReceiptReply(session: Session, command: Command, receiptReply: Reply, units: BuddyInventory): Reply {
  const current = execute(session, { operation: 'refresh' }, units).reply;
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
