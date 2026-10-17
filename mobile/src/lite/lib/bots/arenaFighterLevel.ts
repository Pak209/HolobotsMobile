import { levelBadge } from './hostFighterLevel';
const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
/** Read a #118 Arena reply only for the exact host match and displayed identity.
 * Callers must supply the already-admitted match; never issue/charge merely to obtain a badge.
 * Legacy Arena/PvP local state is deliberately not a supported source.
 */
export function arenaFighterLevel(reply: unknown, matchId: string | undefined, side: 'entrant' | 'opponent', holobotId: string): number | undefined {
  if (!matchId || !/^am_[a-f0-9]{32}$/.test(matchId)) return undefined;
  const r = record(reply), match = record(r.match), fighter = record(match[side]);
  if (r.schemaVersion !== 'arena-match-1' || r.matchId !== matchId || match.schemaVersion !== 'arena-match-1'
    || match.matchId !== matchId || typeof r.alreadyProcessed !== 'boolean'
    || !['issued', 'active', 'settled', 'cancelled', 'expired'].includes(String(match.state))
    || fighter.holobotId !== holobotId.toLowerCase() || fighter.displayName !== holobotId.toUpperCase()
    || typeof fighter.tier !== 'number' || !Number.isSafeInteger(fighter.tier) || fighter.tier < 0 || fighter.tier > 1000000
    || levelBadge(fighter.level) === null) return undefined;
  return fighter.level as number;
}
