import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ArenaMatchFlow, arenaHostRejection } from '../arenaMatchFlow';
import { ARENA_3V3_COPY, ARENA_3V3_UNAVAILABLE_COPY, arenaBenchCards, arenaBenchPhaseLine, arenaBuddySlot, readArena3v3Reply, type Arena3v3Reply, type Arena3v3Swap } from '../arenaMatch3v3';
import { ARENA_3V3_FIXTURE_SHA256, ARENA_3V3_FIXTURE_STEPS as steps, ARENA_BENCH_PREVIEW_ROUTES, benchStep, fixtureBenchHost, fixtureRefusal, fixtureSwap, legacyLocalTeam, legacyStaSplicedReply, memoryIntents } from '../../qa/arenaBenchFixtures';
import { previewInitialScreen } from '../../qa/previewRoutes';
import v1 from '../../qa/fixtures/arena-admitted-lifecycle.json';

const src = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
const reply = (name: string) => structuredClone(benchStep(name).reply) as any as Arena3v3Reply;
const accepted = steps.filter(s => s.reply);
const projections = accepted.filter(s => (s.reply as Arena3v3Reply).match);
function setup(call: (r: Record<string, unknown>) => Promise<unknown>, seed: Arena3v3Swap | null = null) {
    let active = true;
    const intents = memoryIntents(seed), spy = vi.fn(call);
    const flow = new ArenaMatchFlow(spy, { get: async () => null, set: async () => { } }, () => active, intents);
    return { flow, intents, call: spy, signout: () => { active = false; flow.close(); } };
}
/** Resume to a fixture projection first, then answer the next calls with `then`. */
const host = (resumeAt: string, then: (r: Record<string, unknown>) => Promise<unknown>) => async (r: Record<string, unknown>) => r.operation === 'resume' ? reply(resumeAt) : then(r);
/** Synthetic projections for paths the hand-authored lifecycle does not walk (same as the contract test's controls). */
function lossOver(): any {
    const r: any = reply('report-4-active-ko'), m = r.match;
    Object.assign(m.team[0], { status: 'ko', vitals: { ...m.team[0].vitals, currentHealth: 0 } });
    Object.assign(m.battle, { turn: 7, phase: 'over', winner: 'opponent' }); r.intent = { ...r.intent, appliedTurn: 6 }; return r;
}
function settledLoss(): any {
    const r = lossOver(), m = r.match, closed = m.issuedAtMs + 30000;
    Object.assign(m, { state: 'settled', closedAtMs: closed, settlementReceipt: { matchId: m.matchId, outcome: 'loss', refunded: false,
        settlement: { exp: 28, awardedExp: 28, holos: 0, syncPoints: 7, blueprints: null, experience: [{ holobotId: 'ace', awardedExp: 28 }] },
        report: { combosCompleted: 0, perfectDefenses: 0 }, finalVitals: Object.fromEntries(m.team.map((x: any) => [x.fighter.holobotId, x.vitals])), closedAtMs: closed } });
    r.intent = null; return r;
}
function forfeit(): any {
    const r: any = reply('report-2-active-ko'), m = r.match, closed = m.issuedAtMs + 9500;
    Object.assign(m, { state: 'cancelled', closedAtMs: closed, settlementReceipt: { matchId: m.matchId, outcome: 'forfeit', refunded: false, settlement: null, report: null,
        finalVitals: Object.fromEntries(m.team.map((x: any) => [x.fighter.holobotId, x.vitals])), closedAtMs: closed } });
    r.intent = null; return r;
}
function cancelledBeforeStart(): any {
    const r: any = reply('issue'), c = r.match, e = c.entryReceipt;
    Object.assign(c, { state: 'cancelled', closedAtMs: c.issuedAtMs + 500, settlementReceipt: { matchId: c.matchId, outcome: 'cancelled_before_start', refunded: true,
        refund: { method: e.method, amount: e.amount, balanceBefore: e.balanceAfter, balanceAfter: e.balanceBefore }, settlement: null, report: null, finalVitals: null, closedAtMs: c.issuedAtMs + 500 } });
    return r;
}

