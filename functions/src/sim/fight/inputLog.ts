import { FightInput, NO_PICK, Press } from './contracts';
import { FightInputs } from './runner';

/**
 * duel-inputs-2 decoder/encoder: the host mirror of HolobotsUnity `Sim/FightInputs/FightInputLog.cs` (fight-input-1), the
 * authoritative runtime check (JSON Schema cannot express the stream grammar). Same checks, same order, same refusal codes;
 * the 4 valid fixture logs re-encode byte for byte and the 35 invalid ones refuse with the C# decoder's code.
 *   record = header [dt:uleb128 if header&7==0] [moveX:i8 moveZ:i8 if bit3] [press:u8 if bit5 [stepX:i8 stepZ:i8 if press&7==5]]
 *            [deploy:u8 if bit6] [target:u8 if bit7]
 * Levels (move, guard) start at (0,0) / guard false and persist; a press or pick lasts its tick.
 */
export const INPUTS_SCHEMA = 'duel-inputs-2';
export const INPUTS_SIM_VERSION = 'duel-sim-3';
export const INPUTS_TICK_HZ = 30;
export const INPUTS_MAX_TICKS = 7200;
export const HASH_PREFIX_HEX = 16;
export const MAX_ROSTER = 3;

export class FightInputLogError extends RangeError {
  constructor(readonly code: string) { super(code); this.name = 'FightInputLogError'; }
}
const fail = (code: string): never => { throw new FightInputLogError(code); };

/** One tick of one side (FightTickRecord). */
export type FightTickRecord = {
  moveX: number; moveZ: number; guard: boolean; press: number; stepX: number; stepZ: number; specialTier: number; deploy: number; target: number;
};
export function idleRecord(): FightTickRecord {
  return { moveX: 0, moveZ: 0, guard: false, press: Press.None, stepX: 0, stepZ: 0, specialTier: 0, deploy: NO_PICK, target: NO_PICK };
}
/** FightTickRecord.Check. */
export function checkRecord(r: FightTickRecord): void {
  if (r.moveX === -128 || r.moveZ === -128 || r.stepX === -128 || r.stepZ === -128) fail('fight_input_axis');
  if (r.press > Press.Disengage) fail('fight_input_press');
  if (r.press !== Press.Step && (r.stepX !== 0 || r.stepZ !== 0)) fail('fight_input_step');
  if (r.press === Press.Special ? r.specialTier !== 1 && r.specialTier !== 2 : r.specialTier !== 0) fail('fight_input_tier');
}
export function recordEquals(a: FightTickRecord, b: FightTickRecord): boolean {
  return a.moveX === b.moveX && a.moveZ === b.moveZ && a.guard === b.guard && a.press === b.press && a.stepX === b.stepX && a.stepZ === b.stepZ
    && a.specialTier === b.specialTier && a.deploy === b.deploy && a.target === b.target;
}
/** FightInputBridge.ToRecord (a brain decision as the recorder logs it). */
export function toRecord(i: FightInput): FightTickRecord {
  const r = idleRecord();
  r.moveX = i.moveX | 0; r.moveZ = i.moveZ | 0; r.guard = i.guard; r.press = i.press; r.specialTier = i.specialTier; r.deploy = i.deploy; r.target = i.target;
  if (i.press === Press.Step) { r.stepX = i.stepX | 0; r.stepZ = i.stepZ | 0; }
  if (i.press !== Press.Special) r.specialTier = 0;
  return r;
}
export function toInput(r: FightTickRecord): FightInput {
  return { moveX: r.moveX, moveZ: r.moveZ, guard: r.guard, press: r.press as never, stepX: r.stepX, stepZ: r.stepZ, specialTier: r.specialTier, deploy: r.deploy, target: r.target };
}

export type FightRosterEntry = { id: string; profile: string | null };
export type FightLogSide = { side: number; source: 'player' | 'cpu'; rank: string | null; roster: FightRosterEntry[]; ticks: FightTickRecord[] };
export type FightInputLog = {
  rulesId: string; rulesHash: string; seed: string; tickCount: number; hashEvery: number; hashes: string[]; finalHash: string;
  sides: [FightLogSide, FightLogSide];
};
/** The wire JSON (Schemas/duel-inputs-2.json). */
export type DuelInputs2Wire = {
  schemaVersion: typeof INPUTS_SCHEMA; simVersion: typeof INPUTS_SIM_VERSION; rulesId: string; rulesHash: string; seed: string;
  tickHz: typeof INPUTS_TICK_HZ; tickCount: number;
  sides: { side: number; source: 'player' | 'cpu'; rank: string | null; roster: FightRosterEntry[]; stream: string }[];
  hashEvery: number; hashes: string; finalHash: string;
};

