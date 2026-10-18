import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ArenaMatchFlow, arenaClosureResult, arenaIssuePayoutCapped, arenaReceiptResult, readArenaReply, type ArenaIssue, type ArenaReply } from '../arenaMatchFlow';
import { ARENA_SCREEN_COPY, arenaErrorCode, arenaErrorCopy, arenaForfeitHp, arenaQuitPrompt, arenaScreenPhase } from '../arenaCopy';
import { hostKnockedOut, readHostVitals } from '../arenaVitals';
import { ARENA_ISSUE_REQUEST, ARENA_ISSUED, ARENA_SETTLED, ARENA_STARTED, arenaForfeitReply, arenaPayoutCappedIssue, arenaRefundReply, arenaRefusal, arenaWithheldReply, tooFast } from '../../qa/arenaPolishFixtures';

function setup(call: (r: Record<string, unknown>) => Promise<unknown>) {
    let pending: ArenaIssue | null = null, ack: string | null = null;
    const flow = new ArenaMatchFlow(call, { get: async () => pending, set: async v => { pending = v; } }, () => true, undefined, { acks: { get: async () => ack, set: async v => { ack = v; } } });
    return { flow, pending: () => pending, setPending: (v: ArenaIssue | null) => { pending = v; } };
}
const idle = { kind: 'idle' } as const;
const phase = (over: Partial<Parameters<typeof arenaScreenPhase>[0]>) => arenaScreenPhase({ reply: null, acknowledged: false, hasCheckpoint: false, settle: idle, pendingIssue: false, error: null, ...over });

describe('F2: a definite refusal never wedges admission', () => {
    it.each(['insufficient_funds', 'holobot_ko', 'activity_conflict', 'invalid_request'])('clears the stored issue on %s', async (code) => {
        const { flow, pending } = setup(async () => { throw arenaRefusal(code, code === 'invalid_request' ? 'invalid-argument' : 'failed-precondition'); });
        await expect(flow.issue(ARENA_ISSUE_REQUEST)).rejects.toThrow(code);
        expect(pending()).toBeNull();
        // ...so the next pick is not blocked by arena_issue_pending.
        await expect(flow.issue({ ...ARENA_ISSUE_REQUEST, requestId: 'lite_arena_next_pick' })).rejects.toThrow(code);
    });
    it.each([['unavailable', 'unavailable'], ['deadline', 'deadline-exceeded']])('keeps it on %s (outcome unknown)', async (code, https) => {
        const { flow, pending } = setup(async () => { throw arenaRefusal(code, https); });
        await expect(flow.issue(ARENA_ISSUE_REQUEST)).rejects.toThrow();
        expect(pending()).toEqual(ARENA_ISSUE_REQUEST);
    });
    it('keeps it on a timeout / dropped reply, and the explicit discard clears it', async () => {
        const { flow, pending } = setup(async () => { throw Error('Arena confirmation delayed. Resume or retry the same admission.'); });
        await expect(flow.issue(ARENA_ISSUE_REQUEST)).rejects.toThrow();
        expect(pending()).toEqual(ARENA_ISSUE_REQUEST);
        await expect(flow.issue({ ...ARENA_ISSUE_REQUEST, requestId: 'lite_arena_other' })).rejects.toThrow('arena_issue_pending');
        await flow.discardPendingIssue();
        expect(pending()).toBeNull();
    });
    it('a reply admitting the stored requestId resolves it (resume after a lost issue reply)', async () => {
        const { flow, pending, setPending } = setup(async () => ARENA_ISSUED);
        setPending(ARENA_ISSUE_REQUEST);
        await flow.resume();
        expect(pending()).toBeNull();
    });
    it('with no OPEN match known, resume discovers the latest match instead of pinning a closed one', async () => {
        const call = vi.fn(async (r: Record<string, unknown>) => r.operation === 'resume' && !r.matchId ? ARENA_ISSUED : ARENA_SETTLED);
        const { flow } = setup(call);
        await flow.resume(); // issued (open): pinned from now on
        await flow.resume();
        expect(call.mock.calls[1][0]).toEqual({ schemaVersion: 'arena-match-1', operation: 'resume', matchId: ARENA_ISSUED.matchId });
        const closed = setup(vi.fn(async () => ARENA_SETTLED));
        await closed.flow.resume();
        await closed.flow.resume();
        expect((closed.flow as any).call.mock.calls[1][0]).toEqual({ schemaVersion: 'arena-match-1', operation: 'resume' });
    });
    it('the picker KO guard reads only the City ledger; unknown is never KO', () => {
        expect(hostKnockedOut(readHostVitals({ ace: { currentHealth: 0, maxHealth: 172 } }), 'ace')).toBe(true);
        expect(hostKnockedOut(readHostVitals({ ace: { currentHealth: 40, maxHealth: 172 } }), 'ace')).toBe(false);
        expect(hostKnockedOut(readHostVitals({ kuma: { currentHealth: 0, maxHealth: 172 } }), 'ace')).toBe(false);
        expect(readHostVitals({ ace: { currentHealth: -1, maxHealth: 172 } })).toBeNull();
        expect(readHostVitals('nope')).toBeNull();
        expect(hostKnockedOut(null, 'ace')).toBe(false);
        expect(arenaErrorCopy(arenaRefusal('holobot_ko')).body).toMatch(/Heal it/);
    });
});

