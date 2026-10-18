/** arena-match-3v3-1 strict reader and bench presenter (PROPOSAL contract, HolobotsMobile #134).
 * No host implements 3v3 yet and nothing calls this live. The host owns every vital, the turn, the phase
 * and the outcome. This module only reads the reply and never derives HP, STA, regen or level. */
export const ARENA_3V3_SCHEMA = 'arena-match-3v3-1';
/** Every player-visible 3v3 string. PLACEHOLDER copy until Lex. Per DECISIONS #71 the on-screen authority is
 * "the City"; the word "host" never appears on screen (code identifiers and comments may keep it). */
export const ARENA_3V3_COPY = {
    unavailable: '3v3 isn’t open yet. The City admits one fighter per match today, so 3v3 can’t start and nothing is charged.',
    benchLabel: '3v3 bench, City roster',
    swapIn: 'SWAP IN',
    asking: 'ASKING THE CITY…',
    askLabel: (name: string) => `Ask the City to swap in ${name}`,
    buddyLabel: 'BUDDY',
    buddyEmpty: 'NO BUDDY UNIT FROM YOUR ACCOUNT YET',
    admitted: 'ADMITTED · WAITING FOR START',
    turn: (turn: number) => `TURN ${turn}`,
    sendIn: 'SEND IN A FIGHTER',
    swaps: (used: number, limit: number) => `SWAPS ${used}/${limit}`,
    over: 'MATCH OVER',
    receipt: (won: boolean) => `CITY RECEIPT · ${won ? 'WIN' : 'LOSS'}`,
    closed: (state: string) => `CITY CLOSED · ${state.toUpperCase()}`,
} as const;
export const ARENA_3V3_UNAVAILABLE_COPY = ARENA_3V3_COPY.unavailable;
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
    rules: Record<string, unknown> & { voluntarySwapLimit: number; entryFeeHolos: number; entryFeePasses: number };
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
const fraction = (v: unknown) => finite(v) && v <= 1;
const exactKeys = (v: unknown, keys: string[], optional: string[] = []) => isRecord(v) && Object.keys(v as object).every(k => keys.includes(k) || optional.includes(k)) && keys.every(k => Object.hasOwn(v as object, k));
const ID = /^a3_[a-f0-9]{32}$/, TOKEN = /^[A-Za-z0-9_-]{8,80}$/, BOT = /^[a-z][a-z0-9_]{0,39}$/;
const MATCH_KEYS = ['schemaVersion', 'matchId', 'requestId', 'format', 'state', 'tierId', 'issuedAtMs', 'expiresAtMs', 'startedAtMs', 'closedAtMs', 'team', 'opponentTeam', 'battle', 'entryReceipt', 'rules', 'settlementReceipt'];
const QUOTE_KEYS = ['entryFeeHolos', 'exp', 'holos', 'syncPoints', 'blueprints'];
const RULE_KEYS = ['version', 'teamSize', 'entryFeePasses', ...QUOTE_KEYS, 'comboBonus', 'perfectDefenseBonus', 'lossExpFraction', 'lossSyncFraction', 'maxPerformanceEvents', 'expBoosterMultiplier', 'voluntarySwapLimit', 'benchRegen', 'sendIn', 'opponentSendIn'];
const fail = (code = 'arena_3v3_reply_invalid'): never => { throw Error(code); };

