import type { HoloCityCommand } from '../HoloCityCommandBar';
import type { FinisherReadiness } from './commandPlateLayout';
import { ArenaCombatEngine } from '../../features/arena/combatEngine';
import { FINISHER_POLICY, type FinisherPower } from '../../../features/arena/finisherPolicy';
import type { ActionCard, BattleState, CardType } from '../../types/arena';

/** The four HoloCity command plates and the move type each one plays. */
const COMMAND_TYPE: Record<string, CardType> = { strike: 'strike', heavy: 'combo', defend: 'defense', finisher: 'finisher' };

/** The move a command plate plays, or undefined (no such move issued). FINISHER is the signature, never a listed move. */
export function liveDuelCommandMove(id: string, moves: readonly ActionCard[]): ActionCard | undefined {
  const type = COMMAND_TYPE[id];
  return type && type !== 'finisher' ? moves.find(candidate => candidate.type === type) : undefined;
}

/** lite-battle-ui-1: the FINISHER readiness chip (Unity's LOCKED / HALF READY / FULL READY), read from the engine's own
 * signature availability at each power. No signature for this match (a City-issued CPU match) reads LOCKED. */
export function finisherReadiness(battle: BattleState, signatureAllowed: boolean): FinisherReadiness {
  if (!signatureAllowed) return 'locked';
  if (ArenaCombatEngine.getSignatureAvailability(battle, 'player', 'full').playable) return 'full';
  return ArenaCombatEngine.getSignatureAvailability(battle, 'player', 'half').playable ? 'half' : 'locked';
}

/** Presentation of availability that the engine or the caller's store already decided; no combat rule lives here. */
/** `plates` is HOLOCITY_COMMANDS (passed in, so this module stays free of react-native). */
export function liveDuelCommands(plates: readonly HoloCityCommand[], { battle, moves, power, signature: signatureAllowed, playableIds, blocked }: {
  battle: BattleState; moves: readonly ActionCard[]; power: FinisherPower; signature: boolean; playableIds?: readonly string[]; blocked: boolean;
}): HoloCityCommand[] {
  const signature = ArenaCombatEngine.getSignatureAvailability(battle, 'player', power);
  return plates.map(command => {
    const finisher = command.id === 'finisher';
    const card = finisher ? signatureAllowed ? ArenaCombatEngine.buildSignatureCard(battle.player, power) : undefined : liveDuelCommandMove(command.id, moves);
    const available = card && (finisher ? signature.playable : playableIds ? playableIds.includes(card.id) : ArenaCombatEngine.getCardAvailability(battle, 'player', card).playable);
    return { ...command, detail: card?.name, cost: card ? `${finisher ? FINISHER_POLICY[power].stamina : card.staminaCost} STA` : undefined, disabled: !available || blocked,
      ...(finisher ? { readiness: finisherReadiness(battle, signatureAllowed) } : {}) };
  });
}
