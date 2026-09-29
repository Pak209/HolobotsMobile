/** Pak DECISIONS #40, 2026-09-29. Server-only account projection. */
import { calculateExperience, getHolobotRank } from '../lib/progression';
import { toHolobotKey } from '../lib/mintingEconomy';
import { HostError, TravelSquad } from './wildEncounterDomain';

type Profile = Record<string, unknown>;
function bots(profile: Profile): Record<string, unknown>[] {
  if (profile.holobots === undefined) return [];
  if (!Array.isArray(profile.holobots) || profile.holobots.some(b => !b || typeof b !== 'object' || typeof b.name !== 'string' || !b.name.trim())) throw new HostError('unavailable');
  return profile.holobots;
}
export function readTravelSquad(profile: Profile): TravelSquad {
  const raw = profile.travelSquad;
  if (raw === undefined) return { schemaVersion: 'travel-squad-1', revision: 0, holobotIds: [] };
  const s = raw as TravelSquad;
  const owned = new Set(bots(profile).map(b => toHolobotKey(b.name as string)));
  if (!s || s.schemaVersion !== 'travel-squad-1' || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Array.isArray(s.holobotIds) || s.holobotIds.length > 3 || new Set(s.holobotIds).size !== s.holobotIds.length || s.holobotIds.some(id => typeof id !== 'string' || !/^[a-z0-9_]{1,128}$/.test(id) || toHolobotKey(id) !== id || !owned.has(id))) throw new HostError('unavailable');
  return structuredClone(s);
}
export function projectCapture(profile: Profile, holobotId: string): { updates: Profile; travelSquad: TravelSquad; ownershipOutcome: 'new_bot' | 'added_to_squad' | 'blueprints'; blueprintDelta: number } {
  if (typeof holobotId !== 'string' || !/^[a-z0-9_]{1,128}$/.test(holobotId) || toHolobotKey(holobotId) !== holobotId) throw new HostError('unavailable');
  const owned = bots(profile);
  const travelSquad = readTravelSquad(profile);
  if (owned.some(b => toHolobotKey(b.name as string) === holobotId)) {
    const raw = profile.blueprints;
    if (raw !== undefined && (!raw || typeof raw !== 'object' || Array.isArray(raw))) throw new HostError('unavailable');
    const blueprints = (raw ?? {}) as Record<string, number>;
    const count = blueprints[holobotId] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0 || count > 100000000 - 5) throw new HostError('unavailable');
    return { updates: { blueprints: { ...blueprints, [holobotId]: count + 5 } }, travelSquad, ownershipOutcome: 'blueprints', blueprintDelta: 5 };
  }
  const record = { name: holobotId.toUpperCase(), level: 1, experience: 0, nextLevelExp: calculateExperience(2), rank: getHolobotRank(1), attributePoints: 10, boostedAttributes: {} };
  const updates: Profile = { holobots: [...owned, record] };
  let ownershipOutcome: 'new_bot' | 'added_to_squad' = 'new_bot';
  if (travelSquad.holobotIds.length < 3) {
    if (travelSquad.revision >= Number.MAX_SAFE_INTEGER) throw new HostError('unavailable');
    travelSquad.holobotIds.push(holobotId); travelSquad.revision++;
    updates.travelSquad = travelSquad; ownershipOutcome = 'added_to_squad';
  }
  return { updates, travelSquad, ownershipOutcome, blueprintDelta: 0 };
}
