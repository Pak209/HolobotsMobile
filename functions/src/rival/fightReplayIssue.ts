import {
  FIGHT_INPUTS_SCHEMA, FIGHT_RECEIPT_SCHEMA, FIGHT_REPLAY_MODE, FIGHT_SIM_VERSION, FightReplayIssueWire,
} from '../shared/fightReplayContract';
import { duelFighterFromCombatant } from '../lib/duelResolver';
import { getHolobotFightStatDelta } from '../lib/fightBalance';
import {
  defaultAttrRules, defaultChaseRules, defaultRulesValues, FightFighterDef, FightRules, KIT_IDS, kitFighter, RULES_SCHEMA, RULES_SCHEMA_4, RULES_SCHEMA_5, rulesDocToJson5,
  rulesHash, validateRules,
} from '../sim/fight/rules';
import { brainProfile, issuedProfile, issuedSkill, PROFILE_ROSTER_IDS, PROFILES_VERSION, RANKS } from '../sim/fight/profiles';

/**
 * fight-host-1 issue side of rival-battle mode `input-log` (fight-flow brief C0, lane H1): turn the battle the ladder just
 * issued (the pinned player squad with issue-time HP, the opponent squad) into an immutable duel-rules-3 snapshot + seed +
 * CPU profile/rank. Stats are the same host numbers the resolver pins (duelFighterFromCombatant: rounded attack/defense/
 * max HP, floored current HP); the kit/movement rows are FightKitDefaults; every other number is the duel-rules-3 default.
 * Returns null when the lineup cannot be expressed (a bot with no kit/profile row): the caller keeps the existing mode.
 * duel-rules-4-1: `chase` true (host flag HOLOCITY_FIGHT_CHASE, default off) issues duel-rules-4 = the same snapshot + the
 * fight-chase-1 chase block at its defaults (#72.65); false/absent issues today's duel-rules-3, byte for byte.
 * duel-rules-5 (speed-special-p2-1, #72.77/#72.78): `chase` AND `attrs` true (host flag HOLOCITY_FIGHT_ATTRS, default off) issues
 * duel-rules-5 = the duel-rules-4 snapshot + the attrs block at its defaults + each fighter's battle `speed` and `intelligence`
 * (as `special`) from the issued combatant (getHolobotBattleStats numbers); `attrs` without `chase` changes nothing.
 */
export const FIGHT_START_GAP_MM = 7000;
export const FIGHT_HASH_EVERY = 30;

/** Rival tier -> CPU rank skill row (producer pick: tiers 0-1 rookie ... 9+ legendary; Pak tunes). */
export function fightRankForTier(tier: number): string {
  const t = Number.isSafeInteger(tier) && tier > 0 ? tier : 0;
  const idx = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5][Math.min(t, 9)];
  return RANKS[idx];
}

/** statSource 'progression' = stats from getHolobotBattleStats rows (player bots, arena / PvP entrants): a duel-rules-5 issue
 * applies the #72.80 fight-row delta (lib/fightBalance). Rival tier-curve combatants (WOLF-shaped, rivalTierStats) carry none. */
type Combatant = Parameters<typeof duelFighterFromCombatant>[0] & { intelligence?: number; statSource?: 'progression' | 'tier' };