function team(raw: unknown): Arena3v3Slot[] {
    if (!Array.isArray(raw) || raw.length !== 3) return fail();
    raw.forEach((s, i) => {
        const f = record(s?.fighter), v = record(s?.vitals);
        // Exactly the contract keys: no stamina, combat or charge field can ride along on a slot.
        if (!exactKeys(s, ['slot', 'fighter', 'vitals', 'status']) || s.slot !== i
            || !exactKeys(f, ['holobotId', 'level', 'displayName', 'tier']) || typeof f.holobotId !== 'string' || !BOT.test(f.holobotId)
            || f.displayName !== f.holobotId.toUpperCase() || !integer(f.level, 1, 99) || !integer(f.tier, 0, 1000000)
            || !exactKeys(v, ['currentHealth', 'maxHealth']) || !finite(v.maxHealth) || v.maxHealth <= 0 || !finite(v.currentHealth) || v.currentHealth > v.maxHealth
            || !['active', 'bench', 'ko'].includes(s.status) || (s.status === 'ko') !== (v.currentHealth === 0)) fail();
    });
    if (new Set(raw.map(s => s.fighter.holobotId)).size !== 3) fail();
    return raw as Arena3v3Slot[];
}
function rulesQuote(raw: unknown) {
    const r = record(raw);
    if (!exactKeys(r, RULE_KEYS) || r.version !== 'arena-3v3-rules-1' || r.teamSize !== 3 || r.benchRegen !== 'none' || r.sendIn !== 'forced_on_ko' || r.opponentSendIn !== 'next_alive_slot'
        || !integer(r.entryFeeHolos, 1, 1000000) || !integer(r.entryFeePasses, 1, 1000) || !QUOTE_KEYS.every(k => integer(r[k], 0, 1000000))
        || !['comboBonus', 'perfectDefenseBonus', 'lossExpFraction', 'lossSyncFraction'].every(k => fraction(r[k]))
        || !integer(r.maxPerformanceEvents, 0, 25) || !integer(r.expBoosterMultiplier, 1, 10) || !integer(r.voluntarySwapLimit, 0, 10)) fail();
    return r;
}
const counts = (v: unknown) => { const c = record(v); return exactKeys(c, ['combosCompleted', 'perfectDefenses']) && integer(c.combosCompleted, 0, 25) && integer(c.perfectDefenses, 0, 25); };
/** Terminal receipt, at parity with the contract's settlementReceipt and its outcome couplings. */
function receipt(m: Record<string, unknown>, mine: Arena3v3Slot[], b: Record<string, unknown>, entry: Record<string, unknown>) {
    const r = record(m.settlementReceipt), outcome = String(r.outcome), finalVitals = record(r.finalVitals);
    const bad = () => fail('arena_receipt_invalid');
    if (!exactKeys(r, ['matchId', 'outcome', 'refunded', 'settlement', 'report', 'finalVitals', 'closedAtMs'], ['refund']) || r.matchId !== m.matchId
        || !['win', 'loss', 'forfeit', 'cancelled_before_start'].includes(outcome) || !integer(m.closedAtMs) || r.closedAtMs !== m.closedAtMs || m.closedAtMs < Number(m.issuedAtMs)) bad();
    if (m.state === 'settled' ? outcome !== (b.winner === 'player' ? 'win' : 'loss') || b.phase !== 'over' || m.startedAtMs === null : !['forfeit', 'cancelled_before_start'].includes(outcome)) bad();
    if (outcome === 'cancelled_before_start') {
        const refund = record(r.refund);
        if (m.startedAtMs !== null || b.phase !== 'ready' || b.turn !== 0 || r.refunded !== true || r.settlement !== null || r.report !== null || r.finalVitals !== null
            || !exactKeys(refund, ['method', 'amount', 'balanceBefore', 'balanceAfter']) || refund.method !== entry.method || refund.amount !== entry.amount
            || !integer(refund.balanceBefore) || !integer(refund.balanceAfter) || refund.balanceAfter - refund.balanceBefore !== refund.amount) bad();
        return;
    }
    // The host writes its own vitals for all three bots; the receipt must agree with the projection.
    if (r.refunded !== false || Object.hasOwn(r, 'refund') || Object.keys(finalVitals).length !== 3
        || mine.some(s => { const v = record(finalVitals[s.fighter.holobotId]); return !exactKeys(v, ['currentHealth', 'maxHealth']) || v.currentHealth !== s.vitals.currentHealth || v.maxHealth !== s.vitals.maxHealth; })) bad();
    if (outcome === 'forfeit') {
        // A forfeit writes vitals only: no settlement and no performance report.
        if (m.startedAtMs === null || b.winner !== null || !['command', 'send_in'].includes(String(b.phase)) || r.settlement !== null || r.report !== null) bad();
        return;
    }
    const s = record(r.settlement), blueprint = s.blueprints, bot = (v: unknown) => typeof v === 'string' && BOT.test(v);
    if (!exactKeys(s, ['exp', 'awardedExp', 'holos', 'syncPoints', 'blueprints', 'experience']) || !['exp', 'awardedExp', 'holos', 'syncPoints'].every(k => integer(s[k]))
        || !(blueprint === null || (exactKeys(blueprint, ['holobotKey', 'amount']) && bot(record(blueprint).holobotKey) && integer(record(blueprint).amount, 1)))
        || !Array.isArray(s.experience) || !s.experience.length || s.experience.length > 3 || !s.experience.every(e => exactKeys(e, ['holobotId', 'awardedExp']) && bot(e.holobotId) && integer(e.awardedExp))
        || (outcome === 'loss' && (s.holos !== 0 || blueprint !== null))
        || !counts(r.report)) bad();
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
    const mine = team(m.team), theirs = team(m.opponentTeam), b = record(m.battle), rules = rulesQuote(m.rules), entry = record(m.entryReceipt);
    if (!exactKeys(b, ['turn', 'phase', 'activeSlot', 'opponentActiveSlot', 'voluntarySwapsUsed', 'winner']) || !integer(b.turn, 0, 1000)
        || !['ready', 'command', 'send_in', 'over'].includes(String(b.phase)) || !integer(b.activeSlot, 0, 2) || !integer(b.opponentActiveSlot, 0, 2)
        || !integer(b.voluntarySwapsUsed, 0, Number(rules.voluntarySwapLimit)) || (b.phase === 'over') !== (b.winner === 'player' || b.winner === 'opponent') || (b.phase !== 'over' && b.winner !== null)) fail();
    const actives = (t: Arena3v3Slot[]) => t.filter(s => s.status === 'active').length;
    if (b.phase === 'ready' || b.phase === 'command') { if (actives(mine) !== 1 || mine[Number(b.activeSlot)].status !== 'active') fail(); }
    if (b.phase === 'send_in' && (actives(mine) !== 0 || mine[Number(b.activeSlot)].status !== 'ko' || !mine.some(s => s.status === 'bench'))) fail();
    if (b.phase !== 'over' && (actives(theirs) !== 1 || theirs[Number(b.opponentActiveSlot)].status !== 'active')) fail();
    // A decided winner: the losing side is all KO'd and the winning side still has a fighter (no double wipe).
    if (b.winner === 'player' && (theirs.some(s => s.status !== 'ko') || mine.every(s => s.status === 'ko'))) fail();
    if (b.winner === 'opponent' && (mine.some(s => s.status !== 'ko') || theirs.every(s => s.status === 'ko'))) fail();
    if (m.state === 'issued' && (b.phase !== 'ready' || b.turn !== 0 || m.startedAtMs !== null)) fail();
    if (m.state === 'active' && (b.phase === 'ready' || m.startedAtMs === null)) fail();
    // ONE entry charge for the whole match, at the host-frozen price (Holos or pass); the client assumes no price.
    if (!exactKeys(entry, ['matchId', 'method', 'amount', 'balanceBefore', 'balanceAfter', 'chargedAtMs']) || entry.matchId !== m.matchId || !['tokens', 'pass'].includes(String(entry.method))
        || !integer(entry.amount, 1) || entry.amount !== (entry.method === 'pass' ? rules.entryFeePasses : rules.entryFeeHolos) || !integer(entry.balanceBefore) || !integer(entry.balanceAfter)
        || entry.balanceBefore - entry.amount !== entry.balanceAfter || entry.chargedAtMs !== m.issuedAtMs) fail('arena_receipt_invalid');
    if (['settled', 'cancelled', 'expired'].includes(String(m.state))) receipt(m, mine, b, entry);
    else if (m.settlementReceipt !== null || m.closedAtMs !== null) fail('arena_receipt_invalid');
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
    /** On-card tag: ACTIVE, KO, or BENCH 1 / BENCH 2 by position on the bench (1-indexed, never a slot index). */
    label: string;
    /** Host HP, copied. The bar width is the host's own current/max ratio; no HP is derived or regenerated. */
    currentHealth: number;
    maxHealth: number;
    hpLabel: string;
};
/** Three cards, the active slot first and then the bench in slot order. Pure function of the host projection. */
export function arenaBenchCards(match: Arena3v3Match): ArenaBenchCard[] {
    const at = match.battle.activeSlot, order = [at, ...[0, 1, 2].filter(i => i !== at)];
    return order.map((i, position) => {
        const s = match.team[i], role = s.status === 'ko' ? 'KO' : s.status === 'active' ? 'ACTIVE' : 'BENCH';
        return {
            slot: s.slot, holobotId: s.fighter.holobotId, name: s.fighter.displayName, levelBadge: `LV ${s.fighter.level}`,
            role, label: role === 'BENCH' ? `BENCH ${position}` : role,
            currentHealth: s.vitals.currentHealth, maxHealth: s.vitals.maxHealth, hpLabel: `${s.vitals.currentHealth} / ${s.vitals.maxHealth}`,
        };
    });
}
/** One honest line for the bench header, from host state, phase and turn only. */
export function arenaBenchPhaseLine(match: Arena3v3Match): string {
    const b = match.battle, c = ARENA_3V3_COPY;
    if (match.state === 'settled') return c.receipt(b.winner === 'player');
    if (match.state === 'cancelled' || match.state === 'expired') return c.closed(match.state);
    if (b.phase === 'ready') return c.admitted;
    if (b.phase === 'send_in') return `${c.turn(b.turn)} · ${c.sendIn}`;
    if (b.phase === 'over') return `${c.turn(b.turn)} · ${c.over} · ${b.winner === 'player' ? 'WIN' : 'LOSS'}`;
    return `${c.turn(b.turn)} · ${c.swaps(b.voluntarySwapsUsed, match.rules.voluntarySwapLimit)}`;
}
/** BUDDY strip above the bench (DECISIONS #71). arena-match-3v3-1 carries no Buddy Unit data, and the strict reader
 * refuses unknown keys, so this is always the honest empty slot. It never shows a local or default buddy. */
export function arenaBuddySlot(_match: Arena3v3Match): { kind: 'empty'; label: string; line: string } {
    return { kind: 'empty', label: ARENA_3V3_COPY.buddyLabel, line: ARENA_3V3_COPY.buddyEmpty };
}
