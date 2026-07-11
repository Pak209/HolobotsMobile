import { describe, expect, it } from "vitest";

import type { UserProfile } from "@/types/profile";
import {
  buildKitSaveUpdates,
  buildMoveUpgradeUpdates,
  CATEGORY_SPECIALIZATIONS,
  MOVE_RANK_SP_COSTS,
} from "@/features/arena/moveProgression";

import * as serverMoves from "../../../../functions/src/lib/moveProgression";

function playerState() {
  const holobot = {
    name: "ACE",
    level: 5,
    experience: 0,
    nextLevelExp: 100,
    moveProgress: { "strike.quickJab": { rank: 1 as const } },
    combatKit: {
      slots: ["strike.quickJab", "defense.guardUp", "combo.chainBurst", "finisher.tacticalOverride"] as [string, string, string, string],
      revision: 2,
    },
  };
  const shared = {
    battle_cards: {
      "combo.chainBurst": 1,
      "combo.doubleTap": 1,
      "defense.guardUp": 1,
      "finisher.tacticalOverride": 1,
      "strike.quickJab": 1,
      "strike.snapShot": 1,
    },
    holobots: [holobot],
    syncPoints: 300,
  };

  return {
    clientProfile: JSON.parse(JSON.stringify(shared)) as UserProfile,
    rawDoc: JSON.parse(JSON.stringify(shared)) as Record<string, unknown>,
  };
}

describe("move progression client/server parity", () => {
  it("cost and specialization tables match", () => {
    expect(serverMoves.MOVE_RANK_SP_COSTS).toEqual(MOVE_RANK_SP_COSTS);
    expect(serverMoves.CATEGORY_SPECIALIZATIONS).toEqual(CATEGORY_SPECIALIZATIONS);
    expect([...serverMoves.STOCK_KIT_TEMPLATE_IDS]).toEqual([
      "strike.quickJab",
      "defense.guardUp",
      "combo.chainBurst",
      "finisher.tacticalOverride",
    ]);
  });

  it("move upgrades produce identical updates", () => {
    const { clientProfile, rawDoc } = playerState();

    const client = buildMoveUpgradeUpdates(clientProfile, "ACE", "strike.quickJab", 1, "strike.power");
    const server = serverMoves.buildMoveUpgradeUpdatesRaw(rawDoc, "ACE", "strike.quickJab", 1, "strike.power");

    expect(server.cost).toBe(client.cost);
    expect(server.nextRank).toBe(client.nextRank);
    expect(server.updates).toEqual(client.updates);
  });

  it("kit saves produce identical updates", () => {
    const { clientProfile, rawDoc } = playerState();
    const slots: [string, string, string, string] = [
      "strike.snapShot",
      "defense.guardUp",
      "combo.doubleTap",
      "finisher.tacticalOverride",
    ];

    const client = buildKitSaveUpdates(clientProfile, "ACE", slots, 2);
    const server = serverMoves.buildKitSaveUpdatesRaw(rawDoc, "ACE", slots, 2);

    expect(server.revision).toBe(client.revision);
    expect(server.updates).toEqual(client.updates);
  });

  it("both sides reject the same invalid operations", () => {
    const scenarios: Array<() => [unknown, unknown]> = [
      () => {
        // Insufficient Sync Points.
        const { clientProfile, rawDoc } = playerState();
        clientProfile.syncPoints = 5;
        (rawDoc as { syncPoints: number }).syncPoints = 5;
        return [
          () => buildMoveUpgradeUpdates(clientProfile, "ACE", "strike.quickJab", 1, "strike.power"),
          () => serverMoves.buildMoveUpgradeUpdatesRaw(rawDoc, "ACE", "strike.quickJab", 1, "strike.power"),
        ];
      },
      () => {
        // Stale rank (optimistic check).
        const { clientProfile, rawDoc } = playerState();
        return [
          () => buildMoveUpgradeUpdates(clientProfile, "ACE", "strike.quickJab", 0),
          () => serverMoves.buildMoveUpgradeUpdatesRaw(rawDoc, "ACE", "strike.quickJab", 0),
        ];
      },
      () => {
        // Invalid branch for the category.
        const { clientProfile, rawDoc } = playerState();
        return [
          () => buildMoveUpgradeUpdates(clientProfile, "ACE", "strike.quickJab", 1, "combo.flow"),
          () => serverMoves.buildMoveUpgradeUpdatesRaw(rawDoc, "ACE", "strike.quickJab", 1, "combo.flow"),
        ];
      },
      () => {
        // Stale kit revision.
        const { clientProfile, rawDoc } = playerState();
        const slots: [string, string, string, string] = [
          "strike.snapShot",
          "defense.guardUp",
          "combo.doubleTap",
          "finisher.tacticalOverride",
        ];
        return [
          () => buildKitSaveUpdates(clientProfile, "ACE", slots, 0),
          () => serverMoves.buildKitSaveUpdatesRaw(rawDoc, "ACE", slots, 0),
        ];
      },
      () => {
        // Wrong slot category order.
        const { clientProfile, rawDoc } = playerState();
        const slots: [string, string, string, string] = [
          "defense.guardUp",
          "strike.snapShot",
          "combo.doubleTap",
          "finisher.tacticalOverride",
        ];
        return [
          () => buildKitSaveUpdates(clientProfile, "ACE", slots, 2),
          () => serverMoves.buildKitSaveUpdatesRaw(rawDoc, "ACE", slots, 2),
        ];
      },
    ];

    for (const scenario of scenarios) {
      const [clientOp, serverOp] = scenario() as [() => unknown, () => unknown];
      expect(clientOp).toThrow();
      expect(serverOp).toThrow();
    }
  });
});
