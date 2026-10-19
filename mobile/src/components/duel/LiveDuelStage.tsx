import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveBotId } from '../../../assets/bots';
import { BotStage, type BotMetrics, type BotStageHandle } from '../bots/BotStage';
import { HoloCityCommandBar, HOLOCITY_COMMANDS } from '../HoloCityCommandBar';
import { liveDuelCommandMove, liveDuelCommands } from './liveDuelCommands';
import { FighterHud } from '../../screens/DuelPlaybackScreen';
import { getActionSides } from '../arena/battleVisualStates';
import { FINISHER_POLICY, type FinisherPower } from '../../features/arena/finisherPolicy';
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
  /** Dev QA only: BotStage frame metrics. */
  onMetrics?: (metrics: BotMetrics) => void;
  showMetrics?: boolean;
};

/** The park-arena 3D duel: BotStage over the park plate, FighterHud and the HoloCity command bar. Presentation of an
 * existing battle state only; every combat decision is the caller's (engine or store). */
export function LiveDuelStage({ battle, moves, onPlay, onSignature, onLeave, pending, caption, leaveLabel, leaveDisabled = pending, levels, levelTab = false, signature: signatureAllowed = true, playableIds, holdUntilReady = true, chrome, active = true, onMetrics, showMetrics = false }: LiveDuelStageProps) {
  const insets = useSafeAreaInsets();
  const stage = useRef<BotStageHandle>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [power, setPower] = useState<FinisherPower>('half');
  const player = resolveBotId(battle.player.name);
  const rival = resolveBotId(battle.opponent.name);
  const action = battle.actionHistory.at(-1);
  useEffect(() => {
    if (!ready || !action) return;
    const { attacker, damaged } = getActionSides(action, battle);
    const side = attacker === 'player' ? 'player' : 'rival';
    const target = side === 'player' ? 'rival' : 'player';
    const type = action.actionType ?? action.card.type;
    if (type === 'defense') stage.current?.guard(side);
    else { stage.current?.play(side, type === 'combo' ? 'Heavy' : type === 'finisher' ? 'Finisher' : 'Strike'); stage.current?.strike(side); }
    const impact = setTimeout(() => {
      if (damaged) stage.current?.hit(damaged === 'player' ? 'player' : 'rival');
      else if (action.outcome === 'dodged' || action.outcome === 'missed') stage.current?.play(target, 'Evade');
    }, 300);
    return () => clearTimeout(impact);
  }, [action?.id, ready]);
  const waiting = holdUntilReady && !ready && !error && !!player && !!rival;
  const commands = liveDuelCommands(HOLOCITY_COMMANDS, { battle, moves, power, signature: signatureAllowed, playableIds, blocked: pending || waiting });
  const state = (fighter: BattleState['player']) => ({ hp: fighter.currentHP, maxHp: fighter.maxHP, stamina: fighter.stamina, maxStamina: fighter.maxStamina });
  return <View style={styles.screen} testID="live-duel-stage">
    <Image source={require('../../../assets/battle/holocity-park.jpg')} style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]} resizeMode="cover" />
    {player && rival && <BotStage ref={stage} variant="duelPortrait" transparentBackdrop bots={[{ id: player, side: 'player' }, { id: rival, side: 'rival' }]} style={StyleSheet.absoluteFillObject} onReady={() => setReady(true)} onError={() => setError(true)} active={active} onMetrics={onMetrics} showMetrics={showMetrics} />}
    <View style={[styles.top, { paddingTop: chrome?.top ?? insets.top + 4 }]}>
      <View style={[styles.toolbar, chrome ? { marginRight: chrome.right } : null]}><Text style={styles.caption}>{caption}</Text><Pressable accessibilityRole="button" onPress={onLeave} disabled={leaveDisabled} style={styles.button}><Text style={styles.caption}>{leaveLabel}</Text></Pressable></View>
      <View style={styles.hud}><FighterHud name={battle.player.name} state={state(battle.player)} level={levels.player} levelTab={levelTab} /><View style={styles.round}><Text style={styles.caption}>TURN</Text><Text style={styles.number}>{String(action?.turnNumber ?? 1).padStart(2, '0')}</Text></View><FighterHud name={battle.opponent.name} state={state(battle.opponent)} level={levels.rival} levelTab={levelTab} rival /></View>
    </View>
    <View style={[styles.bottom, { paddingBottom: Math.max(12, insets.bottom) }]}>
      <Text style={styles.log}>{error || !player || !rival ? '3D unavailable · controls remain active' : !ready ? 'LOADING ARENA' : action ? `${action.card.name} · ${action.actualDamage ?? action.damageDealt} DMG` : 'SELECT YOUR COMMAND'}</Text>
      <View style={styles.toolbar}><Text style={styles.caption}>{Math.round(battle.player.specialMeter)}% SYNC</Text>{signatureAllowed ? (['half', 'full'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: power === value }} onPress={() => setPower(value)} style={styles.button}><Text style={[styles.caption, power === value && { color: theme.colors.warning }]}>{FINISHER_POLICY[value].sync}% · {FINISHER_POLICY[value].stamina} STA</Text></Pressable>) : <View style={styles.button} />}</View>
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
  hud: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  round: { backgroundColor: '#081723EF', borderWidth: 1, borderColor: theme.colors.accent, padding: 8, alignItems: 'center' },
  number: { ...theme.type.display, color: theme.colors.text, fontSize: 30 },
  bottom: { position: 'absolute', bottom: 0, left: 14, right: 14 },
  log: { ...theme.type.label, textAlign: 'center', color: theme.colors.text, padding: 8, marginBottom: 8, backgroundColor: '#101318EF', borderWidth: 1, borderColor: theme.colors.accent },
});
