import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, StyleSheet, ActivityIndicator, AppState, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/lite/theme';
import { useAuth } from '@/contexts/AuthContext';
import { ArenaPrebattleMenu } from '@/lite/components/arena/ArenaPrebattleMenu';
import { LiveDuelStage } from '@/lite/components/duel/LiveDuelStage';
import { arenaFighterLevel } from '@/lite/lib/bots/arenaFighterLevel';
import { BattleResultsModal } from '@/lite/components/arena/BattleResultsModal';
import { ArenaFighterCard, ArenaInterstitial } from '@/lite/components/arena/ArenaInterstitial';
import { HomeCogButton } from '@/lite/components/HomeCogButton';
import { PvpArenaModal } from '@/lite/components/arena/PvpArenaModal';
import { getTierOpponentLineup, type ArenaTier } from '@/config/arenaConfig';
import type { UserHolobot } from '@/types/profile';
import { createArenaMatchClient } from '@/lite/lib/arenaMatchClient';
import { arenaClosureResult, arenaIssuePayoutCapped, arenaReceiptResult, type ArenaCheckpoint, type ArenaMatchFlow, type ArenaReply, type ArenaSettleReport } from '@/lite/lib/arenaMatchFlow';
import { ArenaSettleConfirmer, type ArenaSettlePhase } from '@/lite/lib/arenaSettleConfirm';
import { ARENA_SCREEN_COPY as COPY, arenaForfeitHp, arenaQuitPrompt, arenaScreenPhase, type ArenaQuitPrompt } from '@/lite/lib/arenaCopy';
import { ARENA_3V3_UNAVAILABLE_COPY } from '@/lite/lib/arenaMatch3v3';
import { arenaHostBattle } from '@/lite/lib/arenaHostBattle';
import { readHostVitals } from '@/lite/lib/arenaVitals';
import { useArenaBattleStore } from '@/lite/stores/arena-battle-store';
import type { BotMetrics } from '@/lite/components/bots/BotStage';
import { arenaEconomyChange, notifyHostEconomyChanged } from '@/lite/lib/hostDashboard';
/** Lite CPU Arena. Presentation and transport only (hard rule 1): the City admits, settles and pays; this screen shows
 * its replies, runs the existing client practice sim between `start` and `settle`, and never decides an outcome. */
/** F3: performance carried over when an interrupted fight continues from its checkpoint, keyed by matchId. Module
 * scope, like the battle store it complements, so a remount mid-fight keeps it. */