describe('arena-match-3v3-1 fixture copy', () => {
    it('is the contract fixture verbatim (sha256 pinned to HolobotsMobile #134)', () => {
        const bytes = readFileSync(path.resolve(__dirname, '../../qa/fixtures/arena-match-3v3-lifecycle.json'));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(ARENA_3V3_FIXTURE_SHA256);
        expect(ARENA_3V3_FIXTURE_SHA256).toBe('9a9ff7e66d66e15dc1833eb8ae1134c83ac805b1e8d6462e25cc1abbe5d1abd1');
        expect([steps.length, accepted.length]).toEqual([23, 15]);
    });
});

describe('strict 3v3 reply reader: accept/refuse table', () => {
    it.each(accepted.map(s => [s.name]))('accepts host projection %s', name => {
        expect(() => readArena3v3Reply(reply(name))).not.toThrow();
    });
    it.each([['player wipe', lossOver], ['settled loss', settledLoss], ['mid-match forfeit', forfeit], ['refund before start', cancelledBeforeStart]] as const)('accepts the schema-valid %s control', (_name, build) => {
        expect(() => readArena3v3Reply(build())).not.toThrow();
    });
    it('accepts Firestore key reordering, and a pass entry at the host-frozen pass price', () => {
        const reorder = (v: any): any => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
        for (const s of accepted) expect(() => readArena3v3Reply(reorder(structuredClone(s.reply)))).not.toThrow();
        const pass: any = reply('start'), e = pass.match.entryReceipt;
        Object.assign(pass.match.rules, { entryFeePasses: 2 }); Object.assign(e, { method: 'pass', amount: 2, balanceBefore: 3, balanceAfter: 1 });
        expect(() => readArena3v3Reply(pass)).not.toThrow(); // the client assumes no pass price
        e.amount = 1; e.balanceAfter = 2;
        expect(() => readArena3v3Reply(pass)).toThrow('arena_receipt_invalid');
    });
    type Row = [string, string | (() => any), (r: any) => void, string];
    const R = 'arena_3v3_reply_invalid', RC = 'arena_receipt_invalid';
    const refuse: Row[] = [
        ['wrong schema version', 'start', r => { r.schemaVersion = 'arena-match-1'; }, R],
        ['missing intent key', 'start', r => { delete r.intent; }, R],
        ['1v1 am_ id everywhere', 'start', r => { r.matchId = r.match.matchId = r.match.entryReceipt.matchId = 'am_' + '0'.repeat(32); }, R],
        ['team of two', 'start', r => { r.match.team.pop(); }, R],
        ['local STA spliced into host vitals', 'swap-1-voluntary', r => { r.match.team[0].vitals.stamina = 7; }, R],
        ['an open combat bag on a slot', 'start', r => { r.match.team[1].combat = { stamina: 110 }; }, R],
        ['extra field on the #118 snapshot', 'start', r => { r.match.team[1].fighter.currentHealth = 205; }, R],
        ['displayName not the catalog name', 'start', r => { r.match.team[0].fighter.displayName = 'Pilot Ace'; }, R],
        ['level 0', 'start', r => { r.match.team[0].fighter.level = 0; }, R],
        ['level 100', 'start', r => { r.match.team[0].fighter.level = 100; }, R],
        ['fractional level', 'start', r => { r.match.team[0].fighter.level = 4.5; }, R],
        ['missing level', 'start', r => { delete r.match.team[0].fighter.level; }, R],
        ['KO with HP left', 'report-2-active-ko', r => { r.match.team[1].vitals.currentHealth = 5; }, R],
        ['bench at 0 HP but not KO', 'start', r => { r.match.team[2].vitals.currentHealth = 0; }, R],
        ['HP above max', 'start', r => { r.match.team[0].vitals.currentHealth = 173; }, R],
        ['duplicate bot on the team', 'start', r => { r.match.team[2].fighter = { ...r.match.team[0].fighter }; }, R],
        ['slot field not its array index', 'start', r => { r.match.team[1].slot = 2; }, R],
        ['bench slots reordered', 'start', r => { [r.match.team[1], r.match.team[2]] = [r.match.team[2], r.match.team[1]]; }, R],
        ['two actives in command', 'start', r => { r.match.team[1].status = 'active'; }, R],
        ['send_in with a fighter still active', 'report-2-active-ko', r => { r.match.team[0].status = 'active'; }, R],
        ['winner before the match is over', 'start', r => { r.match.battle.winner = 'player'; }, R],
        ['over without a winner', 'report-5-match-over', r => { r.match.battle.winner = null; }, R],
        ['swaps above the host limit', 'start', r => { r.match.battle.voluntarySwapsUsed = 3; }, R],
        ['bench regen rule', 'start', r => { r.match.rules.benchRegen = 'per_second'; }, R],
        ['extra rules policy key', 'start', r => { r.match.rules.benchRegenPerTick = 3; }, R],
        ['missing reward quote', 'start', r => { delete r.match.rules.holos; }, R],
        ['fee above the quote bound', 'start', r => { r.match.rules.entryFeeHolos = 1000001; }, R],
        ['missing frozen pass price', 'start', r => { delete r.match.rules.entryFeePasses; }, R],
        ['second charge (amount != fee)', 'start', r => { r.match.entryReceipt.amount = 100; r.match.entryReceipt.balanceAfter = 900; }, RC],
        ['per-fighter charge list', 'start', r => { r.match.entryReceipts = [r.match.entryReceipt]; }, R],
        ['charge not at issue time', 'start', r => { r.match.entryReceipt.chargedAtMs += 1; }, RC],
        ['issued but already in command', 'issue', r => { r.match.battle.phase = 'command'; }, R],
        ['receipt while active', 'start', r => { r.match.settlementReceipt = {}; }, RC],
        ['settled outcome disagrees with host winner', 'settle', r => { r.match.settlementReceipt.outcome = 'loss'; r.match.settlementReceipt.settlement.holos = 0; r.match.settlementReceipt.settlement.blueprints = null; }, RC],
        ['finalVitals disagree with projection', 'settle', r => { r.match.settlementReceipt.finalVitals.ace.currentHealth = 172; }, RC],
        ['settled win marked refunded', 'settle', r => { r.match.settlementReceipt.refunded = true; }, RC],
        ['settled win with a refund attached', 'settle', r => { r.match.settlementReceipt.refund = { method: 'tokens', amount: 50, balanceBefore: 0, balanceAfter: 50 }; }, RC],
        ['settled win without a settlement', 'settle', r => { r.match.settlementReceipt.settlement = null; }, RC],
        ['settlement with an extra payout field', 'settle', r => { r.match.settlementReceipt.settlement.bonusHolos = 10; }, RC],
        ['terminal without a close time', 'settle', r => { r.match.closedAtMs = null; }, RC],
        ['cancelled match paying a win', 'settle', r => { r.match.state = 'cancelled'; }, RC],
        ['loss paying win-only Holos', settledLoss, r => { r.match.settlementReceipt.settlement.holos = 100; }, RC],
        ['loss paying a blueprint', settledLoss, r => { r.match.settlementReceipt.settlement.blueprints = { holobotKey: 'hare', amount: 5 }; }, RC],
        ['refund after the match started', cancelledBeforeStart, r => { r.match.startedAtMs = r.match.issuedAtMs + 60; }, RC],
        ['refund without a refund object', cancelledBeforeStart, r => { delete r.match.settlementReceipt.refund; }, RC],
        ['forfeit that pays', forfeit, r => { r.match.settlementReceipt.settlement = { exp: 1, awardedExp: 1, holos: 0, syncPoints: 0, blueprints: null, experience: [] }; }, RC],
        ['intent applied at the current turn', 'swap-1-voluntary', r => { r.intent.appliedTurn = r.match.battle.turn; }, R],
        ['empty reply that is not alreadyProcessed', 'resume-empty', r => { r.alreadyProcessed = false; }, R],
    ];
    it.each(refuse)('refuses %s', (_label, base, edit, code) => {
        const r = typeof base === 'string' ? reply(base) : base(); edit(r);
        expect(() => readArena3v3Reply(r)).toThrow(code);
    });
    it('refuses every arena-match-1 reply and binds expected match and intent', () => {
        for (const s of v1.steps) expect(() => readArena3v3Reply(s.reply)).toThrow();
        const r = reply('swap-1-voluntary');
        expect(() => readArena3v3Reply(r, { matchId: 'a3_' + 'f'.repeat(32) })).toThrow('arena_3v3_reply_invalid');
        expect(() => readArena3v3Reply(r, { intent: { intentId: 'lite3v3_intent_99', operation: 'swap' } })).toThrow('arena_3v3_intent_mismatch');
        expect(() => readArena3v3Reply(r, { intent: { intentId: 'lite3v3_intent_02', operation: 'report' } })).toThrow('arena_3v3_intent_mismatch');
        expect(() => readArena3v3Reply(reply('resume-empty'), { matchId: r.matchId! })).toThrow();
    });
});

