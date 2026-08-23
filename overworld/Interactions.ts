import type { BuildingEventId, TileEvent } from "./TileTypes";

export interface BuildingCallbacks {
  enterArena: () => void;
  enterH3Core: () => void;
  openGacha: () => void;
  openPvPTerminal: () => void;
  openTraining: () => void;
}

export const createDefaultBuildingCallbacks = (): BuildingCallbacks => ({
  enterArena: () => {
    console.info("[Overworld] enterArena()");
  },
  enterH3Core: () => {
    console.info("[Overworld] enterH3Core()");
  },
  openGacha: () => {
    console.info("[Overworld] openGacha()");
  },
  openPvPTerminal: () => {
    console.info("[Overworld] openPvPTerminal()");
  },
  openTraining: () => {
    console.info("[Overworld] openTraining()");
  },
});

const EVENT_TO_CALLBACK: Record<BuildingEventId, keyof BuildingCallbacks> = {
  arena: "enterArena",
  h3Core: "enterH3Core",
  gacha: "openGacha",
  pvpTerminal: "openPvPTerminal",
  trainingLab: "openTraining",
};

export const triggerBuildingEvent = (
  event: TileEvent,
  callbacks: BuildingCallbacks,
): void => {
  callbacks[EVENT_TO_CALLBACK[event.id]]();
};
