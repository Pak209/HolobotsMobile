/**
 * zell-crash-1 catch-duels (DECISIONS #72.75; beat sheet 2026-10-23 beat 6): two host-issued, can't-lose duel-rules-4 duels in
 * which Zell's JUSAN is the tagged runner. The host issues the escape condition with the duel; the duel ends on the FIRST
 * tick it holds (or on a core end: either KO, the core's own timeout) and the outcome is always `escaped`. The condition is
 * evaluated on the core state after each tick, identically in Unity (Holobots.Story.ZellCatchEscape, C# twin) and here.
 * It never enters the rules hash or the state hash: duel-rules-4, duel-inputs-2 and duel-sim-3 are unchanged.
 *
 * Pure module: no firebase imports.
 */
import { FightCore } from '../sim/fight/core';
import { brainProfile, issuedProfile, profileIsValid } from '../sim/fight/profiles';
import type { FightProfileWire } from '../shared/fightReplayContract';

export const CATCH_ESCAPE_SCHEMA = 'catch-escape-1' as const;
/** Every key is an integer; 0 disables that threshold (maxTicks is always on). */
export type CatchEscapeWire = {
  schemaVersion: typeof CATCH_ESCAPE_SCHEMA;
  /** Escape once the runner (side 1) has been caught (pulled back, #72.65 (3)) this many times. */
  caughtPulls: number;
  /** Escape once the ring has stopped the runner (#72.65 (6)) this many times. */
  ringStops: number;
  /** Escape once the runner's fielded bot is at or below this fight-HP per mille. */
  runnerHpPm: number;
  /** Escape once this many ticks have run (30 Hz). */
  maxTicks: number;
};
export const CATCH_ESCAPE_KEYS = ['schemaVersion', 'caughtPulls', 'ringStops', 'runnerHpPm', 'maxTicks'] as const;
export type CatchEscapeCause = 'caught' | 'ring_stop' | 'runner_hp' | 'time' | 'player_ko' | 'runner_ko';
export const CATCH_ESCAPE_CAUSES: readonly CatchEscapeCause[] = ['caught', 'ring_stop', 'runner_hp', 'time', 'player_ko', 'runner_ko'];

export type ZellCatchDef = { catchIndex: 0 | 1; lesson: 'stamina_and_pull' | 'ring_stop'; tier: number; escape: CatchEscapeWire };
/** Producer defaults (Pak tunes): catch 1 teaches no-regen + the caught pull, catch 2 the ring stop. */
export const ZELL_CATCHES: readonly ZellCatchDef[] = [
  { catchIndex: 0, lesson: 'stamina_and_pull', tier: 2, escape: { schemaVersion: CATCH_ESCAPE_SCHEMA, caughtPulls: 2, ringStops: 0, runnerHpPm: 450, maxTicks: 1800 } },
  { catchIndex: 1, lesson: 'ring_stop', tier: 3, escape: { schemaVersion: CATCH_ESCAPE_SCHEMA, caughtPulls: 3, ringStops: 2, runnerHpPm: 300, maxTicks: 1800 } },
];

const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= lo && v <= hi;
/** Strict reader (stored record / fixture): exact keys, bounded integers. Throws RangeError('invalid_escape'). */
export function readCatchEscape(raw: unknown): CatchEscapeWire {
  const e = raw as Record<string, unknown>;
  if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).length !== CATCH_ESCAPE_KEYS.length
    || CATCH_ESCAPE_KEYS.some(k => !(k in e)) || e.schemaVersion !== CATCH_ESCAPE_SCHEMA
    || !int(e.caughtPulls, 0, 50) || !int(e.ringStops, 0, 50) || !int(e.runnerHpPm, 0, 999) || !int(e.maxTicks, 30, 7200)) throw new RangeError('invalid_escape');
  return { schemaVersion: CATCH_ESCAPE_SCHEMA, caughtPulls: e.caughtPulls as number, ringStops: e.ringStops as number, runnerHpPm: e.runnerHpPm as number, maxTicks: e.maxTicks as number };
}

/** The escape threshold that holds after the core's latest tick, or null. Side 1 is always the runner (Zell). */
export function catchEscapeHit(core: FightCore, e: CatchEscapeWire): CatchEscapeCause | null {
  const cs = core.chaseState ? core.chaseState[1] : null;
  if (cs && e.caughtPulls > 0 && cs.caught >= e.caughtPulls) return 'caught';
  if (cs && e.ringStops > 0 && cs.ringStops >= e.ringStops) return 'ring_stop';
  const m = core.roster[1][core.active[1]];
  if (e.runnerHpPm > 0 && m && m.hp * 1000 <= e.runnerHpPm * m.maxHp) return 'runner_hp';
  if (core.tick + 1 >= e.maxTicks) return 'time';
  return null;
}

/** The cause of a finished catch-duel: a core end (KO / its own timeout) first, else the escape threshold. */
export function catchEscapeCause(core: FightCore, e: CatchEscapeWire): CatchEscapeCause {
  if (core.ended) return core.winner === 1 ? 'player_ko' : core.winner === 0 ? 'runner_ko' : 'time';
  return catchEscapeHit(core, e) ?? 'time';
}

/** JUSAN's issued profile biased to run (lower aggression, breaks early) - data only; the brain is the shipped one. */
export function zellRunnerProfile(): FightProfileWire {
  const p = { ...brainProfile('jusan'), aggressionBps: 3000, breakAtStamina: 80000, engageMinStamina: 85000 };
  const bad = profileIsValid(p);
  if (bad) throw new RangeError('runner_profile:' + bad);
  return issuedProfile(p) as FightProfileWire;
}
