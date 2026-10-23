import { CHASE_SIDE_FIELDS, FightCore, STATE_FIGHTER_FIELDS, STATE_FIGHTER_FIELDS_4, STATE_HEADER_FIELDS, STATE_SIDE_FIELDS } from './core';
import { ATTR_KEYS, CHASE_KEYS, SIM_VERSION_4 } from './rules';
import { FightRules } from './rules';

/**
 * fight-host-1 divergence tool. A parity or replay failure must name the FIRST divergent tick and the differing state
 * fields, never just "hash mismatch". Three pieces:
 *  - firstDivergence: expected per-tick hashes (full or 16-hex prefixes) vs a replay's tick -> hash map;
 *  - decodeState: canonical state bytes (FightCore.stateBytes / C# FightCore.StateBytes) -> named int32 fields;
 *  - diffState: two state byte strings (e.g. host vs a C# dump from the cold oracle `state` mode) -> the differing fields.
 */
export type Divergence = { tick: number; expected: string; actual: string | null };

export function firstDivergence(expected: readonly string[], actual: Map<number, string>): Divergence | null {
  for (let t = 0; t < expected.length; t++) {
    const a = actual.get(t);
    if (a === undefined || !a.startsWith(expected[t])) return { tick: t, expected: expected[t], actual: a ?? null };
  }
  return null;
}

const HEADER_BYTES = 10 + 32 + 32;

/** Named int32 fields of a state dump, in StateBytes order. Members follow rules.fighters order (id-labelled). */
export function decodeState(bytes: Uint8Array, rules: FightRules): Record<string, number> {
  const b = Buffer.from(bytes);
  const out: Record<string, number> = {};
  let at = HEADER_BYTES;
  const take = () => { const v = b.readInt32LE(at); at += 4; return v; };
  out.rulesHashHead = b.readUInt32LE(10); out.seedHead = b.readUInt32LE(42);
  for (const k of STATE_HEADER_FIELDS) out[k] = take();
  for (let s = 0; s < 2; s++) for (const k of STATE_SIDE_FIELDS) out[`side${s}.${k}`] = take();
  // duel-sim-4 (duel-rules-5): every member carries syncAcc / evadeRolls / retreatChain after its duel-sim-3 fields
  const sim4 = b.toString('ascii', 0, 10) === SIM_VERSION_4;
  for (const f of rules.fighters) {
    for (const k of STATE_FIGHTER_FIELDS) out[`${f.id}.${k}`] = take();
    if (sim4) for (const k of STATE_FIGHTER_FIELDS_4) out[`${f.id}.${k}`] = take();
  }
  // fight-chase-1 tail (duel-rules-4 only): ASCII 'fight-chase-1', the 10 chase rules, then per side CHASE_SIDE_FIELDS
  const tag = 'fight-chase-1';
  if (b.length - at >= tag.length && b.toString('ascii', at, at + tag.length) === tag) {
    at += tag.length;
    for (const k of CHASE_KEYS) out[`chase.${k}`] = take();
    for (let s = 0; s < 2; s++) for (const k of CHASE_SIDE_FIELDS) out[`chase${s}.${k}`] = take();
  }
  // duel-rules-5 tail: ASCII 'fight-attrs-1' then the 18 attrs rules
  const atag = 'fight-attrs-1';
  if (b.length - at >= atag.length && b.toString('ascii', at, at + atag.length) === atag) {
    at += atag.length;
    for (const k of ATTR_KEYS) out[`attrs.${k}`] = take();
  }
  if (at !== b.length) out.trailingBytes = b.length - at;
  return out;
}

export type FieldDiff = { field: string; expected: number | undefined; actual: number | undefined };

export function diffState(expected: Uint8Array, actual: Uint8Array, rules: FightRules): FieldDiff[] {
  const a = decodeState(expected, rules), b = decodeState(actual, rules);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: FieldDiff[] = [];
  for (const k of keys) if (a[k] !== b[k]) out.push({ field: k, expected: a[k], actual: b[k] });
  return out;
}

/** The named state of a live core (for the report when only the expected HASH is known). */
export function coreFields(core: FightCore): Record<string, number> {
  return decodeState(core.stateBytes(), core.rules);   // includes the chase tail when core.chase is set
}
