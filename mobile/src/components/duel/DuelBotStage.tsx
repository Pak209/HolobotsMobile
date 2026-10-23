import type { TerminalPresentation } from '../../lib/bots/koPresentation';
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import { resolveBotId } from '../../../assets/bots';
import { BotStage, type BotStageHandle } from '../bots/BotStage';
import { FAST_RENDER_QUALITY, type StageRenderQuality } from '../../lib/bots/stagePerf';
import { liveDuelVfxCues } from '../../vfx/liveDuelVfx';
import { PresentationCursor } from '../../lib/bots/battlePace';
import { resolvedBattlePace } from '../../lib/bots/resolvedBattlePace';
import type { BattleAction, BattleState } from '../../types/arena';


/** True when both active fighters have a 3D model (the stage can show them); otherwise the caller keeps its 2D stage. */
export function hasDuelBotStage(battle: BattleState) {
  return !!resolveBotId(battle.player.name) && !!resolveBotId(battle.opponent.name);
}

/**
 * lite-pvp-3d-1: the Arena round's 3D stage (the park plate, BotStage `duelPortrait`, the HoloCity pack VFX and the SKY /
 * BREAK special camera beat) for a view that draws its own HUD — PvP's BattleArenaView. It presents the action the caller
 * already resolved, in the same FIFO as LiveDuelStage: the authored attack/contact, pack cue, and hit reaction
 * or evade. Presentation only; it decides nothing about the fight. Only the two ACTIVE fighters are
 * on stage (3v3: a switch swaps the model, never six at once). `onError` lets the caller fall back to its 2D stage.
 */
export function DuelBotStage({ battle, action, active = true, renderQuality = FAST_RENDER_QUALITY, vfx = true, specialCamera = true, onError, terminal, onTerminalComplete }: {
  battle: BattleState;
  /** The last resolved action to present (PvP: room.lastAction). */
  action: BattleAction | null;
  /** False pauses the GL scene (under an overlay); combat is not affected. */
  active?: boolean;
  /** Default: the Arena round's fast mix (FAST_RENDER_QUALITY), since the live loop shares the JS thread with GL. */
  renderQuality?: StageRenderQuality;
  vfx?: boolean;
  specialCamera?: boolean;
  onError?: () => void;
  terminal?: TerminalPresentation;
  onTerminalComplete?: (id: string) => void;
}) {
  const stage = useRef<BotStageHandle>(null);
  const [readyScene, setReadyScene] = useState<string | null>(null);
  const [drained, setDrained] = useState(0);
  const [presentedThrough, setPresentedThrough] = useState<string | null>(null);
  const player = resolveBotId(battle.player.name);
  const rival = resolveBotId(battle.opponent.name);
  const sceneKey = `${battle.battleId}:${player}:${rival}`;
  const ready = readyScene === sceneKey;
  const historyKey = `${sceneKey}:${battle.actionHistory.length}:${battle.actionHistory.at(-1)?.id}:${action?.id}:${battle.player.currentHP}:${battle.opponent.currentHP}`;
  // A 3v3 switch changes the bots, which remounts the GL scene: present nothing until it reports ready again.
  // An action that landed while the scene was loading (the room's last action on entry, or the KO that forced a switch)
  // is not replayed late on the fresh scene.
  const presented = useRef(new PresentationCursor<BattleState['actionHistory'][number]>());
  useEffect(() => {
    const history = [...battle.actionHistory];
    if (action && !history.some(row => row.id === action.id)) history.push(action);
    presented.current.consume(sceneKey, history, ready, row => {
      const cue = resolvedBattlePace(row, battle, row.id === action?.id);
      cue.effects = vfx ? liveDuelVfxCues(row, battle, { player, rival }) : [];
      return stage.current?.present(cue) ?? 'backpressure';
    });
    setPresentedThrough(ready && !presented.current.hasPending(history) ? historyKey : null);
  }, [battle.actionHistory, action?.id, ready, sceneKey, drained, historyKey]);
  useEffect(() => { if (terminal && (!player || !rival)) onTerminalComplete?.(terminal.id); }, [terminal?.id, player, rival, onTerminalComplete]);
  if (!player || !rival) return null;
  return <>
    <Image source={require('../../../assets/battle/holocity-park.jpg')} style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]} resizeMode="cover" />
    <BotStage key={sceneKey} ref={stage} variant="duelPortrait" transparentBackdrop bots={[{ id: player, side: 'player' }, { id: rival, side: 'rival' }]} style={StyleSheet.absoluteFillObject} onReady={() => setReadyScene(sceneKey)} onPresentationDrain={() => setDrained(n => n + 1)} terminal={presentedThrough === historyKey ? terminal : undefined} onTerminalComplete={onTerminalComplete} onError={() => onError?.()} active={active} quality={renderQuality} vfx={vfx} specialCamera={specialCamera} />
  </>;
}
