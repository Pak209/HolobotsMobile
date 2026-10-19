import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/config/holobots', () => ({ getHolobotFullImageSource: () => 1 }));
import { arenaHostBattle } from '@/lite/lib/arenaHostBattle';
import { readArenaReply } from '@/lite/lib/arenaMatchFlow';
import { useArenaBattleStore } from '@/lite/stores/arena-battle-store';
import { CPU_STAGE_HOLD_CAP_MS, holdCpuForStage, releaseCpuForStage } from '../arenaStageGate';
import fixture from '../../qa/fixtures/arena-admitted-lifecycle.json';

/** lite-arena-fast-1: the CPU's first action waits for the 3D stage. Real store, real game loop, fake clock. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), 'utf8');
const match = readArenaReply(fixture.steps.find(s => s.request.operation === 'start')!.reply).match!;
const cpuActions = () => { const b = useArenaBattleStore.getState().currentBattle!; return b.actionHistory.filter(a => a.actorId === b.opponent.holobotId).length; };
function startRound() {
    const p = arenaHostBattle(match, 'offline-fixture');
    const s = useArenaBattleStore.getState();
    s.startHostBattle(p.battle, p.playerMoves, p.opponentMoves);
    s.startGameLoop();
}

describe('CPU first-action gate (arenaStageGate)', () => {
    beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); useArenaBattleStore.getState().resetBattle(); });
    afterEach(() => { useArenaBattleStore.getState().resetBattle(); vi.useRealTimers(); });

    it('control: without the gate the CPU acts about one AI interval after the round starts', () => {
        startRound();
        vi.advanceTimersByTime(1300);
        expect(cpuActions()).toBe(1);
    });

    it('held: the CPU does not act while the stage loads, however long that takes (up to the cap)', () => {
        startRound();
        holdCpuForStage();
        vi.advanceTimersByTime(CPU_STAGE_HOLD_CAP_MS - 100);
        expect(cpuActions()).toBe(0);
    });

    it('release: the CPU then waits the same interval as at any fight start, and combat resumes normally', () => {
        startRound();
        holdCpuForStage();
        vi.advanceTimersByTime(4000); // a slow stage load
        releaseCpuForStage();
        vi.advanceTimersByTime(900);
        expect(cpuActions()).toBe(0);
        vi.advanceTimersByTime(400);
        expect(cpuActions()).toBe(1);
    });

    it('the player can act during the hold (only the CPU is gated)', () => {
        startRound();
        holdCpuForStage();
        useArenaBattleStore.getState().useMove('gap_closer');
        const b = useArenaBattleStore.getState().currentBattle!;
        expect(b.actionHistory.filter(a => a.actorId === b.player.holobotId)).toHaveLength(1);
        expect(cpuActions()).toBe(0);
    });

    it('the cap releases a stage that never reports in', () => {
        startRound();
        holdCpuForStage();
        vi.advanceTimersByTime(CPU_STAGE_HOLD_CAP_MS + 1300);
        expect(cpuActions()).toBe(1);
    });

    it('release never pushes the CPU clock forward when nothing is held', () => {
        startRound();
        const before = useArenaBattleStore.getState().lastAIActionTime;
        vi.advanceTimersByTime(500);
        releaseCpuForStage();
        expect(useArenaBattleStore.getState().lastAIActionTime).toBe(before);
    });

    it('timing only: the gate writes nothing but lastAIActionTime, and the store file is untouched by it', () => {
        const gate = read('../arenaStageGate.ts');
        expect([...gate.matchAll(/setState\(\{ ([a-zA-Z]+):/g)].map(m => m[1])).toEqual(['lastAIActionTime', 'lastAIActionTime']);
        expect(read('../../stores/arena-battle-store.ts')).not.toMatch(/arenaStageGate|holdCpu|releaseCpu/);
    });

    it('ArenaScreen holds once per shown round and releases on the stage-ready signal; no visual change', () => {
        const screen = read('../../screens/ArenaScreen.tsx');
        const stage = read('../../components/duel/LiveDuelStage.tsx');
        expect(screen).toContain("const roundShown = !!battle && phase.kind === 'battle';");
        expect(screen).toContain('stageGateFor.current === battle.battleId || stageReadyFor.current === battle.battleId');
        expect(screen).toContain('holdCpuForStage(); }, [roundShown, battle?.battleId]);');
        expect(screen).toContain('onStageReady={() => { stageReadyFor.current = battle.battleId; releaseCpuForStage(); }}');
        // Ready = GL loaded, GL failed, or no 3D for these fighters; the stage renders nothing new for it.
        expect(stage).toContain('const settled = ready || error || !player || !rival;');
        expect(stage).toContain('useEffect(() => { if (settled) stageReady.current?.(); }, [settled]);');
    });
});
