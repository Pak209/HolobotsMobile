/**
 * fight-flow H1 (fight-host-1) wire contract shared by the host and the mobile app: the rival-battle `input-log` issue
 * block, the settle request field, the `duel-receipt-2` reply and the `replay_mismatch` refusal detail.
 * Pure types + constants, no imports. Kept byte-identical at
 *   functions/src/shared/fightReplayContract.ts  and  mobile/src/lib/fightReplayContract.ts
 * (functions/scripts/check-shared-parity.mjs, run on every functions build).
 * JSON Schemas: Schemas/duel-rules-3.json, Schemas/duel-rules-4.json, Schemas/duel-inputs-2.json, Schemas/duel-receipt-2.json (HolobotsUnity mirrors).
 * Hard rule 1: the host re-runs the duel-sim-3 core on the issued rules + seed + this log and settles what IT computed.
 */

export const FIGHT_REPLAY_MODE = 'input-log' as const;
export const FIGHT_RECEIPT_SCHEMA = 'duel-receipt-2' as const;
export const FIGHT_INPUTS_SCHEMA = 'duel-inputs-2' as const;
export const FIGHT_RULES_SCHEMA = 'duel-rules-3' as const;
/** duel-rules-4 (DECISIONS #72.65, Contract-Change duel-rules-4-1): duel-rules-3 + the fight-chase-1 `chase` block. */
export const FIGHT_RULES_SCHEMA_4 = 'duel-rules-4' as const;
export const FIGHT_SIM_VERSION = 'duel-sim-3' as const;
/** Host env flag ("replay verification ON"); default off. */
export const FIGHT_REPLAY_FLAG = 'HOLOCITY_FIGHT_REPLAY' as const;
/** Host env flag: input-log issues carry duel-rules-4 (the chase / retreat rules); default off = duel-rules-3, today's fight.
 * Only meaningful with FIGHT_REPLAY_FLAG on. Turn it on only once the floor client parses duel-rules-4 (HolobotsUnity duel-rules-4-1). */
export const FIGHT_CHASE_FLAG = 'HOLOCITY_FIGHT_CHASE' as const;
/** Issue request field a client sends to say it can record + upload duel-inputs-2 (capability, not a mode override). */
export const FIGHT_INPUTS_CAPABILITY_FIELD = 'duelInputs' as const;
/** Settle request field carrying the duel-inputs-2 log (the JSON object, or its compact wire string). */
export const FIGHT_LOG_FIELD = 'inputLog' as const;
/** Settle reply field carrying the duel-receipt-2 (new field; duel-receipt-1 keeps `duelReceipt`). */
export const FIGHT_RECEIPT_FIELD = 'fightReceipt' as const;
/** Largest accepted log, compact JSON bytes (a 180 s fight is ~45-75 KB worst case; 60 s ~15-25 KB). */
export const FIGHT_LOG_MAX_BYTES = 262144;

/** duel-sim-3 FightProfile as issued (per-mille). */
export type FightProfileWire = {
  id: string; aggressionPmPerSec: number; engageMinStaminaPm: number; preferredBand: number; preferredBandOffsetMm: number;
  chainMeanMilli: number; heavyRatioPm: number; feintRatePm: number; guardRatePm: number; counterRatePm: number;
  breakAtStaminaPm: number; circleBiasPm: number; shoveRatePm: number; specialPolicy: number;
  beatSharePm: number; burstInPm: number; lowHpRiskPm: number;
};
/** duel-sim-3 FightSkill as issued (rank lowercased). */
export type FightSkillWire = { rank: string; reactionTicks: number; feintReadPm: number; perfectGuardPm: number };
/** duel-rules-3 document (Schemas/duel-rules-3.json); every number the core uses. */
export type DuelRules3Wire = {
  schemaVersion: 'duel-rules-3'; simVersion: 'duel-sim-3'; tickHz: 30;
  rules: Record<string, number>;
  fighters: ({ id: string } & Record<string, number | string>)[];
};
/** duel-rules-4 document (Schemas/duel-rules-4.json): duel-rules-3 + the ten chase numbers. */
export type DuelRules4Wire = Omit<DuelRules3Wire, 'schemaVersion'> & { schemaVersion: 'duel-rules-4'; chase: Record<string, number> };

