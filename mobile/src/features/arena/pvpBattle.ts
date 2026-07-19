import { buildPlayerFighter } from '@/config/arenaConfig';
import { getHolobotFullImageSource } from '@/config/holobots';
import { fireAbility, getAbility } from '@/features/arena/abilities';
import { ArenaCombatEngine } from '@/features/arena/combatEngine';
import { resolveCombatKit } from '@/features/arena/moveKits';
import { getEquippedPartBoosts, getHolobotEquippedParts } from '@/lib/partStats';
import type { ArenaFighter, BattleAction, BattleState } from '@/types/arena';
import type { BattleLogEntry, BattleRoom, PlayerRole, PvpFighterDoc } from '@/types/battle-room';
import type { UserHolobot, UserProfile } from '@/types/profile';

/**
 * PvE/PvP convergence layer (plan Phase 5): maps between the serializable
 * battle-room documents and the ArenaCombatEngine's BattleState so realtime
 * PvP resolves with the exact PvE rules, kits, ranks, abilities, and
 * signatures. The mapping is fixed (p1 -> state.player, p2 -> state.opponent)
 * on BOTH clients, so every device derives identical state from the shared
 * room document.
 */

export const PVP_FIGHTER_IDS: Record<PlayerRole, string> = {
  p1: 'pvp-p1',
  p2: 'pvp-p2',
};

/**
 * Firestore rejects any payload containing `undefined` — even nested inside
 * arrays (that's how an optional template field broke quick match). Fighter
 * docs are plain JSON at build time, so a deep prune at this boundary keeps
 * every future optional field from wedging pool entries and rooms.
 */
function pruneUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => pruneUndefinedDeep(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .map(([key, child]) => [key, pruneUndefinedDeep(child)]),
    ) as T;
  }
  return value;
}

/** Builds a player's serializable room entry from their own profile. */
export function buildPvpFighterDoc(
  uid: string,
  username: string,
  holobot: UserHolobot,
  profile: Pick<UserProfile, 'arena_deck_template_ids' | 'battle_cards' | 'equippedParts'>,
): PvpFighterDoc {
  // Equipped-part boosts ride the same self-authored stat path as levels
  // and ranks (C4's documented PvP trust model).
  const fighter = buildPlayerFighter(
    uid,
    holobot,
    getEquippedPartBoosts(getHolobotEquippedParts(profile.equippedParts, holobot.name)),
  );
  // PvP rooms never pass through initializeBattle, so opening-bell abilities
  // (battle_start, e.g. ERA's meter head start) fire here at entry instead.
  fighter.abilityRuntime = fighter.abilityRuntime ?? { firedCount: 0 };
  fireAbility(fighter, 'battle_start', { turnNumber: 0 });
  ArenaCombatEngine.applyMeterFloor(fighter);
  const kit = resolveCombatKit({
    savedKitTemplateIds: holobot.combatKit?.slots,
    deckTemplateIds: profile.arena_deck_template_ids,
    ownedBattleCards: profile.battle_cards,
    moveProgress: holobot.moveProgress,
    idPrefix: `pvp-${uid.slice(0, 6)}`,
  });

  return pruneUndefinedDeep({
    uid,
    username,
    holobotName: holobot.name.toUpperCase(),
    level: fighter.level,
    archetype: fighter.archetype,
    maxHP: fighter.maxHP,
    currentHP: fighter.maxHP,
    attack: fighter.attack,
    defense: fighter.defense,
    speed: fighter.speed,
    intelligence: fighter.intelligence,
    stamina: fighter.maxStamina,
    maxStamina: fighter.maxStamina,
    specialMeter: fighter.specialMeter,
    comboCounter: 0,
    guardStacks: 0,
    isInDefenseMode: false,
    defenseActive: false,
    defendedAt: null,
    defenseCooldownUntil: null,
    armedDefenseTrap: null,
    moveCooldowns: {},
    abilityRuntime: fighter.abilityRuntime ?? { firedCount: 0 },
    moves: [...kit.slots],
    signatureFinisher: fighter.signatureFinisher ?? {
      id: 'signature.generic',
      name: 'Arena Burst',
      baseDamage: 38,
      animationId: 'finisher_signature',
    },
    totalDamageDealt: 0,
    isConnected: true,
  });
}

/** Rehydrates a room entry into an engine fighter (art/ability from identity). */
export function pvpDocToFighter(doc: PvpFighterDoc, role: PlayerRole): ArenaFighter {
  return {
    holobotId: PVP_FIGHTER_IDS[role],
    ownerUserId: doc.uid,
    name: doc.holobotName,
    avatar: getHolobotFullImageSource(doc.holobotName),
    archetype: doc.archetype,
    level: doc.level,
    maxHP: doc.maxHP,
    currentHP: doc.currentHP,
    attack: doc.attack,
    defense: doc.defense,
    speed: doc.speed,
    intelligence: doc.intelligence,
    stamina: doc.stamina,
    maxStamina: doc.maxStamina,
    specialMeter: doc.specialMeter,
    staminaState: ArenaCombatEngine.getStaminaState(doc.stamina),
    isInDefenseMode: doc.isInDefenseMode,
    defenseActive: doc.defenseActive ?? false,
    defendedAt: doc.defendedAt ?? undefined,
    armedDefenseTrap: doc.armedDefenseTrap,
    guardStacks: doc.guardStacks ?? 0,
    defenseCooldownUntil: doc.defenseCooldownUntil ?? 0,
    comboCounter: doc.comboCounter,
    lastActionTime: 0,
    statusEffects: [],
    staminaEfficiency: 1,
    defenseTimingWindow: 500,
    counterDamageBonus: 1.25,
    damageMultiplier: 1,
    speedBonus: 0,
    totalDamageDealt: doc.totalDamageDealt,
    ability: getAbility(doc.holobotName),
    abilityRuntime: { ...doc.abilityRuntime },
    signatureFinisher: doc.signatureFinisher,
  };
}

