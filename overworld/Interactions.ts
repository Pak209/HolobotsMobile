import type { BuildingEventId, TileEvent } from "./TileTypes";

export interface BuildingCallbacks {
  enterArena: () => void;
  openGacha: () => void;
  openPvPTerminal: () => void;
  openTraining: () => void;
}

export const createDefaultBuildingCallbacks = (): BuildingCallbacks => ({
  enterArena: () => {
    console.info("[Overworld] enterArena()");
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
