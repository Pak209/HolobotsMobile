/** Durable CPU Arena transport. No combat simulation or local reward writes. */
import { ARENA_3V3_SCHEMA, readArena3v3Reply, type Arena3v3Reply, type Arena3v3Swap } from './arenaMatch3v3';
export type ArenaIssue = {
    requestId: string;
    tierId: string;
    paymentMethod: 'tokens' | 'pass';
    holobotId: string;
    opponentName: string;
};
export type ArenaSnapshot = {
    holobotId: string;
    displayName: string;
    level: number;
    tier: number;
    maxHealth: number;
    currentHealth?: number;
    attack: number;
    defense: number;
    speed: number;
    intelligence: number;
    commandRules: Record<string, number>;
    moves: Array<{
        moveId: string;
        staminaCost: number;
        damageScale: number;
        breakPower: number;
        chargeable: boolean;
    }>;
};
export type ArenaMatch = {
    schemaVersion: 'arena-match-1';
    matchId: string;
    requestId: string;
    state: 'issued' | 'active' | 'settled' | 'cancelled' | 'expired';
    tierId: string;
    entrant: ArenaSnapshot;
    opponent: ArenaSnapshot;
    issuedAtMs: number;
    expiresAtMs: number;
    entryReceipt: Record<string, unknown>;
    settlementReceipt: Record<string, unknown> | null;
    [key: string]: unknown;
};
export type ArenaReply = {
    schemaVersion: 'arena-match-1';
    matchId: string | null;
    alreadyProcessed: boolean;
    match: ArenaMatch | null;
};
export const canonicalArenaValue = (value: unknown): string => JSON.stringify(Array.isArray(value) ? value.map(v => JSON.parse(canonicalArenaValue(v))) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(canonicalArenaValue(v))])) : value);
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const number = (v: unknown, min = 0) => typeof v === 'number' && Number.isFinite(v) && v >= min;
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) => number(v, min) && Number.isSafeInteger(v) && Number(v) <= max;
const id = (v: unknown) => typeof v === 'string' && /^am_[a-f0-9]{32}$/.test(v);
function snapshot(raw: unknown): ArenaSnapshot {
    const f = record(raw), rules = record(f.commandRules);
    if (typeof f.holobotId !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(f.holobotId) || f.displayName !== f.holobotId.toUpperCase() || !integer(f.level, 1, 99) || !integer(f.tier, 0, 1000000)
        || !['maxHealth', 'attack', 'defense', 'speed', 'intelligence'].every(k => number(f[k], 1))
        || (f.currentHealth !== undefined && (!number(f.currentHealth) || Number(f.currentHealth) > Number(f.maxHealth)))
        || rules.version !== 1 || !number(rules.maxStamina, 1) || !['maxStamina', 'staminaRegen', 'strikeCost', 'comboCost', 'fullCost', 'fullSync', 'guardReduction'].every(k => number(rules[k]))
        || !Array.isArray(f.moves) || !f.moves.length || !f.moves.every(raw => { const m = record(raw); return typeof m.moveId === 'string' && ['staminaCost', 'damageScale', 'breakPower'].every(k => number(m[k])) && typeof m.chargeable === 'boolean'; }))
        throw Error('arena_snapshot_unavailable');
    return f as unknown as ArenaSnapshot;
}
export function readArenaReply(raw: unknown, expectedId?: string): ArenaReply {
    const r = record(raw), m = record(r.match);
    if (r.schemaVersion !== 'arena-match-1' || typeof r.alreadyProcessed !== 'boolean')
        throw Error('arena_reply_invalid');
    if (r.match === null && r.matchId === null && !expectedId && r.alreadyProcessed === true)
        return r as unknown as ArenaReply;
    if (!id(r.matchId) || (expectedId && r.matchId !== expectedId) || m.matchId !== r.matchId || m.schemaVersion !== 'arena-match-1' || typeof m.requestId !== 'string'
        || !['issued', 'active', 'settled', 'cancelled', 'expired'].includes(String(m.state)) || !integer(m.issuedAtMs) || !integer(m.expiresAtMs) || Number(m.expiresAtMs) <= Number(m.issuedAtMs))
        throw Error('arena_reply_invalid');
    const entrant = snapshot(m.entrant);
    if (!number(entrant.currentHealth) || entrant.currentHealth === 0) throw Error('arena_snapshot_unavailable');
    snapshot(m.opponent);
    const entry = record(m.entryReceipt);
    if (entry.matchId !== m.matchId || !['tokens', 'pass'].includes(String(entry.method)) || !['amount', 'balanceBefore', 'balanceAfter', 'chargedAtMs'].every(k => integer(entry[k])) || Number(entry.balanceBefore) - Number(entry.amount) !== entry.balanceAfter)
        throw Error('arena_receipt_invalid');
    if (['settled', 'cancelled', 'expired'].includes(String(m.state))) {
        const receipt = record(m.settlementReceipt);
        if (receipt.matchId !== m.matchId || !['win', 'loss', 'forfeit', 'cancelled_before_start'].includes(String(receipt.outcome)))
            throw Error('arena_receipt_invalid');
    }
    else if (m.settlementReceipt !== null)
        throw Error('arena_receipt_invalid');
    if (m.state === 'settled')
        arenaReceiptResult(r as unknown as ArenaReply);
    return r as unknown as ArenaReply;
}
export interface ArenaFlowStorage {
    get(): Promise<ArenaIssue | null>;
    set(value: ArenaIssue | null): Promise<void>;
}
/** Pending arena-match-3v3-1 swap, persisted per account before it is sent. */
export interface Arena3v3IntentStorage {
    get(): Promise<Arena3v3Swap | null>;
    set(value: Arena3v3Swap | null): Promise<void>;
}
/** The four reported fields of one CPU settle, exactly as sent. */
export type ArenaSettleReport = {
    playerFinalHealth: number;
    opponentFinalHealth: number;
    combosCompleted: number;
    perfectDefenses: number;
};
/** A settle persisted per account BEFORE it is sent, so a refused-for-now (too_fast) or lost settle is resent byte-for-byte. */
export type ArenaPendingSettle = { matchId: string; report: ArenaSettleReport };
export interface ArenaSettleStorage {
    get(): Promise<ArenaPendingSettle | null>;
    set(value: ArenaPendingSettle | null): Promise<void>;
}
/** F3: the local practice fight's last state for the open match, written as HP changes, so an interrupted fight (kill,
 * relaunch) continues from where it stopped instead of re-rolling from entry HP. Local sim state only: the City still
 * receives nothing but the eventual settle or cancel report. */
