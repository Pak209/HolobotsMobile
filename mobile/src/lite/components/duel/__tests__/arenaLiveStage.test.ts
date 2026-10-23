import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/config/holobots', () => ({ getHolobotFullImageSource: () => 1 }));
import { arenaHostBattle } from '@/lite/lib/arenaHostBattle';
import { readArenaReply } from '@/lite/lib/arenaMatchFlow';
import { arenaFighterLevel } from '@/lite/lib/bots/arenaFighterLevel';
import { useArenaBattleStore } from '@/lite/stores/arena-battle-store';
import type { HoloCityCommand } from '@/lite/components/HoloCityCommandBar';
import { liveDuelCommandMove, liveDuelCommands } from '../liveDuelCommands';
import { FAST_RENDER_QUALITY, PERF_SWEEP_ARMS, PRODUCTION_KNOBS, resolveStageRender } from '@/lite/lib/bots/stagePerf';
import fixture from '../../../qa/fixtures/arena-admitted-lifecycle.json';

/** lite-arena-stage-1: the CPU Arena round renders the city duel's park-arena 3D stage. There is no RN renderer here, so
 * the command mapping runs for real against the Arena store, and the screen wiring is pinned at its source lines. */
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url) as unknown as string), 'utf8');
const screen = read('../../../screens/ArenaScreen.tsx');
const stage = read('../LiveDuelStage.tsx');
const city = read('../../city/CityLiveBattleView.tsx');
// Main: FighterHud lives in the Enabled* half of the lazy split; the wrapper is string-free (lite-main-port-2 note).
const botStage = read('../../bots/BotStage.tsx');
const hud = read('../../../screens/EnabledDuelPlaybackScreen.tsx');
// The four plates as HoloCityCommandBar declares them (that module imports react-native, which this env cannot load).
const PLATES: HoloCityCommand[] = [{ id: 'strike', label: 'STRIKE' }, { id: 'heavy', label: 'HEAVY' }, { id: 'defend', label: 'DEFEND' }, { id: 'finisher', label: 'FINISHER' }];
const startReply = fixture.steps.find(s => s.request.operation === 'start')!.reply;
const match = readArenaReply(startReply).match!;

