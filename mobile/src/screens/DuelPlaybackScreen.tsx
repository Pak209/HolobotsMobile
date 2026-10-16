import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../theme';
import { resolveBotId } from '../../assets/bots';
import { getHolobotHeadshotImageSource } from '../config/holobots';
import { HoloCityCommandBar, HOLOCITY_COMMANDS } from '../components/HoloCityCommandBar';
import { BotStage, type BotMetrics, type BotStageHandle } from '../components/bots/BotStage';
import { buildPlaybackCues, normalizeDuelReceipt, ROUND_DURATION_MS, type DuelRound, type ObservedDuelState, type ObservedFighterState } from '../lib/bots/duelPlayback';
import { readLiveRivalPlayback } from '../lib/bots/liveRivalPlayback';
export type { DuelRound } from '../lib/bots/duelPlayback';
export type DuelPlaybackScreenProps = { receipt: unknown; liveIssue?: unknown; rounds?: readonly DuelRound[]; attackerBotId?: string; defenderBotId?: string; onClose: () => void; onMetrics?: (metrics: BotMetrics) => void; fixture?: boolean; showMetrics?: boolean; /** Development capture stops the actual cue runner after this round's impact. */ captureRound?: number };

type FighterSnapshot = ObservedFighterState;
export function FighterHud({ name, state, rival = false }: { name: string; state?: FighterSnapshot; rival?: boolean }) {
  const accent = rival ? theme.rings.rival[0] : theme.rings.player[0];
  const ratio = state && state.hp !== undefined && state.maxHp > 0 ? Math.max(0, Math.min(1, state.hp / state.maxHp)) : 0;
  return <View style={[styles.fighter, { borderColor: accent }]}>
    <View style={[styles.identity, rival && styles.reverse]}>
      {resolveBotId(name) ? <Image source={getHolobotHeadshotImageSource(name)} resizeMode="contain" style={[styles.portrait, { borderColor: accent }]} /> : <View style={[styles.portrait, { borderColor: accent, alignItems: 'center', justifyContent: 'center' }]}><Text style={styles.statLabel}>?</Text></View>}
      <Text numberOfLines={1} style={[styles.name, { color: accent }]}>{name.toUpperCase()}</Text>
    </View>
    <View style={styles.statLine}><Text style={styles.statLabel}>HP</Text><Text style={styles.statValue}>{state?.hp !== undefined ? `${state.hp}/${state.maxHp}` : '—'}</Text></View>
    <View style={styles.hpTrack}><View style={[styles.hpFill, { width: `${ratio * 100}%`, backgroundColor: rival ? theme.colors.danger : theme.colors.success }]} /></View>
    <View style={styles.stamina}><Text style={styles.statLabel}>STA</Text>{state?.stamina !== undefined ? Array.from({ length: Math.min(12, state.maxStamina) }, (_, i) => <View key={i} style={[styles.pip, { backgroundColor: i < state.stamina! ? accent : theme.plates.keycap, borderColor: accent }]} />) : <Text style={styles.statValue}>—</Text>}</View>
  </View>;
}

