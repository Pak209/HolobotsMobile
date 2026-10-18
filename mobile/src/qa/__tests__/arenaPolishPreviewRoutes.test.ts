import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { previewInitialScreen } from '../previewRoutes';
import { previewScreenFromUrl } from '../previewDeepLink';
import { ARENA_POLISH_PREVIEW_ROUTES, ARENA_SETTLE_REPORT, ARENA_STARTED, arenaPayoutCappedIssue, arenaRefundReply, arenaWithheldReply, tooFast, ARENA_ISSUED } from '../arenaPolishFixtures';
import { ArenaMatchFlow, arenaIssuePayoutCapped, type ArenaPendingSettle, type ArenaReply } from '../../lib/arenaMatchFlow';
import { ArenaSettleConfirmer, type ArenaSettlePhase } from '../../lib/arenaSettleConfirm';
import { arenaScreenPhase } from '../../lib/arenaCopy';

const screens = { Home: null, ...Object.fromEntries(ARENA_POLISH_PREVIEW_ROUTES.map(name => [name, null])) };
const preview = readFileSync(path.resolve(__dirname, '../ArenaPolishPreview.tsx'), 'utf8');
const fixtures = readFileSync(path.resolve(__dirname, '../arenaPolishFixtures.ts'), 'utf8');

/** The same recorded-reply transport the QA cells mount, driven through the real phase logic. */
async function cellPhase(resume: () => ArenaReply, settle?: () => ArenaReply, settleForMs = 60_000) {
    let stored: ArenaPendingSettle | null = settle ? { matchId: ARENA_STARTED.matchId!, report: ARENA_SETTLE_REPORT } : null;
    const flow = new ArenaMatchFlow(async r => r.operation === 'resume' ? resume() : settle!(), { get: async () => null, set: async () => { } }, () => true, undefined, { settles: { get: async () => stored, set: async v => { stored = v; } } });
    const reply = await flow.resume();
    let last: ArenaSettlePhase = { kind: 'idle' };
    if (await flow.pendingSettle()) { new ArenaSettleConfirmer(flow, p => { last = p; }).resume(); await vi.advanceTimersByTimeAsync(settleForMs); }
    return arenaScreenPhase({ reply, acknowledged: false, hasCheckpoint: false, settle: last, pendingIssue: false, error: null });
}

describe('lite-arena-polish-1 offline QA routes', () => {
    it('registers the cells, known-bad first, in the preview registry', () => {
        expect(ARENA_POLISH_PREVIEW_ROUTES[0]).toBe('ArenaPolishKnownBad');
        for (const name of ARENA_POLISH_PREVIEW_ROUTES) expect(preview).toContain(name);
        expect(readFileSync(path.resolve(__dirname, '../HoloCityPreview.tsx'), 'utf8')).toContain('...arenaPolishPreviewScreens,');
    });
    it.each(ARENA_POLISH_PREVIEW_ROUTES)('opens %s by env and deep link', (name) => {
        expect(previewInitialScreen(name, screens)).toBe(name);
        expect(previewScreenFromUrl(`holobotsmobile://qa/${name}`, screens)).toBe(name);
    });
    it('cells reach the intended REAL screen phases from recorded replies', async () => {
        vi.useFakeTimers();
        try {
            expect(await cellPhase(() => ARENA_ISSUED)).toEqual({ kind: 'admitted', interrupted: false });
            expect(arenaIssuePayoutCapped(arenaPayoutCappedIssue())).toBe(true);
            expect(await cellPhase(() => ARENA_STARTED, () => { throw tooFast(600_000); })).toEqual({ kind: 'confirming' });
            expect(await cellPhase(() => ARENA_STARTED, () => { throw tooFast(0); })).toEqual({ kind: 'stalled' });
            expect(await cellPhase(() => arenaWithheldReply('daily_cap'))).toEqual({ kind: 'receipt' });
            expect(await cellPhase(() => arenaRefundReply())).toEqual({ kind: 'closure' });
        } finally { vi.useRealTimers(); }
    });
    it('Hermes safety: no structuredClone call in the QA cells or fixtures; banners say QA / RECORDED', () => {
        for (const src of [preview, fixtures]) expect(src).not.toMatch(/structuredClone\s*\(/);
        expect(preview).toContain('QA / OFFLINE / RECORDED REPLIES');
        expect(fixtures).toContain('ANTICIPATED');
    });
});
