import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Pressable, Text, StyleSheet, ActivityIndicator, AppState, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/theme';
import { useAuth } from '@/contexts/AuthContext';
import { ArenaPrebattleMenu } from '@/components/arena/ArenaPrebattleMenu';
import { BattleArenaView } from '@/components/arena/BattleArenaView';
import { BattleResultsModal } from '@/components/arena/BattleResultsModal';
import { ArenaFighterCard, ArenaInterstitial } from '@/components/arena/ArenaInterstitial';
import { HomeCogButton } from '@/components/HomeCogButton';
import { PvpArenaModal } from '@/components/arena/PvpArenaModal';
import { getTierOpponentLineup, type ArenaTier } from '@/config/arenaConfig';
import type { UserHolobot } from '@/types/profile';
import { createArenaMatchClient } from '@/lib/arenaMatchClient';
import { arenaClosureResult, arenaIssuePayoutCapped, arenaReceiptResult, type ArenaMatchFlow, type ArenaReply } from '@/lib/arenaMatchFlow';
import { ArenaSettleConfirmer, type ArenaSettlePhase } from '@/lib/arenaSettleConfirm';
import { ARENA_SCREEN_COPY as COPY, arenaForfeitHp, arenaQuitPrompt, arenaScreenPhase, type ArenaQuitPrompt } from '@/lib/arenaCopy';
import { ARENA_3V3_UNAVAILABLE_COPY } from '@/lib/arenaMatch3v3';
import { arenaHostBattle } from '@/lib/arenaHostBattle';
import { readHostVitals } from '@/lib/arenaVitals';
import { useArenaBattleStore } from '@/stores/arena-battle-store';
import { arenaEconomyChange, notifyHostEconomyChanged } from '@/lib/hostDashboard';
/** Lite CPU Arena. Presentation and transport only (hard rule 1): the City admits, settles and pays; this screen shows
 * its replies, runs the existing client practice sim between `start` and `settle`, and never decides an outcome. */