describe('swap goes through the host and is never applied locally first', () => {
    it('persists the exact intent, sends it with the host turn, and changes nothing until the reply', async () => {
        const answer = reply('swap-2-forced-send-in');
        let inFlight: { same: boolean; deep: unknown } | null = null, persistedInFlight: unknown;
        const { flow, intents, call } = setup(host('report-2-active-ko', async r => {
            inFlight = { same: flow.teamReply === resumed, deep: structuredClone(flow.teamReply) }; persistedInFlight = intents.peek();
            return { ...answer, intent: { ...answer.intent!, intentId: r.intentId } };
        }));
        const resumed = await flow.resumeTeam(), before = structuredClone(resumed);
        const after = await flow.swap('shadow');
        const sent = call.mock.calls[1][0] as Arena3v3Swap;
        expect(Object.keys(sent).sort()).toEqual(['holobotId', 'intentId', 'matchId', 'operation', 'schemaVersion', 'turn']);
        expect(sent).toMatchObject({ schemaVersion: 'arena-match-3v3-1', operation: 'swap', matchId: before.matchId, turn: before.match!.battle.turn, holobotId: 'shadow' });
        expect(sent.intentId).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
        expect(persistedInFlight).toEqual(sent); // durable before the call
        expect(inFlight).toEqual({ same: true, deep: before }); // no optimistic swap, not even an in-place edit
        expect(resumed).toEqual(before); // the earlier projection object was never mutated
        expect(intents.peek()).toBeNull();
        expect(flow.teamReply).toBe(after);
        expect(arenaBenchCards(after.match!).map(c => [c.holobotId, c.role])).toEqual([['shadow', 'ACTIVE'], ['ace', 'BENCH'], ['kuma', 'KO']]);
    });
    it('a lost reply keeps the intent and the state; retry resends it byte for byte and accepts the host replay', async () => {
        let n = 0;
        const { flow, intents, call } = setup(host('swap-1-voluntary', async () => { if (n++ === 0) throw Error('Arena confirmation delayed'); return reply('swap-1-replay'); }));
        call.mockImplementationOnce(async () => reply('report-1-opponent-ko'));
        const pre = structuredClone(await flow.resumeTeam());
        await intents.set(fixtureSwap('swap-1-voluntary'));
        await expect(flow.swap('kuma')).rejects.toThrow('delayed');
        expect(intents.peek()).toEqual(fixtureSwap('swap-1-voluntary'));
        expect(flow.teamReply).toEqual(pre);
        const r = await flow.retrySwap();
        expect(call.mock.calls[1][0]).toEqual(call.mock.calls[2][0]);
        expect(call.mock.calls[2][0]).toEqual(fixtureSwap('swap-1-voluntary'));
        expect(r.alreadyProcessed).toBe(true);
        expect(r.match!.battle.turn).toBe(2);
        expect(intents.peek()).toBeNull();
    });
    it('a different swap is blocked while one is pending; an intent for another match fails closed until discarded', async () => {
        const pending = fixtureSwap('swap-2-forced-send-in');
        const a = setup(host('report-2-active-ko', async () => { throw Error('timeout'); }), pending);
        await a.flow.resumeTeam();
        await expect(a.flow.swap('ace')).rejects.toThrow('arena_intent_pending');
        expect(a.call).toHaveBeenCalledTimes(1);
        const stale = { ...pending, matchId: 'a3_' + '1'.repeat(32) };
        const b = setup(fixtureBenchHost('report-2-active-ko'), stale);
        await b.flow.resumeTeam();
        await expect(b.flow.retrySwap()).rejects.toThrow('arena_intent_stale');
        await expect(b.flow.swap('shadow')).rejects.toThrow('arena_intent_stale');
        expect(b.call).toHaveBeenCalledTimes(1); // only the resume: no rewritten or fresh swap was sent
        expect(b.intents.peek()).toEqual(stale);
        await b.flow.discardPendingSwap();
        await expect(b.flow.swap('shadow')).rejects.toThrow('unavailable'); // a fresh id: the fixture host knows only its own
        expect(b.call.mock.calls[1][0]).toMatchObject({ matchId: reply('report-2-active-ko').matchId, holobotId: 'shadow', turn: 3 });
    });
    it('refuses a foreign intent echo and a changed frozen snapshot without adopting them', async () => {
        const echo = setup(host('report-2-active-ko', async () => reply('swap-2-forced-send-in')));
        const before = structuredClone(await echo.flow.resumeTeam());
        await expect(echo.flow.swap('shadow')).rejects.toThrow('arena_3v3_intent_mismatch');
        expect(echo.flow.teamReply).toEqual(before);
        expect(echo.intents.peek()).not.toBeNull(); // unknown outcome: keep the exact body for retry
        const changed = reply('swap-2-forced-send-in'); changed.match!.team[2].fighter.level = 9;
        const snap = setup(host('report-2-active-ko', async () => changed), fixtureSwap('swap-2-forced-send-in'));
        await snap.flow.resumeTeam();
        await expect(snap.flow.swap('shadow')).rejects.toThrow('arena_snapshot_changed');
        expect(snap.flow.teamReply).toEqual(before);
    });
    it('single-flight and sign-out stop a stale reply from landing, including during the final intent clear', async () => {
        let done!: (v: unknown) => void;
        const { flow, signout } = setup(host('report-2-active-ko', () => new Promise(resolve => { done = resolve; })), fixtureSwap('swap-2-forced-send-in'));
        await flow.resumeTeam();
        const p = flow.swap('shadow');
        for (let i = 0; i < 50 && !done; i++) await Promise.resolve();
        await expect(flow.swap('shadow')).rejects.toThrow('arena_busy');
        signout(); done(reply('swap-2-forced-send-in'));
        await expect(p).rejects.toThrow('arena_session_changed');
        expect(flow.teamReply).toBeNull();
        // Sign-out lands while the accepted intent is being cleared from storage.
        let active = true;
        const intents = memoryIntents(fixtureSwap('swap-2-forced-send-in')), clear = intents.set.bind(intents);
        const late: ArenaMatchFlow = new ArenaMatchFlow(host('report-2-active-ko', async () => reply('swap-2-forced-send-in')), { get: async () => null, set: async () => { } }, () => active,
            { get: intents.get, set: async v => { if (v === null) { active = false; late.close(); } await clear(v); } });
        await late.resumeTeam();
        await expect(late.swap('shadow')).rejects.toThrow('arena_session_changed');
        expect(late.teamReply).toBeNull();
    });
    it('without 3v3 intent storage, or before a 3v3 match is read, swap sends nothing', async () => {
        const call = vi.fn();
        await expect(new ArenaMatchFlow(call, { get: async () => null, set: async () => { } }, () => true).swap('ace')).rejects.toThrow('arena_3v3_unavailable');
        await expect(setup(call).flow.swap('ace')).rejects.toThrow('arena_not_admitted');
        expect(call).not.toHaveBeenCalled();
    });
});

