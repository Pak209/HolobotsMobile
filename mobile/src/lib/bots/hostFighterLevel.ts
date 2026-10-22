/** Presentation-only badge. Never derives level from XP, rank, stats or a fallback. */
export function levelBadge(value: unknown): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 99 ? `LV ${value}` : null;
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Resolve the currently displayed fighter by id in the issued host squad, including switched bench fighters. */
export function hostFighterLevel(rawIssue: unknown, side: 'player' | 'rival', holobotId: string | null, accountSnapshot?: unknown): number | undefined {
  if (!holobotId) return undefined;
  const issue = object(rawIssue), duel = object(issue.duel);
  if (duel.mode === 'resolver') return uniqueLevel(duel[side === 'player' ? 'player' : 'opponent'], 'holobotId', holobotId);
  if (side === 'rival') return uniqueLevel(object(issue.encounter).opponentSquad, 'holobotId', holobotId);
  // Legacy player card: the verified account snapshot first; lite-2305-1 (DECISIONS #72.63): else the issue's own
  // rival-battle-3 `playerCombatants[]` (the same issue the opponent card reads; the host omits it on citizen issues).
  return uniqueLevel(object(accountSnapshot).holobots, 'name', holobotId) ?? uniqueLevel(issue.playerCombatants, 'holobotId', holobotId);
}
function uniqueLevel(team: unknown, key: 'holobotId' | 'name', holobotId: string): number | undefined {
  if (!Array.isArray(team)) return undefined;
  const matches = team.map(object).filter(bot => typeof bot[key] === 'string' && (bot[key] as string).toLowerCase() === holobotId.toLowerCase());
  return matches.length === 1 && levelBadge(matches[0].level) !== null ? matches[0].level as number : undefined;
}
/** Offline receipt envelope and live issue use the same read-only lookup; receipt final stats never supply levels. */
export function receiptIssue(receipt: unknown): unknown { return object(receipt).issue; }
