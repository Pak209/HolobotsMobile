import { describe, expect, it } from "vitest";

import {
  applyAttributeBoost,
  ATTRIBUTE_BOOST_AMOUNTS,
  BOOSTABLE_ATTRIBUTES,
  calculateExperience,
  getHolobotBattleStats,
  getHolobotDisplayStats,
  getLegacyBattleSpeed,
  HOLOBOT_BASE_STATS,
  LEGACY_BASE_SPEED_PRE_72_78,
  normalizeUserHolobot,
  type BoostableAttribute,
} from "@/lib/progression";
import { getHolobotPowerScore } from "@/lib/progressionSystems";
import type { UserHolobot } from "@/types/profile";

import * as server from "../../../../functions/src/lib/progression";

/**
 * DECISIONS #53-2: boostHolobotAttribute applies exactly the InventoryScreen
 * math. The reference below is the body of InventoryScreen.handleUpgradeStat
 * as it stood before the callable (2026-10-06), reduced to a pure function,
 * amended by DECISIONS #72.78: SPECIAL is buyable (+1) and a NEW HP point is +3 (was +10).
 */
function legacyHandleUpgradeStat(target: UserHolobot, attribute: BoostableAttribute): UserHolobot | null {
  const normalizedTarget = normalizeUserHolobot(target);
  if ((normalizedTarget.attributePoints || 0) <= 0) {
    return null; // "No Boosts Available"
  }

  const boosts = { ...(normalizedTarget.boostedAttributes || {}) };
  if (attribute === "health") {
    boosts.health = (boosts.health || 0) + 3;
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

  it("costs one point: +1 attack/defense/speed/special, +3 HP (DECISIONS #72.78)", () => {
    expect(ATTRIBUTE_BOOST_AMOUNTS).toEqual({ attack: 1, defense: 1, health: 3, special: 1, speed: 1 });
    expect(server.ATTRIBUTE_BOOST_AMOUNTS).toEqual(ATTRIBUTE_BOOST_AMOUNTS);
    expect([...BOOSTABLE_ATTRIBUTES]).toEqual(["attack", "defense", "speed", "health", "special"]);
    expect([...server.BOOSTABLE_ATTRIBUTES]).toEqual([...BOOSTABLE_ATTRIBUTES]);
    const result = server.applyAttributeBoost(bot({ attributePoints: 2, boostedAttributes: { health: 30 } }), "health");
    expect(result).toMatchObject({ applied: true, holobot: { attributePoints: 1, boostedAttributes: { health: 33 } } });
    const special = server.applyAttributeBoost(bot({ attributePoints: 2, boostedAttributes: { special: 2 } }), "special");
    expect(special).toMatchObject({ applied: true, holobot: { attributePoints: 1, boostedAttributes: { special: 3 } } });
    expect(getHolobotBattleStats("ACE", 1, { special: 3 }).intelligence - getHolobotBattleStats("ACE", 1, { special: 2 }).intelligence).toBe(1);
  });

  it("grandfathers allocated HP: health is an HP sum, so a legacy 100 keeps maxHP +100 and a new point makes it 103", () => {
    const legacy = bot({ attributePoints: 1, boostedAttributes: { health: 100 }, level: 3, name: "KEN" });
    const base = getHolobotBattleStats("KEN", 3, {});
    for (const stats of [getHolobotBattleStats("KEN", 3, legacy.boostedAttributes), server.getHolobotBattleStats("KEN", 3, legacy.boostedAttributes)]) {
      expect(stats.maxHP).toBe(base.maxHP + 100);
    }
    const client = applyAttributeBoost(legacy, "health");
    const host = server.applyAttributeBoost(structuredClone(legacy), "health");
    expect(pick(host.holobot)).toEqual(pick(client.holobot));
    expect(client.holobot.boostedAttributes?.health).toBe(103);
    expect(getHolobotBattleStats("KEN", 3, client.holobot.boostedAttributes).maxHP).toBe(base.maxHP + 103);
    expect(getHolobotDisplayStats("KEN", 3, client.holobot.boostedAttributes).hp).toBe(getHolobotDisplayStats("KEN", 3, {}).hp + 103);
  });

  it("base SPEED is the #72.78 4-6 column on both mirrors (3->4, 7->6), the old column frozen beside it", () => {
    const speeds = Object.fromEntries(Object.entries(HOLOBOT_BASE_STATS).map(([k, v]) => [k, v.speed]));
    expect(speeds).toEqual({ ACE: 6, ERA: 6, GAMA: 4, HARE: 4, KEN: 6, KUMA: 4, KURAI: 4, SHADOW: 4, TORA: 6, TSUIN: 5, WAKE: 4, WOLF: 5 });
    expect(server.HOLOBOT_BASE_STATS).toEqual(HOLOBOT_BASE_STATS);
    expect(server.LEGACY_BASE_SPEED_PRE_72_78).toEqual(LEGACY_BASE_SPEED_PRE_72_78);
    const map: Record<number, number> = { 3: 4, 4: 4, 5: 5, 6: 6, 7: 6 };
    for (const [k, old] of Object.entries(LEGACY_BASE_SPEED_PRE_72_78)) expect(speeds[k]).toBe(map[old]);
    for (const name of [...Object.keys(HOLOBOT_BASE_STATS), "JUSAN"]) {
      for (const level of [1, 5, 12, 40]) {
        const boosts = { speed: 3 };
        expect(getLegacyBattleSpeed(name, level, boosts)).toBe(server.getLegacyBattleSpeed(name, level, boosts));
      }
    }
    // The quest/training power score keeps the old column: ACE LV 5 (+4 atk) is 2316, as before the ruling.
    expect(getHolobotPowerScore({ ...bot({ level: 5 }), boostedAttributes: { attack: 4 } })).toBe(2316);
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

  it("unknown attributes are not boostable (SPECIAL is, since #72.78)", () => {
    for (const attribute of ["intelligence", "hp", "ATTACK", "", "__proto__"]) {
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