const HEX64 = /^[0-9a-f]{64}(?![\s\S])/, ID = /^[a-z0-9_-]{1,64}(?![\s\S])/, RULES_ID = /^[A-Za-z0-9._:-]{1,128}(?![\s\S])/;
const HASHES = /^(?:[0-9a-f]{16})*(?![\s\S])/, B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?(?![\s\S])/;
const i8 = (v: number) => v & 0xff;

export function encodeStream(ticks: FightTickRecord[]): Buffer {
  const out: number[] = [];
  let mx = 0, mz = 0, guard = false, prev = -1;
  for (let t = 0; t < ticks.length; t++) {
    const r = ticks[t]; checkRecord(r);
    const move = r.moveX !== mx || r.moveZ !== mz, g = r.guard !== guard, press = r.press !== Press.None;
    const deploy = r.deploy !== NO_PICK, target = r.target !== NO_PICK;
    if (!move && !g && !press && !deploy && !target) continue;
    const dt = t - prev; prev = t;
    out.push((dt <= 7 ? dt : 0) | (move ? 8 : 0) | (g ? 16 : 0) | (press ? 32 : 0) | (deploy ? 64 : 0) | (target ? 128 : 0));
    if (dt > 7) { let v = dt; while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v); }
    if (move) { out.push(i8(r.moveX), i8(r.moveZ)); mx = r.moveX; mz = r.moveZ; }
    if (g) guard = r.guard;
    if (press) {
      out.push(r.press | (r.press === Press.Special ? r.specialTier << 3 : 0));
      if (r.press === Press.Step) out.push(i8(r.stepX), i8(r.stepZ));
    }
    if (deploy) out.push(r.deploy);
    if (target) out.push(r.target);
  }
  return Buffer.from(out);
}