export function buildFightReplayIssue(input: {
  battleId: string; seed: string; tier: number; mentor: boolean;
  player: readonly Combatant[]; opponent: readonly Combatant[]; chase?: boolean; attrs?: boolean;
  playerStartSync?: Readonly<Record<string, number>>; cpuStartSync?: number;
  /** Expedition carry and sizing. Omitted for rival/Arena, retaining their issued bytes. */
  playerStartStaminaPm?: Readonly<Record<string, number>>; hpScaleLights?: number;
  encounter?: {kind:'expedition';runId:string;sectorId:string;ambush:'none'};
  readinessStart?: readonly {holobotId: string; readiness: number; cap: number; startSync: number}[];
}): FightReplayIssueWire | null {
  const { player, opponent } = input;
  if (player.length < 1 || player.length > 3 || opponent.length < 1 || opponent.length > 3) return null;
  const ids = [...player, ...opponent].map(c => c.holobotId);
  if (ids.some(id => !KIT_IDS.includes(id))) return null;
  if (opponent.some(c => !(PROFILE_ROSTER_IDS as readonly string[]).includes(c.holobotId))) return null;
  if (new Set(player.map(c => c.holobotId)).size !== player.length || new Set(opponent.map(c => c.holobotId)).size !== opponent.length) return null;
  const half = Math.trunc(FIGHT_START_GAP_MM / 2);
  const issueAttrs = input.chase === true && input.attrs === true;
  // #72.80: duel-rules-5 fights read the fight base rows (player side always; opponents only when progression-sourced)
  const balanced = (c: Combatant, side: number): Combatant => {
    if (!issueAttrs || !(side === 0 || c.statSource === 'progression')) return c;
    const dl = getHolobotFightStatDelta(c.holobotId, c.level ?? 1);
    const maxHealth = Math.max(1, c.maxHealth + dl.maxHP);
    const currentHealth = c.currentHealth === undefined ? undefined : Math.max(0, Math.min(maxHealth, Math.floor(c.currentHealth * maxHealth / Math.max(1, c.maxHealth))));
    return { ...c, attack: Math.max(0, c.attack + dl.attack), defense: Math.max(0, c.defense + dl.defense), maxHealth, currentHealth,
      speed: Math.max(0, (c.speed ?? 0) + dl.speed), intelligence: Math.max(0, (c.intelligence ?? 0) + dl.intelligence) };
  };
  const fighter = (raw: Combatant, side: number, fighterId: string): FightFighterDef => {
    const c = balanced(raw, side);
    const s = duelFighterFromCombatant({ ...c, tier: input.mentor ? 0 : input.tier });
    const f = kitFighter(c.holobotId);
    f.id = fighterId; f.side = side;
    f.maxHp = s.maxHealth; f.hp = Math.min(s.maxHealth, Math.max(0, s.currentHealth ?? s.maxHealth));
    f.attack = s.attack; f.defense = s.defense;
    f.startXMm = side === 0 ? -half : FIGHT_START_GAP_MM - half;
    if (side === 0 && input.playerStartSync) f.startSync = input.playerStartSync[c.holobotId] ?? 0;
    if (side === 0 && input.playerStartStaminaPm) f.startStaminaPm = input.playerStartStaminaPm[c.holobotId] ?? 1000;
    if (side === 1 && input.cpuStartSync !== undefined) f.startSync = input.cpuStartSync;
    // duel-rules-5: SPEED = the battle speed (duelFighterFromCombatant rounds it), SPECIAL = the battle intelligence, rounded
    if (issueAttrs) { f.speed = s.speed; f.special = Math.round(c.intelligence ?? 0); }
    return f;
  };
  const rules: FightRules = {
    ...defaultRulesValues(),
    fighters: [...player.map(c => fighter(c, 0, c.holobotId)), ...opponent.map(c => fighter(c, 1, 'cpu-' + c.holobotId))],
  };
  if (input.hpScaleLights !== undefined) rules.hpScaleLights = input.hpScaleLights;
  try { validateRules(rules); } catch { return null; }
  if (!rules.fighters.some(f => f.side === 0 && f.hp > 0)) return null;
  const chase = input.chase ? defaultChaseRules() : null;
  const attrs = issueAttrs ? defaultAttrRules() : null;
  const hash = rulesHash(rules, chase, attrs);
  const lead = opponent[0].holobotId;
  return {
    mode: FIGHT_REPLAY_MODE, schemaVersion: FIGHT_RECEIPT_SCHEMA, inputsSchema: FIGHT_INPUTS_SCHEMA, simVersion: FIGHT_SIM_VERSION,
    rulesId: `${attrs ? RULES_SCHEMA_5 : chase ? RULES_SCHEMA_4 : RULES_SCHEMA}:${input.battleId}`, rulesHash: hash,
    rules: rulesDocToJson5(rules, chase, attrs) as unknown as FightReplayIssueWire['rules'],
    seed: input.seed, playerSide: 0,
    player: { roster: player.map(c => ({ fighterId: c.holobotId, holobotId: c.holobotId })) },
    cpu: {
      side: 1, rank: issuedSkill(input.mentor ? 'Rookie' : fightRankForTier(input.tier)), profile: issuedProfile(brainProfile(lead)),
      roster: opponent.map(c => ({ fighterId: 'cpu-' + c.holobotId, holobotId: c.holobotId, profile: c.holobotId })),
    },
    profilesVersion: PROFILES_VERSION,
    ...(input.readinessStart ? { readinessStart: [...input.readinessStart] } : {}),
    ...(input.encounter ? { encounter: input.encounter } : {}),
  };
}