describe('Arena round on the shared 3D stage', () => {
    beforeEach(() => { useArenaBattleStore.getState().resetBattle(); });

    it('plates map to the City-issued moves; DEFEND and FINISHER stay unavailable for a CPU match', () => {
        const { battle, playerMoves } = arenaHostBattle(match, 'offline-fixture');
        const commands = liveDuelCommands(PLATES, { battle, moves: playerMoves, power: 'half', signature: !battle.hostSnapshot, playableIds: playerMoves.map(m => m.id), blocked: false });
        expect(commands.map(c => [c.id, c.detail, c.cost, c.disabled])).toEqual([
            ['strike', 'GAP CLOSER', `${playerMoves[0].staminaCost} STA`, false],
            ['heavy', 'BREAK HEAVY', `${playerMoves[1].staminaCost} STA`, false],
            ['defend', undefined, undefined, true],
            ['finisher', undefined, undefined, true],
        ]);
    });

    it('availability is the store\'s: a move missing from playableIds, or a move in flight, is disabled', () => {
        const { battle, playerMoves } = arenaHostBattle(match, 'offline-fixture');
        const onlyStrike = liveDuelCommands(PLATES, { battle, moves: playerMoves, power: 'half', signature: false, playableIds: ['gap_closer'], blocked: false });
        expect(onlyStrike.map(c => c.disabled)).toEqual([false, true, true, true]);
        const animating = liveDuelCommands(PLATES, { battle, moves: playerMoves, power: 'half', signature: false, playableIds: playerMoves.map(m => m.id), blocked: true });
        expect(animating.every(c => c.disabled)).toBe(true);
    });

    it('a STRIKE press plays the issued move through store.useMove (the same call BattleArenaView made)', () => {
        const prepared = arenaHostBattle(match, 'offline-fixture');
        const store = useArenaBattleStore.getState();
        store.startHostBattle(prepared.battle, prepared.playerMoves, prepared.opponentMoves);
        const before = useArenaBattleStore.getState().currentBattle!;
        const card = liveDuelCommandMove('strike', useArenaBattleStore.getState().playerMoves)!;
        expect(card.id).toBe('gap_closer');
        useArenaBattleStore.getState().useMove(card.id);
        const after = useArenaBattleStore.getState().currentBattle!;
        expect(after.actionHistory.length).toBe(before.actionHistory.length + 1);
        expect(after.actionHistory.at(-1)!.card.id).toBe('gap_closer');
        expect(liveDuelCommandMove('heavy', prepared.playerMoves)!.id).toBe('break_heavy');
        expect(liveDuelCommandMove('defend', prepared.playerMoves)).toBeUndefined();
        expect(liveDuelCommandMove('finisher', prepared.playerMoves)).toBeUndefined();
    });

    it('the LV tab reads the arena reply (entrant/opponent), and nothing without the exact admitted match', () => {
        const { battle } = arenaHostBattle(match, 'offline-fixture');
        expect(arenaFighterLevel(startReply, match.matchId, 'entrant', battle.player.name)).toBe(match.entrant.level);
        expect(arenaFighterLevel(startReply, match.matchId, 'opponent', battle.opponent.name)).toBe(match.opponent.level);
        expect(arenaFighterLevel(startReply, undefined, 'entrant', battle.player.name)).toBeUndefined();
        expect(screen).toContain("levelTab levels={{ player: arenaFighterLevel(reply, reply?.matchId ?? undefined, 'entrant', battle.player.name), rival: arenaFighterLevel(reply, reply?.matchId ?? undefined, 'opponent', battle.opponent.name) }}");
        expect(hud).toMatch(/levelTab: \{ position: 'absolute', bottom: 0, left: 0/);
    });

    it('ArenaScreen renders LiveDuelStage with the same store calls, and no longer the flat BattleArenaView', () => {
        expect(screen).not.toContain('BattleArenaView');
        expect(screen).toContain('<LiveDuelStage battle={battle} moves={store.playerMoves} playableIds={store.getPlayableMoves().map(m => m.id)} pending={store.isAnimating} onPlay={store.useMove} onSignature={() => { }} signature={!battle.hostSnapshot} holdUntilReady={false}');
        expect(screen).toContain('leaveLabel={COPY.quitInBattle} leaveDisabled={settlePhase.kind === \'sending\'} onLeave={quit}');
        expect(screen).toContain("battle && (phase.kind === 'battle' || phase.kind === 'confirming') ? <View style={styles.fight}>");
    });

    it('critic #1: the toolbar clears the pilot-menu cog (48 pt at insets.top + 10, right 18), so QUIT stays reachable', () => {
        const cog = read('../../HomeCogButton.tsx');
        expect(cog).toContain('insets.top + 10');
        expect(cog).toMatch(/right: 18 \+ insets\.right/);
        expect(cog).toMatch(/trigger: \{ position: "absolute", width: 48, height: 48/);
        // top: 12 pt container inset + 60 pt reserve = 72 pt >= 18 + 48 pt cog; the HUD starts at top + 44 + 8 = +62 > +58.
        expect(screen).toContain('chrome={{ top: insets.top + 10, right: 60 }}');
        expect(stage).toContain('chrome ? { marginRight: chrome.right } : null');
        expect(stage).toMatch(/top: \{ position: 'absolute', top: 0, left: 12, right: 12 \}/);
        expect(stage).toMatch(/button: \{ minHeight: 44/);
    });

    it('critic #7: the GL scene pauses under the confirming / quit overlays (presentation only)', () => {
        expect(screen).toContain("active={phase.kind === 'battle' && !quitAsk}");
        expect(stage).toContain('active={active}');
    });

    it('every Arena-only state stays outside the stage', () => {
        expect(screen).toContain("phase.kind === 'admitted' && match ? framed(<ArenaInterstitial");
        expect(screen).toContain('notice={cappedMatchId === reply?.matchId ? COPY.payoutCapped : null}');
        expect(screen).toContain('title={winPending ? COPY.confirmingTitle : COPY.confirmingResult}');
        expect(screen).toContain("receipt={{ kind: 'host', rewards: result.rewards, withheld: result.payoutWithheld }}");
        expect(screen).toContain('closure={{ closure, fighter: match.entrant.displayName }}');
        expect(screen).toContain('setQuitAsk({ prompt: arenaQuitPrompt(');
        expect(screen).toContain('hostVitals={readHostVitals(profile?.holobotVitals)}');
        expect(screen).toContain('unavailable3v3Copy={ARENA_3V3_UNAVAILABLE_COPY}');
        expect(screen).toContain('<PvpArenaModal');
        // lite-hud-row-1: the modal mounts the extracted live-battle body, which renders the (HoloCity-restyled) BattleArenaView;
        // lite-pvp-3d-1: on the Arena round's 3D stage (stage3d).
        expect(read('../../arena/PvpArenaModal.tsx')).toContain('<PvpLiveBattle');
        expect(read('../../arena/PvpLiveBattle.tsx')).toContain('<BattleArenaView');
        expect(read('../../arena/PvpLiveBattle.tsx')).toContain('stage3d');
    });

    it('the stage holds commands until 3D is ready only for the city duel; the Arena loop is never gated on GL load', () => {
        expect(stage).toContain('const waiting = holdUntilReady && !ready && !error && !!player && !!rival;');
        expect(stage).toContain('holdUntilReady = true');
        expect(stage).toContain("variant=\"duelPortrait\" transparentBackdrop");
        expect(stage).toContain("require('../../../../assets/battle/holocity-park.jpg')");
    });

    it('CityLiveBattleView keeps its props and the city level lookup, and delegates to the shared stage', () => {
        expect(city).toContain('hostIssue?: unknown; accountSnapshot?: unknown; battle: BattleState; moves: ActionCard[]; onPlay: (id: string) => void;');
        expect(city).toContain('<LiveDuelStage');
        expect(city).toContain("hostFighterLevel(hostIssue, 'player', battle.player.name, accountSnapshot)");
        expect(city).toContain("caption={preview ? 'OFFLINE PREVIEW · NO REWARDS' : 'HOLOCITY / PARK ARENA'} leaveLabel=\"LEAVE\"");
    });
    it("Pak's call: the Arena round renders #133's fast mix (msaa0 + halfRes + anim30); since lite-sim-fixes-1 the city duel does too", () => {
        expect(FAST_RENDER_QUALITY).toEqual({ msaaSamples: 0, resolution: 0.5, animHz: 30 });
        // The same mix the #133 sweep measured as `combo`.
        const combo = PERF_SWEEP_ARMS.find(a => a.id === 'combo')!.knobs;
        expect({ msaaSamples: combo.msaaSamples, resolution: combo.resolution, animHz: combo.animHz }).toEqual(FAST_RENDER_QUALITY);
        expect(screen).toContain('renderQuality={FAST_RENDER_QUALITY}');
        expect(stage).toContain('quality={renderQuality} perf={perf}');
        // City rival / park duel: it drew a full 402x788 buffer at 7-10 sim fps; it now passes the Arena round's mix.
        expect(city).toContain('renderQuality={FAST_RENDER_QUALITY}');
        expect(resolveStageRender(undefined)).toEqual({ msaaSamples: PRODUCTION_KNOBS.msaaSamples, resolution: 1, animHz: 0 });
    });

    it('dev perf-sweep knobs still override the caller quality, and BotStage applies the resolved settings', () => {
        const halfResOnly = PERF_SWEEP_ARMS.find(a => a.id === 'halfRes')!.knobs;
        expect(resolveStageRender(FAST_RENDER_QUALITY, halfResOnly)).toEqual({ msaaSamples: 1, resolution: 0.5, animHz: 0 });
        expect(resolveStageRender(FAST_RENDER_QUALITY, PRODUCTION_KNOBS)).toEqual({ msaaSamples: 1, resolution: 1, animHz: 0 });
        expect(botStage).toContain('const perfRun = __DEV__ ? perf : undefined;');
        expect(botStage).toContain('const renderSettings = resolveStageRender(quality, perfRun?.knobs);');
        expect(botStage).toContain('msaaSamples={renderSettings.msaaSamples}');
        expect(botStage).toContain('Math.min(1, renderScale)) * renderSettings.resolution;');
        expect(botStage).toContain('const step = animHz ? throttledMixerStep(mixerPendingMs, elapsed, animHz) : null;');
        // A quality change remounts the GL context (it is part of the signature).
        expect(botStage).toContain(':m${renderSettings.msaaSamples}a${renderSettings.animHz}:');
    });
});
