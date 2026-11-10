import { EventKind, Move } from './contracts';
import { FightEvent } from './core';
import { FightTickRecord } from './inputLog';
import { WitnessJson } from './witness';

/**
 * server-rulings-1 (Pak 2026-11-09, ruling 4): a plausibility read of a WINNING input log. It FLAGS wins that look
 * machine-perfect for an admin to review; it never refuses a settle and never withholds a reward. Measurements come from the
 * host's own replay (its events + witness) and the player's logged guard input, so they are a function of the verified fight.
 *
 * Two signals, each with its own minimum sample so a short fight can never flag:
 *  - reaction_floor: the player's guard goes down -> up in reply to a CPU telegraph faster than a human can react, again and again.
 *    A sample is a CPU telegraph at least `reactionMinTelegraphTicks` long (so lights, at 6 ticks on duel-rules-6, never count)
 *    that starts while the player's guard input is released, answered by a guard press before contact. Reaction = press tick -
 *    telegraph tick.
 *  - perfect_guard_rate: the share of the CPU's connecting strikes (hit + blocked + guard break + perfect) the player perfect-guarded.
 *
 * Why these numbers (false positives unlikely). Sample sizes are small: a won 1v1 sees only ~5-15 CPU strikes, so the minimums
 * are set where a real fight can reach them and the floors are set far past human limits instead.
 *  - reaction: floor 2 ticks (<= 66 ms, under any human visual reaction even before a phone's touch + render latency, ~50-100 ms,
 *    is added); flag when >= 80 % of >= 6 samples are under it. A player who guesses (a guard press at a uniformly random tick of
 *    the window) lands under the floor with p <= 2/10 on the shortest counted telegraph and 2/15 on a heavy:
 *    P(Binomial(6, 0.2) >= 5) = 0.0016, 0.0002 at p = 2/15, per fight. Real anticipation is not uniform; this is a sanity bound.
 *  - perfect guards: flag at >= 90 % of >= 10 connecting CPU strikes. The shipped brain at Legendary (perfect-guards 35 % of the
 *    strikes it chooses to guard) is the "very good" reference; scripts/test-server-rulings-1.mjs runs every profile x rank on
 *    duel-rules-5 and -6 and pins that no brain log flags (its observed maxima are in the server-rulings-1 README).
 * One config block; bump `version` with any change so stored flags say which rules judged them.
 */
export const FIGHT_PLAUSIBILITY_CONFIG = Object.freeze({
  version: 'fight-plausibility-1',
  reactionFloorTicks: 2,
  reactionMinTelegraphTicks: 10,
  reactionMinSamples: 6,
  reactionFlagShare: 0.8,
  perfectMinContacts: 10,
  perfectFlagRate: 0.9,
});

export type FightPlausibility = {
  version: string;
  flagged: boolean;
  flags: ('reaction_floor' | 'perfect_guard_rate')[];
  reaction: { samples: number; underFloor: number; medianTicks: number | null };
  perfect: { contacts: number; perfect: number; ratePm: number };
};

/** `playerTicks` = the player's (side 0) logged records, one per tick; `events` = the host replay's events (recordEvents on). */
export function judgePlausibility(events: readonly FightEvent[], witness: WitnessJson, playerTicks: readonly FightTickRecord[],
  cfg: typeof FIGHT_PLAUSIBILITY_CONFIG = FIGHT_PLAUSIBILITY_CONFIG): FightPlausibility {
  const guardAt = (t: number) => t >= 0 && t < playerTicks.length && playerTicks[t].guard;
  const reactions: number[] = [];
  for (const e of events) {
    if (e.side !== 1 || e.kind !== EventKind.Telegraph || e.move === Move.None) continue;
    const start = e.tick, contact = e.value;
    if (contact - start < cfg.reactionMinTelegraphTicks || guardAt(start)) continue;
    for (let t = start + 1; t <= contact && t < playerTicks.length; t++) if (guardAt(t)) { reactions.push(t - start); break; }
  }
  const underFloor = reactions.filter(r => r <= cfg.reactionFloorTicks).length;
  const sorted = [...reactions].sort((a, b) => a - b);
  const p = witness.sides[0].perfectGuards, cpu = witness.sides[1];
  const contacts = cpu.hits + cpu.blocks + cpu.guardBreaks + p;
  const flags: FightPlausibility['flags'] = [];
  if (reactions.length >= cfg.reactionMinSamples && underFloor >= cfg.reactionFlagShare * reactions.length) flags.push('reaction_floor');
  if (contacts >= cfg.perfectMinContacts && p >= cfg.perfectFlagRate * contacts) flags.push('perfect_guard_rate');
  return {
    version: cfg.version, flagged: flags.length > 0, flags,
    reaction: { samples: reactions.length, underFloor, medianTicks: sorted.length ? sorted[Math.trunc(sorted.length / 2)] : null },
    perfect: { contacts, perfect: p, ratePm: contacts ? Math.trunc((p * 1000) / contacts) : 0 },
  };
}