describe('a refused swap leaves the host state unchanged', () => {
    const cases: [string, string, string, string][] = [
        ['refused-swap-to-ko', 'report-2-active-ko', 'kuma', 'fighter_ko'],
        ['refused-stale-turn', 'swap-1-voluntary', 'ace', 'turn_mismatch'],
        ['refused-swap-before-start', 'issue', 'kuma', 'invalid_state'],
        ['refused-swap-after-over', 'report-5-match-over', 'kuma', 'invalid_state'],
    ];
    it.each(cases)('%s → %s', async (refused, resumeAt, target, code) => {
        const { flow, intents, call } = setup(fixtureBenchHost(resumeAt), fixtureSwap(refused));
        const resumed = await flow.resumeTeam(), before = structuredClone(resumed);
        const error = await flow.swap(target).then(() => null, e => e);
        expect(arenaHostRejection(error)).toBe(code);
        expect(error).toMatchObject({ code: `functions/${benchStep(refused).refusal!.code}` });
        expect(call).toHaveBeenCalledTimes(2);
        expect(flow.teamReply).toBe(resumed);
        expect(flow.teamReply).toEqual(before);
        expect(intents.peek()).toBeNull(); // a final host ruling: nothing left to retry
        expect(arenaBenchCards(flow.teamReply!.match!)).toEqual(arenaBenchCards(before.match!));
    });
    it('the flow never sends the known-bad turn-less swap', async () => {
        expect(Object.hasOwn(benchStep('refused-swap-without-turn').request, 'turn')).toBe(false);
        const { flow, call } = setup(host('start', async () => { throw fixtureRefusal({ code: 'failed-precondition', message: 'turn_mismatch', details: { rejectionCode: 'turn_mismatch' } }); }));
        await flow.resumeTeam();
        await flow.swap('kuma').catch(() => { });
        expect(call.mock.calls[1][0]).toMatchObject({ operation: 'swap', turn: 0 });
    });
});

