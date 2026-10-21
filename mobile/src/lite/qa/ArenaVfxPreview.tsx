import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LiveDuelStage } from '@/lite/components/duel/LiveDuelStage';
import { arenaHostBattle } from '@/lite/lib/arenaHostBattle';
import { FAST_RENDER_QUALITY, PRODUCTION_KNOBS } from '@/lite/lib/bots/stagePerf';
import { ArenaCombatEngine } from '@/lite/features/arena/combatEngine';
import type { ActionCard, BattleAction, BattleState } from '@/lite/types/arena';
import { theme } from '@/lite/theme';
import { ARENA_STARTED } from './arenaPolishFixtures';

/**
 * lite-vfx-port-1 witness routes (holobotsmobile://qa/ArenaVfx…). The Arena round's own stage (LiveDuelStage under the
 * CPU Arena's fast mix, FAST_RENDER_QUALITY) on the offline fixture match, with ONE scripted, already-resolved action
 * replayed every PERIOD_MS: the same beat every take, so the simulator capture can be gated like Unity's three takes.
 * The script only appends a recorded action to a local copy of the fixture state; no engine, store or City call runs.
 * The Arena round itself has no player finisher (City-issued CPU match: FINISHER LOCKED), which is why SKYBREAKER is
 * witnessed here. Known-bad control first: the same beat with the VFX off (today's no-VFX hit).
 */
const PERIOD_MS = 5000, FIRST_MS = 2500;
type Cell = { title: string; bot: 'ACE' | 'WOLF'; move: 'combo' | 'finisher'; vfx: boolean; unbuilt?: boolean; /** Dev perf arm (#133 sampler: frame / GL-call breakdown over 1-6 s after load, take 1 inside it). */ perf?: true };
const CELLS: Record<string, Cell> = {
  ArenaVfxBreakOff: { title: 'KNOWN BAD · HEAVY HIT, NO VFX', bot: 'ACE', move: 'combo', vfx: false },
  ArenaVfxSkyOff: { title: 'KNOWN BAD · FINISHER HIT, NO VFX', bot: 'ACE', move: 'finisher', vfx: false },
  ArenaVfxBreak: { title: 'ACE BREAK HEAVY · PACK VFX', bot: 'ACE', move: 'combo', vfx: true },
  ArenaVfxSky: { title: 'ACE SKYBREAKER · PACK VFX', bot: 'ACE', move: 'finisher', vfx: true },
  ArenaVfxWolfBreak: { title: 'WOLF BREAK HEAVY · PACK VFX (UNBUILT IN UNITY)', bot: 'WOLF', move: 'combo', vfx: true, unbuilt: true },
  ArenaVfxWolfSky: { title: 'WOLF SKYBREAKER · PACK VFX (UNBUILT IN UNITY)', bot: 'WOLF', move: 'finisher', vfx: true, unbuilt: true },
  ArenaVfxSkyOffPerf: { title: 'PERF ARM · FINISHER HIT, NO VFX', bot: 'ACE', move: 'finisher', vfx: false, perf: true },
  ArenaVfxSkyPerf: { title: 'PERF ARM · ACE SKYBREAKER · PACK VFX', bot: 'ACE', move: 'finisher', vfx: true, perf: true },
};

function scriptedAction(battle: BattleState, card: ActionCard, n: number): BattleAction {
  const damage = card.type === 'finisher' ? 24 : 16;
  return { id: `qa-vfx-${n}`, turnNumber: n + 1, actorId: battle.player.holobotId, actorRole: 'player', targetId: battle.opponent.holobotId, card, actionType: card.type,
    timestamp: Date.now(), outcome: 'hit', damageDealt: damage, actualDamage: damage, staminaChange: 0, specialMeterChange: 0, wasCountered: false, triggeredCombo: false, perfectDefense: false };
}

function VfxCell({ cell, name }: { cell: Cell; name: string }) {
  const insets = useSafeAreaInsets();
  const prepared = useMemo(() => arenaHostBattle(ARENA_STARTED.match!, 'offline-fixture'), []);
  const base = useMemo<BattleState>(() => ({ ...prepared.battle, player: { ...prepared.battle.player, name: cell.bot } }), [prepared]);
  const card = useMemo(() => cell.move === 'finisher' ? ArenaCombatEngine.buildSignatureCard(base.player, 'full') : prepared.playerMoves.find(m => m.type === 'combo') ?? prepared.playerMoves[0], [base, prepared]);
  const [battle, setBattle] = useState(base);
  const [ready, setReady] = useState(false);
  const takes = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const fire = () => setBattle(current => {
      const action = scriptedAction(current, card, takes.current);
      takes.current += 1;
      const hp = Math.max(1, current.opponent.currentHP - (action.actualDamage ?? 0));
      console.info('[ArenaVfx:take] ' + JSON.stringify({ cell: name, take: takes.current, action: action.id, move: card.type, atMs: Math.round(performance.now()) }));
      return { ...current, opponent: { ...current.opponent, currentHP: hp }, actionHistory: [...current.actionHistory, action] };
    });
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => { fire(); interval = setInterval(fire, PERIOD_MS); }, FIRST_MS);
    return () => { clearTimeout(first); if (interval) clearInterval(interval); };
  }, [ready]);
  return <View style={styles.root}>
    <LiveDuelStage battle={battle} moves={prepared.playerMoves} onPlay={() => { }} onSignature={() => { }} pending={false} caption="QA · VFX WITNESS" leaveLabel="QA" leaveDisabled onLeave={() => { }} levels={{}} levelTab
      renderQuality={FAST_RENDER_QUALITY} perf={cell.perf ? { arm: name, knobs: { ...PRODUCTION_KNOBS, ...FAST_RENDER_QUALITY } } : undefined} vfx={cell.vfx} vfxUnbuiltKits={!!cell.unbuilt} showMetrics onStageReady={() => setReady(true)}
      onMetrics={metrics => console.info('[ArenaVfx:metrics] ' + JSON.stringify({ cell: name, ...metrics }))} />
    <View pointerEvents="none" style={[styles.banner, { top: insets.top + 300 }]}><Text style={styles.bannerTitle}>{`QA / OFFLINE / SCRIPTED BEAT · ${cell.title}`}</Text></View>
  </View>;
}

export const arenaVfxPreviewScreens: Record<string, ComponentType> = Object.fromEntries(Object.entries(CELLS).map(([name, cell]) => [name, function ArenaVfxCell() { return <VfxCell cell={cell} name={name} />; }]));
const styles = StyleSheet.create({
  root: { backgroundColor: theme.colors.carbon, flex: 1 },
  banner: { backgroundColor: theme.plates.overlay, left: 0, paddingHorizontal: theme.space.md, paddingVertical: theme.space.xs, position: 'absolute', right: 0 },
  bannerTitle: { ...theme.type.micro, color: theme.colors.accent, textAlign: 'center' },
});
