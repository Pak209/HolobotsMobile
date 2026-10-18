/** arena-match-3v3-1 strict reader and bench presenter (PROPOSAL contract, HolobotsMobile #134).
 * No host implements 3v3 yet and nothing calls this live. The host owns every vital, the turn, the phase
 * and the outcome. This module only reads the reply and never derives HP, STA, regen or level. */
export const ARENA_3V3_SCHEMA = 'arena-match-3v3-1';
export const ARENA_3V3_UNAVAILABLE_COPY = '3v3 isn’t open yet. The Arena host admits one fighter per match today, so 3v3 can’t start and nothing is charged.';
export type Arena3v3Status = 'active' | 'bench' | 'ko';
export type Arena3v3Phase = 'ready' | 'command' | 'send_in' | 'over';
export type Arena3v3Slot = {
    slot: 0 | 1 | 2;
    fighter: { holobotId: string; level: number; displayName: string; tier: number };
    vitals: { currentHealth: number; maxHealth: number };
    status: Arena3v3Status;
};
export type Arena3v3Battle = { turn: number; phase: Arena3v3Phase; activeSlot: 0 | 1 | 2; opponentActiveSlot: 0 | 1 | 2; voluntarySwapsUsed: number; winner: null | 'player' | 'opponent' };
export type Arena3v3Match = {
    schemaVersion: typeof ARENA_3V3_SCHEMA;
    matchId: string;
    requestId: string;
    format: '3v3';
    state: 'issued' | 'active' | 'settled' | 'cancelled' | 'expired';
    tierId: string;
    issuedAtMs: number;
    expiresAtMs: number;
    startedAtMs: number | null;
    closedAtMs: number | null;
    team: Arena3v3Slot[];
    opponentTeam: Arena3v3Slot[];
    battle: Arena3v3Battle;
    entryReceipt: { matchId: string; method: 'tokens' | 'pass'; amount: number; balanceBefore: number; balanceAfter: number; chargedAtMs: number };
    rules: Record<string, unknown> & { voluntarySwapLimit: number };
    settlementReceipt: Record<string, unknown> | null;
};
export type Arena3v3Intent = { intentId: string; operation: 'report' | 'swap'; appliedTurn: number };
export type Arena3v3Reply = { schemaVersion: typeof ARENA_3V3_SCHEMA; matchId: string | null; alreadyProcessed: boolean; intent: Arena3v3Intent | null; match: Arena3v3Match | null };
/** The exact swap body the flow persists before sending, and retries unchanged. */
export type Arena3v3Swap = { schemaVersion: typeof ARENA_3V3_SCHEMA; operation: 'swap'; matchId: string; intentId: string; turn: number; holobotId: string };

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const isRecord = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min;
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const exactKeys = (v: unknown, keys: string[], optional: string[] = []) => isRecord(v) && Object.keys(v as object).every(k => keys.includes(k) || optional.includes(k)) && keys.every(k => Object.hasOwn(v as object, k));
const ID = /^a3_[a-f0-9]{32}$/, TOKEN = /^[A-Za-z0-9_-]{8,80}$/, BOT = /^[a-z][a-z0-9_]{0,39}$/;
const MATCH_KEYS = ['schemaVersion', 'matchId', 'requestId', 'format', 'state', 'tierId', 'issuedAtMs', 'expiresAtMs', 'startedAtMs', 'closedAtMs', 'team', 'opponentTeam', 'battle', 'entryReceipt', 'rules', 'settlementReceipt'];
const fail = (code = 'arena_3v3_reply_invalid'): never => { throw Error(code); };