describe('F3: a lost start reply never forces a 0-HP forfeit', () => {
    it('an active match with no checkpoint is the "interrupted" admitted state, not an error', () => {
        expect(phase({ reply: ARENA_STARTED })).toEqual({ kind: 'admitted', interrupted: true });
        expect(phase({ reply: ARENA_ISSUED })).toEqual({ kind: 'admitted', interrupted: false });
    });
    it('a forfeit reports the checkpoint, else the saved result, else the admission HP (never 0 by default)', () => {
        const admissionHp = ARENA_STARTED.match!.entrant.currentHealth!;
        expect(admissionHp).toBeGreaterThan(0);
        expect(arenaForfeitHp({ checkpointHp: null, pendingSettleHp: null, admissionHp })).toBe(admissionHp);
        expect(arenaForfeitHp({ checkpointHp: 12, pendingSettleHp: 30, admissionHp })).toBe(12);
        expect(arenaForfeitHp({ checkpointHp: null, pendingSettleHp: 30, admissionHp })).toBe(30);
    });
    it('the screen source restarts the practice from the admitted snapshot instead of throwing "Interrupted fight"', () => {
        const screen = readFileSync(fileURLToPath(new URL('../../screens/ArenaScreen.tsx', import.meta.url) as unknown as string), 'utf8');
        expect(screen).not.toContain('Interrupted fight');
        expect(screen).not.toMatch(/currentHP \?\? 0/);
        expect(screen).toContain('arenaForfeitHp(');
    });
});

describe('F4: a dismissed receipt is not re-opened on mount or foreground', () => {
    it('acknowledged terminal match -> menu; unacknowledged -> receipt', async () => {
        const { flow } = setup(async () => ARENA_SETTLED);
        const r = await flow.resume();
        expect(await flow.acknowledged(r)).toBe(false);
        expect(phase({ reply: r })).toEqual({ kind: 'receipt' });
        await flow.acknowledge(r.matchId!);
        expect(await flow.acknowledged(await flow.resume())).toBe(true);
        expect(phase({ reply: r, acknowledged: true })).toEqual({ kind: 'menu' });
    });
});

