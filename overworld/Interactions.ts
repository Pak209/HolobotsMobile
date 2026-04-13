import type { BuildingEventId, TileEvent } from "./TileTypes";

export interface BuildingCallbacks {
  enterArena: () => void;
  openDeckBuilder: () => void;
  openPvPTerminal: () => void;
  openTraining: () => void;
}

export const createDefaultBuildingCallbacks = (): BuildingCallbacks => ({
  enterArena: () => {
    console.info("[Overworld] enterArena()");
  },
  openDeckBuilder: () => {
    console.info("[Overworld] openDeckBuilder()");
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
  deckBuilder: "openDeckBuilder",
  pvpTerminal: "openPvPTerminal",
  trainingLab: "openTraining",
};

export const triggerBuildingEvent = (
  event: TileEvent,
  callbacks: BuildingCallbacks,
): void => {
  callbacks[EVENT_TO_CALLBACK[event.id]]();
};
