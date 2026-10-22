/**
 * duel-sim-3 plug-in surface, ported from HolobotsUnity `Sim/Fight/FightContracts.cs` (fight-core-1, fight-tune-1 r2, fight-tune-2 r3).
 * Enum values ARE the C# byte values (they are hashed and on the wire): append only, never renumber.
 */

/** DoubleTap (8): HolobotsUnity fight-input-2 (#134) — the stick double-tapped, stepX/stepZ = its world direction (never 0,0);
 * the r3 core makes a double-tap AWAY from the rival the quick escape (from EDGE or the fighter's own BREAK). */
export const Press = { None: 0, Light: 1, Heavy: 2, Special: 3, Feint: 4, Step: 5, Shove: 6, Disengage: 7, DoubleTap: 8 } as const;
export type FightPress = (typeof Press)[keyof typeof Press];
export const PRESS_NAMES = ['None', 'Light', 'Heavy', 'Special', 'Feint', 'Step', 'Shove', 'Disengage', 'DoubleTap'] as const;

export const State = { OutOfRange: 0, EdgeOfRange: 1, Exchange: 2, CloseRange: 3, Break: 4 } as const;
export type FightState = (typeof State)[keyof typeof State];

export const Action = { Idle: 0, Telegraph: 1, Recovery: 2, Step: 3, Stun: 4, Shove: 5, FeintRecovery: 6, Ko: 7, Escape: 8 } as const;
export type FightAction = (typeof Action)[keyof typeof Action];

export const Guard = { Down: 0, Raising: 1, Up: 2, Lowering: 3 } as const;
export type FightGuard = (typeof Guard)[keyof typeof Guard];

export const Move = { None: 0, Light: 1, Heavy: 2, Special: 3, Charge: 4 } as const;
export type FightMove = (typeof Move)[keyof typeof Move];
export const MOVE_NAMES = ['None', 'Light', 'Heavy', 'Special', 'Charge'] as const;

export const Loco = { Still: 0, Forward: 1, Backpedal: 2, StrafeL: 3, StrafeR: 4, Backstep: 5, SidestepL: 6, SidestepR: 7, ForwardJump: 8, Lunge: 9, Pushed: 10, TurnAway: 11, EscapeRun: 12, TurnBack: 13 } as const;
export type FightLoco = (typeof Loco)[keyof typeof Loco];

export const Outcome = { Hit: 0, Blocked: 1, Perfect: 2, GuardBreak: 3, Whiffed: 4, Evaded: 5, Shielded: 6 } as const;
export type FightOutcome = (typeof Outcome)[keyof typeof Outcome];
export const OUTCOME_NAMES = ['Hit', 'Blocked', 'Perfect', 'GuardBreak', 'Whiffed', 'Evaded', 'Shielded'] as const;

export const EventKind = {
  Telegraph: 0, Feint: 1, FeintBait: 2, Step: 3, Shove: 4, Contact: 5, HardHit: 6, BreakStart: 7, BreakEnd: 8,
  ExchangeStart: 9, ExchangeEnd: 10, Rail: 11, Ko: 12, Denied: 13, Buffered: 14, GuardRaise: 15, GuardLower: 16, Timeout: 17, Swap: 18,
  ForcedSwap: 19, TargetLock: 20, ProbeEnd: 21, Escape: 22,
  // fight-chase-1 (#72.65; only with a duel-rules-4 chase block): see FightCore.cs FightEventKind
  Retreat: 23, Caught: 24, RingStop: 25, ChaseEnd: 26,
} as const;
export type FightEventKind = (typeof EventKind)[keyof typeof EventKind];
export const EVENT_NAMES = ['Telegraph', 'Feint', 'FeintBait', 'Step', 'Shove', 'Contact', 'HardHit', 'BreakStart', 'BreakEnd', 'ExchangeStart',
  'ExchangeEnd', 'Rail', 'Ko', 'Denied', 'Buffered', 'GuardRaise', 'GuardLower', 'Timeout', 'Swap', 'ForcedSwap', 'TargetLock', 'ProbeEnd', 'Escape',
  'Retreat', 'Caught', 'RingStop', 'ChaseEnd'] as const;

/** Denied reason codes (FightEvent.value). */
export const Deny = { Guarding: 1, Sync: 2, NotClose: 3, Busy: 4, FeintWindow: 5, Ko: 6, Lockout: 7, SameSlot: 8, KnockedOut: 9, NoSuchSlot: 10, TargetNotFielded: 11,
  NotEdgeOrBreak: 12, RetreatCooldown: 13 } as const;
/** fight-chase-1: why a runner's tag ended (the ChaseEnd event's value; C# FightChaseEnd). */
export const ChaseEnd = { Turned: 1, Caught: 2, Closed: 3, Lapsed: 4, Ko: 5, Benched: 6 } as const;

