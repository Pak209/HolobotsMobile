import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ArenaMatchFlow, arenaHostRejection } from '../arenaMatchFlow';
import { ARENA_3V3_UNAVAILABLE_COPY, arenaBenchCards, arenaBenchPhaseLine, readArena3v3Reply, type Arena3v3Reply, type Arena3v3Swap } from '../arenaMatch3v3';
import { ARENA_3V3_FIXTURE_SHA256, ARENA_3V3_FIXTURE_STEPS as steps, ARENA_BENCH_PREVIEW_ROUTES, benchStep, fixtureBenchHost, fixtureRefusal, fixtureSwap, legacyLocalTeam, memoryIntents } from '../../qa/arenaBenchFixtures';
import { previewInitialScreen } from '../../qa/previewRoutes';
import v1 from '../../qa/fixtures/arena-admitted-lifecycle.json';

const src = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
const reply = (name: string) => structuredClone(benchStep(name).reply) as Arena3v3Reply;
const accepted = steps.filter(s => s.reply);
function setup(call: (r: Record<string, unknown>) => Promise<unknown>, seed: Arena3v3Swap | null = null) {
    let active = true;
    const intents = memoryIntents(seed), spy = vi.fn(call);
    const flow = new ArenaMatchFlow(spy, { get: async () => null, set: async () => { } }, () => active, intents);
    return { flow, intents, call: spy, signout: () => { active = false; flow.close(); } };
}
/** Resume to a fixture projection first, then answer the next calls with `then`. */
const host = (resumeAt: string, then: (r: Record<string, unknown>) => Promise<unknown>) => async (r: Record<string, unknown>) => r.operation === 'resume' ? reply(resumeAt) : then(r);

describe('arena-match-3v3-1 fixture copy', () => {
    it('is the contract fixture verbatim (sha256 pinned to HolobotsMobile #134)', () => {
        const bytes = readFileSync(path.resolve(__dirname, '../../qa/fixtures/arena-match-3v3-lifecycle.json'));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(ARENA_3V3_FIXTURE_SHA256);
        expect(ARENA_3V3_FIXTURE_SHA256).toBe('05490d02a2efb6fcd42cbae07aa437815bed95872273141f9450c467727734ec');
        expect(steps).toHaveLength(21);
    });
});

