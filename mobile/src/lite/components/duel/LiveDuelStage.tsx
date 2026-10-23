import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveBotId } from '../../../../assets/bots';
import { BotStage, type BotMetrics, type BotStageHandle, type BotStagePerf } from '../bots/BotStage';
import type { StageRenderQuality } from '../../lib/bots/stagePerf';
import { FinisherReadinessChip, HoloCityCommandBar, HOLOCITY_COMMANDS } from '../HoloCityCommandBar';
import { HudActionStrip, HudRoundPlate } from './HoloHudArt';
import { liveDuelCommandMove, liveDuelCommands } from './liveDuelCommands';
import { liveDuelVfxCues } from '../../vfx/liveDuelVfx';
import { FighterHud } from '../../screens/DuelPlaybackScreen';
import { PresentationCursor } from '../../lib/bots/battlePace';
import { resolvedBattlePace } from '../../lib/bots/resolvedBattlePace';
import { FINISHER_POLICY, type FinisherPower } from '../../../features/arena/finisherPolicy';
import type { ActionCard, BattleState } from '../../types/arena';
import { theme } from '../../theme';


export type LiveDuelStageProps = {
  battle: BattleState;
  moves: ActionCard[];
  onPlay: (id: string) => void;
  onSignature: (power?: FinisherPower) => void;
  onLeave: () => void;
  /** Commands are blocked while true (a move in flight). */
  pending: boolean;
  caption: string;
  leaveLabel: string;
  /** Defaults to `pending`. */
  leaveDisabled?: boolean;
  /** Read by the caller from the City's own reply; the stage never derives a level. */
  levels: { player?: number; rival?: number };
  /** DECISIONS #71: the LV badge as a lower-left corner tab on each fighter card. */
  levelTab?: boolean;
  /** False for a City-issued CPU match, which has no signature move (FINISHER stays unavailable). */
  signature?: boolean;
  /** The caller's playable move ids (the Arena store); without it, the engine's own availability. */
  playableIds?: readonly string[];
  /** Hold commands until the 3D stage has loaded (city rival). The Arena's live loop is never held. */
  holdUntilReady?: boolean;
  /** Top padding (default insets.top + 4) and a right reserve on the toolbar, for chrome the caller keeps above the
   * stage (the Arena's pilot-menu cog, 48 pt at insets.top + 10, right 18). */
  chrome?: { top: number; right: number };
  /** False pauses the GL scene (under an overlay); combat is not affected. */
  active?: boolean;
  /** GL render settings. Omitted (the city duel): production defaults. The CPU Arena passes FAST_RENDER_QUALITY. */
  renderQuality?: StageRenderQuality;
  /** Dev only: #133 perf-sweep knobs, which override renderQuality (BotStage ignores them outside __DEV__). */
  perf?: BotStagePerf;
  /** Called once the stage can show the fight: GL loaded, GL failed, or no 3D for these fighters. */
  onStageReady?: () => void;
  /** Dev QA only: BotStage frame metrics. */
  onMetrics?: (metrics: BotMetrics) => void;
  showMetrics?: boolean;
  /** lite-vfx-port-1 / lite-2305-1: the HoloCity combat VFX on the stage (the CPU Arena round and the city duel pass true). */
  vfx?: boolean;
  /** lite-2305-1 (DECISIONS #72.63): the special camera beat on a played SKY / BREAK special. Default on; QA passes false for
   * today's framing. It only runs with the VFX (it holds for the played effect's duration). */
  specialCamera?: boolean;
  /** Dev QA only: also play pack kits Unity has not built yet (WOLF). */
  vfxUnbuiltKits?: boolean;
};

/** The park-arena 3D duel: BotStage over the park plate, FighterHud and the HoloCity command bar. Presentation of an
 * existing battle state only; every combat decision is the caller's (engine or store). */
