import {
  FIGHT_INPUTS_SCHEMA, FIGHT_RECEIPT_SCHEMA, FIGHT_REPLAY_MODE, FIGHT_SIM_VERSION, FightReplayIssueWire,
} from '../shared/fightReplayContract';
import { duelFighterFromCombatant } from '../lib/duelResolver';
import { getHolobotFightStatDelta } from '../lib/fightBalance';
import { applyPartBoosts, PartBoosts } from '../lib/partStats';
import { boostStat, isIdentityModifiers, LiveMoveMinGain, liveMoveMinGain, LiveMoveModifiers, LiveMoveRanks, liveMoveModifiers } from '../lib/liveMoveRanks';
import {
  beastArchetype, defaultAttrRules, defaultChaseRules, defaultRulesValues, defaultTempoRules, FIGHT_KIT_IDS, FightFighterDef, FightRules, FightRulesValues, isBeastId, KIT_IDS,
  kitFighter, RULES_SCHEMA, RULES_SCHEMA_4,
  RULES_SCHEMA_5, RULES_SCHEMA_6, RULES_SCHEMA_7, RULES_SCHEMA_8, defaultGuardRules, defaultStaminaRules, rulesDocToJson6, rulesHash, validateRules,
} from '../sim/fight/rules';
import { brainProfile, issuedProfile, issuedSkill, PROFILE_ROSTER_IDS, PROFILES_VERSION, RANKS } from '../sim/fight/profiles';
import type { FightProfile } from '../sim/fight/contracts';

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

/**
 * cpu-gama-engage-1 (2026-11-12): GAMA's table row backs off until its stamina is back to 650 and breaks off at 350, so in a live
 * duel it stands around. The ISSUED profile carries lower numbers (the table row, its C# parity and every other bot stay as they
 * are). breakAtStaminaPm 250 is below the brain's old profileIsValid floor (30000 bps), which phone builds before duel-rules-8
 * enforce, so the tuning is issued only to a client that asked duel-rules-8 (and so has the widened floor).
 */
export const CPU_ISSUE_PROFILE_TUNING: Readonly<Record<string, Partial<FightProfile>>> = Object.freeze({
  gama: Object.freeze({ engageMinStaminaPm: 450, breakAtStaminaPm: 250 }),
});
/** The issued CPU profile for a profile id: the table row, with CPU_ISSUE_PROFILE_TUNING applied. */
export function cpuIssueProfile(profileId: string): FightProfile {
  return { ...issuedProfile(brainProfile(profileId)), ...(CPU_ISSUE_PROFILE_TUNING[profileId] ?? {}) };
}
export const FIGHT_HASH_EVERY = 30;

/**
 * duel-rules-6 global numbers (server-rulings-1 ruling 2; data in the issued snapshot, so every client reads them from `rules`):
 * the values that differ from RULE_DEFAULTS on a duel-rules-6 issue; every other number stays the duel-rules-5 default.
 * hpScaleLights 19 -> 17 with the tempo block: CPU-vs-CPU 1v1 median 49 s -> 36 s, 3v3 timeouts 34 % -> ~1 %
 * (scripts/bench-fight-length.mjs; the table is in the server-rulings-1 README).
 */
export const TEMPO_RULE_OVERRIDES: Readonly<Partial<FightRulesValues>> = Object.freeze({ hpScaleLights: 17 });

/**
 * server-rulings-1 ruling 1 (+ Pak 2026-11-10 on SPECIAL): a player combatant with its equipped parts, for an input-log issue.
 * The four fight stats go through applyPartBoosts exactly as in the resolver. On a duel-rules-6 issue only (`tempo`), the parts'
 * SPECIAL is added to the combatant's intelligence, which the issue pins as the fighter's `special` (SYNC gain, special damage);
 * every other rules version leaves intelligence untouched, so its bytes are unchanged.
 */
export function inputLogCombatant<T extends Combatant>(c: T, b: PartBoosts, tempo: boolean, moves?: LiveMoveRanks): T {
  const out = applyPartBoosts(c, b);
  const withParts = tempo && b.special > 0 ? { ...out, intelligence: (c.intelligence ?? 0) + b.special } : out;
  // live-move-ranks-1: the Holobot's Move Lab live-move ranks (lib/liveMoveRanks), capped there; rank 0 everywhere attaches nothing,
  // so the issue is byte-identical. buildFightReplayIssue applies them to the PLAYER fighter's final pinned numbers.
  return withLiveMoveRanks(withParts, moves);
}

