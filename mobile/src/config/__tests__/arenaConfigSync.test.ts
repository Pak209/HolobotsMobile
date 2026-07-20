import { describe, expect, it, vi } from "vitest";

import { buildPlayerFighter } from "@/config/arenaConfig";
import type { UserHolobot } from "@/types/profile";

vi.mock("@/config/holobots", () => ({
  getHolobotBattleStats: () => ({
    archetype: "balanced",
    attack: 50,
    defense: 50,
    intelligence: 50,
    maxHP: 150,
    speed: 50,
  }),
  getHolobotFullImageSource: () => "test://ace",
}));

function makeAce(overrides: Partial<UserHolobot> = {}): UserHolobot {
  return {
    name: "ACE",
    level: 2,
    experience: 0,
    nextLevelExp: 900,
    syncStats: { power: 0, guard: 0, tempo: 0, focus: 0, bond: 0 },
    ...overrides,
  };
}

describe("buildPlayerFighter Sync integration", () => {
  it("uses Sync Stats in battle attributes", () => {
    const base = buildPlayerFighter("pilot", makeAce());
    const synced = buildPlayerFighter(
      "pilot",
      makeAce({ syncStats: { power: 20, guard: 20, tempo: 20, focus: 20, bond: 0 } }),
    );

    expect(synced.attack).toBeGreaterThan(base.attack);
    expect(synced.defense).toBeGreaterThan(base.defense);
    expect(synced.speed).toBeGreaterThan(base.speed);
    expect(synced.intelligence).toBeGreaterThan(base.intelligence);
  });

  it("installs only the selected unlocked Sync Ability", () => {
    const fighter = buildPlayerFighter(
      "pilot",
      makeAce({
        equippedSyncAbilityId: "ace_combo_ignition",
        syncStats: { power: 10, guard: 0, tempo: 25, focus: 0, bond: 0 },
      }),
    );

    expect(fighter.syncAbilities).toEqual(["ace_combo_ignition"]);
  });
});
