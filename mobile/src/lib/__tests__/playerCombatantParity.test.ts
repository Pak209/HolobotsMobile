import { describe, expect, it, vi } from "vitest";

// react-native cannot load under vitest, so @/config/holobots is replaced by
// the REAL stat function from the pure lib (only the image lookup is stubbed).
vi.mock("@/config/holobots", async () => {
  const lib = await vi.importActual<typeof import("@/lib/progression")>("@/lib/progression");
  return {
    getHolobotBattleStats: lib.getHolobotBattleStats,
    getHolobotFullImageSource: () => "test://holobot",
  };
});

import { buildPlayerFighter } from "@/config/arenaConfig";
import { EMPTY_PART_BOOSTS } from "@/lib/partStats";
import { calculateExperience, getHolobotBattleStats, HOLOBOT_BASE_STATS, HOLOBOT_NAMES } from "@/lib/progression";
import { calculateSyncBattleModifiers } from "@/lib/syncProgression";
import type { UserHolobot } from "@/types/profile";

import * as serverProgression from "../../../../functions/src/lib/progression";
import * as serverEconomy from "../../../../functions/src/lib/progressionEconomy";

/**
 * DECISIONS #53-2/3: the rival host builds the player's combatants from the
 * real stats. The server functions must equal the client's
 * getHolobotBattleStats and the stat lines of arenaConfig.buildPlayerFighter
 * (sync modifiers applied; equipped parts excluded = EMPTY_PART_BOOSTS).
 */

const LEVELS = [1, 2, 5, 10, 11, 20, 21, 31, 41, 50, 60, 0, -3];
const BOOSTS: Array<UserHolobot["boostedAttributes"]> = [
  undefined,
  {},
  { attack: 3, defense: 2, health: 40, special: 5, speed: 1 },
  { speed: 12 },
];
const SYNC_STATS = [
  undefined,
  { bond: 0, focus: 0, guard: 0, power: 0, tempo: 0 },
  { bond: 5, focus: 9, guard: 25, power: 12, tempo: 3 },
  { bond: 50, focus: 50, guard: 50, power: 50, tempo: 50 },
  { bond: 99, focus: 70, guard: -4, power: 51, tempo: 7.9 },
];

describe("battle stat parity", () => {
  it("base tables match", () => {
    expect(serverProgression.HOLOBOT_BASE_STATS).toEqual(HOLOBOT_BASE_STATS);
    expect(Object.keys(serverProgression.HOLOBOT_BASE_STATS)).toEqual([...HOLOBOT_NAMES]);
  });

  it("getHolobotBattleStats matches for every bot, level and boost set", () => {
    for (const name of [...HOLOBOT_NAMES, "ace", " Kuma ", "UNKNOWN"]) {
      for (const level of LEVELS) {
        for (const boosts of BOOSTS) {
          expect(serverProgression.getHolobotBattleStats(name, level, boosts)).toEqual(
            getHolobotBattleStats(name, level, boosts),
          );
        }
      }
    }
  });

  it("calculateSyncBattleModifiers matches (incl. clamps)", () => {
    for (const syncStats of SYNC_STATS) {
      expect(serverEconomy.calculateSyncBattleModifiers(syncStats)).toEqual(
        calculateSyncBattleModifiers({ syncStats } as Pick<UserHolobot, "syncStats">),
      );
    }
  });
});

describe("player combatant stats = arenaConfig.buildPlayerFighter (no parts)", () => {
  it("maxHealth / attack / defense / speed / intelligence match for every bot, level, boost and sync set", () => {
    let cases = 0;
    for (const name of HOLOBOT_NAMES) {
      for (const level of LEVELS) {
        for (const boostedAttributes of BOOSTS) {
          for (const syncStats of SYNC_STATS) {
            const holobot: UserHolobot = {
              boostedAttributes,
              experience: 0,
              level,
              name,
              nextLevelExp: calculateExperience(Math.max(1, level) + 1),
              syncStats: syncStats as UserHolobot["syncStats"],
            };
            const fighter = buildPlayerFighter("uid-1", holobot, EMPTY_PART_BOOSTS);
            const serverStats = serverEconomy.getPlayerBattleStats(structuredClone(holobot));
            expect(serverStats).toEqual({
              attack: fighter.attack,
              defense: fighter.defense,
              intelligence: fighter.intelligence,
              maxHP: fighter.maxHP,
              speed: fighter.speed,
            });
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(HOLOBOT_NAMES.length * LEVELS.length * BOOSTS.length * SYNC_STATS.length);
  });

  it("SPECIAL rides on focus (SYNC), not on points: focus raises intelligence, a special boost is only the stored flat value", () => {
    const base = { experience: 0, level: 10, name: "ACE", nextLevelExp: calculateExperience(11) };
    const noFocus = serverEconomy.getPlayerBattleStats({ ...base, syncStats: { focus: 0 } });
    const maxFocus = serverEconomy.getPlayerBattleStats({ ...base, syncStats: { focus: 50 } });
    expect(maxFocus.intelligence).toBe(Math.floor(noFocus.intelligence * 1.1));
    expect(maxFocus.attack).toBe(noFocus.attack);
  });
});