describe('F7 + (A)2: closures and withheld payouts are receipts with honest reasons', () => {
    it('accepts payoutWithheld daily_cap / under_floor only with an all-zero settlement', () => {
        expect(arenaReceiptResult(readArenaReply(arenaWithheldReply('daily_cap')))).toMatchObject({ didWin: true, payoutWithheld: 'daily_cap', rewards: { exp: 0, syncPoints: 0, holos: 0, blueprintRewards: [] } });
        expect(arenaReceiptResult(readArenaReply(arenaWithheldReply('under_floor')))).toMatchObject({ didWin: false, payoutWithheld: 'under_floor' });
        expect(arenaReceiptResult(readArenaReply(ARENA_SETTLED)).payoutWithheld).toBeNull();
        const unknown = arenaWithheldReply('daily_cap') as any; unknown.match.settlementReceipt.settlement.payoutWithheld = 'vip';
        expect(() => arenaReceiptResult(unknown)).toThrow('arena_result_unavailable');
        for (const k of ['exp', 'awardedExp', 'holos', 'syncPoints']) {
            const paid = arenaWithheldReply('daily_cap') as any; paid.match.settlementReceipt.settlement[k] = 5;
            expect(() => arenaReceiptResult(paid)).toThrow('arena_result_unavailable');
        }
        const bp = arenaWithheldReply('daily_cap') as any; bp.match.settlementReceipt.settlement.blueprints = { holobotKey: 'hare', amount: 5 };
        expect(() => arenaReceiptResult(bp)).toThrow('arena_result_unavailable');
    });
    it('refund and forfeit closures read the City receipt (refund amount; forfeit HP) and route to the closure screen', () => {
        const refund = readArenaReply(arenaRefundReply());
        expect(arenaClosureResult(refund)).toEqual({ kind: 'refund', method: ARENA_ISSUED.match!.entryReceipt.method, amount: ARENA_ISSUED.match!.entryReceipt.amount, expired: false });
        expect(phase({ reply: refund })).toEqual({ kind: 'closure' });
        const forfeit = readArenaReply(arenaForfeitReply(44));
        expect(arenaClosureResult(forfeit)).toMatchObject({ kind: 'forfeit', finalHealth: 44, maxHealth: ARENA_STARTED.match!.entrant.maxHealth });
        expect(() => arenaClosureResult(ARENA_SETTLED)).toThrow('arena_result_unavailable');
        // A terminal record the readers refuse is the unreadable interstitial, never a render-time throw.
        const odd = arenaRefundReply() as any; odd.match.settlementReceipt.outcome = 'win';
        expect(phase({ reply: odd })).toMatchObject({ kind: 'error', matchOpen: false, copy: { title: 'MATCH UNREADABLE' } });
    });
});

describe('(A)3 ANTICIPATED payoutCapped on the issue reply', () => {
    it('only a literal true means capped; absent means unknown (no notice, never assumed)', () => {
        expect(arenaIssuePayoutCapped(arenaPayoutCappedIssue())).toBe(true);
        expect(arenaIssuePayoutCapped({ ...ARENA_ISSUED, match: { ...ARENA_ISSUED.match!, payoutCapped: true } })).toBe(true);
        expect(arenaIssuePayoutCapped(ARENA_ISSUED)).toBe(false);
        expect(arenaIssuePayoutCapped({ ...ARENA_ISSUED, payoutCapped: 'true' } as unknown as ArenaReply)).toBe(false);
        expect(arenaIssuePayoutCapped(null)).toBe(false);
        // The reader keeps the additive key, so the screen can show the notice before START.
        expect(arenaIssuePayoutCapped(readArenaReply(arenaPayoutCappedIssue()))).toBe(true);
        expect(ARENA_SCREEN_COPY.payoutCapped).toBe('Daily Arena rewards reached · this match pays no rewards');
    });
    it('the screen stops before START when capped (it does not auto-launch past the notice)', () => {
        const screen = readFileSync(fileURLToPath(new URL('../../screens/ArenaScreen.tsx', import.meta.url) as unknown as string), 'utf8');
        expect(screen).toMatch(/if \(arenaIssuePayoutCapped\(r\)\) \{ setCappedMatchId\(r\.matchId\); return; \}\s*await launch\(\);/);
        expect(screen).toContain('notice={cappedMatchId === reply?.matchId ? COPY.payoutCapped : null}');
    });
});

