import {
  FIGHT_LOG_MAX_BYTES, FIGHT_RECEIPT_SCHEMA, FIGHT_SIM_VERSION, FightFinalWire, FightReceiptWire, FightReplayIssueWire, FightReplayMismatchDetail,
  FightReplayRejectReason,
} from '../../shared/fightReplayContract';
import { FightCoreBrain } from './brain';
import { EventKind, FIGHT_PROFILE_KEYS, FIGHT_SKILL_KEYS, FightInput, FightProfile, FightSkill } from './contracts';
import { FightCore, townHp } from './core';
import { FightInputLog, FightInputLogError, firstDivergentSample, inputLogToWire, logInputs, parseInputLog, recordEquals, sampleTick, toRecord } from './inputLog';
import { hex, sha256 } from './math';
import { FightChaseRules, FightRules, rulesDocFromJson, rulesHash } from './rules';
import { runFight } from './runner';

/**
 * fight-host-1 replay verification (fight-flow brief C0): re-run the duel-sim-3 twin on the ISSUED rules + seed + CPU
 * profile/rank with the player's duel-inputs-2 log, verify the client's hash trail window by window (and the CPU stream it
 * recorded "for parity" against the host brain's own decisions), and return the outcome THE HOST computed as duel-receipt-2.
 * Pure: no clock, database, network or randomness. A refusal names the first divergent window / field.
 */
export class FightReplayError extends Error {
  constructor(readonly code: 'invalid_log' | 'replay_mismatch' | 'invalid_issue', readonly detail: Record<string, unknown> = {}) {
    super(code); this.name = 'FightReplayError';
  }
}
const mismatch = (reason: FightReplayRejectReason, extra: Omit<FightReplayMismatchDetail, 'rejectionCode' | 'reason'> = {}): never => {
  throw new FightReplayError('replay_mismatch', { rejectionCode: 'replay_mismatch', reason, ...extra });
};

export type FightReplayVerdict = {
  receipt: FightReceiptWire;
  /** 0 player side won, 1 CPU won, 2 draw. */
  winner: number;
  /** Player holobot ids that were fielded at any tick (the XP rule's "actual participants"). */
  fieldedHolobotIds: string[];
  /** Replay CPU time (ms, wall clock of this process; measurement only, never in the receipt). */
  replayMs: number;
  ticks: number;
};

/** Bounded structural validation of a stored issue block (the record is server-written; this fails closed if corrupted). */
export function readIssue(issue: unknown): { issue: FightReplayIssueWire; rules: FightRules; chase: FightChaseRules | null } {
  const i = issue as FightReplayIssueWire;
  try {
    if (!i || i.mode !== 'input-log' || i.schemaVersion !== FIGHT_RECEIPT_SCHEMA || i.simVersion !== FIGHT_SIM_VERSION || i.playerSide !== 0) throw 0;
    // duel-rules-3 (chase null, today's core) or duel-rules-4 (the issued chase block); the hash is that document's
    const { rules, chase } = rulesDocFromJson(i.rules);
    if (rulesHash(rules, chase) !== i.rulesHash) throw 0;
    if (!/^[0-9a-f]{64}$/.test(i.seed) || !i.cpu || i.cpu.side !== 1) throw 0;
    for (const k of FIGHT_PROFILE_KEYS) if (!(k in i.cpu.profile)) throw 0;
    for (const k of FIGHT_SKILL_KEYS) if (!(k in i.cpu.rank)) throw 0;
    const side = (s: number) => rules.fighters.filter(f => f.side === s).map(f => f.id);
    if (JSON.stringify(i.player.roster.map(r => r.fighterId)) !== JSON.stringify(side(0))) throw 0;
    if (JSON.stringify(i.cpu.roster.map(r => r.fighterId)) !== JSON.stringify(side(1))) throw 0;
    return { issue: i, rules, chase };
  } catch {
    throw new FightReplayError('invalid_issue');
  }
}

function decodeLog(raw: unknown): { log: FightInputLog; canonical: string } {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > FIGHT_LOG_MAX_BYTES) throw new FightReplayError('invalid_log', { decoderCode: 'too_large' });
    try { obj = JSON.parse(raw); } catch { throw new FightReplayError('invalid_log', { decoderCode: 'invalid_json' }); }
  } else {
    let size = 0;
    try { size = Buffer.byteLength(JSON.stringify(raw) ?? ''); } catch { throw new FightReplayError('invalid_log', { decoderCode: 'invalid_json' }); }
    if (size > FIGHT_LOG_MAX_BYTES) throw new FightReplayError('invalid_log', { decoderCode: 'too_large' });
  }
  try {
    const log = parseInputLog(obj);
    return { log, canonical: JSON.stringify(inputLogToWire(log)) };
  } catch (e) {
    if (e instanceof FightInputLogError) throw new FightReplayError('invalid_log', { decoderCode: e.code });
    throw new FightReplayError('invalid_log', { decoderCode: 'invalid_log' });
  }
}