function team(raw: unknown): Arena3v3Slot[] {
    if (!Array.isArray(raw) || raw.length !== 3) return fail();
    raw.forEach((s, i) => {
        const f = record(s.fighter), v = record(s.vitals);
        // `combat` is optional frozen sim input; presentation never reads it. No stamina key is ever accepted.
        if (!exactKeys(s, ['slot', 'fighter', 'vitals', 'status'], ['combat']) || s.slot !== i || (s.combat !== undefined && !isRecord(s.combat))
            || !exactKeys(f, ['holobotId', 'level', 'displayName', 'tier']) || typeof f.holobotId !== 'string' || !BOT.test(f.holobotId)
            || f.displayName !== f.holobotId.toUpperCase() || !integer(f.level, 1, 99) || !integer(f.tier, 0, 1000000)
            || !exactKeys(v, ['currentHealth', 'maxHealth']) || !finite(v.maxHealth) || v.maxHealth <= 0 || !finite(v.currentHealth) || v.currentHealth > v.maxHealth
            || !['active', 'bench', 'ko'].includes(s.status) || (s.status === 'ko') !== (v.currentHealth === 0)) fail();
    });
    if (new Set(raw.map(s => s.fighter.holobotId)).size !== 3) fail();
    return raw as Arena3v3Slot[];
}
/** Strict arena-match-3v3-1 reply reader. Throws instead of falling back to any local or default value. */
export function readArena3v3Reply(raw: unknown, expect: { matchId?: string; intent?: { intentId: string; operation: 'report' | 'swap' } } = {}): Arena3v3Reply {
    const r = record(raw);
    if (!exactKeys(r, ['schemaVersion', 'matchId', 'alreadyProcessed', 'intent', 'match']) || r.schemaVersion !== ARENA_3V3_SCHEMA || typeof r.alreadyProcessed !== 'boolean') return fail();
    if (r.match === null) {
        if (r.matchId !== null || r.intent !== null || r.alreadyProcessed !== true || expect.matchId || expect.intent) fail();
        return r as unknown as Arena3v3Reply;
    }
    const m = record(r.match);
    if (!exactKeys(m, MATCH_KEYS) || typeof r.matchId !== 'string' || !ID.test(r.matchId) || m.matchId !== r.matchId || (expect.matchId && r.matchId !== expect.matchId)
        || m.schemaVersion !== ARENA_3V3_SCHEMA || m.format !== '3v3' || typeof m.requestId !== 'string' || !TOKEN.test(m.requestId)
        || !['rookie', 'challenger', 'elite', 'legend'].includes(String(m.tierId)) || !['issued', 'active', 'settled', 'cancelled', 'expired'].includes(String(m.state))
        || !integer(m.issuedAtMs) || !integer(m.expiresAtMs) || m.expiresAtMs <= m.issuedAtMs
        || !(m.startedAtMs === null || integer(m.startedAtMs)) || !(m.closedAtMs === null || integer(m.closedAtMs))) return fail();
    const mine = team(m.team), theirs = team(m.opponentTeam), b = record(m.battle), rules = record(m.rules), entry = record(m.entryReceipt);
    if (rules.version !== 'arena-3v3-rules-1' || rules.teamSize !== 3 || rules.benchRegen !== 'none' || rules.sendIn !== 'forced_on_ko' || rules.opponentSendIn !== 'next_alive_slot'
        || !integer(rules.voluntarySwapLimit, 0, 10) || !integer(rules.entryFeeHolos, 1)) fail();
    if (!exactKeys(b, ['turn', 'phase', 'activeSlot', 'opponentActiveSlot', 'voluntarySwapsUsed', 'winner']) || !integer(b.turn, 0, 1000)
        || !['ready', 'command', 'send_in', 'over'].includes(String(b.phase)) || !integer(b.activeSlot, 0, 2) || !integer(b.opponentActiveSlot, 0, 2)
        || !integer(b.voluntarySwapsUsed, 0, Number(rules.voluntarySwapLimit)) || (b.phase === 'over') !== (b.winner === 'player' || b.winner === 'opponent') || (b.phase !== 'over' && b.winner !== null)) fail();
    const actives = (t: Arena3v3Slot[]) => t.filter(s => s.status === 'active').length;
    if (b.phase === 'ready' || b.phase === 'command') { if (actives(mine) !== 1 || mine[Number(b.activeSlot)].status !== 'active') fail(); }
    if (b.phase === 'send_in' && (actives(mine) !== 0 || mine[Number(b.activeSlot)].status !== 'ko' || !mine.some(s => s.status === 'bench'))) fail();
    if (b.phase !== 'over' && (actives(theirs) !== 1 || theirs[Number(b.opponentActiveSlot)].status !== 'active')) fail();
    if (b.winner === 'player' && theirs.some(s => s.status !== 'ko')) fail();
    if (b.winner === 'opponent' && mine.some(s => s.status !== 'ko')) fail();
    if (m.state === 'issued' && (b.phase !== 'ready' || b.turn !== 0 || m.startedAtMs !== null)) fail();
    if (m.state === 'active' && (b.phase === 'ready' || m.startedAtMs === null)) fail();
    // ONE entry charge for the whole match.
    if (!exactKeys(entry, ['matchId', 'method', 'amount', 'balanceBefore', 'balanceAfter', 'chargedAtMs']) || entry.matchId !== m.matchId || !['tokens', 'pass'].includes(String(entry.method))
        || !integer(entry.amount, 1) || entry.amount !== (entry.method === 'pass' ? 1 : rules.entryFeeHolos) || !integer(entry.balanceBefore) || !integer(entry.balanceAfter)
        || entry.balanceBefore - entry.amount !== entry.balanceAfter || entry.chargedAtMs !== m.issuedAtMs) fail('arena_receipt_invalid');
    const terminal = ['settled', 'cancelled', 'expired'].includes(String(m.state)), receipt = record(m.settlementReceipt);
    if (!terminal && (m.settlementReceipt !== null || m.closedAtMs !== null)) fail('arena_receipt_invalid');
    if (terminal) {
        const outcome = String(receipt.outcome), finalVitals = record(receipt.finalVitals);
        if (receipt.matchId !== m.matchId || !['win', 'loss', 'forfeit', 'cancelled_before_start'].includes(outcome) || receipt.closedAtMs !== m.closedAtMs) fail('arena_receipt_invalid');
        if (m.state === 'settled' && (b.phase !== 'over' || outcome !== (b.winner === 'player' ? 'win' : 'loss'))) fail('arena_receipt_invalid');
        // The host writes its own vitals for all three bots; the receipt must agree with the projection.
        if (outcome !== 'cancelled_before_start' && (Object.keys(finalVitals).length !== 3
            || mine.some(s => { const v = record(finalVitals[s.fighter.holobotId]); return !exactKeys(v, ['currentHealth', 'maxHealth']) || v.currentHealth !== s.vitals.currentHealth || v.maxHealth !== s.vitals.maxHealth; }))) fail('arena_receipt_invalid');
    }
    if (r.intent !== null) {
        const i = record(r.intent);
        if (!exactKeys(i, ['intentId', 'operation', 'appliedTurn']) || typeof i.intentId !== 'string' || !TOKEN.test(i.intentId) || !['report', 'swap'].includes(String(i.operation))
            || !integer(i.appliedTurn) || i.appliedTurn >= Number(b.turn)) fail();
    }
    if (expect.intent && (r.intent === null || record(r.intent).intentId !== expect.intent.intentId || record(r.intent).operation !== expect.intent.operation)) fail('arena_3v3_intent_mismatch');
    return r as unknown as Arena3v3Reply;
}

