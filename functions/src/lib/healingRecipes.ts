/** DECISIONS #57 producer defaults; quantities are host-owned. */
export const HEALING_RECIPES = {
 'item.repair_kit':{lower:'item.emergency_patch',fragments:3},
 'item.full_restore':{lower:'item.repair_kit',fragments:5},
} as const;
