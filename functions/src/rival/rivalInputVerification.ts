import { canonicalHash, InputLog, RulesSnapshot, SimResult, simulate } from '../sim';
import { shape, validate } from '../sim/validate';

/** Internal verification result; NOT duel-receipt-1 and not a callable reply. */
export const RIVAL_SIM_RECEIPT_SCHEMA = 'duel-sim-receipt-1' as const;
export type RivalInputIssuedSnapshot = {
  battleId: string;
  duel: {
    mode: 'input-log';
    seed: string;
    rulesHash: string;
    rules: RulesSnapshot;
  };
};
export type RivalSimReceipt = SimResult & {
  schemaVersion: typeof RIVAL_SIM_RECEIPT_SCHEMA;
  battleId: string;
};
export type RivalInputVerificationCode = 'unsupported_mode' | 'invalid_snapshot' | 'invalid_log' | 'replay_failed';
export class RivalInputVerificationError extends Error {
  constructor(readonly code: RivalInputVerificationCode) { super(code); this.name = 'RivalInputVerificationError'; }
}

/**
 * Dormant trusted-store seam: the caller must obtain both arguments from the
 * authenticated battle record and its server-accepted, sealed log. Never pass a
 * request's rules/seed or replace an accepted log with a finish-time client log.
 * No current issue creates this mode; transactRivalBattle does not call this.
 *
 * Structural replay bounds are the core's existing 7200 ticks, 8192 events,
 * four events/tick and six fighters. Worker CPU/memory deadlines, accepted-log
 * provenance, receipt fencing and exact-once settlement remain future gates.
 */
export function verifyRivalInputLog(issued: unknown, acceptedLog: unknown): RivalSimReceipt {
  const envelope = issued as Partial<RivalInputIssuedSnapshot> | null;
  if (envelope?.duel?.mode !== 'input-log') throw new RivalInputVerificationError('unsupported_mode');
  let pinned: RivalInputIssuedSnapshot;
  try {
    // Accept a projection of the stored record, never an entire client envelope.
    shape(issued, ['battleId', 'duel']);
    shape(issued.duel, ['mode', 'seed', 'rulesHash', 'rules']);
    if (typeof issued.battleId !== 'string' || !/^rb_[a-zA-Z0-9_-]{1,128}(?![\s\S])/.test(issued.battleId)) throw new Error('battle_id');
    pinned = issued as unknown as RivalInputIssuedSnapshot;
    if (pinned.duel.rules.simVersion !== 'duel-sim-1') throw new Error('unsupported_sim_version');
    validate(pinned.duel.rules, {schemaVersion: 'duel-inputs-1', events: []}, pinned.duel.seed);
    const normalizedRules = {...pinned.duel.rules, fighters: [...pinned.duel.rules.fighters].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)};
    if (pinned.duel.rulesHash !== canonicalHash(normalizedRules)) throw new Error('rules_hash');
  } catch { throw new RivalInputVerificationError('invalid_snapshot'); }
  try { validate(pinned.duel.rules, acceptedLog as InputLog, pinned.duel.seed); }
  catch { throw new RivalInputVerificationError('invalid_log'); }
  try {
    const result = simulate(pinned.duel.rules, pinned.duel.seed, acceptedLog as InputLog);
    return {schemaVersion: RIVAL_SIM_RECEIPT_SCHEMA, battleId: pinned.battleId, ...result};
  } catch { throw new RivalInputVerificationError('replay_failed'); }
}