/** Offline QA only (src/qa/ArenaPolishPreview.tsx, __DEV__ harness): a recorded-reply transport instead of the callable. */
export type ArenaScreenPreview = { flow: ArenaMatchFlow; uid: string; payoutCapped?: boolean };
export function ArenaScreen({ preview }: { preview?: ArenaScreenPreview } = {}) {
    const { user, profile } = useAuth();
    const uid = preview?.uid ?? user?.uid;
    const insets = useSafeAreaInsets();
    const flow = useMemo(() => preview?.flow ?? (uid ? createArenaMatchClient(uid) : null), [uid, preview?.flow]);
    const currentFlow = useRef(flow);
    currentFlow.current = flow;
    const live = useRef(false);
    const [reply, setReply] = useState<ArenaReply | null>(null);
    const [acknowledged, setAcknowledged] = useState(false);
    const [pendingIssue, setPendingIssue] = useState(false);
    const [pendingSettleHp, setPendingSettleHp] = useState<number | null>(null);
    const [settlePhase, setSettlePhase] = useState<ArenaSettlePhase>({ kind: 'idle' });
    const [cappedMatchId, setCappedMatchId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [pvp, setPvp] = useState(false);
    const [quitAsk, setQuitAsk] = useState<{ prompt: ArenaQuitPrompt; hp: number | null } | null>(null);
    const store = useArenaBattleStore();
    const submitted = useRef<string | null>(null);
    const economySeen = useRef<string | null>(null);
    const mine = () => live.current && currentFlow.current === flow;
    const apply = async (r: ArenaReply) => {
        if (!flow || !mine())
            return;
        // Issue charged / settle paid / cancel refunded: the dashboard re-reads Holos, SYNC and levels from the City.
        const economy = arenaEconomyChange(r);
        if (economy && economy !== economySeen.current) { economySeen.current = economy; notifyHostEconomyChanged(uid); }
        const [acked, issue, settle] = await Promise.all([flow.acknowledged(r), flow.pendingIssue(), flow.pendingSettle()]);
        if (!mine())
            return;
        if (preview?.payoutCapped && arenaIssuePayoutCapped(r)) setCappedMatchId(r.matchId);
        setReply(r);
        setAcknowledged(acked);
        setPendingIssue(!!issue);
        setPendingSettleHp(settle?.report.playerFinalHealth ?? null);
        setError(null);
    };
    const applyRef = useRef(apply);
    applyRef.current = apply;
    const confirmer = useMemo(() => flow ? new ArenaSettleConfirmer(flow, phase => {
        if (!live.current || currentFlow.current !== flow)
            return;
        setSettlePhase(phase);
        if (phase.kind === 'settled')
            void applyRef.current(phase.reply);
    }) : null, [flow]);
    const fail = async (e: unknown) => {
        if (!flow || !mine())
            return;
        const issue = await flow.pendingIssue().catch(() => null);
        if (!mine())
            return;
        setPendingIssue(!!issue);
        setError(e);
    };
    /** Mount / foreground: re-read the City's view; a stored settle for the open match is resent unchanged. */
    const resumeAll = async () => {
        if (!flow)
            return;
        const r = await flow.resume();
        await apply(r);
        if (!mine() || r.match?.state !== 'active')
            return;
        if (await flow.pendingSettle()) { confirmer?.resume(); return; }
        const s = useArenaBattleStore.getState();
        if (s.currentBattle?.battleId === r.matchId && !s.battleResult) { s.startGameLoop(); s.setPaused(false); }
    };
    useEffect(() => {
        live.current = true;
        setBusy(false);
        setReply(null);
        setError(null);
        setSettlePhase({ kind: 'idle' });
        submitted.current = null;
        void resumeAll().catch(fail);
        return () => { live.current = false; confirmer?.stop(); flow?.close(); useArenaBattleStore.getState().setPaused(true); useArenaBattleStore.getState().stopGameLoop(); };
    }, [flow]);
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') {
                useArenaBattleStore.getState().setPaused(true);
                confirmer?.stop();
                return;
            }
            void resumeAll().catch(fail);
        });
        return () => subscription.remove();
    }, [flow]);
    const action = async (work: () => Promise<void>) => { if (!flow || busy)
        return; setBusy(true); try {
        await work();
    }
    catch (e) {
        await fail(e);
    }
    finally {
        if (mine())
            setBusy(false);
    } };
    const launch = async () => {
        if (!flow?.reply?.match)
            return;
        // Verify all required move fields before changing issued -> active.
        const admitted = flow.reply.match;
        arenaHostBattle({ ...admitted, state: 'active' }, uid!);
        const r = admitted.state === 'issued' ? await flow.start() : flow.reply;
        if (!mine())
            return;
        await apply(r);
        if (r.match?.state !== 'active')
            return;
        // A result saved for the City is resent, never replayed as a new fight.
        if (await flow.pendingSettle()) { confirmer?.resume(); return; }
        const existing = useArenaBattleStore.getState().currentBattle;
        if (existing?.battleId === r.matchId) {
            store.startGameLoop();
            store.setPaused(false);
            return;
        }
        // F3: no local checkpoint for an active match (lost `start` reply, relaunch). The practice restarts from the
        // City's admitted snapshot (its entry HP) instead of forcing a 0-HP forfeit with no fight.
        const prepared = arenaHostBattle(r.match, uid!);
        submitted.current = null;
        store.startHostBattle(prepared.battle, prepared.playerMoves, prepared.opponentMoves);
    };
    const start = ({ selectedHolobot, tier, paymentMethod }: {
        selectedHolobot: UserHolobot;
        tier: ArenaTier;
        paymentMethod: 'tokens' | 'pass';
    }) => action(async () => {
        const opponentName = getTierOpponentLineup(tier, selectedHolobot.name)[0];
        const r = await flow!.issue({ requestId: `lite_arena_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, tierId: tier.id, paymentMethod, holobotId: selectedHolobot.name.toLowerCase(), opponentName });
        await apply(r);
        // ANTICIPATED payoutCapped: stop before START so the player reads the notice (and may cancel for a refund).
        if (arenaIssuePayoutCapped(r)) { setCappedMatchId(r.matchId); return; }
        await launch();
    });
    const battle = store.currentBattle?.battleId === reply?.matchId ? store.currentBattle : null;
    useEffect(() => { if (store.battleResult && battle && reply?.match?.state === 'active' && submitted.current !== battle.battleId) {
        submitted.current = battle.battleId;
        store.setPaused(true);
        confirmer?.start({ playerFinalHealth: battle.player.currentHP, opponentFinalHealth: battle.opponent.currentHP, combosCompleted: Math.min(25, battle.actionHistory.filter(a => a.triggeredCombo).length), perfectDefenses: Math.min(25, battle.actionHistory.filter(a => a.perfectDefense).length) });
    } }, [store.battleResult, battle?.battleId, reply?.match?.state]);
    const match = reply?.match ?? null;
    const phase = arenaScreenPhase({ reply, acknowledged, hasCheckpoint: !!battle, settle: settlePhase, pendingIssue, error });
    const pendingWin = pendingSettleHp !== null || ['sending', 'waiting', 'stalled'].includes(settlePhase.kind);
    const doCancel = (hp: number | undefined) => action(async () => {
        confirmer?.stop();
        const r = await flow!.cancel(hp);
        setSettlePhase({ kind: 'idle' });
        store.resetBattle();
        await apply(r);
    });
    /** QUIT / CANCEL always confirms first; a forfeit over an unconfirmed win says so (it is never silent). */
    const quit = () => {
        if (!match || (match.state !== 'issued' && match.state !== 'active'))
            return;
        const forfeitHp = match.state === 'active' ? arenaForfeitHp({ checkpointHp: battle?.player.currentHP ?? null, pendingSettleHp, admissionHp: match.entrant.currentHealth ?? match.entrant.maxHealth }) : null;
        setQuitAsk({ prompt: arenaQuitPrompt({ state: match.state, pendingSettle: pendingWin, fighter: match.entrant.displayName, forfeitHp }), hp: forfeitHp });
    };
    const exit = () => action(async () => {
        if (reply?.matchId)
            await flow!.acknowledge(reply.matchId);
        store.resetBattle();
        submitted.current = null;
        setCappedMatchId(null);
        setSettlePhase({ kind: 'idle' });
        setAcknowledged(true);
    });
    const context = match ? `${match.entrant.displayName} LV ${match.entrant.level} · ${match.opponent.displayName} LV ${match.opponent.level}` : undefined;
    const result = phase.kind === 'receipt' ? arenaReceiptResult(reply!) : null;
    const closure = phase.kind === 'closure' ? arenaClosureResult(reply!) : null;
    const fighters = match ? <View style={styles.fighters}><ArenaFighterCard snapshot={match.entrant} side="entrant"/><ArenaFighterCard snapshot={match.opponent} side="opponent"/></View> : null;
    const pad = { paddingTop: insets.top + theme.space.md, paddingBottom: insets.bottom + theme.space.md };
    const framed = (node: ReactNode) => <ScrollView contentContainerStyle={[styles.framed, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + theme.space.xl }]}>{node}</ScrollView>;
    const inFight = phase.kind === 'battle' || phase.kind === 'confirming';
    return <View style={styles.page}>
  {!inFight ? <HomeCogButton onOpenPvp={() => setPvp(true)}/> : null}
  {phase.kind === 'menu' && !busy ? <ArenaPrebattleMenu onStartBattle={start} unavailable3v3Copy={ARENA_3V3_UNAVAILABLE_COPY} hostVitals={readHostVitals(profile?.holobotVitals)} userArenaPasses={profile?.arena_passes ?? 0} userHolobots={profile?.holobots ?? []} userTokens={profile?.holosTokens ?? 0}/> : null}
  {phase.kind === 'pendingIssue' ? framed(<ArenaInterstitial tone="warning" eyebrow={COPY.pendingIssueEyebrow} title={COPY.pendingIssueTitle} body={COPY.pendingIssueBody} actions={[
            { label: COPY.retryEntry, onPress: () => void action(async () => { const r = await flow!.retryIssue(); await apply(r); if (arenaIssuePayoutCapped(r)) { setCappedMatchId(r.matchId); return; } await launch(); }) },
            { label: COPY.discardEntry, tone: 'secondary', onPress: () => void action(async () => { await flow!.discardPendingIssue(); await resumeAll(); }) },
        ]}/>) : null}
  {phase.kind === 'admitted' && match ? framed(<ArenaInterstitial eyebrow={phase.interrupted ? COPY.interruptedEyebrow : COPY.admittedEyebrow} title={phase.interrupted ? COPY.interruptedTitle : COPY.admittedTitle} body={phase.interrupted ? COPY.interruptedBody : COPY.admittedBody} notice={cappedMatchId === reply?.matchId ? COPY.payoutCapped : null} actions={[
            { label: phase.interrupted ? COPY.restart : COPY.start, onPress: () => void action(launch) },
            { label: phase.interrupted ? COPY.forfeit : COPY.cancelRefund, tone: phase.interrupted ? 'danger' : 'secondary', onPress: quit },
        ]}>{fighters}</ArenaInterstitial>) : null}
  {battle && (phase.kind === 'battle' || phase.kind === 'confirming') ? <View style={[styles.fight, pad]}>
      <BattleArenaView embedded battle={battle} hostMatchReply={reply} hostMatchId={reply!.matchId!} roundProgress={{ currentRound: 1, totalRounds: 1 }} playerCards={store.playerMoves} playableCardIds={store.getPlayableMoves().map(m => m.id)} cardAvailability={store.getMoveAvailabilityMap()} lastAction={store.lastAction} isAnimating={store.isAnimating} onCardPlay={store.useMove} onSignaturePlay={() => { }}/>
      <Pressable accessibilityRole="button" disabled={settlePhase.kind === 'sending'} onPress={quit} style={styles.quit}><Text style={styles.quitLabel}>{COPY.quitInBattle}</Text></Pressable>
    </View> : null}
  {phase.kind === 'confirming' ? <View style={[styles.overlay, { paddingTop: insets.top + 64 }]}><ArenaInterstitial eyebrow={COPY.confirmingEyebrow} title={COPY.confirmingTitle} body={COPY.confirmingBody} waiting actions={[{ label: COPY.forfeit, tone: 'danger', disabled: settlePhase.kind === 'sending', onPress: quit }]}/></View> : null}
  {phase.kind === 'stalled' ? framed(<ArenaInterstitial tone="warning" eyebrow={COPY.stalledEyebrow} title={COPY.stalledTitle} body={COPY.stalledBody} actions={[
            { label: COPY.tryAgain, onPress: () => confirmer?.retryNow() },
            { label: COPY.forfeit, tone: 'danger', onPress: quit },
        ]}>{fighters}</ArenaInterstitial>) : null}
  {phase.kind === 'error' ? framed(<ArenaInterstitial tone="danger" eyebrow={COPY.errorEyebrow} title={phase.copy.title} body={phase.copy.body} actions={phase.matchOpen ? [
            { label: COPY.checkAgain, onPress: () => void action(async () => { setSettlePhase({ kind: 'idle' }); await resumeAll(); }) },
            { label: match?.state === 'issued' ? COPY.cancelRefund : COPY.forfeit, tone: 'danger', onPress: quit },
        ] : [
            { label: COPY.checkAgain, onPress: () => void action(resumeAll) },
            { label: COPY.back, tone: 'secondary', onPress: () => setError(null) },
        ]}/>) : null}
  {result ? <BattleResultsModal visible didWin={result.didWin} receipt={{ kind: 'host', rewards: result.rewards, withheld: result.payoutWithheld }} context={context} hideRematch onRematch={() => { }} onExit={() => void exit()}/> : null}
  {closure && match ? <BattleResultsModal visible didWin={false} receipt={{ kind: 'host', rewards: { exp: 0, syncPoints: 0 } }} closure={{ closure, fighter: match.entrant.displayName }} context={context} hideRematch onRematch={() => { }} onExit={() => void exit()}/> : null}
  {busy || (settlePhase.kind === 'sending' && phase.kind === 'battle') ? <View style={styles.loadingOverlay}><ActivityIndicator color={theme.colors.accent}/></View> : null}
  <Modal visible={!!quitAsk} transparent animationType="fade" onRequestClose={() => setQuitAsk(null)}>
    <View style={[styles.overlay, styles.confirm]}>
      {quitAsk ? <ArenaInterstitial tone="danger" eyebrow={COPY.errorEyebrow} title={quitAsk.prompt.title} body={quitAsk.prompt.body} actions={[
                { label: quitAsk.prompt.confirm, tone: 'danger', onPress: () => { const hp = quitAsk.hp; setQuitAsk(null); void doCancel(hp ?? undefined); } },
                { label: quitAsk.prompt.dismiss, tone: 'secondary', onPress: () => setQuitAsk(null) },
            ]}/> : null}
    </View>
  </Modal>
  <PvpArenaModal visible={pvp} onClose={() => setPvp(false)} userHolobots={profile?.holobots ?? []}/>
 </View>;
}
const styles = StyleSheet.create({
  page: {backgroundColor:theme.colors.carbon,flex:1},
  framed: {flexGrow:1,justifyContent:'center',paddingHorizontal:theme.space.lg},
  fighters: {flexDirection:'row',gap:theme.space.md,marginTop:theme.space.lg},
  fight: {flex:1},
  quit: {alignItems:'center',alignSelf:'center',justifyContent:'center',minHeight:theme.touchTarget,paddingHorizontal:theme.space.xl},
  quitLabel: {...theme.type.caption,color:theme.colors.danger,letterSpacing:1},
  overlay: {...StyleSheet.absoluteFillObject,backgroundColor:theme.plates.overlay,paddingHorizontal:theme.space.lg},
  confirm: {justifyContent:'center'},
  loadingOverlay: {alignItems:'center',backgroundColor:theme.plates.overlay,bottom:0,justifyContent:'center',left:0,position:'absolute',right:0,top:0},
});
