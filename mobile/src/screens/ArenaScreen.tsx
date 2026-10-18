import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, AppState } from 'react-native';
import { theme } from '@/theme';
import { useAuth } from '@/contexts/AuthContext';
import { ArenaPrebattleMenu } from '@/components/arena/ArenaPrebattleMenu';
import { BattleArenaView } from '@/components/arena/BattleArenaView';
import { BattleResultsModal } from '@/components/arena/BattleResultsModal';
import { HomeCogButton } from '@/components/HomeCogButton';
import { PvpArenaModal } from '@/components/arena/PvpArenaModal';
import { getTierOpponentLineup, type ArenaTier } from '@/config/arenaConfig';
import type { UserHolobot } from '@/types/profile';
import { createArenaMatchClient } from '@/lib/arenaMatchClient';
import { arenaReceiptResult, type ArenaReply } from '@/lib/arenaMatchFlow';
import { ARENA_3V3_UNAVAILABLE_COPY } from '@/lib/arenaMatch3v3';
import { arenaHostBattle } from '@/lib/arenaHostBattle';
import { useArenaBattleStore } from '@/stores/arena-battle-store';
import { arenaEconomyChange, notifyHostEconomyChanged } from '@/lib/hostDashboard';
export function ArenaScreen() {
    const { user, profile } = useAuth();
    const uid = user?.uid;
    const flow = useMemo(() => uid ? createArenaMatchClient(uid) : null, [uid]);
    const currentFlow = useRef(flow);
    currentFlow.current = flow;
    const live = useRef(false);
    const [reply, setReply] = useState<ArenaReply | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [pvp, setPvp] = useState(false), [showResult, setShowResult] = useState(true);
    const store = useArenaBattleStore();
    const submitted = useRef<string | null>(null);
    const economySeen = useRef<string | null>(null);
    const apply = (r: ArenaReply) => { if (live.current && currentFlow.current === flow) {
        // Issue charged / settle paid / cancel-expiry refunded: the dashboard re-reads Holos, SYNC and levels from the host.
        const economy = arenaEconomyChange(r);
        if (economy && economy !== economySeen.current) { economySeen.current = economy; notifyHostEconomyChanged(uid); }
        setReply(r);
        setError('');
        setShowResult(true);
    } };
    useEffect(() => {
        live.current = true;
        setBusy(false);
        setReply(null);
        setError('');
        submitted.current = null;
        if (flow)
            void flow.resume().then(apply).catch(e => { if (live.current && currentFlow.current === flow)
                setError(String(e.message ?? e)); });
        return () => { live.current = false; flow?.close(); useArenaBattleStore.getState().setPaused(true); useArenaBattleStore.getState().stopGameLoop(); };
    }, [flow]);
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') {
                useArenaBattleStore.getState().setPaused(true);
                return;
            }
            if (flow)
                void flow.resume().then(r => { apply(r); const s = useArenaBattleStore.getState(); if (currentFlow.current === flow && live.current && r.match?.state === 'active' && s.currentBattle?.battleId === r.matchId)
                    {s.startGameLoop();s.setPaused(false);} }).catch(e => { if (live.current && currentFlow.current === flow)
                    setError(e.message); });
        });
        return () => subscription.remove();
    }, [flow]);
    const action = async (work: () => Promise<void>) => { if (!flow || busy)
        return; setBusy(true); try {
        await work();
    }
    catch (e) {
        if (live.current && currentFlow.current === flow)
            setError(e instanceof Error ? e.message : String(e));
    }
    finally {
        if (live.current && currentFlow.current === flow)
            setBusy(false);
    } };
    const launch = async () => {
        if (!flow?.reply?.match)
            return;
        // Verify all required move fields before changing issued -> active.
        const admitted = flow.reply.match;
        arenaHostBattle({ ...admitted, state: 'active' }, uid!);
        const r = admitted.state === 'issued' ? await flow.start() : flow.reply;
        if (!live.current || currentFlow.current !== flow)
            return;
        apply(r);
        if (r.match?.state !== 'active')
            return;
        const existing = useArenaBattleStore.getState().currentBattle;
        if (admitted.state === 'active' && existing?.battleId !== r.matchId)
            throw Error('Interrupted fight: no local combat checkpoint. Cancel this match; no new charge or HP reset.');
        if (existing?.battleId === r.matchId) {
            store.startGameLoop();
            store.setPaused(false);
            return;
        }
        const prepared = arenaHostBattle(r.match, uid!);
        store.startHostBattle(prepared.battle, prepared.playerMoves, prepared.opponentMoves);
    };
    const start = ({ selectedHolobot, tier, paymentMethod }: {
        selectedHolobot: UserHolobot;
        tier: ArenaTier;
        paymentMethod: 'tokens' | 'pass';
    }) => action(async () => {
        const opponentName = getTierOpponentLineup(tier, selectedHolobot.name)[0];
        const r = await flow!.issue({ requestId: `lite_arena_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, tierId: tier.id, paymentMethod, holobotId: selectedHolobot.name.toLowerCase(), opponentName });
        apply(r);
        await launch();
    });
    const battle = store.currentBattle?.battleId === reply?.matchId ? store.currentBattle : null;
    const settle = () => action(async () => { if (!battle || !flow)
        return; const r = await flow.settle({ playerFinalHealth: battle.player.currentHP, opponentFinalHealth: battle.opponent.currentHP, combosCompleted: Math.min(25, battle.actionHistory.filter(a => a.triggeredCombo).length), perfectDefenses: Math.min(25, battle.actionHistory.filter(a => a.perfectDefense).length) }); apply(r); store.setPaused(true); });
    useEffect(() => { if (store.battleResult && battle && reply?.match?.state === 'active' && submitted.current !== battle.battleId) {
        submitted.current = battle.battleId;
        void settle();
    } }, [store.battleResult, battle?.battleId, reply?.match?.state]);
    const open = reply?.match && ['issued', 'active'].includes(reply.match.state);
    const result = reply?.match?.state === 'settled' ? arenaReceiptResult(reply) : null;
    const cancel = () => action(async () => { if (!flow || !reply?.match)
        return; const hp = reply.match.state === 'active' ? (battle?.player.currentHP ?? 0) : undefined; apply(await flow.cancel(hp)); store.resetBattle(); });
    return <View style={styles.page}>
  <HomeCogButton onOpenPvp={() => setPvp(true)}/>
  {error ? <View style={{ paddingTop: 70, padding: 16 }}><Text style={{ color: '#ffca79' }}>{error}</Text><Pressable onPress={() => action(async () => apply(await flow!.resume()))}><Text style={{ color: '#62DDE8' }}>RESUME HOST MATCH</Text></Pressable><Pressable onPress={() => action(async () => { apply(await flow!.retryIssue()); await launch(); })}><Text style={{ color: '#62DDE8' }}>RETRY SAME ADMISSION</Text></Pressable></View> : null}
  {!open && !result && !busy ? <ArenaPrebattleMenu onStartBattle={start} unavailable3v3Copy={ARENA_3V3_UNAVAILABLE_COPY} userArenaPasses={profile?.arena_passes ?? 0} userHolobots={profile?.holobots ?? []} userTokens={profile?.holosTokens ?? 0}/> : null}
  {open && !battle ? <View style={{ paddingTop: 90, padding: 20 }}><Text style={{ color: 'white' }}>ADMITTED {reply!.match!.entrant.displayName} LV {reply!.match!.entrant.level} / {reply!.match!.opponent.displayName} LV {reply!.match!.opponent.level}</Text><Pressable onPress={() => action(launch)}><Text style={{ color: '#62DDE8' }}>CONTINUE SAME MATCH</Text></Pressable><Pressable onPress={cancel}><Text style={{ color: '#ffca79' }}>CANCEL MATCH {reply!.match!.state === 'active' ? '(FORFEIT; LOST CHECKPOINT COUNTS AS KO)' : '(REFUND)'}</Text></Pressable></View> : null}
  {battle && open ? <><Text style={{ color: '#ffca79', textAlign: 'center', paddingTop: 45 }}>CPU PRACTICE · STRIKE / HEAVY · EXTRAS UNAVAILABLE</Text><BattleArenaView embedded battle={battle} hostMatchReply={reply} hostMatchId={reply!.matchId!} roundProgress={{ currentRound: 1, totalRounds: 1 }} playerCards={store.playerMoves} playableCardIds={store.getPlayableMoves().map(m => m.id)} cardAvailability={store.getMoveAvailabilityMap()} lastAction={store.lastAction} isAnimating={store.isAnimating} onCardPlay={store.useMove} onSignaturePlay={() => { }}/><Pressable onPress={cancel}><Text style={{ color: '#ffca79' }}>QUIT / FORFEIT</Text></Pressable>{store.battleResult ? <Pressable onPress={settle}><Text style={{ color: '#62DDE8' }}>RETRY SAME SETTLEMENT</Text></Pressable> : null}</> : null}
  {result && showResult ? <BattleResultsModal visible didWin={result.didWin} receipt={{ kind: 'host', rewards: result.rewards }} context={`${reply!.match!.entrant.displayName} LV ${reply!.match!.entrant.level} · ${reply!.match!.opponent.displayName} LV ${reply!.match!.opponent.level}`} hideRematch onRematch={() => { }} onExit={() => { store.resetBattle(); setReply(null); setShowResult(false); submitted.current = null; }}/> : null}
  {busy ? <View style={styles.loadingOverlay}><ActivityIndicator color={theme.colors.accent}/></View> : null}
  <PvpArenaModal visible={pvp} onClose={() => setPvp(false)} userHolobots={profile?.holobots ?? []}/>
 </View>;
}
const styles = StyleSheet.create({
  page: {backgroundColor:theme.colors.carbon,flex:1},
  loadingOverlay: {alignItems:'center',backgroundColor:'rgba(5,6,6,0.48)',bottom:0,justifyContent:'center',left:0,position:'absolute',right:0,top:0},
});
