import type {
  ActionCard,
  ArenaCardAvailability,
  ArenaCardDisableReason,
  ArenaFighter,
  BattleState,
} from "../../types/arena";

export const DEFENSE_COOLDOWN_TURNS = 0;

const DEFAULT_COOLDOWN_BY_TYPE: Record<ActionCard["type"], number> = {
  combo: 0,
  defense: DEFENSE_COOLDOWN_TURNS,
  finisher: 2,
  strike: 0,
};

export function getCardCooldownTurns(card: ActionCard): number {
  if (card.type === "strike" || card.type === "combo") {
    return 0;
  }

  return card.cooldownTurns ?? DEFAULT_COOLDOWN_BY_TYPE[card.type] ?? 0;
}

export function getCardCooldownKey(card: ActionCard): string {
  return card.templateId || card.id;
}

export function buildCardAvailability(
  cards: ActionCard[],
  fighter: ArenaFighter,
  opponent: ArenaFighter,
  state: BattleState,
  isPlayer: boolean,
): ArenaCardAvailability[] {
  const cooldownMap = isPlayer ? state.playerCardCooldowns ?? {} : state.opponentCardCooldowns ?? {};
  const trapActive =
    !!fighter.armedDefenseTrap && fighter.armedDefenseTrap.expiresOnTurn >= state.turnNumber;

  return cards.map((card) => {
    let cooldownTurns =
      card.type === "strike" || card.type === "combo"
        ? 0
        : cooldownMap[getCardCooldownKey(card)] ?? 0;
    let disabledReason: ArenaCardDisableReason | undefined;

    if (card.type === "defense" && trapActive) {
      disabledReason = "trap_armed";
    } else if (cooldownTurns > 0) {
      disabledReason = "cooldown";
    } else if (fighter.stamina < card.staminaCost) {
      disabledReason = "insufficient_stamina";
    } else {
      for (const requirement of card.requirements) {
        if (
          requirement.type === "special_meter" &&
          requirement.operator === "gte" &&
          fighter.specialMeter < Number(requirement.value)
        ) {
          disabledReason = "special_meter";
        }

        if (
          requirement.type === "combo" &&
          requirement.operator === "gte" &&
          fighter.comboCounter < Number(requirement.value)
        ) {
          disabledReason = "combo_requirement";
        }

        if (
          requirement.type === "opponent_state" &&
          requirement.operator === "equals" &&
          opponent.staminaState !== String(requirement.value)
        ) {
          disabledReason = "opponent_state";
        }

        if (disabledReason) {
          break;
        }
      }
    }

    return {
      cardId: card.id,
      cooldownTurns,
      disabledReason,
      playable: !disabledReason,
    };
  });
}
