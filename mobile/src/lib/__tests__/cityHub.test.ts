import { describe, expect, it } from "vitest";
import { CITY_DISTRICTS, CITY_RING_COLORS, EMPTY_CITY_FLAGS, cityDistrictAccess, cityMapPoint, cityTimeOfDay, readArenaGathering, readCityStoryFlags } from "../cityHub";
import { CITY_GATHERING_FIXTURE } from "../cityHubFixtures";
import { theme } from "../../theme";

describe("HoloCity #80 gathering", () => {
  it("reads the published emulator roster with exact pilot ring identity", () => {
    const reply = readArenaGathering(CITY_GATHERING_FIXTURE);
    expect(reply.roster).toHaveLength(8);
    expect(reply.roster.filter((rival) => rival.holobotId === "shadow").map((rival) => rival.ringColor)).toEqual(["#7CFF4F", "#FF7A1A"]);
    expect(CITY_RING_COLORS).toEqual([...theme.rings.player, ...theme.rings.rival]);
  });
  it("rejects missing, ambiguous, unknown-bot and malformed roster replies", () => {
    for (const patch of [{ roster: [] }, { schemaVersion: "arena-gathering-2" }, { storyFlags: {} }]) expect(() => readArenaGathering({ ...CITY_GATHERING_FIXTURE, ...patch })).toThrow();
    for (const patch of [{ citizenId: CITY_GATHERING_FIXTURE.roster[0].citizenId }, { holobotId: "invented" }, { ringColor: "red" }]) {
      const roster = CITY_GATHERING_FIXTURE.roster.map((row, i) => i === 1 ? { ...row, ...patch } : row);
      expect(() => readArenaGathering({ ...CITY_GATHERING_FIXTURE, roster })).toThrow();
    }
    const roster = CITY_GATHERING_FIXTURE.roster.map((row, i) => i === 3 ? { ...row, ringColor: "#7CFF4F" } : row);
    expect(() => readArenaGathering({ ...CITY_GATHERING_FIXTURE, roster })).toThrow();
  });
});

describe("city story gates and geography", () => {
  it("keeps old, corrupt and string-boolean flags locked", () => {
    for (const value of [undefined, {}, [], { ...EMPTY_CITY_FLAGS, arenaGatheringSeen: "true" }, { ...EMPTY_CITY_FLAGS, arenaGatheringSeen: true, tournamentsWon: 3 }]) expect(readCityStoryFlags(value)).toEqual(EMPTY_CITY_FLAGS);
    expect(cityDistrictAccess("arena", EMPTY_CITY_FLAGS)).toBe("locked");
    expect(cityDistrictAccess("zone", EMPTY_CITY_FLAGS)).toBe("hidden");
    expect(cityDistrictAccess("arena", CITY_GATHERING_FIXTURE.storyFlags)).toBe("open");
    expect(cityDistrictAccess("zone", { ...CITY_GATHERING_FIXTURE.storyFlags, holoZonesArcBuilt: true })).toBe("open");
    expect(cityDistrictAccess("workshop", EMPTY_CITY_FLAGS)).toBe("open");
  });
  it("uses exported X/Z anchors and puts north above the plaza", () => {
    const byId = Object.fromEntries(CITY_DISTRICTS.map((district) => [district.id, district]));
    expect(byId.workshop.world).toEqual([-135, 0]);
    expect(byId.vendor.world).toEqual([100, -55]);
    expect(byId.harbor.world).toEqual([-48, -164.4]);
    expect(cityMapPoint(byId.port.world).y).toBeLessThan(cityMapPoint(byId.plaza.world).y);
    expect(cityMapPoint(byId.harbor.world).y).toBeGreaterThan(cityMapPoint(byId.arena.world).y);
    expect(CITY_DISTRICTS.filter((district) => cityDistrictAccess(district.id, EMPTY_CITY_FLAGS) !== "hidden")).toHaveLength(6);
  });
  it("switches tint at device-local 06:00 and 19:00", () => {
    expect([0, 5, 19, 23].map(cityTimeOfDay)).toEqual(["night", "night", "night", "night"]);
    expect([6, 12, 18].map(cityTimeOfDay)).toEqual(["day", "day", "day"]);
  });
});
