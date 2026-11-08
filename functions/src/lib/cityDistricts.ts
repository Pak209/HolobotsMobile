/**
 * The shared HoloCity plan's districts (Lite and Unity are one place, one plan): ids, centres and zone polygons in
 * Unity metres (x east, z north), copied from the Lite field's cityPlan.generated.json (CITY_PLAN_v1.3 + Lite
 * overrides; HolobotsLiteMerge candidate 97637db, file md5 8fee83e1ea678fcf64d926eb63153fd4). `cityDistrictAt` is
 * the Lite field's rule (mobile/src/lite/field/fieldCityLayout.ts): the first zone polygon that contains the point,
 * else the nearest district centre. Polygon membership is the same in Unity and Lite space (the Lite transform is a
 * uniform scale plus a z flip), so this works on Unity coordinates directly.
 *
 * Pure module: no firebase imports.
 */
export type CityDistrictId = "D01" | "D02" | "D03" | "D04" | "D05" | "D06" | "D07" | "D08" | "D09" | "D10";
export type CityDistrict = { id: CityDistrictId; name: string; x: number; z: number };

export const CITY_DISTRICTS: readonly CityDistrict[] = [
  { id: "D01", name: "Tower Plaza", x: 0, z: -14 },
  { id: "D02", name: "Harbor", x: -8, z: -138 },
  { id: "D03", name: "Court + Promenade", x: -90, z: -118 },
  { id: "D04", name: "Guild + Dome", x: -60, z: -74 },
  { id: "D05", name: "Market Row", x: 92, z: -62 },
  { id: "D06", name: "Research Garden", x: 128, z: 58 },
  { id: "D07", name: "Portal Terminal", x: -8, z: 88 },
  { id: "D08", name: "Workshop", x: -110, z: 8 },
  { id: "D09", name: "Arena Gate", x: -110, z: 66 },
  { id: "D10", name: "Residential Skyline", x: -78, z: 118 },
];

/** Zone polygons in plan order (D10 has two parts). */
export const CITY_DISTRICT_ZONES: readonly { id: CityDistrictId; zone: readonly (readonly [number, number])[] }[] = [
  { id: "D01", zone: [[-42, -26], [56, -26], [56, 3], [100, 3], [100, 40], [66, 54], [34, 60], [-40, 62]] },
  { id: "D02", zone: [[-48, -114], [58, -124], [62, -165], [14, -196], [-14, -196], [-48, -165]] },
  { id: "D03", zone: [[-112, -104], [-58, -112], [-56, -146], [-112, -146]] },
  { id: "D04", zone: [[-168, -40], [-50, -37], [-2, -28], [46, -28], [46, -108], [10, -112], [-50, -108], [-108, -94], [-130, -106], [-168, -80]] },
  { id: "D05", zone: [[58, 3], [166, 3], [158, -48], [118, -104], [70, -120], [46, -112], [46, -60], [56, -60]] },
  { id: "D06", zone: [[76, 44], [100, 42], [106, 13], [168, 13], [168, 62], [142, 102], [110, 126], [90, 96], [76, 88]] },
  { id: "D07", zone: [[-42, 64], [34, 62], [62, 86], [52, 130], [40, 164], [-14, 168], [-30, 130], [-40, 100]] },
  { id: "D08", zone: [[-170, -28], [-52, -28], [-56, 22], [-62, 38], [-112, 58], [-163, 44]] },
  { id: "D09", zone: [[-163, 44], [-112, 58], [-68, 44], [-84, 78], [-125, 106], [-148, 86]] },
  { id: "D10", zone: [[-122, 112], [-92, 92], [-42, 70], [-36, 100], [-30, 130], [-20, 168], [-70, 156], [-100, 135]] },
  { id: "D10", zone: [[52, 96], [106, 96], [108, 132], [60, 160], [44, 164], [52, 130]] },
];

function inPolygon(x: number, z: number, polygon: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[i], [bx, bz] = polygon[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

/** The district at Unity (x, z): plan zones first; ground between zones takes the nearest district centre. */
export function cityDistrictAt(x: number, z: number): CityDistrictId {
  const zone = CITY_DISTRICT_ZONES.find((row) => inPolygon(x, z, row.zone));
  if (zone) return zone.id;
  return CITY_DISTRICTS.reduce((best, d) => (Math.hypot(x - d.x, z - d.z) < Math.hypot(x - best.x, z - best.z) ? d : best), CITY_DISTRICTS[0]).id;
}

/** Plan sites the board names, Unity metres (cityPlan.generated.json `sites` / `buildings`). */
export const CITY_SITES = Object.freeze({
  /** sites.guildCourt: the Lite Guild Court challenge (holoZoneRuns zone guild_court). */
  guildCourt: { x: 22.5, z: -58.5 },
  /** buildings.Dome_Arena_exterior_: the Arena (town rival). */
  arenaDome: { x: -22, z: -52.8 },
  /** buildings.Arena_Gate_kiosk: where the Arena-gathering citizens duel. */
  arenaGate: { x: -120, z: 70 },
  /** sites.kuraiWild: the Research Garden KURAI (cityEncounterHost city_kurai_garden). */
  kuraiGarden: { x: 103, z: 66 },
  missionBoard: { x: -72, z: -88 },
  marketRow: { x: 112, z: -53 },
  workshopHall: { x: -132, z: -1 },
  ferryTerminal: { x: 2, z: -153 },
  portalTerminal: { x: 1, z: 118 },
});
