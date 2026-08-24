export type InteractableNpc = {
  gridX: number;
  gridY: number;
  prevGridX?: number;
  prevGridY?: number;
  isMoving: boolean;
  interactive: boolean;
};

type GridPoint = { gridX: number; gridY: number };
type Direction = "up" | "down" | "left" | "right";

export const isWithinRadius = (a: GridPoint, b: GridPoint, radius: number): boolean =>
  Math.max(Math.abs(a.gridX - b.gridX), Math.abs(a.gridY - b.gridY)) <= radius;

export const nextPauseState = (
  paused: boolean,
  npc: GridPoint,
  player: GridPoint,
  radius = 2,
): boolean => isWithinRadius(npc, player, paused ? radius + 1 : radius);

export const shouldWander = (input: {
  playerNear: boolean;
  dialogueOpen: boolean;
  isMoving: boolean;
  elapsed: number;
  nextWanderAt: number;
  resumeAt: number;
}): boolean => !input.playerNear && !input.dialogueOpen && !input.isMoving
  && input.elapsed >= Math.max(input.nextWanderAt, input.resumeAt);

const directionTo = (player: GridPoint, targetX: number, targetY: number): Direction | null => {
  const dx = targetX - player.gridX; const dy = targetY - player.gridY;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  if (dx < 0) return "left";
  if (dx > 0) return "right";
  return dy < 0 ? "up" : "down";
};

export const adjacentInteractDirection = (
  npc: InteractableNpc,
  player: GridPoint,
  dialogueOpen: boolean,
): Direction | null => {
  if (!npc.interactive || dialogueOpen) return null;
  const current = directionTo(player, npc.gridX, npc.gridY);
  if (current) return current;
  return npc.isMoving && npc.prevGridX !== undefined && npc.prevGridY !== undefined
    ? directionTo(player, npc.prevGridX, npc.prevGridY)
    : null;
};

export const canInteractWithNpc = (
  npc: InteractableNpc,
  facing: { x: number; y: number },
  dialogueOpen: boolean,
): boolean => {
  if (!npc.interactive || dialogueOpen) return false;
  if (facing.x === npc.gridX && facing.y === npc.gridY) return true;
  return npc.isMoving && facing.x === npc.prevGridX && facing.y === npc.prevGridY;
};