describe('known bad: legacy local teamBattle regen never reaches the bench cards', () => {
    it('legacy regen really raises bench STA on the client, and that STA spliced into a host reply is refused', () => {
        const { before, after } = legacyLocalTeam();
        expect(before.player.slots.map(s => s.fighter.stamina)).toEqual([4, 4, 4]);
        expect(after.player.slots.map(s => s.fighter.stamina)).toEqual([4, 7, 7]); // local authority: bench regen
        const spliced = legacyStaSplicedReply();
        expect(spliced.match.team.map((s: any) => s.vitals.stamina)).toEqual([4, 7, 7]);
        expect(() => readArena3v3Reply(spliced)).toThrow('arena_3v3_reply_invalid');
        const control = structuredClone(spliced); control.match.team.forEach((s: any) => { delete s.vitals.stamina; });
        expect(() => readArena3v3Reply(control)).not.toThrow(); // only the spliced STA is refused
        expect(() => readArena3v3Reply(after)).toThrow('arena_3v3_reply_invalid');
    });
    it('cards carry host HP and the host level only, with no STA or regen field', () => {
        for (const s of projections) {
            const m = readArena3v3Reply(s.reply).match!, cards = arenaBenchCards(m);
            expect(cards).toHaveLength(3);
            for (const c of cards) {
                expect(Object.keys(c).sort()).toEqual(['currentHealth', 'holobotId', 'hpLabel', 'levelBadge', 'maxHealth', 'name', 'role', 'slot']);
                const slot = m.team[c.slot];
                expect([c.currentHealth, c.maxHealth]).toEqual([slot.vitals.currentHealth, slot.vitals.maxHealth]);
                expect(c.levelBadge).toBe(`LV ${slot.fighter.level}`);
            }
            expect(JSON.stringify(cards)).not.toMatch(/stamina|regen|"sta"/i);
        }
    });
    it('a benched fighter shows exactly its host HP across the whole lifecycle (no client recovery)', () => {
        const ace = projections.map(s => arenaBenchCards(readArena3v3Reply(s.reply).match!).find(c => c.holobotId === 'ace')!);
        ace.slice(1).forEach((c, i) => expect(c.currentHealth).toBeLessThanOrEqual(ace[i].currentHealth));
        const benched = accepted.filter(s => ['swap-1-voluntary', 'report-2-active-ko', 'swap-2-forced-send-in', 'report-3-opponent-ko', 'report-4-active-ko'].includes(s.name));
        for (const s of benched) expect(arenaBenchCards(readArena3v3Reply(s.reply).match!).find(c => c.holobotId === 'ace')).toMatchObject({ role: 'BENCH', currentHealth: 120, hpLabel: '120 / 172' });
    });
    it('no lite CPU 3v3 module imports the legacy local-authority team code', () => {
        // Scope: the CPU Arena 3v3 path only. ArenaScreen still renders PvpArenaModal, whose legacy PvP 3v3 (pvpTeamBattle)
        // keeps client-side bench regen. That modal is owned by lite-pvp-fighters-1 and is out of this lane (follow-up).
        for (const file of ['components/arena/ArenaBenchCards.tsx', 'lib/arenaMatch3v3.ts', 'lib/arenaMatchFlow.ts', 'lib/arenaMatchClient.ts', 'screens/ArenaScreen.tsx']) {
            expect(src(file)).not.toMatch(/teamBattle|pvpTeamBattle|arena-team-battle-store/);
        }
        expect(src('components/arena/ArenaBenchCards.tsx')).not.toMatch(/stamina|Stamina|regen/);
    });
});

