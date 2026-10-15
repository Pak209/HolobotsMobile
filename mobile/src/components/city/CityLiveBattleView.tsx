import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveBotId } from '../../../assets/bots';
import { BotStage, type BotStageHandle } from '../bots/BotStage';
import { HoloCityCommandBar, HOLOCITY_COMMANDS } from '../HoloCityCommandBar';
import { FighterHud } from '../../screens/DuelPlaybackScreen';
import { getActionSides } from '../arena/battleVisualStates';
import { ArenaCombatEngine } from '../../features/arena/combatEngine';
import { FINISHER_POLICY, type FinisherPower } from '../../features/arena/finisherPolicy';
import type { ActionCard, BattleState } from '../../types/arena';
import { theme } from '../../theme';

/** Presentation of the existing resolved battle state; no combat decisions here. */
export function CityLiveBattleView({ battle, moves, onPlay, onSignature, onLeave, pending, preview }: {
  battle: BattleState; moves: ActionCard[]; onPlay: (id: string) => void;
  onSignature: (power?: FinisherPower) => void; onLeave: () => void; pending: boolean; preview: boolean;
}) {
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
  const signature = ArenaCombatEngine.getSignatureAvailability(battle, 'player', power);
  const commands = HOLOCITY_COMMANDS.map(command => {
    const type = command.id === 'heavy' ? 'combo' : command.id === 'defend' ? 'defense' : command.id;
    const card = type === 'finisher' ? ArenaCombatEngine.buildSignatureCard(battle.player, power) : moves.find(candidate => candidate.type === type);
    const available = card && (type === 'finisher' ? signature.playable : ArenaCombatEngine.getCardAvailability(battle, 'player', card).playable);
    return { ...command, detail: card?.name, cost: card ? `${type === 'finisher' ? FINISHER_POLICY[power].stamina : card.staminaCost} STA` : undefined, disabled: !available || pending || (!ready && !error && !!player && !!rival) };
  });
  const state = (fighter: BattleState['player']) => ({ hp: fighter.currentHP, maxHp: fighter.maxHP, stamina: fighter.stamina, maxStamina: fighter.maxStamina });
  return <View style={styles.screen}>
    <Image source={require('../../../assets/battle/holocity-park.jpg')} style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]} resizeMode="cover" />
    {player && rival && <BotStage ref={stage} variant="duelPortrait" transparentBackdrop bots={[{ id: player, side: 'player' }, { id: rival, side: 'rival' }]} style={StyleSheet.absoluteFillObject} onReady={() => setReady(true)} onError={() => setError(true)} />}
    <View style={[styles.top, { paddingTop: insets.top + 4 }]}>
      <View style={styles.toolbar}><Text style={styles.caption}>{preview ? 'OFFLINE PREVIEW · NO REWARDS' : 'HOLOCITY / PARK ARENA'}</Text><Pressable accessibilityRole="button" onPress={onLeave} disabled={pending} style={styles.button}><Text style={styles.caption}>LEAVE</Text></Pressable></View>
      <View style={styles.hud}><FighterHud name={battle.player.name} state={state(battle.player)} /><View style={styles.round}><Text style={styles.caption}>TURN</Text><Text style={styles.number}>{String(action?.turnNumber ?? 1).padStart(2, '0')}</Text></View><FighterHud name={battle.opponent.name} state={state(battle.opponent)} rival /></View>
    </View>
    <View style={[styles.bottom, { paddingBottom: Math.max(12, insets.bottom) }]}>
      <Text style={styles.log}>{error || !player || !rival ? '3D unavailable · controls remain active' : !ready ? 'LOADING ARENA' : action ? `${action.card.name} · ${action.actualDamage ?? action.damageDealt} DMG` : 'SELECT YOUR COMMAND'}</Text>
      <View style={styles.toolbar}><Text style={styles.caption}>{Math.round(battle.player.specialMeter)}% SYNC</Text>{(['half', 'full'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: power === value }} onPress={() => setPower(value)} style={styles.button}><Text style={[styles.caption, power === value && { color: theme.colors.warning }]}>{FINISHER_POLICY[value].sync}% · {FINISHER_POLICY[value].stamina} STA</Text></Pressable>)}</View>
      <HoloCityCommandBar compact commands={commands} onPress={id => {
        if (id === 'finisher') onSignature(power);
        else { const card = moves.find(candidate => candidate.type === (id === 'heavy' ? 'combo' : id === 'defend' ? 'defense' : id)); if (card) onPlay(card.id); }
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
