import { describe, expect, it } from "vitest";

import {
  applyAttributeBoost,
  ATTRIBUTE_BOOST_AMOUNTS,
  BOOSTABLE_ATTRIBUTES,
  calculateExperience,
  normalizeUserHolobot,
  type BoostableAttribute,
} from "@/lib/progression";
import type { UserHolobot } from "@/types/profile";

import * as server from "../../../../functions/src/lib/progression";

/**
 * DECISIONS #53-2: boostHolobotAttribute applies exactly the InventoryScreen
 * math. The reference below is the body of InventoryScreen.handleUpgradeStat
 * as it stood before the callable (2026-10-06), reduced to a pure function.
 */
function legacyHandleUpgradeStat(target: UserHolobot, attribute: BoostableAttribute): UserHolobot | null {
  const normalizedTarget = normalizeUserHolobot(target);
  if ((normalizedTarget.attributePoints || 0) <= 0) {
    return null; // "No Boosts Available"
  }

  const boosts = { ...(normalizedTarget.boostedAttributes || {}) };
  if (attribute === "health") {
    boosts.health = (boosts.health || 0) + 10;
  } else {
    boosts[attribute] = (boosts[attribute] || 0) + 1;
  }

  return {
    ...normalizedTarget,
    attributePoints: Math.max(0, (normalizedTarget.attributePoints || 0) - 1),
    boostedAttributes: boosts,
  };
}

const PARITY_FIELDS = ["attributePoints", "boostedAttributes", "experience", "level", "name", "nextLevelExp", "rank"] as const;

function pick(holobot: unknown) {
  const source = (holobot ?? {}) as Record<string, unknown>;
  return Object.fromEntries(PARITY_FIELDS.map((field) => [field, source[field]]));
}

function bot(overrides: Partial<UserHolobot> = {}): UserHolobot {
  return { experience: 0, level: 1, name: "ACE", nextLevelExp: calculateExperience(2), ...overrides };
}

const HOLOBOTS: UserHolobot[] = [
  bot({ attributePoints: 1 }),
  bot({ attributePoints: 3, boostedAttributes: { attack: 5, health: 20 } }),
  bot({ attributePoints: 7, boostedAttributes: { defense: 2, special: 4, speed: 1 }, level: 12, name: "KUMA", rank: "Champion" }),
  // Legacy record without attributePoints: normalize grants `level` points.
  bot({ level: 4, name: "WOLF" }),
  bot({ attributePoints: 2, boostedAttributes: {}, experience: 450, level: 2, name: "SHADOW", nextLevelExp: 900 }),
];

describe("applyAttributeBoost = the InventoryScreen math", () => {
  it("client equals the legacy handleUpgradeStat body for every attribute", () => {
    for (const holobot of HOLOBOTS) {
      for (const attribute of BOOSTABLE_ATTRIBUTES) {
        const result = applyAttributeBoost(holobot, attribute);
        expect(result.applied).toBe(true);
        expect(result.holobot).toEqual(legacyHandleUpgradeStat(holobot, attribute));
      }
    }
  });

  it("server equals client on every progression field", () => {
    for (const holobot of HOLOBOTS) {
      for (const attribute of BOOSTABLE_ATTRIBUTES) {
        const clientResult = applyAttributeBoost(holobot, attribute);
        const serverResult = server.applyAttributeBoost(structuredClone(holobot), attribute);
        expect(serverResult.applied).toBe(clientResult.applied);
        expect(pick(serverResult.holobot)).toEqual(pick(clientResult.holobot));
      }
    }
  });

  it("costs one point: +1 attack/defense/speed, +10 HP", () => {
    expect(ATTRIBUTE_BOOST_AMOUNTS).toEqual({ attack: 1, defense: 1, health: 10, speed: 1 });
    expect(server.ATTRIBUTE_BOOST_AMOUNTS).toEqual(ATTRIBUTE_BOOST_AMOUNTS);
    const result = server.applyAttributeBoost(bot({ attributePoints: 2, boostedAttributes: { health: 30 } }), "health");
    expect(result).toMatchObject({ applied: true, holobot: { attributePoints: 1, boostedAttributes: { health: 40 } } });
  });

  it("spends down to zero, then refuses with no_attribute_points", () => {
    let holobot: unknown = bot({ attributePoints: 3 });
    for (const attribute of ["attack", "attack", "speed"] as const) {
      const step = server.applyAttributeBoost(holobot, attribute);
      expect(step.applied).toBe(true);
      holobot = step.holobot;
    }
    expect(pick(holobot)).toMatchObject({ attributePoints: 0, boostedAttributes: { attack: 2, speed: 1 } });
    const refused = server.applyAttributeBoost(holobot, "defense");
    expect(refused).toMatchObject({ applied: false, reason: "no_attribute_points" });
    expect(pick(refused.holobot)).toEqual(pick(holobot));
    const clientRefused = applyAttributeBoost(holobot as UserHolobot, "defense");
    expect(clientRefused).toMatchObject({ applied: false, reason: "no_attribute_points" });
    expect(legacyHandleUpgradeStat(holobot as UserHolobot, "defense")).toBeNull();
  });

  it("SPECIAL is not boostable with points (DECISIONS #53-2), and neither is anything unknown", () => {
    for (const attribute of ["special", "intelligence", "hp", "ATTACK", "", "__proto__"]) {
      const holobot = bot({ attributePoints: 5, boostedAttributes: { special: 2 } });
      const serverResult = server.applyAttributeBoost(holobot, attribute);
      const clientResult = applyAttributeBoost(holobot, attribute);
      expect(serverResult).toMatchObject({ applied: false, reason: "attribute_not_boostable" });
      expect(clientResult).toMatchObject({ applied: false, reason: "attribute_not_boostable" });
      expect(pick(serverResult.holobot)).toMatchObject({ attributePoints: 5, boostedAttributes: { special: 2 } });
    }
    expect(server.applyAttributeBoost(bot({ attributePoints: 5 }), undefined).applied).toBe(false);
  });

  it("does not mutate its input", () => {
    const holobot = bot({ attributePoints: 2, boostedAttributes: { attack: 1 } });
    const frozen = structuredClone(holobot);
    server.applyAttributeBoost(holobot, "attack");
    applyAttributeBoost(holobot, "attack");
    expect(holobot).toEqual(frozen);
  });
});