const carriedPerformance = new Map<string, { combos: number; perfects: number }>();
/** Offline QA only (src/qa/ArenaPolishPreview.tsx, __DEV__ harness): a recorded-reply transport instead of the callable. */
export type ArenaScreenPreview = { flow: ArenaMatchFlow; uid: string; payoutCapped?: boolean; /** QA fps witness only. */ showStageMetrics?: boolean; onStageMetrics?: (metrics: BotMetrics) => void };
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
    // Settle phases are bound to the match the confirmer was started for; another match's phase is never shown.
    const [settleState, setSettleState] = useState<{ phase: ArenaSettlePhase; matchId: string | null }>({ phase: { kind: 'idle' }, matchId: null });
    const confirmerMatch = useRef<string | null>(null);
    /** The City answered too_fast for this match (the floor refuses only wins), so "win" is the City's word, not ours. */
    const tooFastFor = useRef<string | null>(null);
    const [savedCheckpoint, setSavedCheckpoint] = useState<ArenaCheckpoint | null>(null);
    const [ready, setReady] = useState(false);
    /** While the quit prompt is up, nothing but the prompt may unpause the fight or re-arm the resend. */
    const quitOpen = useRef(false);
    const [cappedMatchId, setCappedMatchId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [pvp, setPvp] = useState(false);
    const [quitAsk, setQuitAsk] = useState<{ prompt: ArenaQuitPrompt } | null>(null);
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
        const [acked, issue, settle, cp] = await Promise.all([flow.acknowledged(r), flow.pendingIssue(), flow.pendingSettle(), flow.checkpoint()]);
        if (!mine())
            return;
        setSavedCheckpoint(cp);
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
        if ((phase.kind === 'waiting' || phase.kind === 'stalled') && phase.reason === 'too_fast')
            tooFastFor.current = confirmerMatch.current;
        setSettleState({ phase, matchId: confirmerMatch.current });
        if (phase.kind === 'settled')
            void applyRef.current(phase.reply);
        else if (phase.kind === 'refused' || phase.kind === 'idle')
            void flow.pendingSettle().then(p => { if (live.current && currentFlow.current === flow) setPendingSettleHp(p?.report.playerFinalHealth ?? null); }).catch(() => undefined);
    }) : null, [flow]);
    const setSettlePhase = (phase: ArenaSettlePhase) => setSettleState({ phase, matchId: confirmerMatch.current });
    /** The only entry to the confirmer: binds its phases to the open match. */
    const runConfirm = (mode: 'start' | 'resume' | 'retry', report?: ArenaSettleReport) => {
        if (!confirmer || !mine())
            return;
        confirmerMatch.current = flow?.reply?.matchId ?? null;
        if (mode === 'start' && report) confirmer.start(report);
        else if (mode === 'resume') confirmer.resume();
        else confirmer.retryNow();
    };
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
        // Never collide with an in-flight settle or cancel as arena_busy: queue behind it, then read the City's view.
        const r = await flow.afterIdle(() => flow.resume());
        await apply(r);
        if (!mine() || r.match?.state !== 'active' || quitOpen.current)
            return;
        await rearm(r.matchId);
    };
    /** Resend what this device owes the City for the open match, or resume its live fight: the stored settle; else a
     * finished fight whose first send never got stored; else the paused live fight. */
    const rearm = async (matchId: string | null) => {
        if (!flow)
            return;
        const pending = await flow.pendingSettle().catch(() => null);
        if (!mine() || quitOpen.current)
            return;
        if (pending) { runConfirm('resume'); return; }
        const s = useArenaBattleStore.getState();
        if (!s.currentBattle || s.currentBattle.battleId !== matchId)
            return;
        if (s.battleResult) { runConfirm('start', reportOf(s.currentBattle)); return; }
        s.startGameLoop();
        s.setPaused(false);
    };
    useEffect(() => {
        live.current = true;
        setReady(false);
        setBusy(false);
        setReply(null);
        setError(null);
        setSettlePhase({ kind: 'idle' });
        submitted.current = null;
        void resumeAll().catch(fail).finally(() => { if (mine()) setReady(true); });
        return () => { live.current = false; confirmer?.dispose(); flow?.close(); useArenaBattleStore.getState().setPaused(true); useArenaBattleStore.getState().stopGameLoop(); };
    }, [flow]);
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') {
                useArenaBattleStore.getState().setPaused(true);
                // Only a real background disarms the resend; an `inactive` blip (Control Center, app switcher) does not.
                if (state === 'background')
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
        if (await flow.pendingSettle()) { runConfirm('resume'); return; }
        const existing = useArenaBattleStore.getState().currentBattle;
        if (existing?.battleId === r.matchId) {
            store.startGameLoop();
            store.setPaused(false);
            return;
        }
        // F3: no live fight for an active match. If this device ran it (kill, relaunch), it continues from its saved
        // checkpoint, so force-quitting never re-rolls a losing fight; a fight that had already ended sends that result.
        // If it never ran here (lost `start` reply), the practice starts from the City's admitted snapshot.
        const prepared = arenaHostBattle(r.match, uid!);
        const cp = await flow.checkpoint();
        if (!mine())
            return;
        carriedPerformance.delete(r.matchId!);
        if (cp) {
            if (cp.report.playerFinalHealth <= 0 || cp.report.opponentFinalHealth <= 0) { runConfirm('start', cp.report); return; }
            // Never above what the City admitted (it accepts a forfeit only at or below admission HP).
            prepared.battle.player.currentHP = Math.min(prepared.battle.player.maxHP, r.match.entrant.currentHealth ?? r.match.entrant.maxHealth, cp.report.playerFinalHealth);
            prepared.battle.opponent.currentHP = Math.min(prepared.battle.opponent.maxHP, r.match.opponent.currentHealth ?? r.match.opponent.maxHealth, cp.report.opponentFinalHealth);
            carriedPerformance.set(cp.matchId, { combos: cp.report.combosCompleted, perfects: cp.report.perfectDefenses });
        }
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
    /** The report of the fight on this device (plus what it carried over from a checkpoint). */
    const reportOf = (b: NonNullable<typeof battle>): ArenaSettleReport => {
        const base = carriedPerformance.get(b.battleId) ?? null;
        return { playerFinalHealth: b.player.currentHP, opponentFinalHealth: b.opponent.currentHP, combosCompleted: Math.min(25, (base?.combos ?? 0) + b.actionHistory.filter(a => a.triggeredCombo).length), perfectDefenses: Math.min(25, (base?.perfects ?? 0) + b.actionHistory.filter(a => a.perfectDefense).length) };
    };
    // F3: keep the fight's state on this device as it changes, so an interrupted fight continues instead of re-rolling.
    useEffect(() => { if (flow && battle && reply?.match?.state === 'active')
        void flow.saveCheckpoint(reportOf(battle)).catch(() => undefined); }, [battle?.player.currentHP, battle?.opponent.currentHP, battle?.actionHistory.length]);
    useEffect(() => { if (store.battleResult && battle && reply?.match?.state === 'active' && submitted.current !== battle.battleId) {
        submitted.current = battle.battleId;
        store.setPaused(true);
        runConfirm('start', reportOf(battle));
    } }, [store.battleResult, battle?.battleId, reply?.match?.state]);
    const match = reply?.match ?? null;
    const settlePhase: ArenaSettlePhase = settleState.matchId !== null && settleState.matchId === (reply?.matchId ?? null) ? settleState.phase : { kind: 'idle' };
    const phase = arenaScreenPhase({ reply, acknowledged, hasCheckpoint: !!battle, savedCheckpoint: !!savedCheckpoint, savedCheckpointFinished: !!savedCheckpoint && (savedCheckpoint.report.playerFinalHealth <= 0 || savedCheckpoint.report.opponentFinalHealth <= 0), settle: settlePhase, pendingIssue, error });
    const pendingResult = pendingSettleHp !== null || ['sending', 'waiting', 'stalled'].includes(settlePhase.kind);
    const winPending = !!reply?.matchId && tooFastFor.current === reply.matchId;
    const forfeitHpNow = () => match && match.state === 'active' ? arenaForfeitHp({ checkpointHp: battle?.player.currentHP ?? null, pendingSettleHp, savedCheckpointHp: savedCheckpoint?.report.playerFinalHealth ?? null, admissionHp: match.entrant.currentHealth ?? match.entrant.maxHealth }) : null;
    const doCancel = () => action(async () => {
        store.setPaused(true);
        confirmer?.stop();
        // Queued behind any in-flight settle (a match it settled then replays its record instead of being cancelled).
        const r = await flow!.afterIdle(() => flow!.cancel(forfeitHpNow() ?? undefined));
        setSettlePhase({ kind: 'idle' });
        store.resetBattle();
        await apply(r);
    });
    /** QUIT / CANCEL always confirms first, with the fight paused and the resend disarmed; a forfeit over an unconfirmed
     * result says so (it is never silent). */
    const quit = () => {
        if (!match || (match.state !== 'issued' && match.state !== 'active'))
            return;
        quitOpen.current = true;
        store.setPaused(true);
        confirmer?.stop();
        setQuitAsk({ prompt: arenaQuitPrompt({ state: match.state, pendingSettle: pendingResult, win: winPending, fighter: match.entrant.displayName, forfeitHp: forfeitHpNow() }) });
    };
    const dismissQuit = () => {
        quitOpen.current = false;
        setQuitAsk(null);
        void rearm(reply?.matchId ?? null);
    };
    // A prompt for a match that is no longer open (settled under it, closed elsewhere) is withdrawn.
    useEffect(() => { if (quitAsk && !(match && (match.state === 'issued' || match.state === 'active'))) { quitOpen.current = false; setQuitAsk(null); } }, [match?.state, quitAsk]);
    const exit = () => action(async () => {
        confirmer?.stop();
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
    const framed = (node: ReactNode) => <ScrollView contentContainerStyle={[styles.framed, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + theme.space.xl }]}>{node}</ScrollView>;
    return <View style={styles.page}>
  {phase.kind !== 'confirming' ? <HomeCogButton onOpenPvp={() => setPvp(true)}/> : null}
  {phase.kind === 'menu' && !busy && ready ? <ArenaPrebattleMenu onStartBattle={start} unavailable3v3Copy={ARENA_3V3_UNAVAILABLE_COPY} hostVitals={readHostVitals(profile?.holobotVitals)} userArenaPasses={profile?.arena_passes ?? 0} userHolobots={profile?.holobots ?? []} userTokens={profile?.holosTokens ?? 0}/> : null}
  {phase.kind === 'pendingIssue' ? framed(<ArenaInterstitial tone="warning" eyebrow={COPY.pendingIssueEyebrow} title={COPY.pendingIssueTitle} body={COPY.pendingIssueBody} actions={[
            { label: COPY.retryEntry, onPress: () => void action(async () => { const r = await flow!.retryIssue(); await apply(r); if (arenaIssuePayoutCapped(r)) { setCappedMatchId(r.matchId); return; } await launch(); }) },
            { label: COPY.discardEntry, tone: 'secondary', onPress: () => void action(async () => { await flow!.discardPendingIssue(); await resumeAll(); }) },
        ]}/>) : null}
  {phase.kind === 'admitted' && match ? framed(<ArenaInterstitial eyebrow={phase.interrupted ? COPY.interruptedEyebrow : COPY.admittedEyebrow} title={phase.interrupted ? COPY.interruptedTitle : COPY.admittedTitle} body={!phase.interrupted ? COPY.admittedBody : phase.finished ? COPY.finishedBody : phase.resumable ? COPY.interruptedBody : COPY.notStartedBody} notice={cappedMatchId === reply?.matchId ? COPY.payoutCapped : null} actions={[
            { label: !phase.interrupted ? COPY.start : phase.finished ? COPY.sendResult : phase.resumable ? COPY.resumeFight : COPY.restart, onPress: () => void action(launch) },
            { label: phase.interrupted ? COPY.forfeit : COPY.cancelRefund, tone: phase.interrupted ? 'danger' : 'secondary', onPress: quit },
        ]}>{fighters}</ArenaInterstitial>) : null}
  {/* lite-arena-stage-1: the park-arena 3D duel stage (the city duel's look). Same store calls as before: moves go to
      store.useMove, a City-issued match has no signature, and QUIT goes through the in-app confirmation. The toolbar
      sits left of the pilot-menu cog (HomeCogButton, zIndex 100) so the cog never covers QUIT. */}
  {battle && (phase.kind === 'battle' || phase.kind === 'confirming') ? <View style={styles.fight}>
      <LiveDuelStage battle={battle} moves={store.playerMoves} playableIds={store.getPlayableMoves().map(m => m.id)} pending={store.isAnimating} onPlay={store.useMove} onSignature={() => { }} signature={!battle.hostSnapshot} holdUntilReady={false} levelTab levels={{ player: arenaFighterLevel(reply, reply?.matchId ?? undefined, 'entrant', battle.player.name), rival: arenaFighterLevel(reply, reply?.matchId ?? undefined, 'opponent', battle.opponent.name) }} caption={COPY.stageCaption} leaveLabel={COPY.quitInBattle} leaveDisabled={settlePhase.kind === 'sending'} onLeave={quit} chrome={{ top: insets.top + 10, right: 60 }} active={phase.kind === 'battle' && !quitAsk} onMetrics={preview?.onStageMetrics} showMetrics={!!preview?.showStageMetrics}/>
    </View> : null}
  {phase.kind === 'confirming' ? <View style={[styles.overlay, { paddingTop: insets.top + 64 }]}><ArenaInterstitial eyebrow={COPY.confirmingEyebrow} title={winPending ? COPY.confirmingTitle : COPY.confirmingResult} body={COPY.confirmingBody} waiting actions={[{ label: COPY.forfeit, tone: 'danger', disabled: settlePhase.kind === 'sending', onPress: quit }]}/></View> : null}
  {phase.kind === 'stalled' ? framed(<ArenaInterstitial tone="warning" eyebrow={COPY.stalledEyebrow} title={COPY.stalledTitle} body={COPY.stalledBody} actions={[
            { label: COPY.tryAgain, disabled: settlePhase.kind === 'sending', onPress: () => runConfirm('retry') },
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
  {busy || (!ready && phase.kind === 'menu') || (settlePhase.kind === 'sending' && phase.kind === 'battle') ? <View style={styles.loadingOverlay}><ActivityIndicator color={theme.colors.accent}/></View> : null}
  {/* An in-tree overlay, not a native Modal: the refund/forfeit receipt modal presents right after a confirm, and iOS
      drops a Modal presented while another is still dismissing (witness cell 07). */}
  {quitAsk ? <View style={[styles.overlay, styles.confirm]}>
      <ArenaInterstitial tone="danger" eyebrow={COPY.errorEyebrow} title={quitAsk.prompt.title} body={quitAsk.prompt.body} actions={[
            { label: quitAsk.prompt.confirm, tone: 'danger', onPress: () => { quitOpen.current = false; setQuitAsk(null); void doCancel(); } },
            { label: quitAsk.prompt.dismiss, tone: 'secondary', onPress: dismissQuit },
        ]}/>
    </View> : null}
  <PvpArenaModal visible={pvp} onClose={() => setPvp(false)} userHolobots={profile?.holobots ?? []}/>
 </View>;
}
const styles = StyleSheet.create({
  page: {backgroundColor:theme.colors.carbon,flex:1},
  framed: {flexGrow:1,justifyContent:'center',paddingHorizontal:theme.space.lg},
  fighters: {flexDirection:'row',gap:theme.space.md,marginTop:theme.space.lg},
  fight: {flex:1},
  overlay: {...StyleSheet.absoluteFillObject,backgroundColor:theme.plates.overlay,paddingHorizontal:theme.space.lg},
  confirm: {justifyContent:'center'},
  loadingOverlay: {alignItems:'center',backgroundColor:theme.plates.overlay,bottom:0,justifyContent:'center',left:0,position:'absolute',right:0,top:0},
});