/** Serializes an engine fighter back onto its room entry. */
export function fighterToPvpDoc(
  fighter: ArenaFighter,
  base: PvpFighterDoc,
  moveCooldowns: Record<string, number> = base.moveCooldowns ?? {},
): PvpFighterDoc {
  return {
    ...base,
    moveCooldowns: { ...moveCooldowns },
    currentHP: fighter.currentHP,
    stamina: fighter.stamina,
    specialMeter: fighter.specialMeter,
    comboCounter: fighter.comboCounter,
    isInDefenseMode: fighter.isInDefenseMode,
    defenseActive: fighter.defenseActive ?? false,
    defendedAt: fighter.defendedAt ?? null,
    armedDefenseTrap: fighter.armedDefenseTrap ?? null,
    guardStacks: fighter.guardStacks ?? 0,
    defenseCooldownUntil: fighter.defenseCooldownUntil ?? null,
    abilityRuntime: fighter.abilityRuntime ?? { firedCount: 0 },
    totalDamageDealt: fighter.totalDamageDealt ?? 0,
  };
}

/** Rebuilds engine BattleState from the shared room document. */
export function roomToBattleState(room: BattleRoom): BattleState {
  const player = pvpDocToFighter(room.players.p1, 'p1');
  const opponent = pvpDocToFighter(room.players.p2, 'p2');
  const now = Date.now();

  return {
    battleId: room.roomId,
    battleType: 'pvp',
    status: room.status === 'waiting' ? 'active' : room.status,
    player,
    opponent,
    turnNumber: room.turnNumber ?? 0,
    currentActorId: player.holobotId,
    playerCardCooldowns: { ...(room.players.p1.moveCooldowns ?? {}) },
    opponentCardCooldowns: { ...(room.players.p2.moveCooldowns ?? {}) },
    pendingActions: [],
    actionHistory: [],
    timer: 0,
    neutralPhase: false,
    lastActionTimestamp: now,
    createdAt: now,
    playerBattleStyle: 'balanced',
    hackUsed: false,
    allowPlayerControl: true,
    potentialRewards: { exp: 0, syncPoints: 0, holos: 0 },
  };
}

function describeAction(room: BattleRoom, action: BattleAction): string {
  const actorDoc = action.actorId === PVP_FIGHTER_IDS.p1 ? room.players.p1 : room.players.p2;
  const name = actorDoc.username || actorDoc.holobotName;
  const damage = action.actualDamage ?? 0;

  if (action.actionType === 'defense') {
    return `${name} armed ${action.card.name}.`;
  }
  if (action.wasCountered) {
    return `${name} used ${action.card.name} — countered!`;
  }
  if (action.perfectDefense) {
    return `${name} used ${action.card.name} — evaded.`;
  }
  if (action.outcome === 'blocked') {
    return `${name} used ${action.card.name} for ${damage} damage. Blocked.`;
  }
  return `${name} used ${action.card.name} for ${damage} damage.`;
}

export type PvpRoomUpdates = { [key: string]: any };

/**
 * Turns a resolved engine state back into the room-document updates the
 * acting client commits in its transaction.
 */
export function battleStateToRoomUpdates(
  room: BattleRoom,
  state: BattleState,
  now: number = Date.now(),
): PvpRoomUpdates {
  const lastAction = state.actionHistory[state.actionHistory.length - 1];
  const winnerRole: PlayerRole | null =
    state.status === 'completed'
      ? state.player.currentHP <= 0
        ? 'p2'
        : state.opponent.currentHP <= 0
          ? 'p1'
          : null
      : null;

  const battleLog: BattleLogEntry[] = [
    ...(room.battleLog || []),
    ...(lastAction
      ? [{ turnNumber: state.turnNumber, message: describeAction(room, lastAction), timestamp: now }]
      : []),
  ].slice(-40);

  return {
    'players.p1': fighterToPvpDoc(state.player, room.players.p1, state.playerCardCooldowns ?? {}),
    'players.p2': fighterToPvpDoc(state.opponent, room.players.p2, state.opponentCardCooldowns ?? {}),
    turnNumber: state.turnNumber,
    status: state.status === 'completed' ? 'completed' : 'active',
    winner: winnerRole,
    battleLog,
    lastAction: lastAction ? pruneUndefinedDeep(lastAction) : null,
    lastActionAt: now,
    ...(state.status === 'completed' ? { completedAt: now } : {}),
  };
}