export const NO_PICK = 255;

/** One side's input for one tick (FightInput). deploy/target default to NO_PICK (255). */
export type FightInput = {
  moveX: number; moveZ: number; guard: boolean; press: FightPress;
  stepX: number; stepZ: number; specialTier: number; deploy: number; target: number;
};

export function idleInput(): FightInput {
  return { moveX: 0, moveZ: 0, guard: false, press: Press.None, stepX: 0, stepZ: 0, specialTier: 0, deploy: NO_PICK, target: NO_PICK };
}

/** FightInput.Check: the core refuses (throws) rather than clamping. */
export function checkInput(i: FightInput): void {
  if (i.moveX === -128 || i.moveZ === -128 || i.stepX === -128 || i.stepZ === -128) throw new RangeError('fight_input_axis');
  if (i.press > Press.DoubleTap) throw new RangeError('fight_input_press');
  if (i.specialTier > 2) throw new RangeError('fight_input_tier');
}

/** Same-tick press order (higher first): double-tap > step > shove > special > heavy > light > feint > disengage. */
export function pressRank(p: number): number {
  switch (p) {
    case Press.DoubleTap: return 8;
    case Press.Step: return 7;
    case Press.Shove: return 6;
    case Press.Special: return 5;
    case Press.Heavy: return 4;
    case Press.Light: return 3;
    case Press.Feint: return 2;
    case Press.Disengage: return 1;
    default: return 0;
  }
}
export function collapse(a: FightPress, b: FightPress): FightPress {
  return pressRank(a) >= pressRank(b) ? a : b;
}

/**
 * Per-side seeded stream: Marsaglia xorshift32 (13, 17, 5). Draws come only from brains; state + draw count are hashed.
 */
export class FightRng {
  state: number;
  draws = 0;
  constructor(seedWord: number) { this.state = (seedWord >>> 0) === 0 ? 0x9e3779b9 : seedWord >>> 0; }
  next(): number {
    let x = this.state;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.state = x; this.draws++;
    return x;
  }
  /** Uniform in [0, bound) by rejection (no modulo bias); bound 1..2^31. */
  below(bound: number): number {
    if (bound < 1) throw new RangeError('rng_bound');
    const limit = Math.floor(4294967296 / bound) * bound;
    for (let i = 0; i < 64; i++) { const n = this.next(); if (n < limit) return n % bound; }
    throw new RangeError('rng_exhausted');
  }
  chance(pm: number): boolean { return this.below(1000) < pm; }
}

/** The issued CPU personality (duel-sim-3 FightProfile, per-mille). Behaviour only, never stats (rule 1). */
export type FightProfile = {
  id: string;
  aggressionPmPerSec: number; engageMinStaminaPm: number; preferredBand: number; preferredBandOffsetMm: number;
  chainMeanMilli: number; heavyRatioPm: number; feintRatePm: number; guardRatePm: number; counterRatePm: number;
  breakAtStaminaPm: number; circleBiasPm: number; shoveRatePm: number; specialPolicy: number;
  beatSharePm: number; burstInPm: number; lowHpRiskPm: number;
  escapeRatePm: number; chargeSharePm: number;   // r3 (fight-tune-2)
};
export const FIGHT_PROFILE_KEYS = ['id', 'aggressionPmPerSec', 'engageMinStaminaPm', 'preferredBand', 'preferredBandOffsetMm', 'chainMeanMilli',
  'heavyRatioPm', 'feintRatePm', 'guardRatePm', 'counterRatePm', 'breakAtStaminaPm', 'circleBiasPm', 'shoveRatePm', 'specialPolicy',
  'beatSharePm', 'burstInPm', 'lowHpRiskPm', 'escapeRatePm', 'chargeSharePm'] as const;

/** The issued rank skill row (FightSkill). */
export type FightSkill = { rank: string; reactionTicks: number; feintReadPm: number; perfectGuardPm: number };
export const FIGHT_SKILL_KEYS = ['rank', 'reactionTicks', 'feintReadPm', 'perfectGuardPm'] as const;

/** Everything a brain may observe about one fighter (FightFighterView). */
export type FightFighterView = {
  tick: number; xMm: number; zMm: number; hp: number; maxHp: number; staminaPm: number; sync: number;
  state: FightState; action: FightAction; guard: FightGuard; move: FightMove;
  telegraphStartTick: number; contactTick: number; actionUntilTick: number; counterWindowUntil: number; chainCount: number;
  gassed: boolean; loco: FightLoco; rosterIndex: number; shieldUntil: number; punishableUntil: number; breakUntil: number;
};
