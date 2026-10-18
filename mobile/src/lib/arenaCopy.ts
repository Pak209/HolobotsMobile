/**
 * Player copy and screen phases for the lite CPU Arena (L1, F2, F3, F7; DECISIONS #71).
 * Every string here is PLACEHOLDER until Lex signs off the Arena copy. The authority is "the City", never "host".
 * Presentation only (hard rule 1): nothing here decides an outcome, a reward or an HP value. Codes from the host or
 * the transport are mapped to copy and are never printed raw.
 */
import { arenaCallCode, arenaClosureResult, arenaDefiniteRefusal, arenaHostRejection, arenaReceiptResult, type ArenaReply } from './arenaMatchFlow';
import type { ArenaSettlePhase } from './arenaSettleConfirm';

export type ArenaCopyBlock = { title: string; body: string };

// PLACEHOLDER until Lex.
export const ARENA_SCREEN_COPY = {
    admittedEyebrow: 'ARENA ENTRY ACCEPTED',
    admittedTitle: 'READY TO FIGHT',
    admittedBody: 'Your entry is paid. Start the fight, or cancel now for a full refund.',
    start: 'START FIGHT',
    cancelRefund: 'CANCEL · REFUND ENTRY',
    interruptedEyebrow: 'MATCH IN PROGRESS',
    interruptedTitle: 'FIGHT INTERRUPTED',
    /** F3, a fight that ran on this device and was cut off (kill, relaunch): it continues from its saved state. */
    interruptedBody: 'This fight stopped on this device. Continue from where it stopped, or forfeit at that HP.',
    resumeFight: 'CONTINUE FIGHT',
    /** F3, a lost `start` reply: no fight ever ran here, so it starts from the HP the City admitted. */
    notStartedBody: "This fight never started on this device. Start it from the HP you entered with, or forfeit at that HP.",
    restart: 'START FROM ENTRY HP',
    /** F3, the fight ended on this device but its result never reached the City. */
    finishedBody: 'This fight ended on this device before the City got its result. Send it now, or forfeit.',
    sendResult: 'SEND RESULT',
    forfeit: 'FORFEIT MATCH',
    payoutCapped: 'Daily Arena rewards reached · this match pays no rewards',
    confirmingEyebrow: 'CITY CONFIRMING',
    confirmingTitle: 'The City is confirming your win…',
    confirmingBody: 'Your result is saved on this device and is sent again automatically.',
    confirmingResult: 'The City is confirming your result…',
    stalledEyebrow: 'NOT CONFIRMED YET',
    stalledTitle: 'Still waiting for the City',
    stalledBody: "The City hasn't confirmed this match yet. Your result is saved on this device and nothing was charged again.",
    tryAgain: 'TRY AGAIN',
    pendingIssueEyebrow: 'ENTRY NOT CONFIRMED',
    pendingIssueTitle: 'An earlier entry is still waiting',
    pendingIssueBody: "We couldn't tell whether the City accepted your last entry. Send it again exactly as before, or discard it and check your account.",
    retryEntry: 'RETRY SAME ENTRY',
    discardEntry: 'DISCARD ENTRY',
    errorEyebrow: 'ARENA',
    checkAgain: 'CHECK AGAIN',
    back: 'BACK TO ARENA',
    quitInBattle: 'QUIT · FORFEIT',
} as const;

