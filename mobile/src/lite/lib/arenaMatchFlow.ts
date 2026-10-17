/** Durable CPU Arena transport. No combat simulation or local reward writes. */
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
/** One in-flight command. Unknown issue outcome retains its exact persisted request. */
export class ArenaMatchFlow {
    private epoch = 0;
    private flight: Promise<ArenaReply> | null = null;
    private latest: ArenaReply | null = null;
    constructor(private call: (request: Record<string, unknown>) => Promise<unknown>, private storage: ArenaFlowStorage, private active: () => boolean) { }
    close() { this.epoch++; this.latest = null; }
    get reply() { return this.latest; }
    private run(work: (epoch: number) => Promise<ArenaReply>): Promise<ArenaReply> {
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
