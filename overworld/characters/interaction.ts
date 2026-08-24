export type InteractableNpc = {
  gridX: number;
  gridY: number;
  prevGridX?: number;
  prevGridY?: number;
  isMoving: boolean;
  interactive: boolean;
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
