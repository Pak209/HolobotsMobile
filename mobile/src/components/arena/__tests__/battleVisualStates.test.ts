import { describe, expect, it } from "vitest";

import { getActionSides, getCompletedVisualStates } from "../battleVisualStates";
import type { BattleAction, BattleState } from "../../../types/arena";

const battle = {
  battleId: "battle-1",
  status: "active",
  player: { currentHP: 100, holobotId: "player-bot" },
  opponent: { currentHP: 100, holobotId: "opponent-bot" },
} as unknown as BattleState;

function action(overrides: Partial<BattleAction>) {
  return {
    actorId: "player-bot",
    damageDealt: 10,
    outcome: "hit",
    ...overrides,
  } as unknown as BattleAction;
}

describe("arena fighter visual state", () => {
  it("attributes attacker by role and falls back to actor id", () => {
    expect(getActionSides(action({ actorRole: "opponent" }), battle).attacker).toBe("opponent");
    expect(getActionSides(action({ actorId: "opponent-bot", actorRole: undefined }), battle).attacker).toBe("opponent");
  });

  it("assigns damage feedback for hits, counters, and blocks", () => {
    expect(getActionSides(action({ actorRole: "player", outcome: "countered" }), battle).damaged).toBe("player");
    expect(getActionSides(action({ actorRole: "player", outcome: "hit" }), battle).damaged).toBe("opponent");
    expect(getActionSides(action({ actorRole: "player", outcome: "blocked" }), battle).damaged).toBeNull();
  });

  it("gives completed-state visuals precedence only when a knockout is known", () => {
    const knockout = {
      ...battle,
      player: { ...battle.player, currentHP: 0 },
    } as unknown as BattleState;
    expect(getCompletedVisualStates(knockout)).toEqual({ player: "defeat", opponent: "victory" });
    expect(getCompletedVisualStates(battle)).toBeNull();
  });
});