describe('bench presentation (DECISIONS #71)', () => {
    it('active first, then the bench in slot order; KO is shown, never hidden', () => {
        expect(arenaBenchCards(reply('start').match!).map(c => [c.name, c.levelBadge, c.role, c.hpLabel])).toEqual([['ACE', 'LV 4', 'ACTIVE', '172 / 172'], ['KUMA', 'LV 3', 'BENCH', '205 / 220'], ['SHADOW', 'LV 2', 'BENCH', '150 / 150']]);
        expect(arenaBenchCards(reply('report-2-active-ko').match!).map(c => [c.name, c.role])).toEqual([['KUMA', 'KO'], ['ACE', 'BENCH'], ['SHADOW', 'BENCH']]);
        expect(arenaBenchPhaseLine(reply('report-2-active-ko').match!)).toBe('TURN 3 · SEND IN A FIGHTER');
        expect(arenaBenchPhaseLine(reply('swap-1-voluntary').match!)).toBe('TURN 2 · SWAPS 1/2');
        expect(arenaBenchPhaseLine(reply('settle').match!)).toBe('CITY RECEIPT · WIN');
        expect(arenaBenchPhaseLine(forfeit().match)).toBe('CITY CLOSED · CANCELLED');
    });
    it('the word "host" never appears on screen: every player-visible 3v3 string says City', () => {
        const visible = [
            ...Object.values(ARENA_3V3_COPY).map(v => typeof v === 'function' ? (v as (...a: any[]) => string)('ACE', 2) : v),
            ...projections.flatMap(s => { const m = readArena3v3Reply(s.reply).match!; return [arenaBenchPhaseLine(m), ...arenaBenchCards(m).flatMap(c => [c.name, c.levelBadge, c.role, c.hpLabel]), ...Object.values(arenaBuddySlot(m))]; }),
        ];
        expect(visible.filter(v => /host/i.test(String(v)))).toEqual([]);
        expect(ARENA_3V3_UNAVAILABLE_COPY).toBe(ARENA_3V3_COPY.unavailable);
        // String literals and JSX text in the on-screen 3v3 files (identifiers and comments may keep "host").
        for (const file of ['components/arena/ArenaBenchCards.tsx', 'qa/ArenaBenchPreview.tsx']) {
            const code = src(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').split('\n').filter(l => !/^\s*import /.test(l)).join('\n');
            const literals = [...code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map(m => m[2].replace(/\$\{[^}]*\}/g, '')).filter(t => !/^[@.]/.test(t)); // ${code} inside a template is not on screen
            const jsxText = [...code.matchAll(/>([^<>{}]+)</g)].map(m => m[1].trim()).filter(Boolean);
            expect([...literals, ...jsxText].filter(t => /host/i.test(t)), file).toEqual([]);
        }
    });
    it('the BUDDY strip sits above the bench and is an honest empty slot (the 3v3 reply carries no Buddy Unit data)', () => {
        for (const s of projections) expect(arenaBuddySlot(readArena3v3Reply(s.reply).match!)).toEqual({ kind: 'empty', label: 'BUDDY', line: ARENA_3V3_COPY.buddyEmpty });
        const withBuddy: any = reply('start'); withBuddy.match.buddy = { tier: 'heavy' };
        expect(() => readArena3v3Reply(withBuddy)).toThrow(); // no unpinned buddy shape can be shown
        const cards = src('components/arena/ArenaBenchCards.tsx');
        expect(cards.indexOf('styles.buddy}')).toBeGreaterThan(-1);
        expect(cards.indexOf('styles.buddy}')).toBeLessThan(cards.indexOf('<Card card={active} wide/>'));
    });
    it('the LV badge is a lower-left corner tab on every card, and SWAP IN is offered only on an active match', () => {
        const cards = src('components/arena/ArenaBenchCards.tsx');
        expect(cards).toMatch(/levelTab: \{[^}]*bottom: 0, left: 0[^}]*position: 'absolute'/);
        expect(cards).toContain("<View style={[styles.levelTab, { borderColor: accent }]}><Text style={styles.level}>{card.levelBadge}</Text></View>");
        expect(cards).toContain("const canAsk = !!onSwap && match.state === 'active' && (match.battle.phase === 'command' || match.battle.phase === 'send_in');");
    });
});