/** Receipt-only presentation. It never calculates damage, stamina, misses, winners or rewards. */
export function DuelPlaybackScreen({ receipt, liveIssue, rounds, attackerBotId, defenderBotId, onClose, onMetrics, fixture = false, showMetrics = false, captureRound }: DuelPlaybackScreenProps) {
  const insets = useSafeAreaInsets();
  const normalized = useMemo(() => liveIssue === undefined ? normalizeDuelReceipt(receipt, rounds) : readLiveRivalPlayback(liveIssue, receipt), [receipt, rounds, liveIssue]);
  const [actors, setActors] = useState({ player: normalized.attackerBotId, rival: normalized.defenderBotId });
  const player = resolveBotId(actors.player ?? attackerBotId ?? '');
  const rival = resolveBotId(actors.rival ?? defenderBotId ?? '');
  const cues = useMemo(() => buildPlaybackCues(normalized.rounds), [normalized]);
  const duration = normalized.rounds.length * ROUND_DURATION_MS;
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [replay, setReplay] = useState(0);
  const [stageError, setStageError] = useState(false);
  const [snapshot, setSnapshot] = useState<ObservedDuelState | null>(normalized.initialState);
  const stage = useRef<BotStageHandle>(null);
  const elapsedRef = useRef(0);
  const nextCue = useRef(0);
  const complete = elapsed >= duration;
  const currentRound = Math.max(0, Math.min(normalized.rounds.length - 1, Math.floor(elapsed / ROUND_DURATION_MS)));
  const round = normalized.rounds[currentRound];
  const isSynthetic = fixture || normalized.synthetic;
  useEffect(() => { setReady(false); setStageError(false); }, [player, rival]);
  useEffect(() => { elapsedRef.current = 0; nextCue.current = 0; setElapsed(0); setSnapshot(normalized.initialState); setActors({ player: normalized.attackerBotId, rival: normalized.defenderBotId }); setPaused(false); }, [normalized, replay]);
  useEffect(() => {
    if ((!ready && player && rival) || paused || complete || duration === 0) return;
    let appActive = AppState.currentState === 'active';
    let previous = performance.now();
    const subscription = AppState.addEventListener('change', state => { appActive = state === 'active'; previous = performance.now(); });
    const captureAt = __DEV__ && isSynthetic && captureRound ? (normalized.rounds.findLastIndex(row => row.roundNumber === captureRound) + 0) * ROUND_DURATION_MS + 1100 : Infinity;
    const timer = setInterval(() => {
      const now = performance.now();
      if (!appActive) { previous = now; return; }
      elapsedRef.current = Math.min(duration, captureAt, elapsedRef.current + Math.min(now - previous, 1000)); previous = now;
      while (nextCue.current < cues.length && cues[nextCue.current].atMs <= elapsedRef.current) {
        const cue = cues[nextCue.current++];
        if (cue.kind === 'actors') {
          if (cue.actors && (cue.actors.player !== actors.player || cue.actors.rival !== actors.rival)) {
            setActors(cue.actors); setSnapshot(null); setReady(false); setElapsed(elapsedRef.current); return;
          }
        }
        else if (cue.kind === 'state') { if (cue.snapshot) setSnapshot(cue.snapshot); }
        else if (cue.kind === 'hit') stage.current?.hit(cue.side);
        else if (cue.kind === 'guard') stage.current?.guard(cue.side);
        else if (cue.kind === 'miss') stage.current?.play(cue.side, 'Evade');
        else { stage.current?.play(cue.side, cue.clip); if (cue.kind === 'attack') stage.current?.strike(cue.side); }
      }
      setElapsed(elapsedRef.current);
      if (elapsedRef.current >= duration && normalized.finalState) setSnapshot(normalized.finalState);
      if (elapsedRef.current >= captureAt) setPaused(true);
    }, 32);
    return () => { clearInterval(timer); subscription.remove(); };
  }, [ready, paused, complete, duration, cues, player, rival, replay, isSynthetic, captureRound, actors, normalized]);
  const result = normalized.didWin === null ? 'AWAITING RESULT' : normalized.didWin ? 'VICTORY' : 'DEFEAT';
  const traceLabel = normalized.synthetic ? 'SYNTHETIC RECEIPT · NO REWARDS' : fixture ? normalized.traceSource === 'client' ? 'OFFLINE CLIENT TRACE · NO REWARDS' : 'OFFLINE FIXTURE · NO REWARDS' : normalized.traceSource === 'client' ? 'CLIENT TRACE · HOST SETTLEMENT' : normalized.traceSource === 'host' ? 'RECORDED RECEIPT' : 'HOST SETTLEMENT · NO ROUND TRACE';
  const commands = HOLOCITY_COMMANDS.map(command => {
    const action = command.label[0] + command.label.slice(1).toLowerCase();
    const cost = normalized.commandCosts?.[action as keyof typeof normalized.commandCosts];
    return { ...command, cost: cost === undefined ? undefined : `${cost} STA` };
  });
  const actionLog = complete ? result : round?.label ?? (round?.action ? `${round.action.toUpperCase()}${round.damage !== undefined ? ` · ${round.damage} DMG` : ''}` : 'RECORDED ACTION');
  return <View style={styles.screen} testID="duel-playback-screen">
    <Image source={require('../../assets/battle/holocity-park.jpg')} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} resizeMode="cover" />
    {player && rival ? <BotStage key={`${player}:${rival}`} ref={stage} variant="duelPortrait" transparentBackdrop bots={[{ id: player, side: 'player' }, { id: rival, side: 'rival' }]} style={styles.stage} active={!paused} onReady={() => setReady(true)} onError={() => { setStageError(true); setReady(true); }} onMetrics={metrics => {
      onMetrics?.(metrics);
      if (__DEV__ && showMetrics) console.info('[DuelPlayback:metrics] ' + JSON.stringify({ ...metrics, round: currentRound + 1, elapsedMs: Math.round(elapsedRef.current), synthetic: isSynthetic }));
    }} showMetrics={showMetrics} /> : null}
    <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + 4 }]}>
      <View style={styles.toolbar}><Pressable style={styles.utilityButton} accessibilityRole="button" accessibilityLabel="Return to city" onPress={onClose} hitSlop={4}><Text style={styles.utility}>‹ CITY</Text></Pressable><Text style={styles.arenaLabel}>HOLOCITY / PARK ARENA</Text><Pressable style={styles.utilityButton} accessibilityRole="button" accessibilityLabel={complete ? "Replay battle" : paused ? "Resume battle replay" : "Pause battle replay"} onPress={() => complete ? setReplay(v => v + 1) : setPaused(v => !v)} hitSlop={12}><Text style={styles.utility}>{complete ? 'REPLAY ↻' : paused ? 'PLAY ▷' : 'PAUSE Ⅱ'}</Text></Pressable></View>
      <View style={styles.hud}>
        <FighterHud name={player ?? attackerBotId ?? 'PLAYER'} state={snapshot?.player} />
        <View style={styles.roundPlate}><Text style={styles.roundLabel}>{complete && !round ? 'RESULT' : 'ROUND'}</Text><Text style={styles.roundNumber}>{round ? String(round.roundNumber ?? currentRound + 1).padStart(2, '0') : '—'}</Text><Text style={styles.roundLabel}>OF {normalized.roundCount || '—'}</Text></View>
        <FighterHud name={rival ?? defenderBotId ?? 'RIVAL'} state={snapshot?.rival} rival />
      </View>
    </View>
    {(normalized.receiptError || stageError || !player || !rival) && <View style={styles.warning}><Text style={styles.notice}>{normalized.receiptError ?? '3D presentation unavailable. The recorded result is preserved.'}</Text></View>}
    {complete && <View style={styles.result} testID="duel-result-card"><Text style={styles.resultEyebrow}>RECORDED RESULT</Text><Text style={[styles.resultTitle, normalized.didWin === false && { color: theme.colors.danger }]}>{result}</Text>{!isSynthetic && normalized.holosGranted !== null && <Text style={styles.reward}>+{normalized.holosGranted} HOLOS</Text>}{!normalized.rounds.length && <Text style={styles.notice}>This host reply contains no round trace.</Text>}<Pressable style={styles.returnButton} accessibilityRole="button" onPress={onClose}><Text style={styles.returnLabel}>RETURN TO CITY</Text></Pressable></View>}
    <View style={[styles.bottom, { paddingBottom: Math.max(12, insets.bottom) }]}>
      <View style={styles.actionLog}><View style={styles.logAccent} /><Text numberOfLines={1} style={styles.logText}>{!ready && player && rival ? 'LOADING ARENA' : actionLog}</Text></View>
      {!complete && <HoloCityCommandBar compact commands={commands} selected={round?.action?.toLowerCase() ?? null} />}
      <Text style={styles.source}>{traceLabel}</Text>
    </View>
  </View>;
}
export default DuelPlaybackScreen;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.carbon }, stage: { ...StyleSheet.absoluteFillObject, borderRadius: 0 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12 }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#101318CC', paddingHorizontal: 10, marginBottom: 9, borderRadius: 4 }, utilityButton: { minWidth: 52, minHeight: 44, justifyContent: 'center' }, utility: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1 }, arenaLabel: { ...theme.type.micro, color: theme.colors.text, letterSpacing: 1, fontSize: 9 },
  hud: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 }, fighter: { flex: 1, minWidth: 0, backgroundColor: '#081723EA', borderWidth: 1, borderRadius: 6, padding: 8 }, identity: { flexDirection: 'row', alignItems: 'center', gap: 7 }, reverse: { flexDirection: 'row-reverse' }, portrait: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, backgroundColor: theme.plates.keycap }, name: { ...theme.type.label, fontSize: 18, flexShrink: 1 }, statLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }, statLabel: { ...theme.type.micro, color: theme.colors.muted, fontSize: 9 }, statValue: { ...theme.type.micro, color: theme.colors.text, fontSize: 11 }, hpTrack: { height: 5, backgroundColor: theme.plates.keycap, borderRadius: 2, overflow: 'hidden', marginTop: 3 }, hpFill: { height: '100%' }, stamina: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 7 }, pip: { flex: 1, height: 9, borderWidth: 0.5, borderRadius: 1 },
  roundPlate: { width: 52, backgroundColor: '#081723EF', borderColor: theme.colors.accent, borderWidth: 1, borderRadius: 4, alignItems: 'center', paddingVertical: 8 }, roundLabel: { ...theme.type.micro, color: theme.colors.accent, fontSize: 9, letterSpacing: 1 }, roundNumber: { ...theme.type.display, fontSize: 30, lineHeight: 34, color: theme.colors.text },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 14, gap: 8 }, actionLog: { minHeight: 38, backgroundColor: '#101318F2', borderColor: theme.colors.accent, borderWidth: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, overflow: 'hidden' }, logAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: theme.colors.accent }, logText: { ...theme.type.label, color: theme.colors.text, fontSize: 16, letterSpacing: 0.5 }, source: { ...theme.type.micro, color: theme.colors.text, fontSize: 9, letterSpacing: 1, textAlign: 'center', backgroundColor: '#101318D9', padding: 3 },
  warning: { position: 'absolute', top: '35%', left: 24, right: 24, backgroundColor: theme.plates.overlay, padding: 18, borderRadius: 8 }, notice: { ...theme.type.caption, color: theme.colors.muted, textAlign: 'center', marginTop: 8 }, result: { position: 'absolute', left: 32, right: 32, top: '34%', backgroundColor: '#081723F2', borderWidth: 1, borderColor: theme.colors.accent, borderRadius: 8, padding: 18, alignItems: 'center' }, resultEyebrow: { ...theme.type.micro, color: theme.colors.muted, letterSpacing: 2 }, resultTitle: { ...theme.type.display, color: theme.colors.accent, marginTop: 6 }, reward: { ...theme.type.value, color: theme.colors.text, marginTop: 5 }, returnButton: { backgroundColor: theme.colors.accent, paddingHorizontal: 22, paddingVertical: 10, borderRadius: 4, marginTop: 12 }, returnLabel: { ...theme.type.micro, color: theme.colors.carbon, letterSpacing: 1 },
});
