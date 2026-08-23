import { PLAZA_OFFSET } from "./h3Plaza";

export const GUIDE = { x: 11 + PLAZA_OFFSET.x, y: 9 + PLAZA_OFFSET.y, npcId: "guide" } as const;
export const AMBIENT_NPCS = [
  { id: "ambient-1", home: { x: 7 + PLAZA_OFFSET.x, y: 13 + PLAZA_OFFSET.y }, palette: "teal" },
  { id: "ambient-2", home: { x: 12 + PLAZA_OFFSET.x, y: 8 + PLAZA_OFFSET.y }, palette: "rust" },
] as const;