/** Every identity field of the log must equal the issue: no client-selected rules, seed, roster, profile or rank. */
function checkIdentity(issue: FightReplayIssueWire, log: FightInputLog): void {
  if (log.rulesId !== issue.rulesId) mismatch('identity', { field: 'rulesId' });
  if (log.rulesHash !== issue.rulesHash) mismatch('identity', { field: 'rulesHash' });
  if (log.seed !== issue.seed) mismatch('identity', { field: 'seed' });
  const [p, c] = log.sides;
  if (p.source !== 'player' || p.rank !== null) mismatch('identity', { field: 'sides[0].source' });
  if (JSON.stringify(p.roster) !== JSON.stringify(issue.player.roster.map(r => ({ id: r.fighterId, profile: null })))) mismatch('identity', { field: 'sides[0].roster' });
  if (c.source !== 'cpu') mismatch('identity', { field: 'sides[1].source' });
  if (c.rank !== issue.cpu.rank.rank) mismatch('identity', { field: 'sides[1].rank' });
  if (JSON.stringify(c.roster) !== JSON.stringify(issue.cpu.roster.map(r => ({ id: r.fighterId, profile: r.profile })))) mismatch('identity', { field: 'sides[1].roster' });
}

export type VerifyOptions = { battleId: string; now?: () => number };

export function verifyFightReplay(storedIssue: unknown, rawLog: unknown, opts: VerifyOptions): FightReplayVerdict {
  const { issue, rules, chase } = readIssue(storedIssue);
  const { log, canonical } = decodeLog(rawLog);
  checkIdentity(issue, log);
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  // Hash only the sample ticks + the last tick (the full per-tick trail is the parity tool's job, not settlement's).
  const last = log.tickCount - 1;
  const samples = new Set<number>(); for (let k = 0; k < log.hashes.length; k++) samples.add(sampleTick(log, k));
  let cpuDivergence = -1;
  const cpuTicks = log.sides[1].ticks;
  const profile = issue.cpu.profile as FightProfile, skill = issue.cpu.rank as FightSkill;
  let result: ReturnType<typeof runFight>;
  try {
    result = runFight(rules, issue.seed, { inputs: logInputs(log, 0) }, { brain: new FightCoreBrain(), profile, skill }, {
      hashAt: t => samples.has(t) || t === last, maxTicks: log.tickCount, recordEvents: true, chase,
      onTick: (t: number, inputs: [FightInput, FightInput]) => {
        if (cpuDivergence < 0 && (t >= cpuTicks.length || !recordEquals(cpuTicks[t], toRecord(inputs[1])))) cpuDivergence = t;
      },
    });
  } catch {
    // the decoder already refused every out-of-range input, so a core/brain throw means the stored issue is unusable
    throw new FightReplayError('invalid_issue');
  }
  const replayMs = now() - t0;
  const ticksRun = result.endTick + 1;
  const k = firstDivergentSample(log, result.tickHashes, ticksRun);
  if (k >= 0 && k < log.hashes.length) mismatch('hash', { window: k, fromTick: k * log.hashEvery, toTick: sampleTick(log, k) });
  // the last partial window: the final hash differs, or the log runs past the tick the host's fight ended on
  if (k === log.hashes.length) mismatch('final_hash', { fromTick: log.hashes.length * log.hashEvery, toTick: last });
  // every hash matches but the fight is not over at the log's last tick: a sealed, unfinished fight has no outcome
  if (!result.ended) mismatch('incomplete', { toTick: last });
  if (cpuDivergence >= 0) mismatch('cpu_stream', { tick: cpuDivergence });

  const core = result.core;
  const fielded = [new Set<number>([firstFielded(core, 0)]), new Set<number>([firstFielded(core, 1)])];
  for (const e of result.events) if (e.kind === EventKind.Swap || e.kind === EventKind.ForcedSwap) fielded[e.side].add(e.value);
  const finals = (side: number, slots: { fighterId: string; holobotId: string }[]): FightFinalWire[] =>
    core.roster[side].map((m, i) => ({
      // duel-sim-3 r3 (fight-tune-2): the core fights in FIGHT HP (issued HP x the pair HP scale); the receipt and the settle stay in
      // town units (townHp maps back: 0 stays 0, standing >= 1, full stays full), so the town HP display is unchanged (#72.26)
      fighterId: m.def.id, holobotId: slots[i].holobotId, currentHealth: townHp(m), maxHealth: m.def.maxHp, staminaPm: m.sta, sync: m.sync,
      knockedOut: m.ko, fielded: fielded[side].has(i),
    }));
  const receipt: FightReceiptWire = {
    schemaVersion: FIGHT_RECEIPT_SCHEMA, simVersion: FIGHT_SIM_VERSION, battleId: opts.battleId,
    rulesId: issue.rulesId, rulesHash: issue.rulesHash, seed: issue.seed, inputsHash: hex(sha256(Buffer.from(canonical))),
    verified: true, winner: result.winner === 0 ? 'player' : result.winner === 1 ? 'opponent' : 'draw',
    reason: result.reason === 'ko' ? 'ko' : 'timeout', endTick: result.endTick, tickCount: log.tickCount, playerSide: 0,
    playerFinal: finals(0, issue.player.roster), opponentFinal: finals(1, issue.cpu.roster),
    checkpoints: { hashEvery: log.hashEvery, hashes: log.hashes.join(''), finalHash: result.finalHash },
    witness: result.witness,
  };
  return {
    receipt, winner: result.winner, replayMs, ticks: ticksRun,
    fieldedHolobotIds: receipt.playerFinal.filter(f => f.fielded).map(f => f.holobotId),
  };
}

function firstFielded(core: FightCore, side: number): number {
  return core.roster[side].findIndex(m => m.def.hp > 0);
}
