import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Animated: {},
  Image: { resolveAssetSource: () => null },
  Pressable: "Pressable",
  StyleSheet: { absoluteFill: {}, absoluteFillObject: {}, create: (styles: unknown) => styles },
  Text: "Text",
  View: "View",
}));
vi.mock("react-native-svg", () => ({ default: "Svg", Path: "Path" }));
vi.mock("../../ui/GameSurfaceFrame", () => ({ GameSurfaceFrame: () => null }));
vi.mock("../../character/HolobotAnimatedCharacter", () => ({ HolobotAnimatedCharacter: () => null }));
vi.mock("@/config/holobots", () => ({ getHolobotFullImageSource: (id: string) => id }));

import type { BattleAction, BattleState } from "../../../types/arena";

let getActionSides: typeof import("../BattleArenaView").getActionSides;
let getCompletedVisualStates: typeof import("../BattleArenaView").getCompletedVisualStates;
let hasHolobotAnimation: typeof import("../../character/holobotAnimationAssets").hasHolobotAnimation;
let resolveHolobotAnimationState: typeof import("../../character/holobotAnimationAssets").resolveHolobotAnimationState;

beforeAll(async () => {
  const nodeRequire = createRequire(import.meta.url);
  for (const extension of [".mov", ".png", ".webm"]) {
    nodeRequire.extensions[extension] = (module, filename) => {
      module.exports = filename;
    };
  }
  ({ getActionSides, getCompletedVisualStates } = await import("../BattleArenaView"));
  ({ hasHolobotAnimation, resolveHolobotAnimationState } = await import("../../character/holobotAnimationAssets"));
});

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

  it("falls registered bots back to idle and keeps unregistered bots static", () => {
    expect(resolveHolobotAnimationState("ACE", "arena", "attackBasic")).toBe("idle");
    expect(hasHolobotAnimation("KUMA", "arena")).toBe(false);
  });
});