export function decodeStream(bytes: Uint8Array, tickCount: number, ownRoster: number, opponentRoster: number): FightTickRecord[] {
  if (tickCount < 1 || tickCount > INPUTS_MAX_TICKS) fail('invalid_tick_count');
  const ticks: FightTickRecord[] = Array.from({ length: tickCount }, idleRecord);
  let at = 0, prev = -1, mx = 0, mz = 0, guard = false, filled = 0;
  const next = (): number => { if (at >= bytes.length) fail('stream_truncated'); return bytes[at++]; };
  const axis = (): number => { const v = next(); if (v === 0x80) fail('stream_axis'); return v > 127 ? v - 256 : v; };
  while (at < bytes.length) {
    const header = next();
    if ((header & 0xf8) === 0) fail('stream_empty_record');
    let dt = header & 7;
    if (dt === 0) {
      let v = 0, shift = 0, b: number, n = 0;
      do { b = next(); if (++n > 3) fail('stream_varint'); v += (b & 0x7f) * 2 ** shift; shift += 7; } while ((b & 0x80) !== 0);
      if (n > 1 && b === 0) fail('stream_varint');
      if (v < 8) fail('stream_varint');
      dt = v;
    }
    const tick = prev + dt;
    if (tick >= tickCount) fail('stream_tick_range');
    for (let t = filled; t < tick; t++) { ticks[t].moveX = mx; ticks[t].moveZ = mz; ticks[t].guard = guard; }
    prev = tick; filled = tick + 1;
    const r = idleRecord();
    if ((header & 8) !== 0) {
      const x = axis(), z = axis();
      if (x === mx && z === mz) fail('stream_redundant_move');
      mx = x; mz = z;
    }
    if ((header & 16) !== 0) guard = !guard;
    r.moveX = mx; r.moveZ = mz; r.guard = guard;
    if ((header & 32) !== 0) {
      const p = next(), code = p & 7, tier = (p >> 3) & 3;
      if (code === 0 || (p & 0xe0) !== 0) fail('stream_press');
      if (code === Press.Special ? tier !== 1 && tier !== 2 : tier !== 0) fail('stream_tier');
      r.press = code; r.specialTier = tier;
      if (code === Press.Step) { r.stepX = axis(); r.stepZ = axis(); }
    }
    if ((header & 64) !== 0) { r.deploy = next(); if (r.deploy >= ownRoster) fail('stream_deploy'); }
    if ((header & 128) !== 0) { r.target = next(); if (r.target >= opponentRoster) fail('stream_target'); }
    ticks[tick] = r;
  }
  for (let t = filled; t < tickCount; t++) { ticks[t].moveX = mx; ticks[t].moveZ = mz; ticks[t].guard = guard; }
  return ticks;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function shape(t: unknown, keys: string[]): asserts t is Record<string, unknown> {
  if (!isObj(t) || Object.keys(t).length !== keys.length) fail('invalid_fields');
  for (const k of keys) if (!Object.prototype.hasOwnProperty.call(t, k)) fail('invalid_fields');
}
function str(t: unknown, nullable = false): string | null {
  if (nullable && t === null) return null;
  if (typeof t !== 'string') fail('invalid_string');
  return t as string;
}
function int(t: unknown, min: number, max: number): number {
  if (typeof t !== 'number' || !Number.isInteger(t)) fail('invalid_integer');
  if ((t as number) < min || (t as number) > max) fail('invalid_integer_range');
  return t as number;
}

/** FightInputLog.Check (identity, ranges, roster picks). */
export function checkLog(log: FightInputLog): void {
  if (log.rulesId == null || !RULES_ID.test(log.rulesId)) fail('invalid_rules_id');
  if (log.rulesHash == null || !HEX64.test(log.rulesHash)) fail('invalid_rules_hash');
  if (log.seed == null || !HEX64.test(log.seed)) fail('invalid_seed');
  if (log.tickCount < 1 || log.tickCount > INPUTS_MAX_TICKS) fail('invalid_tick_count');
  if (log.hashEvery < 1 || log.hashEvery > 900) fail('invalid_hash_every');
  if (!Array.isArray(log.hashes) || log.hashes.length !== Math.trunc(log.tickCount / log.hashEvery)) fail('invalid_hash_count');
  for (const h of log.hashes) if (h == null || h.length !== HASH_PREFIX_HEX || !HASHES.test(h)) fail('invalid_hash');
  if (log.finalHash == null || !HEX64.test(log.finalHash)) fail('invalid_final_hash');
  if (!Array.isArray(log.sides) || log.sides.length !== 2) fail('invalid_sides');
  const ids = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const s = log.sides[i];
    if (s == null || s.side !== i) fail('invalid_side');
    if (s.source !== 'player' && s.source !== 'cpu') fail('invalid_source');
    if (s.source === 'cpu' ? s.rank == null || !ID.test(s.rank) : s.rank != null) fail('invalid_rank');
    if (s.roster == null || s.roster.length < 1 || s.roster.length > MAX_ROSTER) fail('invalid_roster');
    for (const e of s.roster) {
      if (e.id == null || !ID.test(e.id) || ids.has(e.id)) fail('invalid_fighter_id');
      ids.add(e.id);
      if (s.source === 'cpu' && e.profile == null) fail('cpu_profile_required');
      if (e.profile != null && !ID.test(e.profile)) fail('invalid_profile');
    }
    if (s.ticks == null || s.ticks.length !== log.tickCount) fail('invalid_ticks');
  }
  if (log.sides[0].source === 'cpu' && log.sides[1].source === 'cpu') fail('no_player_side');
  for (let i = 0; i < 2; i++) for (const r of log.sides[i].ticks) {
    checkRecord(r);
    if (r.deploy !== NO_PICK && r.deploy >= log.sides[i].roster.length) fail('invalid_deploy');
    if (r.target !== NO_PICK && r.target >= log.sides[1 - i].roster.length) fail('invalid_target');
  }
}

