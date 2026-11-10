import { FIGHT_LOG_MAX_BYTES } from '../../shared/fightReplayContract';
import { FightReplayError, FightReplayVerdict, verifyFightReplay } from './replay';

/**
 * Replay validation groundwork (ship-readiness item 8, Pak 2026-11-04: "input-log replay on the host is the PvP gate").
 * A NON-THROWING classifier over fight-host-1's verifyFightReplay: re-run the duel-sim-3 core from the issued rules + seed +
 * CPU profile/rank with the client's duel-inputs-2 log, compare the sampled checkpoint hashes, and name the outcome.
 *
 *   match        every checkpoint and the final hash agree, the fight ended, the CPU stream is the host brain's
 *   tamper       identity field, a checkpoint window, the final hash or the recorded CPU stream disagrees
 *   truncated    the log stops early (decoder: short stream / counts; replay: sealed but unfinished)
 *   oversized    more than maxBytes (default FIGHT_LOG_MAX_BYTES) of compact JSON
 *   missing      no log was sent
 *   invalid_log  any other undecodable log
 *   invalid_issue the stored issue block is unusable (a host-side fault, never the player's)
 *
 * Pure: no clock (unless opts.now), database, network or randomness. The caller decides what a verdict does: today the
 * pvp settle only LOGS a non-match (dry run); the gate flip makes a non-match refuse (Documentation/HANDOFFS/
 * 2026-11-04-replay-validation-groundwork.md in HolobotsUnity).
 */
export type ReplayVerdictCode = 'match' | 'tamper' | 'truncated' | 'oversized' | 'missing' | 'invalid_log' | 'invalid_issue';

export type ReplayValidation = {
  verdict: ReplayVerdictCode;
  /** The underlying reason: replay_mismatch reason (identity / hash / final_hash / incomplete / cpu_stream) or decoder code. */
  reason?: string;
  /** First divergent window / field / tick, as verifyFightReplay reports it. */
  detail: Record<string, unknown>;
  /** Compact JSON bytes of the log as received (0 when missing / unmeasurable). */
  bytes: number;
  /** On match only: the host-computed outcome (duel-receipt-2) and the fielded ids. */
  replay?: FightReplayVerdict;
};

/** Settle request field a client sends INSTEAD of the log when its log is over the cap (value 'too_large'); dry run only. */
export const FIGHT_LOG_OMITTED_FIELD = 'inputLogOmitted' as const;

const TRUNCATION_CODES = new Set(['stream_truncated', 'invalid_hash_count', 'invalid_tick_count', 'stream_tick_range']);

function byteLength(raw: unknown): number {
  try { return typeof raw === 'string' ? Buffer.byteLength(raw) : Buffer.byteLength(JSON.stringify(raw) ?? ''); } catch { return -1; }
}

export function validateReplay(storedIssue: unknown, rawLog: unknown, opts: { battleId: string; maxBytes?: number; now?: () => number }): ReplayValidation {
  if (rawLog === undefined || rawLog === null) return { verdict: 'missing', detail: {}, bytes: 0 };
  const bytes = byteLength(rawLog);
  if (bytes < 0) return { verdict: 'invalid_log', reason: 'invalid_json', detail: {}, bytes: 0 };
  const cap = Math.min(opts.maxBytes ?? FIGHT_LOG_MAX_BYTES, FIGHT_LOG_MAX_BYTES);
  if (bytes > cap) return { verdict: 'oversized', reason: 'too_large', detail: { maxBytes: cap }, bytes };
  try {
    const replay = verifyFightReplay(storedIssue, rawLog, { battleId: opts.battleId, now: opts.now });
    return { verdict: 'match', detail: { ticks: replay.ticks, winner: replay.receipt.winner }, bytes, replay };
  } catch (e) {
    if (!(e instanceof FightReplayError)) return { verdict: 'invalid_issue', reason: 'replay_threw', detail: {}, bytes };
    const detail = { ...e.detail } as Record<string, unknown>;
    if (e.code === 'invalid_issue') return { verdict: 'invalid_issue', detail, bytes };
    if (e.code === 'invalid_log') {
      const code = String(detail.decoderCode ?? 'invalid_log');
      if (code === 'too_large') return { verdict: 'oversized', reason: code, detail, bytes };
      return { verdict: TRUNCATION_CODES.has(code) ? 'truncated' : 'invalid_log', reason: code, detail, bytes };
    }
    const reason = String(detail.reason ?? 'replay_mismatch');
    return { verdict: reason === 'incomplete' ? 'truncated' : 'tamper', reason, detail, bytes };
  }
}

/** One telemetry line for a dry-run verdict (bounded: no log body, no seed). */
export function replayDryRunLine(battleId: string, v: ReplayValidation, claimedWin: boolean | null): Record<string, unknown> {
  const replayWinner = v.replay ? v.replay.receipt.winner : null;
  return {
    event: 'pvp_replay_dry_run', battleId, verdict: v.verdict, reason: v.reason ?? null, bytes: v.bytes,
    window: v.detail.window ?? null, field: v.detail.field ?? null, tick: v.detail.tick ?? null,
    claimedWin, replayWinner, agrees: replayWinner === null || claimedWin === null ? null : (replayWinner === 'player') === claimedWin,
  };
}
