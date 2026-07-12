import { getRuleBend } from '@/features/arena/abilities';
import { ArenaCombatEngine } from '@/features/arena/combatEngine';
import type { ActionCard, ArenaBattleConfig, ArenaFighter, BattleState } from '@/types/arena';

/**
 * 3v3 Showdown — team layer ABOVE the untouched 1v1 engine
 * (docs/arena-3v3-mode-plan.md).
 *
 * Each side fields three Holobots with one active; the engine only ever sees
 * the current duel (active vs active). Rotation rules:
 *  - Switching is a retreat: the outgoing fighter drops its armed trap,
 *    combo chain, and guard-stack streak. HP, stamina, special meter, spent
 *    one-shot bends, and defense cooldown timestamps persist.
 *  - A side's switches share a cooldown; incoming fighters are entry-locked
 *    for a beat before they can act.
 *  - Benched fighters regenerate stamina but never HP; their meter is
 *    frozen (it only builds from their own offense while active).
 *  - A KO freezes combat into a SEND-IN phase for the downed side, with a
 *    deadline that auto-picks the next fighter in order.
 */

export const SWITCH_COOLDOWN_MS = 10_000;
export const ENTRY_LOCK_MS = 1_500;
export const SEND_IN_DEADLINE_MS = 5_000;
export const TEAM_SIZE = 3;

export type TeamSideKey = 'player' | 'opponent';

export type TeamSlot = {
  fighter: ArenaFighter;
  moves: ActionCard[];
  isKnockedOut: boolean;
};

export type TeamSide = {
  slots: TeamSlot[];
  activeIndex: number;
  switchCooldownUntil: number;
  entryLockUntil: number;
};

export type TeamBattlePhase = 'active' | 'awaiting_send_in' | 'completed';

export type TeamBattle = {
  phase: TeamBattlePhase;
  player: TeamSide;
  opponent: TeamSide;
  pendingSendInSide: TeamSideKey | null;
  sendInDeadline: number | null;
  /** Engine state for the CURRENT duel (active vs active). */
  duel: BattleState;
  winnerSide: TeamSideKey | null;
  config?: Partial<ArenaBattleConfig>;
};

export type TeamFighterEntry = {
  fighter: ArenaFighter;
  moves: ActionCard[];
};

function cloneSide(side: TeamSide): TeamSide {
  return {
    ...side,
    slots: side.slots.map((slot) => ({ ...slot })),
  };
}

function activeSlot(side: TeamSide): TeamSlot {
  return side.slots[side.activeIndex];
}

function buildDuel(team: Pick<TeamBattle, 'player' | 'opponent' | 'config'>): BattleState {
  return ArenaCombatEngine.initializeBattle(
    activeSlot(team.player).fighter,
    activeSlot(team.opponent).fighter,
    team.config,
  );
}

export function createTeamBattle(
  playerEntries: TeamFighterEntry[],
  opponentEntries: TeamFighterEntry[],
  config?: Partial<ArenaBattleConfig>,
): TeamBattle {
  if (playerEntries.length !== TEAM_SIZE || opponentEntries.length !== TEAM_SIZE) {
    throw new Error(`A 3v3 team needs exactly ${TEAM_SIZE} Holobots.`);
  }

  const toSide = (entries: TeamFighterEntry[]): TeamSide => ({
    slots: entries.map((entry) => ({
      fighter: ArenaCombatEngine.prepareFighterWithBends(entry.fighter),
      moves: entry.moves,
      isKnockedOut: false,
    })),
    activeIndex: 0,
    switchCooldownUntil: 0,
    entryLockUntil: 0,
  });

  const player = toSide(playerEntries);
  const opponent = toSide(opponentEntries);
  const team: TeamBattle = {
    phase: 'active',
    player,
    opponent,
    pendingSendInSide: null,
    sendInDeadline: null,
    duel: null as unknown as BattleState,
    winnerSide: null,
    config,
  };
  team.duel = buildDuel(team);
  return team;
}

export function getActiveMoves(team: TeamBattle, side: TeamSideKey): ActionCard[] {
  return activeSlot(team[side]).moves;
}

export function benchIndexes(side: TeamSide): number[] {
  return side.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot, index }) => !slot.isKnockedOut && index !== side.activeIndex)
    .map(({ index }) => index);
}

export function isSideDefeated(side: TeamSide): boolean {
  return side.slots.every((slot) => slot.isKnockedOut);
}

