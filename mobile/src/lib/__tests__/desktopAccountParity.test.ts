import { readFileSync } from "node:fs";
import path from "node:path";

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
import {
  calculateExperience,
  getHolobotDisplayStats,
  HOLOBOT_BASE_STATS,
  HOLOBOT_NAMES,
  normalizeUserHolobot,
} from "@/lib/progression";
import type { UserHolobot } from "@/types/profile";

import * as snapshot from "../../../../functions/src/desktop/desktopAccountReply";
import * as serverProgression from "../../../../functions/src/lib/progression";

/**
 * DECISIONS #53 amendment 1 + 2: desktop-account-3 holobots carry
 *   battleStats  = the combat scale (getPlayerBattleStats = arenaConfig.buildPlayerFighter minus parts),
 *   displayStats = the mobile display scale (getHolobotDisplayStats, moved into the progression lib pair),
 * and are normalised with the mobile defaults.
 */

/** Verbatim copy of the pre-move formula (mobile/src/config/holobots.ts, origin/main 490ba4b). */
function preMoveDisplayStats(name: string, level = 1, boostedAttributes?: UserHolobot["boostedAttributes"]) {
  const normalizedName = name.trim().toUpperCase() as keyof typeof HOLOBOT_BASE_STATS;
  const base = HOLOBOT_BASE_STATS[normalizedName] ?? HOLOBOT_BASE_STATS.ACE;
  const levelBonus = 1 + (Math.max(1, level) - 1) * 0.05;

  return {
    attack: Math.floor(base.attack * levelBonus) + (boostedAttributes?.attack || 0),
    defense: Math.floor(base.defense * levelBonus) + (boostedAttributes?.defense || 0),
    hp: Math.floor(base.hp * levelBonus) + (boostedAttributes?.health || 0),
    special: Math.floor(base.intelligence * levelBonus) + (boostedAttributes?.special || 0),
    speed: Math.floor(base.speed * levelBonus) + (boostedAttributes?.speed || 0),
  };
}

const LEVELS = [1, 2, 4, 5, 10, 11, 20, 21, 31, 37, 41, 50, 60, 99, 0, -3];
const BOOSTS: Array<UserHolobot["boostedAttributes"]> = [
  undefined,
  {},
  { attack: 3, defense: 2, health: 40, special: 5, speed: 1 },
  { speed: 12 },
  { health: 20, attack: 3 },
];
const SYNC_STATS = [
  undefined,
  { bond: 0, focus: 0, guard: 0, power: 0, tempo: 0 },
  { bond: 5, focus: 9, guard: 25, power: 12, tempo: 3 },
  { bond: 50, focus: 50, guard: 50, power: 50, tempo: 50 },
];

describe("getHolobotDisplayStats lives in the lib pair", () => {
  it("client lib = server lib = the pre-move formula for every bot, level and boost set", () => {
    let cases = 0;
    for (const name of [...HOLOBOT_NAMES, "ace", " Kuma ", "UNKNOWN"]) {
      for (const level of LEVELS) {
        for (const boosts of BOOSTS) {
          const expected = preMoveDisplayStats(name, level, boosts);
          expect(getHolobotDisplayStats(name, level, boosts)).toEqual(expected);
          expect(serverProgression.getHolobotDisplayStats(name, level, boosts)).toEqual(expected);
          cases += 1;
        }
      }
    }
    expect(cases).toBe((HOLOBOT_NAMES.length + 3) * LEVELS.length * BOOSTS.length);
  });

  it("config/holobots.ts re-exports the lib copy instead of defining its own", () => {
    const source = readFileSync(path.join(__dirname, "..", "..", "config", "holobots.ts"), "utf8");
    expect(source).not.toMatch(/function getHolobotDisplayStats/);
    expect(source).toMatch(/getHolobotDisplayStats,\n[\s\S]*?\} from "@\/lib\/progression";/);
  });
});

describe("desktop-account-3 holobots", () => {
  it("battleStats = arenaConfig.buildPlayerFighter (no parts); displayStats = getHolobotDisplayStats", () => {
    let cases = 0;
    for (const name of HOLOBOT_NAMES) {
      for (const level of LEVELS.filter((l) => l >= 1)) {
        for (const boostedAttributes of BOOSTS) {
          for (const syncStats of SYNC_STATS) {
            const holobot: UserHolobot = {
              boostedAttributes,
              experience: 0,
              level,
              name,
              nextLevelExp: calculateExperience(level + 1),
              syncStats: syncStats as UserHolobot["syncStats"],
            };
            const fighter = buildPlayerFighter("uid-1", holobot, EMPTY_PART_BOOSTS);
            const v3 = snapshot.desktopHolobotV3(structuredClone(holobot) as unknown as Record<string, unknown>);
            expect(v3.battleStats).toEqual({
              attack: fighter.attack,
              defense: fighter.defense,
              maxHP: fighter.maxHP,
              speed: fighter.speed,
              intelligence: fighter.intelligence,
            });
            expect(v3.displayStats).toEqual(getHolobotDisplayStats(name, level, boostedAttributes));
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(HOLOBOT_NAMES.length * 14 * BOOSTS.length * SYNC_STATS.length);
  });

  it("records with missing XP / points fields get the mobile normalizeUserHolobot defaults", () => {
    const FIELDS = ["attributePoints", "boostedAttributes", "experience", "level", "name", "nextLevelExp", "rank"] as const;
    const records: UserHolobot[] = [
      { name: "ACE", level: 4 } as UserHolobot,
      { name: "KUMA", level: 1, experience: 350 } as UserHolobot,
      { name: "WOLF", level: 12, experience: 16000, nextLevelExp: 16900, attributePoints: 4, rank: "Champion" } as UserHolobot,
      { name: "HARE", level: 7, attributePoints: 0, boostedAttributes: { attack: 2 } } as UserHolobot,
      { name: "TORA", level: 30, experience: 0, nextLevelExp: 0 } as UserHolobot,
    ];
    for (const record of records) {
      const mobile = normalizeUserHolobot(structuredClone(record));
      const v3 = snapshot.desktopHolobotV3(structuredClone(record) as unknown as Record<string, unknown>);
      for (const field of FIELDS) {
        expect(v3[field], `${record.name}.${field}`).toEqual((mobile as Record<string, unknown>)[field]);
      }
    }
  });

  it("the reply: v3 normalises + adds stats; v1 / v2 return the stored records untouched", () => {
    const profile = { holobots: [{ name: "ACE", level: 4, career: { workouts: 2 } }, null, { level: 3 }], blueprints: { ace: 2 } };
    const units = { light: 1, medium: 0, heavy: 2 };
    const v3 = snapshot.buildDesktopAccountReply(structuredClone(profile), "uid-1", "desktop-account-3", units);
    const holobots = v3.holobots as Array<Record<string, unknown>>;
    expect(holobots).toHaveLength(1);
    expect(holobots[0].career).toEqual({ workouts: 2 });
    expect(Object.keys(holobots[0]).slice(-2)).toEqual(["battleStats", "displayStats"]);
    expect(v3.buddyUnits).toEqual(units);
    for (const version of ["desktop-account-1", "desktop-account-2"] as const) {
      const reply = snapshot.buildDesktopAccountReply(structuredClone(profile), "uid-1", version, units);
      expect(reply.holobots).toEqual(profile.holobots);
    }
  });
});
