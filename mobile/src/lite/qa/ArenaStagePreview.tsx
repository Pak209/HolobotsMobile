import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArenaScreen } from '@/lite/screens/ArenaScreen';
import { BattleArenaView } from '@/lite/components/arena/BattleArenaView';
import { ArenaMatchFlow, type ArenaCheckpoint, type ArenaIssue, type ArenaPendingSettle, type ArenaReply } from '@/lite/lib/arenaMatchFlow';
import { arenaHostBattle } from '@/lite/lib/arenaHostBattle';
import { theme } from '@/lite/theme';
import { useArenaBattleStore } from '@/lite/stores/arena-battle-store';
import { ARENA_SETTLED, ARENA_STARTED, tooFast } from './arenaPolishFixtures';

/**
 * Offline QA routes for lite-arena-stage-1 (holobotsmobile://qa/ArenaStage…). Each cell mounts the REAL ArenaScreen on a
 * recorded-reply transport (no callable, no account, nothing charged) with an F3 checkpoint for the started fixture
 * match, so CONTINUE FIGHT brings up the round on the park-arena 3D stage. Known-bad control first.
 */
const match = ARENA_STARTED.match!;
type Cell = { title: string; caption: string; opponentHp: number; opponentBot?: string; settle: () => ArenaReply; gate?: false; vfx?: false };
const unavailable = () => { throw Object.assign(Error('unavailable'), { code: 'functions/unavailable', details: { rejectionCode: 'unavailable' } }); };
const CELLS: Record<string, Cell> = {
    ArenaStageRound: { title: 'ROUND ON 3D STAGE', caption: 'CONTINUE FIGHT: park plate, GLB bots, FighterHud with LV corner tabs, command bar.', opponentHp: match.opponent.maxHealth, settle: unavailable },
    // lite-arena-fast-1 witness: the same idle round with the CPU stage gate switched off (QA only), for the timing pair.
    ArenaStageRoundNoGate: { title: 'ROUND · NO CPU GATE', caption: 'QA control: fast mix only, CPU may act while the stage loads.', opponentHp: match.opponent.maxHealth, settle: unavailable, gate: false },
    // lite-vfx-port-1 control: the same round with the combat VFX off (today's no-VFX hit; the fps baseline).
    ArenaStageRoundNoVfx: { title: 'ROUND · NO VFX', caption: 'QA control: the round without the combat VFX (lite-vfx-port-1 known-bad / fps baseline).', opponentHp: match.opponent.maxHealth, settle: unavailable, vfx: false },
    ArenaStageConfirming: { title: 'CONFIRMING ON STAGE', caption: 'One STRIKE KOs (checkpoint HP 1); the City answers too_fast: confirming over the stage.', opponentHp: 1, settle: () => { throw tooFast(600_000); } },
    ArenaStageKoReceipt: { title: 'KO → RECEIPT', caption: 'SYNTHETIC KUMA model / recorded stats. One STRIKE KOs; real ArenaScreen holds the KO endpoint before CITY RECEIPT.', opponentHp: 1, opponentBot: 'KUMA', settle: () => ARENA_SETTLED },
    ArenaStageReceipt: { title: 'RECEIPT AFTER STAGE', caption: 'One STRIKE KOs (checkpoint HP 1); the recorded settle shows the CITY RECEIPT.', opponentHp: 1, settle: () => ARENA_SETTLED },
};