describe('3v3 entry stays honestly unavailable', () => {
    it('ArenaScreen shows inline copy instead of an Alert, and has no live 3v3 caller', () => {
        const screen = src('screens/ArenaScreen.tsx');
        expect(screen).not.toMatch(/\bAlert\b/);
        expect(screen).toContain('unavailable3v3Copy={ARENA_3V3_UNAVAILABLE_COPY}');
        expect(screen).not.toMatch(/onStart3v3|resumeTeam|\.swap\(|arena-match-3v3-1/);
        expect(screen).toMatch(/notifyHostEconomyChanged\(uid\)/); // #132's economy signal survives the rebase
        expect(ARENA_3V3_UNAVAILABLE_COPY).toMatch(/nothing is charged/);
        const menu = src('components/arena/ArenaPrebattleMenu.tsx');
        expect(menu).toContain('disabled={!canField3v3 || !threeVThreeOpen}');
        expect(menu).toContain('if (!teamComplete || !onStart3v3 || !threeVThreeOpen) return;');
    });
    it('QA bench routes put the known-bad cell first and are registered once in the dev-only registry', () => {
        expect(ARENA_BENCH_PREVIEW_ROUTES[0]).toBe('ArenaBenchKnownBad');
        const screens = { Home: null, ...Object.fromEntries(ARENA_BENCH_PREVIEW_ROUTES.map(n => [n, null])) };
        for (const name of ARENA_BENCH_PREVIEW_ROUTES) expect(previewInitialScreen(name, screens)).toBe(name);
        expect(src('qa/ArenaBenchPreview.tsx').match(/ArenaBench\w+: \(\)/g)!.map(s => s.slice(0, -4))).toEqual([...ARENA_BENCH_PREVIEW_ROUTES]);
        // One self-contained spread in the dev-only registry, so sibling route additions merge trivially.
        expect(src('qa/HoloCityPreview.tsx').match(/\.\.\.arenaBenchPreviewScreens,/g)).toHaveLength(1);
    });
});
