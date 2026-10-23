import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyAttributeBoost,
  ATTRIBUTE_BOOST_AMOUNTS,
  ATTRIBUTE_BOOST_AMOUNTS_RULES5,
  BOOSTABLE_ATTRIBUTES,
  BOOSTABLE_ATTRIBUTES_RULES5,
  calculateExperience,
  getAttributeBoostAmounts,
  getBoostableAttributes,
  getHolobotBattleStats,
  getHolobotDisplayStats,
  getLegacyBattleSpeed,
  HOLOBOT_BASE_STATS,
  HOLOBOT_BASE_STATS_RULES5,
  LEGACY_BASE_SPEED_PRE_72_78,
  normalizeUserHolobot,
  progressionRules5Enabled,
  type BoostableAttribute,
} from "@/lib/progression";
import { getHolobotPowerScore } from "@/lib/progressionSystems";
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

/**
 * rules5-progression-gate-1 (DECISIONS #72.78 item 7 + #72.81): the #72.78 progression changes are live only with the
 * duel-rules-5 flag — host HOLOCITY_FIGHT_ATTRS, client EXPO_PUBLIC_HOLOCITY_FIGHT_ATTRS. Everything above runs flag
 * off (= the pre-#72.78 outputs); this block flips BOTH mirrors on and pins the #72.78 outputs, still client == server.
 */
