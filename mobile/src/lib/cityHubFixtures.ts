import { ArenaGathering, ArenaCitizen, CityStoryFlags } from "./cityHub";

export type CityHubFixture = {
  roster: ArenaCitizen[];
  storyFlags: CityStoryFlags;
  hour?: number;
  initialPanel?: "rivals" | "workshop";
  onNavigate?: (destination: string) => void;
};
/** PR #80's demo-emulator fixture. Never used as a live fallback. */
export const CITY_GATHERING_FIXTURE: ArenaGathering = {
  schemaVersion: "arena-gathering-1",
  roster: [
    { citizenId: "CV1_HB_CITIZEN3_StallLinen_13", pilotName: "Stall Linen", holobotId: "tsuin", rank: "Rookie", ringColor: "#2FE6FF" },
    { citizenId: "CV1_HB_CITIZEN2_CampusMagenta_14", pilotName: "Campus Magenta", holobotId: "shadow", rank: "Rookie", ringColor: "#7CFF4F" },
    { citizenId: "CV1_HB_CITIZEN3_MarketMagenta_03", pilotName: "Market Magenta", holobotId: "wake", rank: "Rookie", ringColor: "#B07CFF" },
    { citizenId: "CV1_HB_CITIZEN1_HarbourSlate_11", pilotName: "Harbour Slate", holobotId: "shadow", rank: "Rookie", ringColor: "#FF7A1A" },
    { citizenId: "CV1_HB_CITIZEN4_HiVisAmber_12", pilotName: "Hi Vis Amber", holobotId: "gama", rank: "Rookie", ringColor: "#FF3D8B" },
    { citizenId: "CV1_HB_CITIZEN5_MarketAmber_05", pilotName: "Market Amber", holobotId: "kuma", rank: "Rookie", ringColor: "#FFD21A" },
    { citizenId: "CV1_HB_CITIZEN2_CampusAmber_04", pilotName: "Campus Amber", holobotId: "ken", rank: "Rookie", ringColor: "#2FE6FF" },
    { citizenId: "CV1_HB_CITIZEN1_LineCyan_06", pilotName: "Line Cyan", holobotId: "ace", rank: "Rookie", ringColor: "#7CFF4F" },
  ],
  storyFlags: { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false },
};
export const cityHubFixtures: Record<"day" | "night" | "locked" | "zones" | "rivals" | "workshop", CityHubFixture> = {
  day: { ...CITY_GATHERING_FIXTURE, hour: 12 },
  night: { ...CITY_GATHERING_FIXTURE, hour: 22 },
  locked: { roster: [], storyFlags: { arenaGatheringSeen: false, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false }, hour: 12 },
  zones: { ...CITY_GATHERING_FIXTURE, storyFlags: { arenaGatheringSeen: true, tournamentsWon: 3, arenaArcBuilt: true, holoZonesArcBuilt: true }, hour: 12 },
  rivals: { ...CITY_GATHERING_FIXTURE, hour: 22, initialPanel: "rivals" },
  workshop: { ...CITY_GATHERING_FIXTURE, hour: 22, initialPanel: "workshop" },
};