const COPY: Record<string, ArenaCopyBlock> = {
    insufficient_funds: { title: 'ENTRY NOT ACCEPTED', body: 'Not enough Holos or Arena Passes for this entry.' },
    holobot_ko: { title: 'HOLOBOT IS KO', body: 'That Holobot is knocked out. Heal it before entering the Arena.' },
    activity_conflict: { title: 'ANOTHER ACTIVITY IS OPEN', body: 'Finish your open match, zone run or duel first, then try again.' },
    match_expired: { title: 'MATCH TIMED OUT', body: 'This match ran out of time before the City could confirm it. Close it to continue.' },
    bracket: { title: 'TOURNAMENT MATCH', body: 'This match belongs to a tournament bracket and cannot be played here.' },
    not_eligible: { title: 'TIER NOT OPEN', body: 'This Arena tier is not open for your account yet.' },
    refused: { title: 'REQUEST NOT ACCEPTED', body: "The City didn't accept that request. Nothing new was charged." },
    unreadable: { title: 'MATCH UNREADABLE', body: "The City sent a match this version can't show. Nothing was decided on this device." },
    session: { title: 'ACCOUNT CHANGED', body: 'You signed in with a different account. Reopen the Arena.' },
    pending_issue: { title: ARENA_SCREEN_COPY.pendingIssueTitle, body: ARENA_SCREEN_COPY.pendingIssueBody },
    confirming: { title: ARENA_SCREEN_COPY.confirmingResult, body: ARENA_SCREEN_COPY.confirmingBody },
    offline: { title: 'NO ANSWER FROM THE CITY', body: "The City didn't answer in time. Nothing new was charged; try again in a moment." },
};
const ALIAS: Record<string, keyof typeof COPY> = {
    holobot_ko: 'holobot_ko', insufficient_funds: 'insufficient_funds', activity_conflict: 'activity_conflict', match_expired: 'match_expired',
    bracket_bound: 'bracket', bracket_required: 'bracket', not_eligible: 'not_eligible', story_locked: 'not_eligible', rank_locked: 'not_eligible',
    invalid_request: 'refused', invalid_state: 'refused', request_conflict: 'refused', unknown_match: 'refused', not_admitted: 'refused',
    arena_not_admitted: 'refused', arena_no_pending_issue: 'refused', arena_no_pending_settle: 'refused', 'invalid-argument': 'refused',
    'failed-precondition': 'refused', 'not-found': 'refused', 'permission-denied': 'refused', unauthenticated: 'session',
    arena_reply_invalid: 'unreadable', arena_snapshot_unavailable: 'unreadable', arena_receipt_invalid: 'unreadable',
    arena_snapshot_changed: 'unreadable', arena_issue_mismatch: 'unreadable', arena_result_unavailable: 'unreadable',
    arena_moves_unavailable: 'unreadable', arena_not_started: 'unreadable',
    arena_session_changed: 'session', arena_issue_pending: 'pending_issue', too_fast: 'confirming',
    unavailable: 'offline', arena_busy: 'offline', 'deadline-exceeded': 'offline', internal: 'offline',
};

/** The machine code of an Arena failure: host rejectionCode, then a local `arena_*` code, then the HTTPS code. */
export function arenaErrorCode(e: unknown): string {
    const rejection = arenaHostRejection(e);
    if (rejection) return rejection;
    const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
    if (/^arena_[a-z0-9_]+$/.test(message)) return message;
    return arenaCallCode(e) ?? 'unknown';
}
/** L1: player copy for any Arena failure, never raw. An unknown code the City sent as a refusal reads "not accepted";
 * only a missing answer (timeout, dropped reply, no code) reads "no answer". */
export function arenaErrorCopy(e: unknown): ArenaCopyBlock {
    const alias = ALIAS[arenaErrorCode(e)];
    if (alias) return COPY[alias];
    return arenaHostRejection(e) || arenaDefiniteRefusal(e) ? COPY.refused : COPY.offline;
}

export type ArenaQuitPrompt = { title: string; body: string; confirm: string; dismiss: string };
/** Every QUIT/CANCEL goes through a confirmation. A forfeit while a result is still unconfirmed says so first; it never
 * silently discards a pending settle. It says "win" only when the City has answered too_fast for this match (the floor
 * refuses only wins); otherwise "result", never a local verdict. */
