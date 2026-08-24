import { describe, expect, it } from "vitest";

import { canInteractWithNpc } from "../interaction";

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