export type FightRosterSlotWire = { fighterId: string; holobotId: string };
export type FightCpuRosterSlotWire = FightRosterSlotWire & { profile: string };

/** The issue reply's / battle record's `duel` block in input-log mode. Immutable for the battle's life. */
export type FightReplayIssueWire = {
  mode: typeof FIGHT_REPLAY_MODE;
  schemaVersion: typeof FIGHT_RECEIPT_SCHEMA;
  inputsSchema: typeof FIGHT_INPUTS_SCHEMA;
  simVersion: typeof FIGHT_SIM_VERSION;
  rulesId: string;
  rulesHash: string;
  /** duel-rules-3, or duel-rules-4 when the host issued the chase rules (FIGHT_CHASE_FLAG); rulesHash is that document's hash. */
  rules: DuelRules3Wire | DuelRules4Wire;
  /** 64 lowercase hex; disclosed at issue by design (the client predicts the CPU's seeded decisions locally). */
  seed: string;
  /** The player always drives side 0; the CPU brain drives side 1. */
  playerSide: 0;
  player: { roster: FightRosterSlotWire[] };
  /**
   * The CPU side: the brain is bound to ONE issued profile for the whole fight (C# FightCoreBrain binds at its first
   * Decide; the bench members' own profile ids are recorded but do not switch the brain on a forced swap).
   */
  cpu: { side: 1; rank: FightSkillWire; profile: FightProfileWire; roster: FightCpuRosterSlotWire[] };
  profilesVersion: number;
};

export type FightFinalWire = {
  fighterId: string; holobotId: string; currentHealth: number; maxHealth: number;
  staminaPm: number; sync: number; knockedOut: boolean; fielded: boolean;
};

export type FightWitnessSideWire = {
  ticksInState: number[]; forcedBreaks: number; voluntaryBreaks: number; lineCrossings: number; breakLengths: number[];
  telegraphs: number; feints: number; feintBaits: number; steps: number; shoves: number; hits: number; blocks: number;
  perfectGuards: number; guardBreaks: number; whiffs: number; evades: number; counters: number; hardHits: number;
  swaps: number; forcedSwaps: number; stamina: number[];
};
/** FightWitness.ToJson, verbatim: the post-fight card's exchange histogram, time-in-state, breaks. */
export type FightWitnessWire = {
  ticks: number; exchangeLengths: number[]; exchangeHistogram1s: number[]; exchangesIn2To5Pm: number; exchangeMedianTicks: number;
  probeLengths: number[]; trades: number; railFires: number; sides: FightWitnessSideWire[];
};

/** duel-receipt-2 (Schemas/duel-receipt-2.json): the VERIFIED outcome the host computed by replay. */
export type FightReceiptWire = {
  schemaVersion: typeof FIGHT_RECEIPT_SCHEMA;
  simVersion: typeof FIGHT_SIM_VERSION;
  battleId: string;
  rulesId: string;
  rulesHash: string;
  seed: string;
  /** SHA-256 of the canonical (re-encoded) duel-inputs-2 wire JSON the host replayed. */
  inputsHash: string;
  verified: true;
  winner: 'player' | 'opponent' | 'draw';
  reason: 'ko' | 'timeout';
  endTick: number;
  tickCount: number;
  playerSide: 0;
  playerFinal: FightFinalWire[];
  opponentFinal: FightFinalWire[];
  checkpoints: { hashEvery: number; hashes: string; finalHash: string };
  witness: FightWitnessWire;
};

export type FightReplayRejectReason = 'identity' | 'hash' | 'final_hash' | 'incomplete' | 'cpu_stream';
/** HttpsError details for rejectionCode `replay_mismatch` (the first divergent window / field). */
export type FightReplayMismatchDetail = {
  rejectionCode: 'replay_mismatch';
  reason: FightReplayRejectReason;
  /** identity: the log field that differs from the issue (rulesId, rulesHash, seed, sides[i].roster, ...). */
  field?: string;
  /** hash: index of the first divergent hash sample; ticks [fromTick, toTick] is that window. */
  window?: number;
  fromTick?: number;
  toTick?: number;
  /** cpu_stream: the first tick whose recorded CPU record differs from the host brain's decision. */
  tick?: number;
};