/** FightInputLog.Parse(JObject): shape, ranges, identity, stream grammar; throws FightInputLogError(code). */
export function parseInputLog(j: unknown): FightInputLog {
  shape(j, ['schemaVersion', 'simVersion', 'rulesId', 'rulesHash', 'seed', 'tickHz', 'tickCount', 'sides', 'hashEvery', 'hashes', 'finalHash']);
  if (str(j.schemaVersion) !== INPUTS_SCHEMA) fail('invalid_schema_version');
  if (str(j.simVersion) !== INPUTS_SIM_VERSION) fail('invalid_sim_version');
  if (int(j.tickHz, INPUTS_TICK_HZ, INPUTS_TICK_HZ) !== INPUTS_TICK_HZ) fail('invalid_tick_hz');
  const rulesId = str(j.rulesId)!, rulesHash = str(j.rulesHash)!, seed = str(j.seed)!;
  const tickCount = int(j.tickCount, 1, INPUTS_MAX_TICKS), hashEvery = int(j.hashEvery, 1, 900), finalHash = str(j.finalHash)!;
  const hashesStr = str(j.hashes)!;
  if (!HASHES.test(hashesStr)) fail('invalid_hash');
  const hashes: string[] = [];
  for (let i = 0; i < hashesStr.length; i += HASH_PREFIX_HEX) hashes.push(hashesStr.slice(i, i + HASH_PREFIX_HEX));
  if (!Array.isArray(j.sides) || j.sides.length !== 2) fail('invalid_sides');
  const sidesRaw = j.sides as unknown[];
  const raw: string[] = [];
  const sides: FightLogSide[] = [];
  for (let i = 0; i < 2; i++) {
    const s = sidesRaw[i];
    shape(s, ['side', 'source', 'rank', 'roster', 'stream']);
    const roster = s.roster;
    if (!Array.isArray(roster) || roster.length < 1 || roster.length > MAX_ROSTER) fail('invalid_roster');
    const entries: FightRosterEntry[] = (roster as unknown[]).map(e => { shape(e, ['id', 'profile']); return { id: str(e.id)!, profile: str(e.profile, true) }; });
    raw[i] = str(s.stream)!;
    if (raw[i].length > 131072 || !B64.test(raw[i])) fail('invalid_stream');
    sides.push({ side: int(s.side, 0, 1), source: str(s.source) as 'player' | 'cpu', rank: str(s.rank, true), roster: entries, ticks: [] });
  }
  for (let i = 0; i < 2; i++) {
    const bytes = Buffer.from(raw[i], 'base64');
    if (bytes.toString('base64') !== raw[i]) fail('invalid_stream');
    sides[i].ticks = decodeStream(bytes, tickCount, sides[i].roster.length, sides[1 - i].roster.length);
  }
  const log: FightInputLog = { rulesId, rulesHash, seed, tickCount, hashEvery, hashes, finalHash, sides: sides as [FightLogSide, FightLogSide] };
  checkLog(log);
  return log;
}

/** FightInputLog.ToJson (fixed key order; the wire form is JSON.stringify of it). */
export function inputLogToWire(log: FightInputLog): DuelInputs2Wire {
  checkLog(log);
  return {
    schemaVersion: INPUTS_SCHEMA, simVersion: INPUTS_SIM_VERSION, rulesId: log.rulesId, rulesHash: log.rulesHash, seed: log.seed,
    tickHz: INPUTS_TICK_HZ, tickCount: log.tickCount,
    sides: log.sides.map(s => ({ side: s.side, source: s.source, rank: s.rank, roster: s.roster.map(e => ({ id: e.id, profile: e.profile })), stream: encodeStream(s.ticks).toString('base64') })),
    hashEvery: log.hashEvery, hashes: log.hashes.join(''), finalHash: log.finalHash,
  };
}

/** The tick whose state hash sample k pins: (k+1)*hashEvery - 1. */
export function sampleTick(log: Pick<FightInputLog, 'hashEvery'>, k: number): number { return (k + 1) * log.hashEvery - 1; }

/**
 * FightInputLog.FirstDivergentSample: the first sample window whose hash prefix differs (0..hashes.length-1), hashes.length
 * when only the final hash differs or the replay is shorter/longer, or -1 when the replay reproduces the log. Any >= 0 = REJECT.
 */
export function firstDivergentSample(log: FightInputLog, replay: Map<number, string>, replayTickCount: number): number {
  for (let k = 0; k < log.hashes.length; k++) {
    const h = replay.get(sampleTick(log, k));
    if (h === undefined || !h.startsWith(log.hashes[k])) return k;
  }
  if (replayTickCount !== log.tickCount || replay.get(log.tickCount - 1) !== log.finalHash) return log.hashes.length;
  return -1;
}

/** The replay input source for one side of a parsed log (FightLogInputs); past the end = idle. */
export function logInputs(log: FightInputLog, side: number): FightInputs {
  const ticks = log.sides[side].ticks;
  return { read: (tick: number) => (tick >= 0 && tick < ticks.length ? toInput(ticks[tick]) : toInput(idleRecord())) };
}
