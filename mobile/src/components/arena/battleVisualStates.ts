import type { BattleAction, BattleState } from "../../types/arena";
import type { HolobotAnimationState } from "../character/holobotAnimationAssets";

export type FighterSide = "player" | "opponent";
export type FighterVisualStates = Record<FighterSide, HolobotAnimationState>;

export function getActionSides(action: BattleAction, battle: BattleState) {
  const attacker: FighterSide = action.actorRole
    ?? (action.actorId === battle.opponent.holobotId
      ? "opponent"
      : action.actorId === battle.player.holobotId
        ? "player"
        : "player");
  const defender: FighterSide = attacker === "player" ? "opponent" : "player";
  const damage = action.actualDamage ?? action.damageDealt;
  const damaged: FighterSide | null =
    damage > 0 && (action.outcome === "countered" || action.outcome === "counter")
      ? attacker
      : damage > 0 && action.outcome === "hit"
        ? defender
        : null;
  return { attacker, damaged };
}

export function getCompletedVisualStates(battle: BattleState): FighterVisualStates | null {
  if (battle.status !== "completed" && battle.player.currentHP > 0 && battle.opponent.currentHP > 0) {
    return null;
  }
  if (battle.player.currentHP <= 0 && battle.opponent.currentHP > 0) {
    return { player: "defeat", opponent: "victory" };
  }
  if (battle.opponent.currentHP <= 0 && battle.player.currentHP > 0) {
    return { player: "victory", opponent: "defeat" };
  }
  return null;
}