export function canAct(team: TeamBattle, side: TeamSideKey, now: number = Date.now()): boolean {
  return team.phase === 'active' && now >= team[side].entryLockUntil;
}

/**
 * Syncs an engine resolution back into the team: writes both actives into
 * their slots, then handles KOs — entering the send-in phase when the downed
 * side still has bench, or completing the match when it does not.
 */
export function applyDuelResolution(
  team: TeamBattle,
  nextDuel: BattleState,
  now: number = Date.now(),
): TeamBattle {
  const player = cloneSide(team.player);
  const opponent = cloneSide(team.opponent);
  player.slots[player.activeIndex] = { ...player.slots[player.activeIndex], fighter: nextDuel.player };
  opponent.slots[opponent.activeIndex] = { ...opponent.slots[opponent.activeIndex], fighter: nextDuel.opponent };

  const next: TeamBattle = { ...team, player, opponent, duel: nextDuel };

  const downedSide: TeamSideKey | null =
    nextDuel.player.currentHP <= 0 ? 'player' : nextDuel.opponent.currentHP <= 0 ? 'opponent' : null;
  if (!downedSide) {
    return next;
  }

  const side = next[downedSide];
  side.slots[side.activeIndex] = { ...side.slots[side.activeIndex], isKnockedOut: true };

  if (isSideDefeated(side)) {
    return {
      ...next,
      phase: 'completed',
      winnerSide: downedSide === 'player' ? 'opponent' : 'player',
      pendingSendInSide: null,
      sendInDeadline: null,
    };
  }

  return {
    ...next,
    phase: 'awaiting_send_in',
    pendingSendInSide: downedSide,
    sendInDeadline: now + SEND_IN_DEADLINE_MS,
  };
}

/** Retreat rules: rotating out abandons stance, chain, and stack streak. */
function applyRetreat(fighter: ArenaFighter): ArenaFighter {
  return {
    ...fighter,
    armedDefenseTrap: null,
    isInDefenseMode: false,
    defenseActive: false,
    defendedAt: undefined,
    comboCounter: 0,
    guardStacks: 0,
  };
}

export type SwitchRefusal =
  | 'not_active'
  | 'invalid_slot'
  | 'knocked_out'
  | 'already_active'
  | 'cooldown';

export function canSwitch(
  team: TeamBattle,
  sideKey: TeamSideKey,
  toIndex: number,
  now: number = Date.now(),
): SwitchRefusal | null {
  if (team.phase !== 'active') return 'not_active';
  const side = team[sideKey];
  const slot = side.slots[toIndex];
  if (!slot) return 'invalid_slot';
  if (slot.isKnockedOut) return 'knocked_out';
  if (toIndex === side.activeIndex) return 'already_active';
  if (now < side.switchCooldownUntil) return 'cooldown';
  return null;
}

export function switchActive(
  team: TeamBattle,
  sideKey: TeamSideKey,
  toIndex: number,
  now: number = Date.now(),
): TeamBattle {
  if (canSwitch(team, sideKey, toIndex, now)) {
    return team;
  }

  const side = cloneSide(team[sideKey]);
  const outgoing = side.slots[side.activeIndex];
  side.slots[side.activeIndex] = { ...outgoing, fighter: applyRetreat(outgoing.fighter) };
  side.activeIndex = toIndex;
  side.switchCooldownUntil = now + SWITCH_COOLDOWN_MS;
  side.entryLockUntil = now + ENTRY_LOCK_MS;

  const next: TeamBattle = { ...team, [sideKey]: side } as TeamBattle;
  next.duel = buildDuel(next);
  return next;
}

export function autoPickIndex(side: TeamSide): number {
  return side.slots.findIndex((slot, index) => !slot.isKnockedOut && index !== side.activeIndex);
}

export function sendIn(
  team: TeamBattle,
  sideKey: TeamSideKey,
  toIndex: number,
  now: number = Date.now(),
): TeamBattle {
  if (team.phase !== 'awaiting_send_in' || team.pendingSendInSide !== sideKey) {
    return team;
  }
  const side = cloneSide(team[sideKey]);
  const slot = side.slots[toIndex];
  if (!slot || slot.isKnockedOut) {
    return team;
  }

  side.activeIndex = toIndex;
  side.entryLockUntil = now + ENTRY_LOCK_MS;

  const next: TeamBattle = {
    ...team,
    [sideKey]: side,
    phase: 'active',
    pendingSendInSide: null,
    sendInDeadline: null,
  } as TeamBattle;
  next.duel = buildDuel(next);
  return next;
}

