/** Additive presentation projection of frozen host combatants; never persisted into receipts. */
export type ArenaFighterSnapshot = { holobotId: string; level: number; displayName: string; tier: number };
export function arenaFighterSnapshot(combatant: { holobotId: string; level: number }, tier: number): ArenaFighterSnapshot {
  if (typeof combatant.holobotId !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(combatant.holobotId) || !Number.isSafeInteger(combatant.level)
    || combatant.level < 1 || combatant.level > 99 || !Number.isSafeInteger(tier) || tier < 0 || tier > 1000000) {
    throw new RangeError('Invalid frozen Arena fighter snapshot');
  }
  // Bot catalog name, not a pilot/account nickname. Preserve the same level/tier as combat.
  return { holobotId: combatant.holobotId, level: combatant.level, displayName: combatant.holobotId.toUpperCase(), tier };
}
