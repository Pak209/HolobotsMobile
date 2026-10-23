import {
  FIGHT_INPUTS_SCHEMA, FIGHT_RECEIPT_SCHEMA, FIGHT_REPLAY_MODE, FIGHT_SIM_VERSION, FightReplayIssueWire,
} from '../shared/fightReplayContract';
import { duelFighterFromCombatant } from '../lib/duelResolver';
import { defaultChaseRules, defaultRulesValues, FightFighterDef, FightRules, KIT_IDS, kitFighter, RULES_SCHEMA, RULES_SCHEMA_4, rulesDocToJson, rulesHash, validateRules } from '../sim/fight/rules';
import { brainProfile, issuedProfile, issuedSkill, PROFILE_ROSTER_IDS, PROFILES_VERSION, RANKS } from '../sim/fight/profiles';

/**
 * fight-host-1 issue side of rival-battle mode `input-log` (fight-flow brief C0, lane H1): turn the battle the ladder just
 * issued (the pinned player squad with issue-time HP, the opponent squad) into an immutable duel-rules-3 snapshot + seed +
 * CPU profile/rank. Stats are the same host numbers the resolver pins (duelFighterFromCombatant: rounded attack/defense/
 * max HP, floored current HP); the kit/movement rows are FightKitDefaults; every other number is the duel-rules-3 default.
 * Returns null when the lineup cannot be expressed (a bot with no kit/profile row): the caller keeps the existing mode.
 * duel-rules-4-1: `chase` true (host flag HOLOCITY_FIGHT_CHASE, default off) issues duel-rules-4 = the same snapshot + the
 * fight-chase-1 chase block at its defaults (#72.65); false/absent issues today's duel-rules-3, byte for byte.
 */
export const FIGHT_START_GAP_MM = 7000;
export const FIGHT_HASH_EVERY = 30;

/** Rival tier -> CPU rank skill row (producer pick: tiers 0-1 rookie ... 9+ legendary; Pak tunes). */
export function fightRankForTier(tier: number): string {
  const t = Number.isSafeInteger(tier) && tier > 0 ? tier : 0;
  const idx = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5][Math.min(t, 9)];
  return RANKS[idx];
}

type Combatant = Parameters<typeof duelFighterFromCombatant>[0];

export function buildFightReplayIssue(input: {
  battleId: string; seed: string; tier: number; mentor: boolean;
  player: readonly Combatant[]; opponent: readonly Combatant[]; chase?: boolean;
}): FightReplayIssueWire | null {
  const { player, opponent } = input;
  if (player.length < 1 || player.length > 3 || opponent.length < 1 || opponent.length > 3) return null;
  const ids = [...player, ...opponent].map(c => c.holobotId);
  if (ids.some(id => !KIT_IDS.includes(id))) return null;
  if (opponent.some(c => !(PROFILE_ROSTER_IDS as readonly string[]).includes(c.holobotId))) return null;
  if (new Set(player.map(c => c.holobotId)).size !== player.length || new Set(opponent.map(c => c.holobotId)).size !== opponent.length) return null;
  const half = Math.trunc(FIGHT_START_GAP_MM / 2);
  const fighter = (c: Combatant, side: number, fighterId: string): FightFighterDef => {
    const s = duelFighterFromCombatant({ ...c, tier: input.mentor ? 0 : input.tier });
    const f = kitFighter(c.holobotId);
    f.id = fighterId; f.side = side;
    f.maxHp = s.maxHealth; f.hp = Math.min(s.maxHealth, Math.max(0, s.currentHealth ?? s.maxHealth));
    f.attack = s.attack; f.defense = s.defense;
    f.startXMm = side === 0 ? -half : FIGHT_START_GAP_MM - half;
    return f;
  };
  const rules: FightRules = {
    ...defaultRulesValues(),
    fighters: [...player.map(c => fighter(c, 0, c.holobotId)), ...opponent.map(c => fighter(c, 1, 'cpu-' + c.holobotId))],
  };
  try { validateRules(rules); } catch { return null; }
  if (!rules.fighters.some(f => f.side === 0 && f.hp > 0)) return null;
  const chase = input.chase ? defaultChaseRules() : null;
  const hash = rulesHash(rules, chase);
  const lead = opponent[0].holobotId;
  return {
    mode: FIGHT_REPLAY_MODE, schemaVersion: FIGHT_RECEIPT_SCHEMA, inputsSchema: FIGHT_INPUTS_SCHEMA, simVersion: FIGHT_SIM_VERSION,
    rulesId: `${chase ? RULES_SCHEMA_4 : RULES_SCHEMA}:${input.battleId}`, rulesHash: hash, rules: rulesDocToJson(rules, chase) as unknown as FightReplayIssueWire['rules'],
    seed: input.seed, playerSide: 0,
    player: { roster: player.map(c => ({ fighterId: c.holobotId, holobotId: c.holobotId })) },
    cpu: {
      side: 1, rank: issuedSkill(input.mentor ? 'Rookie' : fightRankForTier(input.tier)), profile: issuedProfile(brainProfile(lead)),
      roster: opponent.map(c => ({ fighterId: 'cpu-' + c.holobotId, holobotId: c.holobotId, profile: c.holobotId })),
    },
    profilesVersion: PROFILES_VERSION,
  };
}