/** Benched, non-KO'd fighters catch their breath: +1 stamina per tick. */
export function applyBenchRegen(team: TeamBattle): TeamBattle {
  if (team.phase === 'completed') {
    return team;
  }

  const regenSide = (side: TeamSide): TeamSide => ({
    ...side,
    slots: side.slots.map((slot, index) => {
      if (index === side.activeIndex || slot.isKnockedOut) {
        return slot;
      }
      if (slot.fighter.stamina >= slot.fighter.maxStamina) {
        return slot;
      }
      return {
        ...slot,
        fighter: ArenaCombatEngine.recoverStamina({ ...slot.fighter }, 1),
      };
    }),
  });

  return { ...team, player: regenSide(team.player), opponent: regenSide(team.opponent) };
}

// ---------------------------------------------------------------------------
// CPU rotation policy (data-driven; the in-duel AI stays selectAICommand).
// ---------------------------------------------------------------------------

function healthPct(fighter: ArenaFighter): number {
  return fighter.maxHP > 0 ? fighter.currentHP / fighter.maxHP : 0;
}

function bestBenchIndex(side: TeamSide, score: (slot: TeamSlot) => number): number {
  const candidates = benchIndexes(side);
  if (candidates.length === 0) return -1;
  return candidates.reduce((best, index) =>
    score(side.slots[index]) > score(side.slots[best]) ? index : best,
  candidates[0]);
}

/**
 * Voluntary CPU switch: rotate out when badly hurt with a healthier bench,
 * rotate a gassed fighter (unless it's WOLF, who fights fine gassed), or
 * bring in the GAMA wall when the player has a charged signature waiting.
 */
export function selectAISwitch(team: TeamBattle, now: number = Date.now()): number | null {
  if (team.phase !== 'active') return null;
  const side = team.opponent;
  if (now < side.switchCooldownUntil) return null;
  if (benchIndexes(side).length === 0) return null;

  const active = activeSlot(side).fighter;
  const playerActive = activeSlot(team.player).fighter;

  // The player is sitting on a full signature: wall it with a hit-cap bend.
  if (playerActive.specialMeter >= 100 && !getRuleBend(active, 'max_hit_percent_cap')) {
    const wallIndex = benchIndexes(side).find((index) =>
      getRuleBend(side.slots[index].fighter, 'max_hit_percent_cap'),
    );
    if (wallIndex !== undefined && healthPct(side.slots[wallIndex].fighter) > 0.3) {
      return wallIndex;
    }
  }

  // Badly hurt with a meaningfully healthier bench.
  const healthiest = bestBenchIndex(side, (slot) => healthPct(slot.fighter));
  if (
    healthiest >= 0 &&
    healthPct(active) < 0.25 &&
    healthPct(side.slots[healthiest].fighter) > healthPct(active) + 0.25
  ) {
    return healthiest;
  }

  // Gassed (and not WOLF): rotate to a rested fighter.
  if (
    active.stamina <= 1 &&
    !getRuleBend(active, 'ignore_stamina_damage_penalty')
  ) {
    const rested = bestBenchIndex(side, (slot) => slot.fighter.stamina);
    if (rested >= 0 && side.slots[rested].fighter.stamina >= 5) {
      return rested;
    }
  }

  return null;
}

/** Forced send-in: pick the best matchup against the player's active. */
export function selectAISendIn(team: TeamBattle): number {
  const side = team.opponent;
  const playerActive = activeSlot(team.player).fighter;
  const options = benchIndexes(side);
  if (options.length === 0) return side.activeIndex;

  // Player signature charged -> prefer the hit-cap wall.
  if (playerActive.specialMeter >= 100) {
    const wall = options.find((index) => getRuleBend(side.slots[index].fighter, 'max_hit_percent_cap'));
    if (wall !== undefined) return wall;
  }

  // Player trap armed -> prefer the trap-piercer with its pierce unspent.
  if (playerActive.armedDefenseTrap) {
    const piercer = options.find(
      (index) =>
        getRuleBend(side.slots[index].fighter, 'pierce_traps_first_attack') &&
        (side.slots[index].fighter.abilityRuntime?.bendUses ?? 0) === 0,
    );
    if (piercer !== undefined) return piercer;
  }

  // Otherwise the healthiest.
  return bestBenchIndex(side, (slot) => healthPct(slot.fighter));
}