function cellFlow(cell: Cell) {
    // Explicit QA model variant, not a new host reply: all recorded numbers and lifecycle operations remain unchanged.
    const modelVariant = (reply: ArenaReply): ArenaReply => cell.opponentBot && reply.match ? {
        ...reply, match: { ...reply.match, opponent: { ...reply.match.opponent,
            holobotId: cell.opponentBot.toLowerCase(), displayName: cell.opponentBot } },
    } : reply;
    let issue: ArenaIssue | null = null, ack: string | null = null;
    let checkpoint: ArenaCheckpoint | null = { matchId: match.matchId, report: { playerFinalHealth: match.entrant.currentHealth ?? match.entrant.maxHealth, opponentFinalHealth: cell.opponentHp, combosCompleted: 0, perfectDefenses: 0 } };
    let settle: ArenaPendingSettle | null = null;
    return new ArenaMatchFlow(async (request) => {
        if (request.operation === 'resume') return modelVariant(ARENA_STARTED);
        if (request.operation === 'settle') return modelVariant(cell.settle());
        return unavailable();
    }, { get: async () => issue, set: async v => { issue = v; } }, () => true, undefined, {
        settles: { get: async () => settle, set: async v => { settle = v; } },
        acks: { get: async () => ack, set: async v => { ack = v; } },
        checkpoints: { get: async () => checkpoint, set: async v => { checkpoint = v; } },
    });
}
/** Sits between the fighter HUD (with its LV tabs) and the command bar. */
function Banner({ title, caption }: { title: string; caption: string }) {
    const insets = useSafeAreaInsets();
    return <View pointerEvents="none" style={[styles.banner, { top: insets.top + 300 }]}><Text style={styles.bannerTitle}>{`QA / OFFLINE / RECORDED REPLIES · ${title}`}</Text><Text style={styles.bannerCaption}>{caption}</Text></View>;
}
const noop = () => { };
/** KNOWN BAD control: the pre-stage Arena round, exactly as ArenaScreen rendered it at b40c2ac (flat 2D cards). */
function ArenaStageKnownBad() {
    const insets = useSafeAreaInsets();
    const prepared = useMemo(() => arenaHostBattle(match, 'offline-fixture'), []);
    return <View style={styles.root}>
    <View style={{ flex: 1, paddingTop: insets.top + 58, paddingBottom: insets.bottom + theme.space.sm }}>
      <BattleArenaView embedded battle={prepared.battle} hostMatchReply={ARENA_STARTED} hostMatchId={match.matchId} roundProgress={{ currentRound: 1, totalRounds: 1 }} playerCards={prepared.playerMoves} playableCardIds={prepared.playerMoves.map(m => m.id)} cardAvailability={{}} lastAction={null} isAnimating={false} onCardPlay={noop} onSignaturePlay={noop}/>
    </View>
    <Banner title="KNOWN BAD (2D ROUND)" caption="The Arena fixture on the 2D BattleArenaView (PvP's view): sprite stage, no park duel. Since lite-hud-row-1 it wears the HoloCity HUD."/>
  </View>;
}
export const arenaStagePreviewScreens: Record<string, ComponentType> = {
    ArenaStageKnownBad,
    ...Object.fromEntries(Object.entries(CELLS).map(([name, cell]) => [name, function ArenaStageCell() {
        // The battle store is module scope and every cell shares the fixture matchId: clear it (after commit, never while
        // rendering) before the screen mounts, so each cell starts without a fight.
        const flow = useMemo(() => cellFlow(cell), []);
        const [fresh, setFresh] = useState(false);
        useEffect(() => { useArenaBattleStore.getState().resetBattle(); setFresh(true); }, []);
        // Witness timing (QA log only): ms from the round's first appearance to the CPU's first action and to the KO.
        useEffect(() => { let seenAt = 0, done = false; return useArenaBattleStore.subscribe(g => { const b = g.currentBattle; if (!b || done) return; if (!seenAt) seenAt = Date.now(); if (b.status !== 'completed') return; done = true; const cpu = b.actionHistory.find(a => a.actorId === b.opponent.holobotId); console.info('[ArenaStage:timing] ' + JSON.stringify({ cell: name, gate: cell.gate !== false, firstCpuActionMs: cpu ? cpu.timestamp - seenAt : null, koMs: Date.now() - seenAt, playerActions: b.actionHistory.filter(a => a.actorId === b.player.holobotId).length })); }); }, []);
        // Witness probe: the store inputs the stage's commands read, once a second (QA log only).
        useEffect(() => { const id = setInterval(() => { const g = useArenaBattleStore.getState(), b = g.currentBattle; if (b) console.info('[ArenaStage:store] ' + JSON.stringify({ cell: name, animating: g.isAnimating, paused: g.paused, playable: g.getPlayableMoves().map(m => m.id), moves: g.playerMoves.map(m => m.id), playerHp: b.player.currentHP, opponentHp: b.opponent.currentHP, stamina: b.player.stamina, status: b.status, loop: !!g.gameLoopIntervalId })); }, 1000); return () => clearInterval(id); }, []);
        if (!fresh) return <View style={styles.root}/>;
        return <View style={styles.root}><ArenaScreen preview={{ flow, uid: 'offline-fixture', showStageMetrics: true, cpuStageGate: cell.gate, vfx: cell.vfx, onStageMetrics: metrics => console.info('[ArenaStage:metrics] ' + JSON.stringify({ cell: name, ...metrics })) }}/><Banner title={cell.title} caption={cell.caption}/></View>;
    }])),
};
const styles = StyleSheet.create({
    root: { backgroundColor: theme.colors.carbon, flex: 1 },
    banner: { backgroundColor: theme.plates.overlay, left: 0, paddingHorizontal: theme.space.md, paddingVertical: theme.space.xs, position: 'absolute', right: 0 },
    bannerTitle: { ...theme.type.micro, color: theme.colors.accent, textAlign: 'center' },
    bannerCaption: { ...theme.type.micro, color: theme.colors.muted, textAlign: 'center' },
});