describe('forfeit while a win is pending asks first', () => {
    it('the prompt names the unconfirmed win and needs an explicit confirm', () => {
        const p = arenaQuitPrompt({ state: 'active', pendingSettle: true, fighter: 'ACE', forfeitHp: 30 });
        expect(p.title).toBe('FORFEIT AN UNCONFIRMED WIN?');
        expect(p.body).toMatch(/hasn't confirmed your win/);
        expect(p.body).toContain('ACE keeps 30 HP');
        expect(p.confirm).not.toEqual(p.dismiss);
        expect(arenaQuitPrompt({ state: 'issued', pendingSettle: false, fighter: 'ACE', forfeitHp: null }).body).toMatch(/refunds/);
        expect(arenaQuitPrompt({ state: 'active', pendingSettle: false, fighter: 'ACE', forfeitHp: 30 }).title).toBe('FORFEIT THIS MATCH?');
    });
    it('every quit path in the screen goes through the in-app confirmation (no direct cancel)', () => {
        const screen = readFileSync(fileURLToPath(new URL('../../screens/ArenaScreen.tsx', import.meta.url) as unknown as string), 'utf8');
        expect(screen.match(/flow!?\.cancel\(/g)).toHaveLength(1); // only doCancel
        expect(screen.match(/doCancel\(/g)).toHaveLength(1); // only the confirm button of the in-app dialog calls it
        expect(screen).toContain('const doCancel = ');
        expect(screen).toContain('setQuitAsk({ prompt: arenaQuitPrompt(');
    });
});

describe('L1: player copy, never raw codes', () => {
    const codes = ['insufficient_funds', 'holobot_ko', 'activity_conflict', 'match_expired', 'bracket_bound', 'invalid_request', 'invalid_state', 'unknown_match', 'unavailable', 'too_fast', 'request_conflict', 'something_new'];
    it.each(codes)('%s maps to City copy without the code', (code) => {
        const copy = arenaErrorCopy(arenaRefusal(code));
        expect(`${copy.title} ${copy.body}`).not.toContain(code);
        expect(`${copy.title} ${copy.body}`).not.toMatch(/\bhost\b|arena_/i);
    });
    it.each(['arena_busy', 'arena_snapshot_unavailable', 'arena_issue_pending', 'arena_session_changed', 'arena_reply_invalid'])('local %s maps to copy', (code) => {
        const copy = arenaErrorCopy(Error(code));
        expect(`${copy.title} ${copy.body}`).not.toMatch(/arena_|_/);
    });
    it('a timeout message or an SDK error with only an HTTPS code still reads as copy', () => {
        expect(arenaErrorCode(Error('Arena confirmation delayed. Resume or retry the same admission.'))).toBe('unknown');
        expect(arenaErrorCopy(Error('Arena confirmation delayed.')).title).toBe('NO ANSWER FROM THE CITY');
        expect(arenaErrorCode(Object.assign(Error('x'), { code: 'functions/deadline-exceeded' }))).toBe('deadline-exceeded');
    });
    it('an earlier unresolved entry is its own interstitial, not an error', () => {
        expect(phase({ error: Error('arena_issue_pending') })).toEqual({ kind: 'pendingIssue' });
        expect(phase({ pendingIssue: true })).toEqual({ kind: 'pendingIssue' });
        expect(phase({ reply: ARENA_STARTED, settle: { kind: 'refused', code: 'match_expired' } })).toMatchObject({ kind: 'error', matchOpen: true, copy: { title: 'MATCH TIMED OUT' } });
    });
    it('every Arena copy string says "the City", never "host"', () => {
        for (const text of Object.values(ARENA_SCREEN_COPY)) expect(text).not.toMatch(/\bhost\b/i);
        expect(tooFast(1).details.retryAfterMs).toBe(1);
    });
});
