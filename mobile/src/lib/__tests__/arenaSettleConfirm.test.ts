import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaMatchFlow, type ArenaIssue, type ArenaPendingSettle } from '../arenaMatchFlow';
import { ARENA_SETTLE_BACKOFF_MS, ArenaSettleConfirmer, type ArenaSettlePhase } from '../arenaSettleConfirm';
import { ARENA_SCREEN_COPY, arenaErrorCopy, arenaScreenPhase } from '../arenaCopy';
import { ARENA_SETTLE_REPORT, ARENA_SETTLED, ARENA_STARTED, arenaRefusal, tooFast } from '../../qa/arenaPolishFixtures';

/** Host too_fast as the SDK surfaces it, with #145's details.retryAfterMs hint (recorded in the lifecycle fixture's refusals). */
type Reply = unknown;
function harness(script: Array<Reply | Error>, storage: { settle: ArenaPendingSettle | null } = { settle: null }) {
    const calls: Array<Record<string, unknown>> = [];
    const call = vi.fn(async (request: Record<string, unknown>) => {
        calls.push(request);
        if (request.operation === 'resume') return ARENA_STARTED;
        const next = script.shift();
        if (next instanceof Error) throw next;
        return next;
    });
    let issue: ArenaIssue | null = null;
    const flow = new ArenaMatchFlow(call, { get: async () => issue, set: async v => { issue = v; } }, () => true, undefined, {
        settles: { get: async () => storage.settle, set: async v => { storage.settle = v; } },
    });
    const phases: ArenaSettlePhase[] = [];
    const confirmer = new ArenaSettleConfirmer(flow, p => phases.push(p));
    const settles = () => calls.filter(c => c.operation === 'settle');
    return { flow, confirmer, phases, calls, settles, storage, last: () => phases[phases.length - 1] };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('too_fast is PENDING, never an error (host #143 settle floor)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('honours details.retryAfterMs exactly, then settles with the identical body', async () => {
        const h = harness([tooFast(2_500), ARENA_SETTLED]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        expect(h.last()).toEqual({ kind: 'waiting', attempt: 1, resendInMs: 2_500, hinted: true, reason: 'too_fast' });
        expect(h.storage.settle).toEqual({ matchId: ARENA_STARTED.matchId, report: ARENA_SETTLE_REPORT });
        await vi.advanceTimersByTimeAsync(2_499);
        expect(h.settles()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);
        await flush();
        expect(h.settles()).toHaveLength(2);
        expect(h.settles()[1]).toEqual(h.settles()[0]);
        expect(h.settles()[0]).toEqual({ schemaVersion: 'arena-match-1', operation: 'settle', matchId: ARENA_STARTED.matchId, ...ARENA_SETTLE_REPORT });
        expect(h.last()).toMatchObject({ kind: 'settled', reply: { match: { state: 'settled' } } });
        expect(h.storage.settle).toBeNull();
    });

    it('without a hint uses the bounded backoff (1 s, 2 s, ...) and never a hardcoded floor', async () => {
        const h = harness([tooFast(), tooFast(), ARENA_SETTLED]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        expect(h.last()).toMatchObject({ kind: 'waiting', resendInMs: ARENA_SETTLE_BACKOFF_MS[0], hinted: false });
        await vi.advanceTimersByTimeAsync(1_000); await flush();
        expect(h.last()).toMatchObject({ kind: 'waiting', resendInMs: ARENA_SETTLE_BACKOFF_MS[1] });
        await vi.advanceTimersByTimeAsync(1_999); await flush();
        expect(h.settles()).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(1); await flush();
        expect(h.settles()).toHaveLength(3);
        expect(new Set(h.settles().map(c => JSON.stringify(c))).size).toBe(1);
        expect(h.last().kind).toBe('settled');
    });

    it('gives up after the bounded budget (~31 s) and shows TRY AGAIN, which resends the same stored body', async () => {
        const refusals = Array.from({ length: 1 + ARENA_SETTLE_BACKOFF_MS.length }, () => tooFast());
        const h = harness([...refusals, ARENA_SETTLED]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        for (const ms of ARENA_SETTLE_BACKOFF_MS) { await vi.advanceTimersByTimeAsync(ms); await flush(); }
        expect(ARENA_SETTLE_BACKOFF_MS.reduce((a, b) => a + b, 0)).toBe(31_000);
        expect(h.settles()).toHaveLength(6);
        expect(h.last()).toEqual({ kind: 'stalled', reason: 'too_fast' });
        expect(h.storage.settle).not.toBeNull();
        await vi.advanceTimersByTimeAsync(120_000); await flush();
        expect(h.settles()).toHaveLength(6); // nothing automatic after the give-up
        const phase = arenaScreenPhase({ reply: ARENA_STARTED, acknowledged: false, hasCheckpoint: true, settle: h.last(), pendingIssue: false, error: null });
        expect(phase).toEqual({ kind: 'stalled' });
        expect(ARENA_SCREEN_COPY.tryAgain).toBe('TRY AGAIN');
        h.confirmer.retryNow(); await flush();
        expect(h.settles()).toHaveLength(7);
        expect(h.settles()[6]).toEqual(h.settles()[0]);
        expect(h.last().kind).toBe('settled');
    });

    it('a hint counts against the same budget (a host that keeps saying "not yet" cannot loop forever)', async () => {
        const h = harness(Array.from({ length: 10 }, () => tooFast(500)));
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        for (let i = 0; i < 8; i++) { await vi.advanceTimersByTimeAsync(500); await flush(); }
        expect(h.settles()).toHaveLength(6);
        expect(h.last()).toEqual({ kind: 'stalled', reason: 'too_fast' });
    });

    it('survives a kill: a new flow on the same storage resends the stored body byte-for-byte', async () => {
        const storage = { settle: null as ArenaPendingSettle | null };
        const first = harness([tooFast()], storage);
        await first.flow.resume();
        first.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        first.confirmer.stop(); first.flow.close(); // app killed while waiting
        expect(storage.settle).toEqual({ matchId: ARENA_STARTED.matchId, report: ARENA_SETTLE_REPORT });
        const second = harness([ARENA_SETTLED], storage);
        await second.flow.resume();
        expect(await second.flow.pendingSettle()).toEqual(storage.settle);
        second.confirmer.resume(); await flush();
        expect(second.settles()[0]).toEqual(first.settles()[0]);
        expect(second.last().kind).toBe('settled');
        expect(storage.settle).toBeNull();
    });

    it('a new settle() for the same match never rebuilds the report while one is pending', async () => {
        const storage = { settle: { matchId: ARENA_STARTED.matchId!, report: ARENA_SETTLE_REPORT } };
        const h = harness([ARENA_SETTLED], storage);
        await h.flow.resume();
        await h.flow.settle({ ...ARENA_SETTLE_REPORT, combosCompleted: 25 });
        expect(h.settles()[0].combosCompleted).toBe(ARENA_SETTLE_REPORT.combosCompleted);
    });

    it('a first send that never reached storage (arena_busy) is retried through settle(report), not lost', async () => {
        const h = harness([ARENA_SETTLED]);
        await h.flow.resume();
        let release!: () => void;
        const busy = (h.flow as any).run(() => new Promise<void>(r => { release = r; })); // another single-flight op in flight
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        expect(h.storage.settle).toBeNull();
        expect(h.last()).toMatchObject({ kind: 'waiting', reason: 'unknown' });
        release(); await busy;
        await vi.advanceTimersByTimeAsync(1_000); await flush();
        expect(h.settles()).toHaveLength(1);
        expect(h.settles()[0]).toMatchObject(ARENA_SETTLE_REPORT);
        expect(h.last().kind).toBe('settled');
    });

    it('critic #1: stop() during an in-flight send keeps the City\'s settled answer', async () => {
        let release!: (v: unknown) => void;
        const h = harness([]);
        (h.flow as any).call = vi.fn(async (r: Record<string, unknown>) => r.operation === 'resume' ? ARENA_STARTED : new Promise(res => { release = res; }));
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        expect(h.confirmer.busy).toBe(true);
        h.confirmer.stop(); // e.g. the app went to the background
        release(ARENA_SETTLED); await flush();
        expect(h.last()).toMatchObject({ kind: 'settled' });
    });

    it('critic #1: stop() during an in-flight send that fails reports idle and arms nothing', async () => {
        const h = harness([tooFast()]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        h.confirmer.stop();
        await flush();
        expect(h.last()).toEqual({ kind: 'idle' });
        await vi.advanceTimersByTimeAsync(60_000); await flush();
        expect(h.settles()).toHaveLength(1);
    });

    it('critic #11/#3: a second start while a send is out sends nothing new (double tap, effect + resume)', async () => {
        const h = harness([tooFast(), ARENA_SETTLED]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        h.confirmer.retryNow();
        h.confirmer.resume();
        await flush();
        expect(h.settles()).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1_000); await flush();
        expect(h.settles()).toHaveLength(2);
        expect(h.last().kind).toBe('settled');
    });

    it('critic #2: nothing stored for the open match ends the loop as idle instead of a fake "saved" stall', async () => {
        const h = harness([]);
        await h.flow.resume();
        h.confirmer.resume(); // retrySettle with no stored body
        await flush();
        expect(h.last()).toEqual({ kind: 'idle' });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.settles()).toHaveLength(0);
    });

    it('critic #13: a 0 ms hint is no hint (the backoff applies)', async () => {
        const h = harness([tooFast(0), ARENA_SETTLED]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        expect(h.last()).toMatchObject({ kind: 'waiting', resendInMs: 1_000, hinted: false });
        await vi.advanceTimersByTimeAsync(1_000); await flush();
        expect(h.last().kind).toBe('settled');
    });

    it('round 2 #8: request_conflict ends the loop as refused but keeps the stored body for CHECK AGAIN', async () => {
        const h = harness([arenaRefusal('request_conflict'), ARENA_SETTLED]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        expect(h.last()).toEqual({ kind: 'refused', code: 'request_conflict' });
        expect(h.storage.settle).not.toBeNull();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.settles()).toHaveLength(1);
        h.confirmer.resume(); await flush();
        expect(h.settles()[1]).toEqual(h.settles()[0]);
        expect(h.last().kind).toBe('settled');
    });

    it('round 2 #2: stop() leaves a stalled or refused screen alone (it only disarms an armed resend)', async () => {
        const h = harness(Array.from({ length: 6 }, () => tooFast(1)));
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        for (let i = 0; i < 6; i++) { await vi.advanceTimersByTimeAsync(1); await flush(); }
        expect(h.last()).toEqual({ kind: 'stalled', reason: 'too_fast' });
        h.confirmer.stop();
        expect(h.last()).toEqual({ kind: 'stalled', reason: 'too_fast' });
        const r = harness([arenaRefusal('match_expired')]);
        await r.flow.resume();
        r.confirmer.start(ARENA_SETTLE_REPORT); await flush();
        r.confirmer.stop();
        expect(r.last()).toEqual({ kind: 'refused', code: 'match_expired' });
        const w = harness([tooFast()]);
        await w.flow.resume();
        w.confirmer.start(ARENA_SETTLE_REPORT); await flush();
        expect(w.last().kind).toBe('waiting');
        w.confirmer.stop();
        expect(w.last()).toEqual({ kind: 'idle' });
    });

    it('stop() cancels the armed resend (background, unmount)', async () => {
        const h = harness([tooFast(), ARENA_SETTLED]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        h.confirmer.stop();
        await vi.advanceTimersByTimeAsync(60_000); await flush();
        expect(h.settles()).toHaveLength(1);
    });

    it('another definite refusal ends the loop with its code and retires the body; an unknown outcome keeps it', async () => {
        const h = harness([arenaRefusal('match_expired')]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        expect(h.last()).toEqual({ kind: 'refused', code: 'match_expired' });
        expect(h.storage.settle).toBeNull();
        const t = harness([Object.assign(Error('Arena confirmation delayed.'), {}), ARENA_SETTLED]);
        await t.flow.resume();
        t.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        expect(t.last()).toMatchObject({ kind: 'waiting', reason: 'unknown' });
        expect(t.storage.settle).not.toBeNull();
        await vi.advanceTimersByTimeAsync(1_000); await flush();
        expect(t.last().kind).toBe('settled');
    });

    it('too_fast never surfaces raw: no refused phase, City copy, and the screen shows the confirming state', async () => {
        const h = harness([tooFast(), tooFast()]);
        await h.flow.resume();
        h.confirmer.start(ARENA_SETTLE_REPORT);
        await flush();
        expect(h.phases.some(p => p.kind === 'refused')).toBe(false);
        const phase = arenaScreenPhase({ reply: ARENA_STARTED, acknowledged: false, hasCheckpoint: true, settle: h.last(), pendingIssue: false, error: null });
        expect(phase).toEqual({ kind: 'confirming' });
        expect(ARENA_SCREEN_COPY.confirmingTitle).toBe('The City is confirming your win…');
        const copy = arenaErrorCopy(tooFast());
        expect(JSON.stringify(copy)).not.toMatch(/too_fast|host/i);
    });
});