describe('strict 3v3 reply reader: accept/refuse table', () => {
    it.each(accepted.map(s => [s.name]))('accepts host projection %s', name => {
        expect(() => readArena3v3Reply(reply(name))).not.toThrow();
    });
    it('accepts Firestore key reordering', () => {
        const reorder = (v: any): any => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
        for (const s of accepted) expect(() => readArena3v3Reply(reorder(structuredClone(s.reply)))).not.toThrow();
    });
    const refuse: [string, string, (r: any) => void][] = [
        ['wrong schema version', 'start', r => { r.schemaVersion = 'arena-match-1'; }],
        ['missing intent key', 'start', r => { delete r.intent; }],
        ['1v1 am_ id', 'start', r => { r.matchId = r.match.matchId = 'am_' + '0'.repeat(32); }],
        ['team of two', 'start', r => { r.match.team.pop(); }],
        ['local STA spliced into host vitals', 'swap-1-voluntary', r => { r.match.team[0].vitals.stamina = 7; }],
        ['extra field on the #118 snapshot', 'start', r => { r.match.team[1].fighter.currentHealth = 205; }],
        ['displayName not the catalog name', 'start', r => { r.match.team[0].fighter.displayName = 'Pilot Ace'; }],
        ['level 0', 'start', r => { r.match.team[0].fighter.level = 0; }],
        ['level 100', 'start', r => { r.match.team[0].fighter.level = 100; }],
        ['fractional level', 'start', r => { r.match.team[0].fighter.level = 4.5; }],
        ['missing level', 'start', r => { delete r.match.team[0].fighter.level; }],
        ['KO with HP left', 'report-2-active-ko', r => { r.match.team[1].vitals.currentHealth = 5; }],
        ['bench at 0 HP but not KO', 'start', r => { r.match.team[2].vitals.currentHealth = 0; }],
        ['HP above max', 'start', r => { r.match.team[0].vitals.currentHealth = 173; }],
        ['duplicate bot on the team', 'start', r => { r.match.team[2].fighter = { ...r.match.team[0].fighter }; }],
        ['slot order changed', 'start', r => { [r.match.team[0], r.match.team[1]] = [r.match.team[1], r.match.team[0]]; }],
        ['two actives in command', 'start', r => { r.match.team[1].status = 'active'; }],
        ['send_in with a fighter still active', 'report-2-active-ko', r => { r.match.team[0].status = 'active'; }],
        ['winner before the match is over', 'start', r => { r.match.battle.winner = 'player'; }],
        ['over without a winner', 'report-5-match-over', r => { r.match.battle.winner = null; }],
        ['swaps above the host limit', 'start', r => { r.match.battle.voluntarySwapsUsed = 3; }],
        ['bench regen rule', 'start', r => { r.match.rules.benchRegen = 'per_second'; }],
        ['second charge (amount != fee)', 'start', r => { r.match.entryReceipt.amount = 100; r.match.entryReceipt.balanceAfter = 900; }],
        ['per-fighter charge list', 'start', r => { r.match.entryReceipts = [r.match.entryReceipt]; }],
        ['charge not at issue time', 'start', r => { r.match.entryReceipt.chargedAtMs += 1; }],
        ['issued but already in command', 'issue', r => { r.match.battle.phase = 'command'; }],
        ['settled outcome disagrees with host winner', 'settle', r => { r.match.settlementReceipt.outcome = 'loss'; }],
        ['finalVitals disagree with projection', 'settle', r => { r.match.settlementReceipt.finalVitals.ace.currentHealth = 172; }],
        ['receipt while active', 'start', r => { r.match.settlementReceipt = {}; }],
        ['intent applied at the current turn', 'swap-1-voluntary', r => { r.intent.appliedTurn = r.match.battle.turn; }],
        ['empty reply that is not alreadyProcessed', 'resume-empty', r => { r.alreadyProcessed = false; }],
    ];
    it.each(refuse)('refuses %s', (_label, name, edit) => {
        const r = reply(name); edit(r);
        expect(() => readArena3v3Reply(r)).toThrow(/arena_(3v3_reply|receipt)_invalid/);
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
        let seenInFlight: unknown, persistedInFlight: unknown;
        const { flow, intents, call } = setup(host('report-2-active-ko', async r => {
            seenInFlight = structuredClone(flow.teamReply); persistedInFlight = intents.peek();
            return { ...answer, intent: { ...answer.intent!, intentId: r.intentId } };
        }));
        const before = await flow.resumeTeam();
        const after = await flow.swap('shadow');
        const sent = call.mock.calls[1][0] as Arena3v3Swap;
        expect(Object.keys(sent).sort()).toEqual(['holobotId', 'intentId', 'matchId', 'operation', 'schemaVersion', 'turn']);
        expect(sent).toMatchObject({ schemaVersion: 'arena-match-3v3-1', operation: 'swap', matchId: before.matchId, turn: before.match!.battle.turn, holobotId: 'shadow' });
        expect(sent.intentId).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
        expect(persistedInFlight).toEqual(sent); // durable before the call
        expect(seenInFlight).toEqual(before); // no optimistic swap
        expect(intents.peek()).toBeNull();
        expect(flow.teamReply).toBe(after);
        expect(arenaBenchCards(after.match!).map(c => [c.holobotId, c.role])).toEqual([['shadow', 'ACTIVE'], ['ace', 'BENCH'], ['kuma', 'KO']]);
    });
    it('a lost reply keeps the intent; retry resends it byte for byte and accepts the host replay', async () => {
        let n = 0;
        const { flow, intents, call } = setup(host('swap-1-voluntary', async () => { if (n++ === 0) throw Error('Arena confirmation delayed'); return reply('swap-1-replay'); }));
        // Resume to the pre-swap projection, then ask for the same swap as the fixture.
        const pre = reply('report-1-opponent-ko');
        call.mockImplementationOnce(async () => pre);
        await flow.resumeTeam();
        intents.set(fixtureSwap('swap-1-voluntary'));
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
    it('blocks a different swap while one is pending, and drops a pending intent from an earlier match', async () => {
        const pending = fixtureSwap('swap-2-forced-send-in');
        const a = setup(host('report-2-active-ko', async () => { throw Error('timeout'); }), pending);
        await a.flow.resumeTeam();
        await expect(a.flow.swap('ace')).rejects.toThrow('arena_intent_pending');
        expect(a.call).toHaveBeenCalledTimes(1);
        const b = setup(fixtureBenchHost('report-2-active-ko'), { ...pending, matchId: 'a3_' + '1'.repeat(32) });
        await b.flow.resumeTeam();
        await expect(b.flow.swap('shadow')).rejects.toThrow('unavailable'); // fresh intent id: the fixture host knows only its own
        expect(b.call.mock.calls[1][0]).toMatchObject({ matchId: reply('report-2-active-ko').matchId, holobotId: 'shadow', turn: 3 });
    });
    it('refuses a foreign intent echo and a changed frozen snapshot without adopting them', async () => {
        const echo = setup(host('report-2-active-ko', async () => reply('swap-2-forced-send-in')));
        const before = await echo.flow.resumeTeam();
        await expect(echo.flow.swap('shadow')).rejects.toThrow('arena_3v3_intent_mismatch');
        expect(echo.flow.teamReply).toEqual(before);
        expect(echo.intents.peek()).not.toBeNull(); // unknown outcome: keep the exact body for retry
        const changed = reply('swap-2-forced-send-in'); changed.match!.team[2].fighter.level = 9;
        const snap = setup(host('report-2-active-ko', async () => changed), fixtureSwap('swap-2-forced-send-in'));
        await snap.flow.resumeTeam();
        await expect(snap.flow.swap('shadow')).rejects.toThrow('arena_snapshot_changed');
        expect(snap.flow.teamReply).toEqual(before);
    });
    it('single-flight and sign-out stop a stale reply from landing', async () => {
        let done!: (v: unknown) => void;
        const { flow, signout } = setup(host('report-2-active-ko', () => new Promise(resolve => { done = resolve; })), fixtureSwap('swap-2-forced-send-in'));
        await flow.resumeTeam();
        const p = flow.swap('shadow');
        for (let i = 0; i < 50 && !done; i++) await Promise.resolve();
        await expect(flow.swap('shadow')).rejects.toThrow('arena_busy');
        signout(); done(reply('swap-2-forced-send-in'));
        await expect(p).rejects.toThrow('arena_session_changed');
        expect(flow.teamReply).toBeNull();
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
    ];
    it.each(cases)('%s → %s', async (refused, resumeAt, target, code) => {
        const { flow, intents, call } = setup(fixtureBenchHost(resumeAt), fixtureSwap(refused));
        const before = structuredClone(await flow.resumeTeam());
        const error = await flow.swap(target).then(() => null, e => e);
        expect(arenaHostRejection(error)).toBe(code);
        expect(error).toMatchObject({ code: `functions/${benchStep(refused).refusal!.code}` });
        expect(call).toHaveBeenCalledTimes(2);
        expect(flow.teamReply).toEqual(before);
        expect(intents.peek()).toBeNull(); // a final host ruling: nothing left to retry
        expect(arenaBenchCards(flow.teamReply!.match!)).toEqual(arenaBenchCards(before.match!));
    });
    it('the flow never sends the known-bad turn-less swap', async () => {
        const turnless = benchStep('refused-swap-without-turn').request;
        expect(Object.hasOwn(turnless, 'turn')).toBe(false);
        const { flow, call } = setup(host('start', async () => { throw fixtureRefusal({ code: 'failed-precondition', message: 'turn_mismatch', details: { rejectionCode: 'turn_mismatch' } }); }));
        await flow.resumeTeam();
        await flow.swap('kuma').catch(() => { });
        expect(call.mock.calls[1][0]).toMatchObject({ operation: 'swap', turn: 0 });
    });
});

describe('known bad: legacy local teamBattle regen never reaches the bench cards', () => {
    it('legacy regen really raises bench STA on the client, and the reader refuses that state', () => {
        const { before, after } = legacyLocalTeam();
        expect(before.player.slots.map(s => s.fighter.stamina)).toEqual([4, 4, 4]);
        expect(after.player.slots.map(s => s.fighter.stamina)).toEqual([4, 7, 7]); // local authority: bench regen
        expect(() => readArena3v3Reply(after)).toThrow('arena_3v3_reply_invalid');
        expect(() => readArena3v3Reply({ ...reply('start'), match: after })).toThrow('arena_3v3_reply_invalid');
    });
    it('cards carry host HP and the host level only, with no STA or regen field', () => {
        for (const s of accepted.filter(s => (s.reply as Arena3v3Reply).match)) {
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
        const ace = accepted.filter(s => (s.reply as Arena3v3Reply).match).map(s => arenaBenchCards(readArena3v3Reply(s.reply).match!).find(c => c.holobotId === 'ace')!);
        ace.slice(1).forEach((c, i) => expect(c.currentHealth).toBeLessThanOrEqual(ace[i].currentHealth));
        const benched = accepted.filter(s => ['swap-1-voluntary', 'report-2-active-ko', 'swap-2-forced-send-in', 'report-3-opponent-ko', 'report-4-active-ko'].includes(s.name));
        for (const s of benched) expect(arenaBenchCards(readArena3v3Reply(s.reply).match!).find(c => c.holobotId === 'ace')).toMatchObject({ role: 'BENCH', currentHealth: 120, hpLabel: '120 / 172' });
    });
    it('no lite 3v3 module imports the legacy local-authority team code', () => {
        for (const file of ['components/arena/ArenaBenchCards.tsx', 'lib/arenaMatch3v3.ts', 'lib/arenaMatchFlow.ts', 'lib/arenaMatchClient.ts', 'screens/ArenaScreen.tsx']) {
            expect(src(file)).not.toMatch(/teamBattle|pvpTeamBattle|arena-team-battle-store/);
        }
        expect(src('components/arena/ArenaBenchCards.tsx')).not.toMatch(/stamina|Stamina|regen/);
    });
});

describe('bench presentation', () => {
    it('active first, then the bench in slot order; KO is shown, never hidden', () => {
        expect(arenaBenchCards(reply('start').match!).map(c => [c.name, c.levelBadge, c.role, c.hpLabel])).toEqual([['ACE', 'LV 4', 'ACTIVE', '172 / 172'], ['KUMA', 'LV 3', 'BENCH', '205 / 220'], ['SHADOW', 'LV 2', 'BENCH', '150 / 150']]);
        expect(arenaBenchCards(reply('report-2-active-ko').match!).map(c => [c.name, c.role])).toEqual([['KUMA', 'KO'], ['ACE', 'BENCH'], ['SHADOW', 'BENCH']]);
        expect(arenaBenchPhaseLine(reply('report-2-active-ko').match!)).toBe('HOST TURN 3 · SEND IN A FIGHTER');
        expect(arenaBenchPhaseLine(reply('swap-1-voluntary').match!)).toBe('HOST TURN 2 · SWAPS 1/2');
        expect(arenaBenchPhaseLine(reply('settle').match!)).toBe('HOST SETTLED · WIN');
    });
});

describe('3v3 entry stays honestly unavailable', () => {
    it('ArenaScreen shows inline copy instead of an Alert, and has no live 3v3 caller', () => {
        const screen = src('screens/ArenaScreen.tsx');
        expect(screen).not.toMatch(/\bAlert\b/);
        expect(screen).toContain('unavailable3v3Copy={ARENA_3V3_UNAVAILABLE_COPY}');
        expect(screen).not.toMatch(/onStart3v3|resumeTeam|\.swap\(|arena-match-3v3-1/);
        expect(ARENA_3V3_UNAVAILABLE_COPY).toMatch(/nothing is charged/);
        const menu = src('components/arena/ArenaPrebattleMenu.tsx');
        expect(menu).toContain('disabled={!canField3v3 || !threeVThreeOpen}');
        expect(menu).toContain('if (!teamComplete || !onStart3v3 || !threeVThreeOpen) return;');
    });
    it('QA bench routes put the known-bad cell first and resolve as registered screens', () => {
        expect(ARENA_BENCH_PREVIEW_ROUTES[0]).toBe('ArenaBenchKnownBad');
        const screens = { Home: null, ...Object.fromEntries(ARENA_BENCH_PREVIEW_ROUTES.map(n => [n, null])) };
        for (const name of ARENA_BENCH_PREVIEW_ROUTES) expect(previewInitialScreen(name, screens)).toBe(name);
        expect(src('qa/ArenaBenchPreview.tsx').match(/ArenaBench\w+: \(\)/g)!.map(s => s.slice(0, -4))).toEqual([...ARENA_BENCH_PREVIEW_ROUTES]);
        // One self-contained spread in the dev-only registry, so sibling route additions merge trivially.
        expect(src('qa/HoloCityPreview.tsx').match(/\.\.\.arenaBenchPreviewScreens,/g)).toHaveLength(1);
    });
});