describe("rules-5 flag on (#72.78): SPEED 4-6, SPECIAL +1, HP +3 per new point — both mirrors", () => {
  beforeEach(() => {
    vi.stubEnv("HOLOCITY_FIGHT_ATTRS", "1");
    vi.stubEnv("EXPO_PUBLIC_HOLOCITY_FIGHT_ATTRS", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("both mirrors read the flag", () => {
    expect(progressionRules5Enabled()).toBe(true);
    expect(server.progressionRules5Enabled()).toBe(true);
    vi.unstubAllEnvs();
    expect(progressionRules5Enabled()).toBe(false);
    expect(server.progressionRules5Enabled()).toBe(false);
  });

  it("costs one point: +1 attack/defense/speed/special, +3 HP; server equals client", () => {
    expect(getAttributeBoostAmounts()).toEqual({ attack: 1, defense: 1, health: 3, special: 1, speed: 1 });
    expect(server.getAttributeBoostAmounts()).toEqual(getAttributeBoostAmounts());
    expect([...getBoostableAttributes()]).toEqual(["attack", "defense", "speed", "health", "special"]);
    expect([...server.getBoostableAttributes()]).toEqual([...getBoostableAttributes()]);
    expect(server.ATTRIBUTE_BOOST_AMOUNTS_RULES5).toEqual(ATTRIBUTE_BOOST_AMOUNTS_RULES5);
    expect([...server.BOOSTABLE_ATTRIBUTES_RULES5]).toEqual([...BOOSTABLE_ATTRIBUTES_RULES5]);
    for (const holobot of HOLOBOTS) {
      for (const attribute of BOOSTABLE_ATTRIBUTES_RULES5) {
        const clientResult = applyAttributeBoost(holobot, attribute);
        const serverResult = server.applyAttributeBoost(structuredClone(holobot), attribute);
        expect(clientResult.applied).toBe(true);
        expect(pick(serverResult.holobot)).toEqual(pick(clientResult.holobot));
      }
    }
    const special = server.applyAttributeBoost(bot({ attributePoints: 2, boostedAttributes: { special: 2 } }), "special");
    expect(special).toMatchObject({ applied: true, holobot: { attributePoints: 1, boostedAttributes: { special: 3 } } });
    expect(getHolobotBattleStats("ACE", 1, { special: 3 }).intelligence - getHolobotBattleStats("ACE", 1, { special: 2 }).intelligence).toBe(1);
  });

  it("grandfathers allocated HP: a legacy health 100 keeps maxHP +100 and a new point makes it 103", () => {
    const legacy = bot({ attributePoints: 1, boostedAttributes: { health: 100 }, level: 3, name: "KEN" });
    const base = getHolobotBattleStats("KEN", 3, {});
    expect(getHolobotBattleStats("KEN", 3, legacy.boostedAttributes).maxHP).toBe(base.maxHP + 100);
    const client = applyAttributeBoost(legacy, "health");
    const host = server.applyAttributeBoost(structuredClone(legacy), "health");
    expect(pick(host.holobot)).toEqual(pick(client.holobot));
    expect(client.holobot.boostedAttributes?.health).toBe(103);
    expect(getHolobotDisplayStats("KEN", 3, client.holobot.boostedAttributes).hp).toBe(getHolobotDisplayStats("KEN", 3, {}).hp + 103);
  });

  it("base SPEED is the 4-6 column on both mirrors; battle / display stats agree; the power score is frozen", () => {
    const speeds = (t: Record<string, { speed: number }>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.speed]));
    expect(speeds(HOLOBOT_BASE_STATS_RULES5)).toEqual({ ACE: 6, ERA: 6, GAMA: 4, HARE: 4, KEN: 6, KUMA: 4, KURAI: 4, SHADOW: 4, TORA: 6, TSUIN: 5, WAKE: 4, WOLF: 5 });
    expect(server.HOLOBOT_BASE_STATS_RULES5).toEqual(HOLOBOT_BASE_STATS_RULES5);
    for (const name of [...Object.keys(HOLOBOT_BASE_STATS), "JUSAN"]) {
      for (const level of [1, 5, 12, 40]) {
        const boosts = { speed: 3, special: 1 };
        expect(server.getHolobotBattleStats(name, level, boosts)).toEqual(getHolobotBattleStats(name, level, boosts));
        expect(server.getHolobotDisplayStats(name, level, boosts)).toEqual(getHolobotDisplayStats(name, level, boosts));
      }
    }
    expect(getHolobotBattleStats("ACE", 4).speed).toBe(69);
    expect(getHolobotDisplayStats("ACE", 12).speed).toBe(9);
    expect(getHolobotPowerScore({ ...bot({ level: 5 }), boostedAttributes: { attack: 4 } })).toBe(2316);
  });
});

describe("rules-5 flag off (default): the pre-#72.78 outputs on both mirrors", () => {
  it("SPEED 3-7, +10 HP, SPECIAL refused, power score = the stats formula", () => {
    expect(progressionRules5Enabled()).toBe(false);
    expect(server.progressionRules5Enabled()).toBe(false);
    expect(server.HOLOBOT_BASE_STATS).toEqual(HOLOBOT_BASE_STATS);
    expect(Object.fromEntries(Object.entries(HOLOBOT_BASE_STATS).map(([k, v]) => [k, v.speed]))).toEqual(LEGACY_BASE_SPEED_PRE_72_78);
    expect([...getBoostableAttributes()]).toEqual([...BOOSTABLE_ATTRIBUTES]);
    expect(getAttributeBoostAmounts()).toEqual(ATTRIBUTE_BOOST_AMOUNTS);
    expect(getHolobotBattleStats("ACE", 4).speed).toBe(80);
    expect(getHolobotDisplayStats("ACE", 12).speed).toBe(10);
    for (const name of [...Object.keys(HOLOBOT_BASE_STATS), "JUSAN"]) {
      for (const level of [1, 5, 12, 40]) {
        expect(getLegacyBattleSpeed(name, level, { speed: 3 })).toBe(getHolobotBattleStats(name, level, { speed: 3 }).speed);
      }
    }
    const s = getHolobotBattleStats("ACE", 5, { attack: 4 });
    expect(getHolobotPowerScore({ ...bot({ level: 5 }), boostedAttributes: { attack: 4 } })).toBe(Math.round(s.maxHP * 4 + s.attack * 6 + s.defense * 5 + s.speed * 4 + s.intelligence * 5));
    expect(getHolobotPowerScore({ ...bot({ level: 5 }), boostedAttributes: { attack: 4 } })).toBe(2316);
  });
});