/**
 * live-move-ranks-1: attach a player combatant's live-move ranks (capped modifiers + the per-slot minimum gain) for
 * buildFightReplayIssue, which applies them to side 0 only. No ranks / all rank 0 returns the combatant unchanged (same issue bytes).
 * Used by inputLogCombatant (rival, Arena, Guild Court) and by the realtime HoloZone expedition engage.
 */
export function withLiveMoveRanks<T extends object>(c: T, moves?: LiveMoveRanks): T {
  const m = moves ? liveMoveModifiers(moves) : null;
  return m && !isIdentityModifiers(m) ? { ...c, liveMoveMods: m, liveMoveMinGain: liveMoveMinGain(moves) } : c;
}

/**
 * live-tuning-1 (Pak 2026-11-11, after the first live Arena fight ended in one HARE Special): the numbers every LIVE duel is issued
 * with (rival, Arena and Guild Court input-log issues pass `live: true`; expedition and every test fixture leave it off, so their
 * bytes are unchanged). Both are data in the issued, hashed snapshot, so a client replays them from `rules`, never from its own
 * defaults:
 * - the attrs block's specialOpenPm (an unguarded Special's multiplier) is 2000 instead of ATTR_DEFAULTS' 5000 (only when attrs is
 *   issued; ATTR_DEFAULTS stays the Unity-parity value).
 */
export const LIVE_SPECIAL_OPEN_PM = 2000;
/** Start SYNC is NOT live-tuned (Pak 2026-11-11: "Special should be built up from battle for both users and enemy"): every live
 * fighter starts at its kit 0, or at the readiness / CPU start SYNC exactly as before live-tuning-1. */

/** Rival tier -> CPU rank skill row (producer pick: tiers 0-1 rookie ... 9+ legendary; Pak tunes). */
export function fightRankForTier(tier: number): string {
  const t = Number.isSafeInteger(tier) && tier > 0 ? tier : 0;
  const idx = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5][Math.min(t, 9)];
  return RANKS[idx];
}

/** statSource 'progression' = stats from getHolobotBattleStats rows (player bots, arena / PvP entrants): a duel-rules-5 issue
 * applies the #72.80 fight-row delta (lib/fightBalance). Rival tier-curve combatants (WOLF-shaped, rivalTierStats) carry none. */
type Combatant = Parameters<typeof duelFighterFromCombatant>[0] & { intelligence?: number; statSource?: 'progression' | 'tier';
  /** live-move-ranks-1: set only by inputLogCombatant (non-zero ranks); read only for side 0 (the player). */
  liveMoveMods?: LiveMoveModifiers;
  /** live-move-ranks-1: each field's minimum gain (+1 per slot with any rank feeding it), set with liveMoveMods. */
  liveMoveMinGain?: LiveMoveMinGain };

