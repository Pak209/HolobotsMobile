/**
 * CPU Arena settle confirmation (host-compat for the #143 settle floor). Presentation and transport only: this never
 * decides an outcome. The host refuses a WIN reported under its floor with rejectionCode `too_fast` and writes nothing;
 * the match stays active. That is a "not yet", so the IDENTICAL stored settle is resent:
 *   - after exactly `details.retryAfterMs` when the refusal carries one;
 *   - otherwise on a bounded backoff (1, 2, 4, 8, 16 s; ~31 s in all);
 *   - then the player gets a manual TRY AGAIN.
 * The floor itself is never hardcoded here. An unknown outcome (timeout, unavailable, dropped reply) uses the same budget.
 * Any other definite refusal (match_expired, invalid_state, ...) ends the loop with its code for the copy map.
 */
import { ARENA_SETTLE_TOO_FAST, arenaCallCode, arenaDefiniteRefusal, arenaHostRejection, arenaRetryAfterMs, type ArenaReply, type ArenaSettleReport } from './arenaMatchFlow';

export const ARENA_SETTLE_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

export type ArenaSettlePhase =
    | { kind: 'idle' }
    /** A settle request is in flight. attempt 0 is the first send. */
    | { kind: 'sending'; attempt: number }
    /** The City has not confirmed yet; an identical resend is armed. */
    | { kind: 'waiting'; attempt: number; resendInMs: number; hinted: boolean; reason: 'too_fast' | 'unknown' }
    /** The automatic budget is spent. Nothing is lost: the body stays stored for TRY AGAIN. */
    | { kind: 'stalled'; reason: 'too_fast' | 'unknown' }
    | { kind: 'settled'; reply: ArenaReply }
    /** A definite refusal other than the floor. `code` feeds the player copy map; it is never shown raw. */
    | { kind: 'refused'; code: string };

/** The two ArenaMatchFlow calls this needs. retrySettle resends the stored body byte-for-byte. */
export interface ArenaSettleTransport {
    settle(report: ArenaSettleReport): Promise<ArenaReply>;
    retrySettle(): Promise<ArenaReply>;
}
type Timers = { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (handle: any) => void };

export class ArenaSettleConfirmer {
    private generation = 0;
    private timer: unknown = null;
    private resends = 0;
    constructor(private transport: ArenaSettleTransport, private onPhase: (phase: ArenaSettlePhase) => void,
        private timers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) }) { }
    /** First send of a just-finished fight. The flow persists the report before it leaves the device. */
    start(report: ArenaSettleReport) { this.begin(() => this.transport.settle(report)); }
    /** After a relaunch or foreground with a stored settle for the open match: resend it unchanged. */
    resume() { this.begin(() => this.transport.retrySettle()); }
    /** Manual TRY AGAIN: a fresh automatic budget, same stored body. */
    retryNow() { this.begin(() => this.transport.retrySettle()); }
    /** Unmount, background, sign-out: cancel the armed resend and ignore any in-flight answer. */
    stop() { this.generation++; this.clear(); }
    private clear() { if (this.timer !== null) { this.timers.clearTimeout(this.timer); this.timer = null; } }
    private begin(send: () => Promise<ArenaReply>) {
        this.stop();
        this.resends = 0;
        void this.send(this.generation, send, 0);
    }
    private async send(generation: number, send: () => Promise<ArenaReply>, attempt: number) {
        if (generation !== this.generation) return;
        this.onPhase({ kind: 'sending', attempt });
        try {
            const reply = await send();
            if (generation === this.generation) this.onPhase({ kind: 'settled', reply });
        }
        catch (e) {
            if (generation !== this.generation) return;
            if (e instanceof Error && e.message === 'arena_session_changed') { this.onPhase({ kind: 'idle' }); return; }
            const rejection = arenaHostRejection(e);
            const tooFast = rejection === ARENA_SETTLE_TOO_FAST;
            if (!tooFast && arenaDefiniteRefusal(e)) { this.onPhase({ kind: 'refused', code: rejection ?? arenaCallCode(e) ?? 'unknown' }); return; }
            const reason = tooFast ? 'too_fast' : 'unknown';
            if (this.resends >= ARENA_SETTLE_BACKOFF_MS.length) { this.onPhase({ kind: 'stalled', reason }); return; }
            const hint = tooFast ? arenaRetryAfterMs(e) : null;
            const resendInMs = hint ?? ARENA_SETTLE_BACKOFF_MS[this.resends];
            this.resends++;
            this.onPhase({ kind: 'waiting', attempt: attempt + 1, resendInMs, hinted: hint !== null, reason });
            this.timer = this.timers.setTimeout(() => { this.timer = null; void this.send(generation, () => this.transport.retrySettle(), attempt + 1); }, resendInMs);
        }
    }
}
