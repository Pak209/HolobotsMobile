import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LiveDuelStage } from '@/lite/components/duel/LiveDuelStage';
import { CityLiveBattleView } from '@/lite/components/city/CityLiveBattleView';
import { cityCombatantFighter, readCityRivalIssue } from '@/lite/lib/cityRivalBattle';
import { CITY_GATHERING_FIXTURE } from '@/lite/lib/cityHubFixtures';
import { getSignatureFinisher, resolveCombatKit } from '@/features/arena/moveKits';
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
type Cell = { title: string; bot: 'ACE' | 'WOLF'; move: 'combo' | 'finisher'; vfx: boolean; unbuilt?: boolean; /** lite-2305-1: false = today's framing (no special camera beat). */ specialCamera?: false; /** lite-2305-1: the city duel's own view and battle (ACE vs the fixture's TSUIN). */ city?: true; /** Dev perf arm (#133 sampler: frame / GL-call breakdown over 1-6 s after load, take 1 inside it). */ perf?: true };
const CELLS: Record<string, Cell> = {
  ArenaVfxBreakOff: { title: 'KNOWN BAD · HEAVY HIT, NO VFX', bot: 'ACE', move: 'combo', vfx: false },
  ArenaVfxSkyOff: { title: 'KNOWN BAD · FINISHER HIT, NO VFX', bot: 'ACE', move: 'finisher', vfx: false },
  ArenaVfxBreak: { title: 'ACE BREAK HEAVY · PACK VFX', bot: 'ACE', move: 'combo', vfx: true },
  ArenaVfxSky: { title: 'ACE SKYBREAKER · PACK VFX', bot: 'ACE', move: 'finisher', vfx: true },
  ArenaVfxWolfBreak: { title: 'WOLF BREAK HEAVY · PACK VFX (UNBUILT IN UNITY)', bot: 'WOLF', move: 'combo', vfx: true, unbuilt: true },
  ArenaVfxWolfSky: { title: 'WOLF SKYBREAKER · PACK VFX (UNBUILT IN UNITY)', bot: 'WOLF', move: 'finisher', vfx: true, unbuilt: true },
  ArenaVfxSkyOffPerf: { title: 'PERF ARM · FINISHER HIT, NO VFX', bot: 'ACE', move: 'finisher', vfx: false, perf: true },
  ArenaVfxSkyPerf: { title: 'PERF ARM · ACE SKYBREAKER · PACK VFX', bot: 'ACE', move: 'finisher', vfx: true, perf: true },
  // lite-2305-1 (DECISIONS #72.63): today vs the special camera beat, on the Arena round and on the city duel.
  ArenaVfxBreakToday: { title: 'TODAY · ARENA · ACE BREAK, NO CAMERA BEAT', bot: 'ACE', move: 'combo', vfx: true, specialCamera: false },
  ArenaVfxSkyToday: { title: 'TODAY · ARENA · ACE SKYBREAKER, NO CAMERA BEAT', bot: 'ACE', move: 'finisher', vfx: true, specialCamera: false },
  CityVfxBreakToday: { title: 'TODAY · CITY DUEL · ACE BREAK, NO VFX', bot: 'ACE', move: 'combo', vfx: false, specialCamera: false, city: true },
  CityVfxSkyToday: { title: 'TODAY · CITY DUEL · ACE SKYBREAKER, NO VFX', bot: 'ACE', move: 'finisher', vfx: false, specialCamera: false, city: true },
  CityVfxBreak: { title: 'CITY DUEL · ACE BREAK · VFX + CAMERA BEAT', bot: 'ACE', move: 'combo', vfx: true, city: true },
  CityVfxSky: { title: 'CITY DUEL · ACE SKYBREAKER · VFX + CAMERA BEAT', bot: 'ACE', move: 'finisher', vfx: true, city: true },
};

function scriptedAction(battle: BattleState, card: ActionCard, n: number): BattleAction {
  const damage = card.type === 'finisher' ? 24 : 16;
  return { id: `qa-vfx-${n}`, turnNumber: n + 1, actorId: battle.player.holobotId, actorRole: 'player', targetId: battle.opponent.holobotId, card, actionType: card.type,
    timestamp: Date.now(), outcome: 'hit', damageDealt: damage, actualDamage: damage, staminaChange: 0, specialMeterChange: 0, wasCountered: false, triggeredCombo: false, perfectDefense: false };
}