export function buildFightReplayIssue(input: {
  battleId: string; seed: string; tier: number; mentor: boolean;
  player: readonly Combatant[]; opponent: readonly Combatant[]; chase?: boolean; attrs?: boolean; tempo?: boolean;
  playerStartSync?: Readonly<Record<string, number>>; cpuStartSync?: number;
  /** Expedition carry and sizing. Omitted for rival/Arena, retaining their issued bytes. */
  playerStartStaminaPm?: Readonly<Record<string, number>>; hpScaleLights?: number;
  /** live-tuning-1: a live duel (rival / Arena / Guild Court input-log issue): LIVE_SPECIAL_OPEN_PM (start SYNC is untouched). */
  live?: boolean;
  /** guard-hold-1: the client asked duel-rules-7 (`fightRules: 'duel-rules-7'`): a duel-rules-6 issue that is also `live` adds
   * the guard block (GUARD_HOLD_DRAIN_SPEC.md); anything else ignores it (the issue it would have made, byte for byte). */
  guardHold?: boolean;
  /** stamina-wind-1: the client asked duel-rules-8 (`fightRules: 'duel-rules-8'`; the host also passes guardHold): an issue that
   * carries the guard block adds the stamina block (STAMINA_DEFAULTS); anything else ignores it, byte for byte. The ask also opts
   * into the CPU issue tuning (cpuIssueProfile: GAMA engages sooner), which only a rules-8 phone's brain accepts. */
  staminaWind?: boolean;
  encounter?: {kind:'expedition';runId:string;sectorId:string;ambush:'none'};
  readinessStart?: readonly {holobotId: string; readiness: number; cap: number; startSync: number}[];
}): FightReplayIssueWire | null {
  const { player, opponent } = input;
  if (player.length < 1 || player.length > 3 || opponent.length < 1 || opponent.length > 3) return null;
  // beast-fighter-1: a beast (rules.BEAST_ARCHETYPES) may only be an opponent; its kit and CPU profile are its archetype's
  if (player.some(c => !KIT_IDS.includes(c.holobotId))) return null;
  if (opponent.some(c => !FIGHT_KIT_IDS.includes(c.holobotId))) return null;
  if (opponent.some(c => !(PROFILE_ROSTER_IDS as readonly string[]).includes(c.holobotId) && !isBeastId(c.holobotId))) return null;
  const profileOf = (id: string) => beastArchetype(id) ?? id;
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
    // live-move-ranks-1: the player's live-move ranks, on the final pinned numbers (after parts and the #72.80 delta), floored,
    // but never less than +1 per ranked slot feeding the field (lib/liveMoveRanks.boostStat: no dead slot at low stats).
    // Existing per-fighter fields only: the rules schema, hash layout and every global number are unchanged. The CPU side never
    // carries them in this slice.
    const m = side === 0 ? raw.liveMoveMods : undefined;
    if (m) {
      const g = raw.liveMoveMinGain ?? { attack: 0, defense: 0, special: 0, step: 0 };
      f.attack = boostStat(f.attack, m.attackPm, g.attack); f.defense = boostStat(f.defense, m.defensePm, g.defense);
      f.backstepMm = boostStat(f.backstepMm, m.stepPm, g.step); f.sidestepMm = boostStat(f.sidestepMm, m.stepPm, g.step);
      f.forwardJumpMm = boostStat(f.forwardJumpMm, m.stepPm, g.step);
      if (issueAttrs) f.special = boostStat(f.special ?? 0, m.specialPm, g.special);
    }
    return f;
  };
  const issueTempo = issueAttrs && input.tempo === true;
  const rules: FightRules = {
    ...defaultRulesValues(), ...(issueTempo ? TEMPO_RULE_OVERRIDES : {}),
    fighters: [...player.map(c => fighter(c, 0, c.holobotId)), ...opponent.map(c => fighter(c, 1, 'cpu-' + c.holobotId))],
  };
  if (input.hpScaleLights !== undefined) rules.hpScaleLights = input.hpScaleLights;
  try { validateRules(rules); } catch { return null; }
  if (!rules.fighters.some(f => f.side === 0 && f.hp > 0)) return null;
  const chase = input.chase ? defaultChaseRules() : null;
  const attrs = issueAttrs ? { ...defaultAttrRules(), ...(input.live === true ? { specialOpenPm: LIVE_SPECIAL_OPEN_PM } : {}) } : null;
  const issueGuard = issueTempo && input.live === true && input.guardHold === true;
  const issueStamina = issueGuard && input.staminaWind === true;
  const tempo = issueTempo ? { ...defaultTempoRules(), ...(issueGuard ? { guard: defaultGuardRules() } : {}), ...(issueStamina ? { stamina: defaultStaminaRules() } : {}) } : null;
  const hash = rulesHash(rules, chase, attrs, tempo);
  const lead = opponent[0].holobotId;
  return {
    mode: FIGHT_REPLAY_MODE, schemaVersion: FIGHT_RECEIPT_SCHEMA, inputsSchema: FIGHT_INPUTS_SCHEMA, simVersion: FIGHT_SIM_VERSION,
    rulesId: `${tempo?.stamina ? RULES_SCHEMA_8 : tempo?.guard ? RULES_SCHEMA_7 : tempo ? RULES_SCHEMA_6 : attrs ? RULES_SCHEMA_5 : chase ? RULES_SCHEMA_4 : RULES_SCHEMA}:${input.battleId}`, rulesHash: hash,
    rules: rulesDocToJson6(rules, chase, attrs, tempo) as unknown as FightReplayIssueWire['rules'],
    seed: input.seed, playerSide: 0,
    player: { roster: player.map(c => ({ fighterId: c.holobotId, holobotId: c.holobotId })) },
    cpu: {
      side: 1, rank: issuedSkill(input.mentor ? 'Rookie' : fightRankForTier(input.tier)), profile: input.staminaWind === true ? cpuIssueProfile(profileOf(lead)) : issuedProfile(brainProfile(profileOf(lead))),
      roster: opponent.map(c => ({ fighterId: 'cpu-' + c.holobotId, holobotId: c.holobotId, profile: profileOf(c.holobotId) })),
    },
    profilesVersion: PROFILES_VERSION,
    ...(input.readinessStart ? { readinessStart: [...input.readinessStart] } : {}),
    ...(input.encounter ? { encounter: input.encounter } : {}),
  };
}