export function LiveDuelStage({ battle, moves, onPlay, onSignature, onLeave, pending, caption, leaveLabel, leaveDisabled = pending, levels, levelTab = false, signature: signatureAllowed = true, playableIds, holdUntilReady = true, chrome, active = true, renderQuality, perf, onStageReady, onMetrics, showMetrics = false, vfx = false, vfxUnbuiltKits = false, specialCamera = true }: LiveDuelStageProps) {
  const insets = useSafeAreaInsets();
  const stage = useRef<BotStageHandle>(null);
  const [readyScene, setReadyScene] = useState<string | null>(null);
  const [drained, setDrained] = useState(0);
  const [error, setError] = useState(false);
  const [power, setPower] = useState<FinisherPower>('half');
  const player = resolveBotId(battle.player.name);
  const rival = resolveBotId(battle.opponent.name);
  const sceneKey = `${battle.battleId}:${player}:${rival}`;
  const ready = readyScene === sceneKey;
  const action = battle.actionHistory.at(-1);
  const stageReady = useRef(onStageReady);
  stageReady.current = onStageReady;
  const settled = ready || error || !player || !rival;
  useEffect(() => { if (settled) stageReady.current?.(); }, [settled]);
  const presented = useRef(new PresentationCursor<BattleState['actionHistory'][number]>());
  useEffect(() => {
    const history = battle.actionHistory;
    presented.current.consume(sceneKey, history, ready, row => {
      const cue = resolvedBattlePace(row, battle, row.id === action?.id);
      cue.effects = vfx ? liveDuelVfxCues(row, battle, { player, rival }) : [];
      return stage.current?.present(cue) ?? 'backpressure';
    });
  }, [battle.actionHistory, action?.id, ready, sceneKey, drained]);
  const waiting = holdUntilReady && !ready && !error && !!player && !!rival;
  const commands = liveDuelCommands(HOLOCITY_COMMANDS, { battle, moves, power, signature: signatureAllowed, playableIds, blocked: pending || waiting });
  const finisherReadiness = commands.find(command => command.id === 'finisher')?.readiness;
  const state = (fighter: BattleState['player']) => ({ hp: fighter.currentHP, maxHp: fighter.maxHP, stamina: fighter.stamina, maxStamina: fighter.maxStamina });
  return <View style={styles.screen} testID="live-duel-stage">
    <Image source={require('../../../../assets/battle/holocity-park.jpg')} style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]} resizeMode="cover" />
    {player && rival && <BotStage key={sceneKey} ref={stage} variant="duelPortrait" transparentBackdrop bots={[{ id: player, side: 'player' }, { id: rival, side: 'rival' }]} style={StyleSheet.absoluteFillObject} onReady={() => setReadyScene(sceneKey)} onPresentationDrain={() => setDrained(n => n + 1)} onError={() => setError(true)} active={active} quality={renderQuality} perf={perf} onMetrics={onMetrics} showMetrics={showMetrics} vfx={vfx} vfxUnbuiltKits={vfxUnbuiltKits} specialCamera={specialCamera} />}
    <View style={[styles.top, { paddingTop: chrome?.top ?? insets.top + 4 }]}>
      <View style={[styles.toolbar, chrome ? { marginRight: chrome.right } : null]}><Text style={styles.caption}>{caption}</Text><Pressable accessibilityRole="button" onPress={onLeave} disabled={leaveDisabled} style={styles.button}><Text style={styles.caption}>{leaveLabel}</Text></Pressable></View>
      <View style={styles.hud}><FighterHud name={battle.player.name} state={state(battle.player)} level={levels.player} levelTab={levelTab} /><HudRoundPlate testID="live-duel-turn" label="TURN" value={String(action?.turnNumber ?? 1).padStart(2, '0')} /><FighterHud name={battle.opponent.name} state={state(battle.opponent)} level={levels.rival} levelTab={levelTab} rival /></View>
    </View>
    <View style={[styles.bottom, { paddingBottom: Math.max(12, insets.bottom) }]}>
      <HudActionStrip testID="live-duel-log" text={error || !player || !rival ? '3D unavailable · controls remain active' : !ready ? 'LOADING ARENA' : action ? `${action.card.name} · ${action.actualDamage ?? action.damageDealt} DMG` : 'SELECT YOUR COMMAND'} />
      {/* The hint line (Unity's "COMBO 0 · … · SYNC 0% · HALF · TAP 50% / HOLD 100%"), in the lite's own words. */}
      <View style={styles.hint}><Text numberOfLines={1} style={[styles.caption, styles.hintText]}>{`COMBO ×${battle.player.comboCounter} · ${Math.round(battle.player.specialMeter)}% SYNC`}</Text>{signatureAllowed ? (['half', 'full'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: power === value }} onPress={() => setPower(value)} style={styles.button}><Text style={[styles.caption, power === value && { color: theme.colors.warning }]}>{FINISHER_POLICY[value].sync}% · {FINISHER_POLICY[value].stamina} STA</Text></Pressable>) : null}{finisherReadiness ? <FinisherReadinessChip readiness={finisherReadiness} /> : null}</View>
      <HoloCityCommandBar compact commands={commands} onPress={id => {
        if (id === 'finisher') onSignature(power);
        else { const card = liveDuelCommandMove(id, moves); if (card) onPlay(card.id); }
      }} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.carbon },
  top: { position: 'absolute', top: 0, left: 12, right: 12 },
  toolbar: { backgroundColor: '#101318DD', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, marginBottom: 8 },
  button: { minHeight: 44, minWidth: 52, justifyContent: 'center', alignItems: 'center' },
  caption: { ...theme.type.micro, color: theme.colors.accent, fontSize: 10 },
  hud: { flexDirection: 'row', alignItems: 'stretch', gap: 6 },
  bottom: { position: 'absolute', bottom: 0, left: 14, right: 14 },
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, minHeight: 44, marginVertical: 4, paddingLeft: 10, paddingRight: 4, backgroundColor: theme.hud.frameFill, borderRadius: theme.radius.sm },
  hintText: { flex: 1, color: theme.colors.text },
});