export type ArenaCheckpoint = { matchId: string; report: ArenaSettleReport };
export interface ArenaCheckpointStorage {
    get(): Promise<ArenaCheckpoint | null>;
    set(value: ArenaCheckpoint | null): Promise<void>;
}
/** The last terminal matchId whose receipt the player dismissed (F4): it is not re-opened on mount or foreground. */
export interface ArenaAckStorage {
    get(): Promise<string | null>;
    set(value: string | null): Promise<void>;
}
/** A callable error carrying a host rejectionCode is a final ruling: the intent was not applied. */
export function arenaHostRejection(e: unknown): string | null {
    const code = record(record(e).details).rejectionCode;
    return typeof code === 'string' ? code : null;
}
/** The callable's HTTPS code without the SDK prefix ('functions/failed-precondition' -> 'failed-precondition'), or null
 * for a local error (timeout, session change, reply validation). */
export function arenaCallCode(e: unknown): string | null {
    const code = record(e).code;
    return typeof code === 'string' && code.length > 0 ? code.replace(/^functions\//, '') : null;
}
/** HTTPS codes that mean the host refused the request and wrote nothing. Anything else (unavailable, deadline-exceeded,
 * internal, a timeout or a dropped reply) leaves the outcome unknown, so the exact request is kept for an identical retry. */
export const ARENA_DEFINITE_REFUSALS = ['invalid-argument', 'failed-precondition', 'not-found', 'permission-denied'] as const;
export function arenaDefiniteRefusal(e: unknown): boolean {
    return (ARENA_DEFINITE_REFUSALS as readonly string[]).includes(arenaCallCode(e) ?? '');
}
/** The CPU settle floor refusal. The host wrote nothing and the match stays active: it is a "not yet", not an error. */
export const ARENA_SETTLE_TOO_FAST = 'too_fast';
/** Optional host retry hint on a too_fast refusal (details.retryAfterMs, the holoZoneHost convention). Honoured exactly
 * when it is a sane wait (0..10 min, inside the 30 min match TTL); otherwise null and the caller uses its own backoff. */
export function arenaRetryAfterMs(e: unknown): number | null {
    const v = record(record(e).details).retryAfterMs;
    // 0 ("retry now" right after refusing) would spend the whole budget in milliseconds: treated as no hint.
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 600_000 ? Math.ceil(v) : null;
}
const terminalState = (state: unknown) => ['settled', 'cancelled', 'expired'].includes(String(state));
/** One in-flight command. Unknown issue outcome retains its exact persisted request. */
export class ArenaMatchFlow {
    private epoch = 0;
    private flight: Promise<unknown> | null = null;
    private latest: ArenaReply | null = null;
    private team: Arena3v3Reply | null = null;
    private settles?: ArenaSettleStorage;
    private acks?: ArenaAckStorage;
    private checkpoints?: ArenaCheckpointStorage;
    constructor(private call: (request: Record<string, unknown>) => Promise<unknown>, private storage: ArenaFlowStorage, private active: () => boolean, private intents?: Arena3v3IntentStorage, extras: { settles?: ArenaSettleStorage; acks?: ArenaAckStorage; checkpoints?: ArenaCheckpointStorage } = {}) {
        this.settles = extras.settles;
        this.acks = extras.acks;
        this.checkpoints = extras.checkpoints;
    }
    /** Resolves once no command is in flight (never rejects). */
    async whenIdle() {
        while (this.flight)
            await this.flight.catch(() => undefined);
    }
    /** Run `command` (a flow call such as `() => flow.resume()`) as soon as nothing is in flight. It starts in the same
     * synchronous step as the final idle check, so two waiters queue instead of colliding as `arena_busy`. */
    async afterIdle<T>(command: () => Promise<T>): Promise<T> {
        while (this.flight)
            await this.flight.catch(() => undefined);
        return command();
    }
    close() { this.epoch++; this.latest = null; this.team = null; }
    get reply() { return this.latest; }
    /** Last host arena-match-3v3-1 projection. Only a host reply ever replaces it. */
    get teamReply() { return this.team; }
    private run<T>(work: (epoch: number) => Promise<T>): Promise<T> {
        if (this.flight)
            return Promise.reject(Error('arena_busy'));
        const epoch = this.epoch;
        if (!this.active())
            return Promise.reject(Error('arena_session_changed'));
        const p = Promise.resolve().then(() => { if (epoch !== this.epoch || !this.active())
            throw Error('arena_session_changed'); return work(epoch); });
        this.flight = p;
        p.finally(() => { if (this.flight === p)
            this.flight = null; }).catch(() => { });
        return p;
    }
    private async request(operation: string, fields: Record<string, unknown>, epoch: number, expectedId?: string, issue?: ArenaIssue) {
        const raw = await this.call({ schemaVersion: 'arena-match-1', operation, ...fields });
        if (epoch !== this.epoch || !this.active())
            throw Error('arena_session_changed');
        const reply = readArenaReply(raw, expectedId);
        if (issue && (reply.match?.requestId !== issue.requestId || reply.match.entrant.holobotId !== issue.holobotId || reply.match.opponent.displayName !== issue.opponentName || reply.match.tierId !== issue.tierId || reply.match.entryReceipt.method !== issue.paymentMethod))
            throw Error('arena_issue_mismatch');
        if (this.latest?.match && reply.match && this.latest.matchId === reply.matchId) {
            for (const side of ['entrant', 'opponent'] as const)
                if (canonicalArenaValue(this.latest.match[side]) !== canonicalArenaValue(reply.match[side]))
                    throw Error('arena_snapshot_changed');
        }
        this.latest = reply;
        await this.reconcileSettle(reply);
        return reply;
    }
    /** A pending settle lives only while ITS match is the account's open match. A terminal reply for it, or a reply naming
     * another match (one open match per account), retires it; the host's receipt is the truth from then on. */
    private async reconcileSettle(reply: ArenaReply) {
        const pending = this.settles ? await this.settles.get() : null;
        if (pending && (reply.matchId !== pending.matchId || !reply.match || terminalState(reply.match.state)))
            await this.settles!.set(null);
        const cp = this.checkpoints ? await this.checkpoints.get() : null;
        if (cp && (reply.matchId !== cp.matchId || !reply.match || terminalState(reply.match.state)))
            await this.checkpoints!.set(null);
        // A stored issue whose exact requestId the host has admitted is resolved, whichever call surfaced it.
        const issue = reply.match ? await this.storage.get() : null;
        if (issue && reply.match?.requestId === issue.requestId)
            await this.storage.set(null);
    }
    /** Pinned to the known OPEN match; with none open (nothing known, or the known one is terminal) it discovers the
     * account's latest match, so an admission whose reply was lost or whose stored request was discarded surfaces. */
    resume() { return this.run(epoch => {const known=this.latest?.match&&!terminalState(this.latest.match.state)?this.latest.matchId:null;return this.request('resume', known?{matchId:known}:{}, epoch, known??undefined);}); }
    issue(input: ArenaIssue) {
        return this.run(async (epoch) => {
            const pending = await this.storage.get();
            if (pending && canonicalArenaValue(pending) !== canonicalArenaValue(input))
                throw Error('arena_issue_pending');
            if (!pending)
                await this.storage.set(input);
            if (epoch !== this.epoch || !this.active())
                throw Error('arena_session_changed');
            let reply: ArenaReply;
            try {
                reply = await this.request('issue', input, epoch, undefined, input);
            }
            catch (e) {
                // F2: a definite host refusal (insufficient_funds, holobot_ko, activity_conflict, ...) admitted nothing, so the
                // stored request must not wedge every later Start. Unknown outcomes keep it for an identical retry.
                if (arenaDefiniteRefusal(e))
                    await this.storage.set(null);
                throw e;
            }
            await this.storage.set(null);
            return reply;
        });
    }
    retryIssue() { return this.storage.get().then(p => { if (!p)
        throw Error('arena_no_pending_issue'); return this.issue(p); }); }
    /** The stored issue request whose outcome is unknown, if any. */
    pendingIssue() { return this.storage.get(); }
    /** Explicitly drop an unresolved issue request (F2). Safe: the request was charged only if the host admitted it, and a
     * discovery resume (no matchId) then shows that admission. Single-flight: never while an issue is in flight. */
    discardPendingIssue() {
        return this.run(async () => {
            await this.storage.set(null);
        });
    }
    start() { return this.operation('start'); }
    /** Persist the exact report before sending. A pending settle for this match is resent unchanged (never rebuilt); a
     * too_fast refusal keeps it pending, any other DEFINITE refusal retires it, an unknown outcome keeps it. */
    settle(report: ArenaSettleReport) {
        return this.run(async (epoch) => {
            const matchId = this.latest?.matchId;
            if (!matchId)
                throw Error('arena_not_admitted');
            const fresh: ArenaPendingSettle = { matchId, report: { playerFinalHealth: report.playerFinalHealth, opponentFinalHealth: report.opponentFinalHealth, combosCompleted: report.combosCompleted, perfectDefenses: report.perfectDefenses } };
            const pending = this.settles ? await this.settles.get() : null;
            const body = pending?.matchId === matchId ? pending : fresh;
            if (this.settles && body === fresh)
                await this.settles.set(fresh);
            return this.settleIn(epoch, body);
        });
    }
    /** Resend the stored settle body unchanged, or fail. Needs the stored match to be the current one (resume first). */
    retrySettle() {
        return this.run(async (epoch) => {
            const pending = this.settles ? await this.settles.get() : null;
            if (!pending)
                throw Error('arena_no_pending_settle');
            if (this.latest?.matchId !== pending.matchId)
                throw Error('arena_not_admitted');
            return this.settleIn(epoch, pending);
        });
    }
    /** The stored settle for the CURRENT match, if any. */
    async pendingSettle(): Promise<ArenaPendingSettle | null> {
        const pending = this.settles ? await this.settles.get() : null;
        return pending && pending.matchId === this.latest?.matchId ? pending : null;
    }
    private async settleIn(epoch: number, body: ArenaPendingSettle) {
        if (epoch !== this.epoch || !this.active())
            throw Error('arena_session_changed');
        try {
            return await this.request('settle', { matchId: body.matchId, ...body.report }, epoch, body.matchId);
        }
        catch (e) {
            // Only a definite refusal other than the floor retires the body (e.g. match_expired, invalid_state). too_fast and
            // unknown outcomes (unavailable, timeout, dropped reply) keep it for an identical resend.
            const code = arenaHostRejection(e);
            if (this.settles && arenaDefiniteRefusal(e) && code !== ARENA_SETTLE_TOO_FAST && code !== 'request_conflict')
                await this.settles.set(null);
            throw e;
        }
    }
    /** F3: remember the local fight state for the CURRENT open match (no call, not single-flight). */
    async saveCheckpoint(report: ArenaSettleReport) {
        const matchId = this.latest?.matchId;
        if (this.checkpoints && matchId && this.latest?.match?.state === 'active')
            await this.checkpoints.set({ matchId, report: { playerFinalHealth: report.playerFinalHealth, opponentFinalHealth: report.opponentFinalHealth, combosCompleted: report.combosCompleted, perfectDefenses: report.perfectDefenses } });
    }
    /** F3: the saved local fight state for the CURRENT match, if this device ever ran its fight. */
    async checkpoint(): Promise<ArenaCheckpoint | null> {
        const cp = this.checkpoints ? await this.checkpoints.get() : null;
        return cp && cp.matchId === this.latest?.matchId ? cp : null;
    }
    /** F4: has the player already dismissed this terminal match's receipt on this device? */
    async acknowledged(reply: ArenaReply | null): Promise<boolean> {
        return !!reply?.matchId && !!this.acks && (await this.acks.get()) === reply.matchId;
    }
    /** F4: remember the dismissed receipt so the next mount or foreground does not re-open it. */
    async acknowledge(matchId: string) {
        if (this.acks)
            await this.acks.set(matchId);
    }
    private async teamRequest(request: Record<string, unknown>, epoch: number, expect: Parameters<typeof readArena3v3Reply>[1]) {
        const raw = await this.call(request);
        if (epoch !== this.epoch || !this.active())
            throw Error('arena_session_changed');
        const reply = readArena3v3Reply(raw, expect), known = this.team?.match;
        if (known && reply.match && known.matchId === reply.matchId) {
            for (const side of ['team', 'opponentTeam'] as const)
                if (canonicalArenaValue(known[side].map(s => s.fighter)) !== canonicalArenaValue(reply.match[side].map(s => s.fighter)))
                    throw Error('arena_snapshot_changed');
            if (reply.match.battle.turn < known.battle.turn)
                throw Error('arena_3v3_stale_reply');
        }
        return reply;
    }
    /** Read this account's 3v3 match. Dormant: no live caller until the 3v3 host runtime lands, which is HELD until
     * arena-host-resolver-1 can simulate bouts on the host (default decision: no client-asserted bout HP). */
    resumeTeam() {
        return this.run(async (epoch) => {
            const matchId = this.team?.matchId ?? undefined;
            const reply = await this.teamRequest({ schemaVersion: ARENA_3V3_SCHEMA, operation: 'resume', ...(matchId ? { matchId } : {}) }, epoch, { matchId });
            if (epoch !== this.epoch || !this.active())
                throw Error('arena_session_changed');
            this.team = reply;
            return reply;
        });
    }
    /** Swap intent THROUGH THE HOST. The exact body is persisted before sending and retried unchanged.
     * Nothing changes locally until the host replies; a host refusal clears the intent and leaves the state as it was. */
    swap(holobotId: string) { return this.run(epoch => this.swapIn(epoch, holobotId)); }
    private async swapIn(epoch: number, holobotId: string): Promise<Arena3v3Reply> {
        const intents = this.intents, current = this.team?.match;
        if (!intents)
            throw Error('arena_3v3_unavailable');
        if (!current)
            throw Error('arena_not_admitted');
        const pending = await intents.get();
        // Never drop or rewrite an unresolved intent implicitly: one for another match fails closed, sends nothing,
        // and needs an explicit discardPendingSwap() (the next host resume shows what was actually applied).
        if (pending && pending.matchId !== current.matchId)
            throw Error('arena_intent_stale');
        if (pending && pending.holobotId !== holobotId)
            throw Error('arena_intent_pending');
        const request: Arena3v3Swap = pending ?? { schemaVersion: ARENA_3V3_SCHEMA, operation: 'swap', matchId: current.matchId, intentId: `lite3v3_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, turn: current.battle.turn, holobotId };
        if (!pending)
            await intents.set(request);
        if (epoch !== this.epoch || !this.active())
            throw Error('arena_session_changed');
        let reply: Arena3v3Reply;
        try {
            reply = await this.teamRequest({ ...request }, epoch, { matchId: current.matchId, intent: { intentId: request.intentId, operation: 'swap' } });
        }
        catch (e) {
            if (arenaHostRejection(e))
                await intents.set(null);
            throw e;
        }
        if (reply.intent?.appliedTurn !== request.turn)
            throw Error('arena_3v3_intent_mismatch');
        await intents.set(null);
        if (epoch !== this.epoch || !this.active())
            throw Error('arena_session_changed');
        this.team = reply;
        return reply;
    }
    /** Resend the stored swap body unchanged, or fail. Never builds a new intent. Single-flight like every operation. */
    retrySwap() {
        return this.run(async (epoch) => {
            const intents = this.intents;
            if (!intents)
                throw Error('arena_3v3_unavailable');
            const pending = await intents.get();
            if (!pending)
                throw Error('arena_no_pending_intent');
            // Cold start: resume first. Only a KNOWN current match that differs makes the stored intent stale.
            if (!this.team?.match)
                throw Error('arena_not_admitted');
            if (pending.matchId !== this.team.match.matchId)
                throw Error('arena_intent_stale');
            return this.swapIn(epoch, pending.holobotId);
        });
    }
    /** Explicitly abandon an unresolved swap intent. The host state stays the truth on the next resume. Single-flight:
     * it cannot clear an intent while a swap or retry is in flight. */
    discardPendingSwap() {
        return this.run(async () => {
            if (!this.intents)
                throw Error('arena_3v3_unavailable');
            await this.intents.set(null);
        });
    }
    cancel(playerFinalHealth?: number) { return this.operation('cancel', playerFinalHealth === undefined ? {} : { playerFinalHealth }); }
    private operation(op: string, fields: Record<string, unknown> = {}) { return this.run(epoch => { const matchId = this.latest?.matchId; if (!matchId)
        throw Error('arena_not_admitted'); return this.request(op, { matchId, ...fields }, epoch, matchId); }); }
}
/** Why the host paid nothing on a settled match (host #143): the per-account UTC-day payout cap, or a loss reported
 * under the settle floor. Display only; the host already decided. */
export type ArenaPayoutWithheld = 'daily_cap' | 'under_floor';
/** Display only the recorded host receipt; no local estimated rewards or outcome. A payoutWithheld receipt is accepted
 * only with its two known reasons AND an all-zero settlement; anything else is unavailable, never guessed. */
export function arenaReceiptResult(reply: ArenaReply) {
    const receipt = record(reply.match?.settlementReceipt), settlement = record(receipt.settlement);
    if (reply.match?.state !== 'settled' || !['win', 'loss'].includes(String(receipt.outcome)) || !['awardedExp', 'syncPoints', 'holos'].every(k => integer(settlement[k])))
        throw Error('arena_result_unavailable');
    const blueprint = record(settlement.blueprints);
    if (settlement.blueprints !== null && (typeof blueprint.holobotKey !== 'string' || !integer(blueprint.amount)))
        throw Error('arena_result_unavailable');
    let payoutWithheld: ArenaPayoutWithheld | null = null;
    // Absent or null: paid normally (host #143 omits the key when nothing is withheld).
    if (settlement.payoutWithheld !== undefined && settlement.payoutWithheld !== null) {
        if (!['daily_cap', 'under_floor'].includes(String(settlement.payoutWithheld)) || settlement.blueprints !== null
            || !['exp', 'awardedExp', 'syncPoints', 'holos'].every(k => settlement[k] === 0))
            throw Error('arena_result_unavailable');
        payoutWithheld = settlement.payoutWithheld as ArenaPayoutWithheld;
    }
    return { didWin: receipt.outcome === 'win', payoutWithheld, rewards: { exp: Number(settlement.awardedExp), syncPoints: Number(settlement.syncPoints), holos: Number(settlement.holos), blueprintRewards: settlement.blueprints === null ? [] : [{ holobotKey: String(blueprint.holobotKey), amount: Number(blueprint.amount) }] } };
}
/** F7: the host receipt of a match closed WITHOUT a settle: a refund before start, or a forfeit with the HP it recorded. */
export type ArenaClosure =
    | { kind: 'refund'; method: 'tokens' | 'pass'; amount: number; expired: boolean }
    | { kind: 'forfeit'; holobotId: string; finalHealth: number | null; maxHealth: number | null; expired: boolean };
export function arenaClosureResult(reply: ArenaReply): ArenaClosure {
    const m = reply.match, receipt = record(m?.settlementReceipt);
    if (!m || !['cancelled', 'expired'].includes(m.state))
        throw Error('arena_result_unavailable');
    const expired = m.state === 'expired';
    if (receipt.outcome === 'cancelled_before_start') {
        const refund = record(receipt.refund);
        if (receipt.refunded !== true || !['tokens', 'pass'].includes(String(refund.method)) || !integer(refund.amount))
            throw Error('arena_result_unavailable');
        return { kind: 'refund', method: refund.method as 'tokens' | 'pass', amount: Number(refund.amount), expired };
    }
    if (receipt.outcome !== 'forfeit')
        throw Error('arena_result_unavailable');
    const vitals = record(record(receipt.finalVitals)[m.entrant.holobotId]);
    const known = number(vitals.currentHealth) && number(vitals.maxHealth, 1);
    return { kind: 'forfeit', holobotId: m.entrant.holobotId, finalHealth: known ? Number(vitals.currentHealth) : null, maxHealth: known ? Number(vitals.maxHealth) : null, expired };
}
/**
 * ANTICIPATED (host-economy-hardening-2, PR not open yet): an additive `payoutCapped` flag on the ISSUE reply when this
 * account already reached the daily CPU payout cap. Tolerant: only a literal `true` (on the reply or its match) means
 * capped; absent or anything else is UNKNOWN and is never read as "rewards available" or "capped".
 * TODO(host-economy-hardening-2): pin the exact field location once the host PR lands.
 */
export function arenaIssuePayoutCapped(reply: ArenaReply | null): boolean {
    const r = record(reply);
    return r.payoutCapped === true || record(r.match).payoutCapped === true;
}