export function arenaQuitPrompt(input: { state: 'issued' | 'active'; pendingSettle: boolean; win?: boolean; fighter: string; forfeitHp: number | null }): ArenaQuitPrompt {
    if (input.state === 'issued')
        return { title: 'CANCEL THIS ENTRY?', body: 'The fight has not started. The City refunds your entry in full.', confirm: 'CANCEL ENTRY', dismiss: 'KEEP ENTRY' };
    const hp = input.forfeitHp === null ? '' : ` ${input.fighter} keeps ${input.forfeitHp} HP.`;
    const what = input.win ? 'win' : 'result';
    if (input.pendingSettle)
        return { title: `FORFEIT AN UNCONFIRMED ${what.toUpperCase()}?`, body: `The City hasn't confirmed your ${what} yet. Forfeiting closes this match with no rewards and discards the saved result.${hp}`, confirm: 'FORFEIT ANYWAY', dismiss: 'KEEP WAITING' };
    return { title: 'FORFEIT THIS MATCH?', body: `A forfeit pays no rewards and the entry is not refunded.${hp}`, confirm: 'FORFEIT', dismiss: 'KEEP FIGHTING' };
}
/** F3: the HP a forfeit reports: the live fight on this device, else the result saved for the City, else the saved
 * checkpoint of a fight that ran here and was cut off, else (the fight never ran here) the HP the City admitted. */
export function arenaForfeitHp(input: { checkpointHp: number | null; pendingSettleHp: number | null; savedCheckpointHp?: number | null; admissionHp: number }): number {
    // The City accepts a forfeit only at or below the admission HP.
    return Math.min(input.admissionHp, input.checkpointHp ?? input.pendingSettleHp ?? input.savedCheckpointHp ?? input.admissionHp);
}

export type ArenaScreenPhase =
    | { kind: 'menu' }
    | { kind: 'pendingIssue' }
    /** interrupted: active with no live fight here. resumable / finished: this device saved that fight's state, still
     * running or already over (F3). */
    | { kind: 'admitted'; interrupted: boolean; resumable?: boolean; finished?: boolean }
    | { kind: 'battle' }
    | { kind: 'confirming' }
    | { kind: 'stalled' }
    | { kind: 'receipt' }
    | { kind: 'closure' }
    | { kind: 'error'; copy: ArenaCopyBlock; matchOpen: boolean };
const open = (reply: ArenaReply | null) => !!reply?.match && (reply.match.state === 'issued' || reply.match.state === 'active');
/** One honest screen state from the host reply and local transport state. Terminal receipts the player already dismissed
 * (F4) fall back to the menu. */
export function arenaScreenPhase(input: { reply: ArenaReply | null; acknowledged: boolean; hasCheckpoint: boolean; savedCheckpoint?: boolean; settle: ArenaSettlePhase; pendingIssue: boolean; error: unknown; savedCheckpointFinished?: boolean }): ArenaScreenPhase {
    const { reply, settle } = input;
    if (open(reply)) {
        const active = reply!.match!.state === 'active';
        if (active && settle.kind === 'waiting') return { kind: 'confirming' };
        if (active && settle.kind === 'sending' && (settle.attempt > 0 || !input.hasCheckpoint)) return { kind: 'confirming' };
        if (active && settle.kind === 'stalled') return { kind: 'stalled' };
        if (settle.kind === 'refused') return { kind: 'error', copy: COPY[ALIAS[settle.code] ?? 'refused'], matchOpen: true };
        if (input.error) return { kind: 'error', copy: arenaErrorCopy(input.error), matchOpen: true };
        if (input.hasCheckpoint) return { kind: 'battle' };
        if (!active) return { kind: 'admitted', interrupted: false };
        return input.savedCheckpoint && input.savedCheckpointFinished ? { kind: 'admitted', interrupted: true, finished: true } : { kind: 'admitted', interrupted: true, resumable: !!input.savedCheckpoint };
    }
    if (input.error && arenaErrorCode(input.error) === 'arena_issue_pending') return { kind: 'pendingIssue' };
    if (input.error) return { kind: 'error', copy: arenaErrorCopy(input.error), matchOpen: false };
    if (reply?.match && !input.acknowledged) {
        // Validate here, not in render: a terminal record the readers refuse is "unreadable", never a crash or a guess.
        try { if (reply.match.state === 'settled') arenaReceiptResult(reply); else arenaClosureResult(reply); }
        catch { return { kind: 'error', copy: COPY.unreadable, matchOpen: false }; }
        return reply.match.state === 'settled' ? { kind: 'receipt' } : { kind: 'closure' };
    }
    if (input.pendingIssue) return { kind: 'pendingIssue' };
    return { kind: 'menu' };
}