export type ArenaBenchCard = {
    slot: 0 | 1 | 2;
    holobotId: string;
    name: string;
    /** Host #118 level badge only ("LV 4"). */
    levelBadge: string;
    role: 'ACTIVE' | 'BENCH' | 'KO';
    /** Host HP, copied. The bar width is the host's own current/max ratio; no HP is derived or regenerated. */
    currentHealth: number;
    maxHealth: number;
    hpLabel: string;
};
/** Three cards, the active slot first and then the bench in slot order. Pure function of the host projection. */
export function arenaBenchCards(match: Arena3v3Match): ArenaBenchCard[] {
    const at = match.battle.activeSlot, order = [at, ...[0, 1, 2].filter(i => i !== at)];
    return order.map(i => {
        const s = match.team[i];
        return {
            slot: s.slot, holobotId: s.fighter.holobotId, name: s.fighter.displayName, levelBadge: `LV ${s.fighter.level}`,
            role: s.status === 'ko' ? 'KO' : s.status === 'active' ? 'ACTIVE' : 'BENCH',
            currentHealth: s.vitals.currentHealth, maxHealth: s.vitals.maxHealth, hpLabel: `${s.vitals.currentHealth} / ${s.vitals.maxHealth}`,
        };
    });
}
/** One honest line for the bench header, from host phase and turn only. */
export function arenaBenchPhaseLine(match: Arena3v3Match): string {
    const b = match.battle;
    if (match.state === 'settled') return `HOST SETTLED · ${b.winner === 'player' ? 'WIN' : 'LOSS'}`;
    if (match.state === 'cancelled' || match.state === 'expired') return `HOST CLOSED · ${match.state.toUpperCase()}`;
    if (b.phase === 'ready') return 'ADMITTED · WAITING FOR START';
    if (b.phase === 'send_in') return `HOST TURN ${b.turn} · SEND IN A FIGHTER`;
    if (b.phase === 'over') return `HOST TURN ${b.turn} · MATCH OVER · ${b.winner === 'player' ? 'WIN' : 'LOSS'}`;
    return `HOST TURN ${b.turn} · SWAPS ${b.voluntarySwapsUsed}/${match.rules.voluntarySwapLimit}`;
}
