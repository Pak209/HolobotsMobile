/** M1: host-owned public projection. No private profile/economy fields cross this boundary. */
import { readTravelSquad } from '../acquisition/captureOwnership';
import { toHolobotKey } from '../lib/mintingEconomy';
import { loadoutRecipes, readWardrobeState, Recipe } from '../lib/wardrobe';

export const PRESENCE_SCHEMA = 'presence-1';
export const PRESENCE_TTL_MS = 90_000;
export const EMOTE_TTL_MS = 3_000;
// Conservative presentation envelope; native scene coverage is an installation gate.
export const SCENE_BOUNDS = { HoloCity_Main: { min: [-256, -64, -256], max: [256, 256, 256] } } as const;
export type Scene = keyof typeof SCENE_BOUNDS;
export type PresenceCommand = { operation: 'leave' } | { operation: 'heartbeat'; scene: Scene; pos: number[]; yaw: number; deployed: string[] } | { operation: 'emote'; emote: 'wave' };
export type PresenceRow = { username: string; pilot: Recipe; squad: { holobotId: string; level: number; rank: string }[]; deployed: string[]; pos: number[]; yaw: number; updatedAtMs: number; expiresAtMs: number; emote?: 'wave'; emoteExpiresAtMs?: number };
export type PresenceScene = { schemaVersion: typeof PRESENCE_SCHEMA; pilots: Record<string, PresenceRow> };
export class PresenceError extends Error { constructor(public code: 'invalid_request' | 'unavailable') { super(code); } }
const bad = (): never => { throw new PresenceError('invalid_request'); };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Forged username/pilot/level fields are ignored, never projected. */
export function validatePresenceCommand(raw: unknown): PresenceCommand {
  if (!object(raw) || raw.schemaVersion !== PRESENCE_SCHEMA) return bad();
  if (raw.operation === 'leave') return { operation: 'leave' };
  if (raw.operation === 'emote' && raw.emote === 'wave') return { operation: 'emote', emote: 'wave' };
  if (raw.operation !== 'heartbeat' || raw.scene !== 'HoloCity_Main' || !Array.isArray(raw.pos) || raw.pos.length !== 3 || raw.pos.some(x => typeof x !== 'number' || !Number.isFinite(x)) || typeof raw.yaw !== 'number' || !Number.isFinite(raw.yaw) || !Array.isArray(raw.deployed) || raw.deployed.length > 3 || new Set(raw.deployed).size !== raw.deployed.length || raw.deployed.some(x => typeof x !== 'string' || !/^[a-z][a-z0-9_]{0,127}$/.test(x))) return bad();
  return { operation: 'heartbeat', scene: raw.scene, pos: [...raw.pos], yaw: raw.yaw, deployed: [...raw.deployed] };
}
export function projectPresence(uid: string, profile: Record<string, unknown>, wardrobe: unknown, command: Extract<PresenceCommand, { operation: 'heartbeat' }>, now: number): PresenceRow {
  const ids = readTravelSquad(profile).holobotIds;
  if (command.deployed.some(id => !ids.includes(id))) return bad();
  const owned = profile.holobots as Record<string, unknown>[];
  const squad = ids.map(holobotId => {
    const bot = owned.find(b => toHolobotKey(b.name as string) === holobotId)!;
    if (!Number.isSafeInteger(bot.level) || (bot.level as number) < 1 || (bot.level as number) > 1000 || typeof bot.rank !== 'string' || !bot.rank || bot.rank.length > 32) throw new PresenceError('unavailable');
    return { holobotId, level: bot.level as number, rank: bot.rank };
  });
  const bounds = SCENE_BOUNDS[command.scene];
  const username = typeof profile.username === 'string' && profile.username.trim() ? profile.username.trim().slice(0, 64) : `pilot_${uid.slice(0, 8)}`;
  return { username, pilot: loadoutRecipes(readWardrobeState(wardrobe)).city, squad, deployed: [...command.deployed], pos: command.pos.map((v, i) => Math.max(bounds.min[i], Math.min(bounds.max[i], Math.round(v * 2) / 2))), yaw: ((command.yaw % 360) + 360) % 360, updatedAtMs: now, expiresAtMs: now + PRESENCE_TTL_MS };
}
export function prunePresence(raw: unknown, now: number): PresenceScene {
  if (raw !== undefined && (!object(raw) || raw.schemaVersion !== PRESENCE_SCHEMA || !object(raw.pilots))) throw new PresenceError('unavailable');
  const pilots: Record<string, PresenceRow> = Object.create(null);
  for (const [uid, value] of Object.entries((raw as PresenceScene | undefined)?.pilots ?? {})) {
    if (value && Number.isSafeInteger(value.expiresAtMs) && value.expiresAtMs > now) pilots[uid] = structuredClone(value);
  }
  return { schemaVersion: PRESENCE_SCHEMA, pilots };
}
