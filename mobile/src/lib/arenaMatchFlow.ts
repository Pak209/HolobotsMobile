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
/** A callable error carrying a host rejectionCode is a final ruling: the intent was not applied. */
export function arenaHostRejection(e: unknown): string | null {
    const code = record(record(e).details).rejectionCode;
    return typeof code === 'string' ? code : null;
}
/** One in-flight command. Unknown issue outcome retains its exact persisted request. */
export class ArenaMatchFlow {
    private epoch = 0;
    private flight: Promise<unknown> | null = null;
    private latest: ArenaReply | null = null;
    private team: Arena3v3Reply | null = null;
    constructor(private call: (request: Record<string, unknown>) => Promise<unknown>, private storage: ArenaFlowStorage, private active: () => boolean, private intents?: Arena3v3IntentStorage) { }
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
        return reply;
    }
    resume() { return this.run(epoch => {const matchId=this.latest?.matchId;return this.request('resume', matchId?{matchId}:{}, epoch, matchId??undefined);}); }
    issue(input: ArenaIssue) {
        return this.run(async (epoch) => {
            const pending = await this.storage.get();
            if (pending && canonicalArenaValue(pending) !== canonicalArenaValue(input))
                throw Error('arena_issue_pending');
            if (!pending)
                await this.storage.set(input);
            if (epoch !== this.epoch || !this.active())
                throw Error('arena_session_changed');
            const reply = await this.request('issue', input, epoch, undefined, input);
            await this.storage.set(null);
            return reply;
        });
    }
    retryIssue() { return this.storage.get().then(p => { if (!p)
        throw Error('arena_no_pending_issue'); return this.issue(p); }); }
    start() { return this.operation('start'); }
    settle(report: {
        playerFinalHealth: number;
        opponentFinalHealth: number;
        combosCompleted: number;
        perfectDefenses: number;
    }) { return this.operation('settle', report); }
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
    /** Read this account's 3v3 match. No live caller until the host implements arena-match-3v3-1 (HELD). */
    resumeTeam() {
        return this.run(async (epoch) => {
            const matchId = this.team?.matchId ?? undefined;
            this.team = await this.teamRequest({ schemaVersion: ARENA_3V3_SCHEMA, operation: 'resume', ...(matchId ? { matchId } : {}) }, epoch, { matchId });
            return this.team;
        });
    }
    /** Swap intent THROUGH THE HOST. The exact body is persisted before sending and retried unchanged.
     * Nothing changes locally until the host replies; a host refusal clears the intent and leaves the state as it was. */
    swap(holobotId: string) {
        return this.run(async (epoch) => {
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
        });
    }
    /** Resend the stored swap body unchanged, or fail. Never builds a new intent. */
    async retrySwap() {
        const pending = this.intents ? await this.intents.get() : null;
        if (!this.intents)
            throw Error('arena_3v3_unavailable');
        if (!pending)
            throw Error('arena_no_pending_intent');
        // Cold start: resume first. Only a KNOWN current match that differs makes the stored intent stale.
        if (!this.team?.match)
            throw Error('arena_not_admitted');
        if (pending.matchId !== this.team.match.matchId)
            throw Error('arena_intent_stale');
        return this.swap(pending.holobotId);
    }
    /** Explicitly abandon an unresolved swap intent. The host state stays the truth on the next resume. */
    async discardPendingSwap() {
        if (!this.intents)
            throw Error('arena_3v3_unavailable');
        await this.intents.set(null);
    }
    cancel(playerFinalHealth?: number) { return this.operation('cancel', playerFinalHealth === undefined ? {} : { playerFinalHealth }); }
    private operation(op: string, fields: Record<string, unknown> = {}) { return this.run(epoch => { const matchId = this.latest?.matchId; if (!matchId)
        throw Error('arena_not_admitted'); return this.request(op, { matchId, ...fields }, epoch, matchId); }); }
}
/** Display only the recorded host receipt; no local estimated rewards or outcome. */
export function arenaReceiptResult(reply: ArenaReply) {
    const receipt = record(reply.match?.settlementReceipt), settlement = record(receipt.settlement);
    if (reply.match?.state !== 'settled' || !['win', 'loss'].includes(String(receipt.outcome)) || !['awardedExp', 'syncPoints', 'holos'].every(k => integer(settlement[k])))
        throw Error('arena_result_unavailable');
    const blueprint = record(settlement.blueprints);
    if (settlement.blueprints !== null && (typeof blueprint.holobotKey !== 'string' || !integer(blueprint.amount)))
        throw Error('arena_result_unavailable');
    return { didWin: receipt.outcome === 'win', rewards: { exp: Number(settlement.awardedExp), syncPoints: Number(settlement.syncPoints), holos: Number(settlement.holos), blueprintRewards: settlement.blueprints === null ? [] : [{ holobotKey: String(blueprint.holobotKey), amount: Number(blueprint.amount) }] } };
}
