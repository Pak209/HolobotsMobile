/**
 * lite-arena-polish-1 offline cells. Every reply is DERIVED from the recorded host lifecycle
 * (fixtures/arena-admitted-lifecycle.json, byte-identical to main's functions/scripts/fixtures/arena-match/admitted-lifecycle.json)
 * by the minimum edit the host code makes, and says so:
 *  - payoutWithheld: host #143 `rewards()` returns an all-zero settlement plus `payoutWithheld` (arenaMatchStore.ts ~:257).
 *  - closures: host cancel writes `cancelled_before_start` + refund (~:355) or `forfeit` + finalVitals (~:380-384).
 *  - too_fast: host #143 refuses a WIN under ARENA_MIN_SETTLE_MS as HttpsError failed-precondition with
 *    details.rejectionCode 'too_fast' (~:367; arenaMatchHost.ts:8). `retryAfterMs` is ANTICIPATED (asked of
 *    host-economy-hardening-2; holoZoneHost already uses that key).
 *  - payoutCapped: ANTICIPATED additive flag on the ISSUE reply (host-economy-hardening-2, PR not open at authoring).
 * Offline QA and tests only; never a live fallback. JSON copies only (Hermes has no structured clone).
 */
import lifecycle from './fixtures/arena-admitted-lifecycle.json';
import type { ArenaReply } from '@/lib/arenaMatchFlow';

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const step = (operation: string) => copy(lifecycle.steps.find(s => s.request.operation === operation)!.reply) as unknown as ArenaReply;

export const ARENA_ISSUED = step('issue');
export const ARENA_STARTED = step('start');
export const ARENA_SETTLED = step('settle');
export const ARENA_ISSUE_REQUEST = (() => { const r = lifecycle.steps.find(s => s.request.operation === 'issue')!.request as unknown as Record<string, string>; return { requestId: r.requestId, tierId: r.tierId, paymentMethod: r.paymentMethod as 'tokens' | 'pass', holobotId: r.holobotId, opponentName: r.opponentName }; })();
export const ARENA_SETTLE_REPORT = (() => { const r = lifecycle.steps.find(s => s.request.operation === 'settle')!.request as unknown as Record<string, number>; return { playerFinalHealth: r.playerFinalHealth, opponentFinalHealth: r.opponentFinalHealth, combosCompleted: r.combosCompleted, perfectDefenses: r.perfectDefenses }; })();

/** Settled, nothing paid: host `rewards(..., withheld)`. `outcome` follows the host rule (under_floor is only ever a loss). */
export function arenaWithheldReply(reason: 'daily_cap' | 'under_floor'): ArenaReply {
    const r = step('settle') as any, receipt = r.match.settlementReceipt;
    receipt.outcome = reason === 'under_floor' ? 'loss' : 'win';
    receipt.settlement = { exp: 0, awardedExp: 0, holos: 0, syncPoints: 0, blueprints: null, payoutWithheld: reason };
    if (reason === 'under_floor') {
        receipt.report = { ...receipt.report, playerFinalHealth: 0, opponentFinalHealth: Math.min(120, r.match.opponent.maxHealth) };
        receipt.finalVitals = { [r.match.entrant.holobotId]: { ...receipt.finalVitals[r.match.entrant.holobotId], currentHealth: 0 } };
    }
    return r as ArenaReply;
}
/** Cancelled before start: the host refunds the entry it charged. */
export function arenaRefundReply(): ArenaReply {
    const r = step('issue') as any, m = r.match;
    m.state = 'cancelled';
    m.closedAtMs = m.issuedAtMs + 30_000;
    m.settlementReceipt = { matchId: m.matchId, outcome: 'cancelled_before_start', refunded: true, refund: { method: m.entryReceipt.method, amount: m.entryReceipt.amount, balanceBefore: m.entryReceipt.balanceAfter, balanceAfter: m.entryReceipt.balanceBefore }, settlement: null, closedAtMs: m.closedAtMs };
    r.alreadyProcessed = false;
    return r as ArenaReply;
}
/** Forfeit of an active match at the reported HP; the host records finalVitals. */
export function arenaForfeitReply(hp: number): ArenaReply {
    const r = step('start') as any, m = r.match;
    m.state = 'cancelled';
    m.closedAtMs = m.startedAtMs + 12_000;
    m.settlementReceipt = { matchId: m.matchId, outcome: 'forfeit', refunded: false, settlement: null, report: { playerFinalHealth: hp }, closedAtMs: m.closedAtMs, finalVitals: { [m.entrant.holobotId]: { currentHealth: hp, maxHealth: m.entrant.maxHealth } } };
    return r as ArenaReply;
}
/** ANTICIPATED: the issue reply with host-economy-hardening-2's additive payoutCapped flag. */
export function arenaPayoutCappedIssue(): ArenaReply {
    return { ...step('issue'), payoutCapped: true } as ArenaReply;
}
/** The callable refusal exactly as the Firebase SDK surfaces it (HTTPS code + details). */
export function arenaRefusal(rejectionCode: string, httpsCode = 'failed-precondition', extra: Record<string, unknown> = {}) {
    return Object.assign(Error(rejectionCode), { code: `functions/${httpsCode}`, details: { rejectionCode, ...extra } as { rejectionCode: string; retryAfterMs?: number } });
}
export const tooFast = (retryAfterMs?: number) => arenaRefusal('too_fast', 'failed-precondition', retryAfterMs === undefined ? {} : { retryAfterMs });
/** holobotsmobile://qa/<name> routes, known-bad control first (src/qa/ArenaPolishPreview.tsx). */
export const ARENA_POLISH_PREVIEW_ROUTES = ['ArenaPolishKnownBad', 'ArenaPolishAdmitted', 'ArenaPolishCapped', 'ArenaPolishConfirming', 'ArenaPolishStalled', 'ArenaPolishWithheld', 'ArenaPolishRefund'] as const;
