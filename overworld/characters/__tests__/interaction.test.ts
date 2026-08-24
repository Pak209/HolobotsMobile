import { describe, expect, it } from "vitest";

import { adjacentInteractDirection, canInteractWithNpc } from "../interaction";

describe("canInteractWithNpc", () => {
  it("tracks the interactive NPC's current tile across wander steps", () => {
    const npc = { gridX: 29, gridY: 19, prevGridX: 29, prevGridY: 19, isMoving: false, interactive: true };
    expect(canInteractWithNpc(npc, { x: 29, y: 19 }, false)).toBe(true);

    npc.prevGridX = npc.gridX; npc.prevGridY = npc.gridY;
    npc.gridX = 30; npc.isMoving = true;
    expect(canInteractWithNpc(npc, { x: 29, y: 19 }, false)).toBe(true);
    expect(canInteractWithNpc(npc, { x: 30, y: 19 }, false)).toBe(true);

    npc.isMoving = false;
    expect(canInteractWithNpc(npc, { x: 29, y: 19 }, false)).toBe(false);
    expect(canInteractWithNpc(npc, { x: 30, y: 19 }, false)).toBe(true);

    npc.prevGridX = npc.gridX; npc.gridX = 30; npc.gridY = 20; npc.isMoving = true;
    expect(canInteractWithNpc(npc, { x: 30, y: 19 }, false)).toBe(true);
  });

  it("excludes ambient NPCs and all NPCs while dialogue is open", () => {
    const npc = { gridX: 25, gridY: 23, isMoving: false, interactive: false };
    expect(canInteractWithNpc(npc, { x: 25, y: 23 }, false)).toBe(false);
    expect(canInteractWithNpc({ ...npc, interactive: true }, { x: 25, y: 23 }, true)).toBe(false);
  });
});

describe("adjacentInteractDirection", () => {
  const player = { gridX: 10, gridY: 10 };
  const npc = { gridX: 10, gridY: 10, isMoving: false, interactive: true };

  it.each([
    [{ gridX: 9, gridY: 10 }, "left"],
    [{ gridX: 11, gridY: 10 }, "right"],
    [{ gridX: 10, gridY: 9 }, "up"],
    [{ gridX: 10, gridY: 11 }, "down"],
  ] as const)("faces toward $gridX,$gridY", (position, direction) => {
    expect(adjacentInteractDirection({ ...npc, ...position }, player, false)).toBe(direction);
  });

  it("rejects diagonals, distance two, ambient NPCs, and open dialogue", () => {
    expect(adjacentInteractDirection({ ...npc, gridX: 11, gridY: 11 }, player, false)).toBeNull();
    expect(adjacentInteractDirection({ ...npc, gridX: 12 }, player, false)).toBeNull();
    expect(adjacentInteractDirection({ ...npc, gridX: 11, interactive: false }, player, false)).toBeNull();
    expect(adjacentInteractDirection({ ...npc, gridX: 11 }, player, true)).toBeNull();
  });

  it("accepts the previous visible tile during a wander step", () => {
    expect(adjacentInteractDirection({
      ...npc, gridX: 12, prevGridX: 11, prevGridY: 10, isMoving: true,
    }, player, false)).toBe("right");
  });
});