/** The city duel exactly as CityRivalBattle's offline preview enters it (its previewIssue numbers), ACE vs TSUIN. */
function cityPrepared() {
  const rival = CITY_GATHERING_FIXTURE.roster[0];
  const bot = { holobotId: 'ace', level: 2, maxHealth: 150, attack: 38, defense: 22, speed: 20, intelligence: 18, commandRules: { version: 1, maxStamina: 7, staminaRegen: 0.5 } };
  const raw = { schemaVersion: 'rival-battle-3', battleId: 'rb_000000000000000000000000', expiresAtMs: Date.now() + 7_200_000, playerCombatants: [bot], encounter: { encounterId: 'rb_000000000000000000000000', seed: 1, opponentPilot: { pilotId: rival.citizenId }, opponentSquad: [{ ...bot, holobotId: rival.holobotId, attack: 31, defense: 18 }] } };
  const issue = readCityRivalIssue(raw, rival.citizenId, rival.holobotId);
  const player = cityCombatantFighter(issue.player, 'player', 'offline-city-preview'), opponent = cityCombatantFighter(issue.opponent, 'rival', 'offline-city-preview');
  for (const fighter of [player, opponent]) fighter.signatureFinisher = getSignatureFinisher(fighter.name);
  const battle = ArenaCombatEngine.initializeBattle(player, opponent, { battleType: 'pve', allowPlayerControl: true, potentialRewards: { exp: 0, syncPoints: 0 } });
  return { battle, playerMoves: [...resolveCombatKit({ idPrefix: 'city' }).slots], raw };
}

function VfxCell({ cell, name }: { cell: Cell; name: string }) {
  const prepared = useMemo(() => cell.city ? cityPrepared() : { ...arenaHostBattle(ARENA_STARTED.match!, 'offline-fixture'), raw: undefined }, []);
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
  const metrics = (m: object) => console.info('[ArenaVfx:metrics] ' + JSON.stringify({ cell: name, ...m }));
  return <View style={styles.root}>
    {cell.city ? <CityStage cell={cell} battle={battle} moves={prepared.playerMoves} raw={prepared.raw} onReady={() => setReady(true)} /> : <LiveDuelStage battle={battle} moves={prepared.playerMoves} onPlay={() => { }} onSignature={() => { }} pending={false} caption="QA · VFX WITNESS" leaveLabel="QA" leaveDisabled onLeave={() => { }} levels={{}} levelTab
      renderQuality={FAST_RENDER_QUALITY} perf={cell.perf ? { arm: name, knobs: { ...PRODUCTION_KNOBS, ...FAST_RENDER_QUALITY } } : undefined} vfx={cell.vfx} vfxUnbuiltKits={!!cell.unbuilt} specialCamera={cell.specialCamera ?? true} showMetrics onStageReady={() => setReady(true)}
      onMetrics={metrics} />}
    <View pointerEvents="none" style={[styles.banner, { top: 0 }]}><Text style={styles.bannerTitle}>{`QA / OFFLINE / SCRIPTED BEAT · ${cell.title}`}</Text></View>
  </View>;
}

/** The city duel's own wrapper (CityLiveBattleView: production render quality, issue-based levels). Its stage reports ready
 * through LiveDuelStage's metrics only, so the scripted beat starts on the first metrics sample. */
function CityStage({ cell, battle, moves, raw, onReady }: { cell: Cell; battle: BattleState; moves: ActionCard[]; raw: unknown; onReady: () => void }) {
  const started = useRef(false);
  useEffect(() => { const t = setTimeout(() => { if (!started.current) { started.current = true; onReady(); } }, 6000); return () => clearTimeout(t); }, []);
  return <CityLiveBattleView battle={battle} moves={moves} onPlay={() => { }} onSignature={() => { }} onLeave={() => { }} pending={false} preview hostIssue={raw} vfx={cell.vfx} specialCamera={cell.specialCamera ?? true} />;
}

export const arenaVfxPreviewScreens: Record<string, ComponentType> = Object.fromEntries(Object.entries(CELLS).map(([name, cell]) => [name, function ArenaVfxCell() { return <VfxCell cell={cell} name={name} />; }]));
const styles = StyleSheet.create({
  root: { backgroundColor: theme.colors.carbon, flex: 1 },
  banner: { backgroundColor: theme.plates.overlay, left: 0, paddingHorizontal: theme.space.md, paddingVertical: theme.space.xs, position: 'absolute', right: 0 },
  bannerTitle: { ...theme.type.micro, color: theme.colors.accent, textAlign: 'center' },
});
