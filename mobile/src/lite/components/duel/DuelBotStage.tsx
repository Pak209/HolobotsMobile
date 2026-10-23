import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import { resolveBotId } from '../../../../assets/bots';
import { BotStage, type BotStageHandle } from '../bots/BotStage';
import { FAST_RENDER_QUALITY, type StageRenderQuality } from '../../lib/bots/stagePerf';
import { liveDuelVfxCues } from '../../vfx/liveDuelVfx';
import { getActionSides } from '../../../components/arena/battleVisualStates';
import type { BattleAction, BattleState } from '../../types/arena';

/** The contact beat after an action lands on the stage (LiveDuelStage's IMPACT_MS: the hit recoil and the VFX landing). */
const IMPACT_MS = 300;

/** True when both active fighters have a 3D model (the stage can show them); otherwise the caller keeps its 2D stage. */
export function hasDuelBotStage(battle: BattleState) {
  return !!resolveBotId(battle.player.name) && !!resolveBotId(battle.opponent.name);
}

/**
 * lite-pvp-3d-1: the Arena round's 3D stage (the park plate, BotStage `duelPortrait`, the HoloCity pack VFX and the SKY /
 * BREAK special camera beat) for a view that draws its own HUD — PvP's BattleArenaView. It presents the action the caller
 * already resolved (the room's last action) exactly as LiveDuelStage does: the attacker's clip, the pack cue, the hit
 * recoil or evade at +300 ms. Presentation only; it decides nothing about the fight. Only the two ACTIVE fighters are
 * on stage (3v3: a switch swaps the model, never six at once). `onError` lets the caller fall back to its 2D stage.
 */
export function DuelBotStage({ battle, action, active = true, renderQuality = FAST_RENDER_QUALITY, vfx = true, specialCamera = true, onError }: {
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
}) {
  const stage = useRef<BotStageHandle>(null);
  const [ready, setReady] = useState(false);
  const player = resolveBotId(battle.player.name);
  const rival = resolveBotId(battle.opponent.name);
  // A 3v3 switch changes the bots, which remounts the GL scene: present nothing until it reports ready again.
  useEffect(() => { setReady(false); }, [player, rival]);
  // An action that landed while the scene was loading (the room's last action on entry, or the KO that forced a switch)
  // is not replayed late on the fresh scene.
  const presented = useRef<string | null>(null);
  useEffect(() => {
    if (!action || presented.current === action.id) return;
    presented.current = action.id;
    if (!ready) return;
    const { attacker, damaged } = getActionSides(action, battle);
    const side = attacker === 'player' ? 'player' : 'rival';
    const target = side === 'player' ? 'rival' : 'player';
    const type = action.actionType ?? action.card.type;
    if (type === 'defense') stage.current?.guard(side);
    else { stage.current?.play(side, type === 'combo' ? 'Heavy' : type === 'finisher' ? 'Finisher' : 'Strike'); stage.current?.strike(side); }
    if (vfx) for (const cue of liveDuelVfxCues(action, battle, { player, rival })) stage.current?.fx(cue, IMPACT_MS);
    const impact = setTimeout(() => {
      if (damaged) stage.current?.hit(damaged === 'player' ? 'player' : 'rival');
      else if (action.outcome === 'dodged' || action.outcome === 'missed') stage.current?.play(target, 'Evade');
    }, IMPACT_MS);
    return () => clearTimeout(impact);
  }, [action?.id, ready]);
  if (!player || !rival) return null;
  return <>
    <Image source={require('../../../../assets/battle/holocity-park.jpg')} style={[StyleSheet.absoluteFillObject, { width: '100%', height: '100%' }]} resizeMode="cover" />
    <BotStage ref={stage} variant="duelPortrait" transparentBackdrop bots={[{ id: player, side: 'player' }, { id: rival, side: 'rival' }]} style={StyleSheet.absoluteFillObject} onReady={() => setReady(true)} onError={() => onError?.()} active={active} quality={renderQuality} vfx={vfx} specialCamera={specialCamera} />
  </>;
}
