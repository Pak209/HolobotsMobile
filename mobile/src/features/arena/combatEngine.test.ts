// @ts-nocheck
import { ArenaCombatEngine } from "./combatEngine";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function createCard(overrides = {}) {
  return {
    id: "card-1",
    templateId: "card-template",
    name: "Quick Jab",
    type: "strike",
    staminaCost: 2,
    requirements: [],
    baseDamage: 12,
    speedModifier: 0,
    effects: [],
    animationId: "jab",
    description: "test card",
    ...overrides,
  };
}

function createFighter(id: string, overrides = {}) {
  return {
    holobotId: id,
    ownerUserId: `owner-${id}`,
    maxHP: 100,
    currentHP: 100,
    attack: 20,
    defense: 10,
    speed: 10,
    intelligence: 10,
    stamina: 7,
    maxStamina: 7,
    specialMeter: 0,
    staminaState: "fresh",
    isInDefenseMode: false,
    comboCounter: 0,
    lastActionTime: Date.now(),
    staminaEfficiency: 1,
    defenseTimingWindow: 0,
    counterDamageBonus: 1.5,
    avatar: "",
    name: id,
    archetype: "balanced",
    level: 1,
    armedDefenseTrap: null,
    ...overrides,
  };
}

function createAction(state, actorId, targetId, card) {
  return {
    id: `action-${card.id}-${Date.now()}`,
    turnNumber: state.turnNumber,
    actorId,
    targetId,
    card,
    timestamp: Date.now(),
    outcome: "hit",
    damageDealt: 0,
    staminaChange: 0,
    specialMeterChange: 0,
    wasCountered: false,
    triggeredCombo: false,
    perfectDefense: false,
  };
}

(function runArenaCombatEngineTests() {
  const defenseCard = createCard({
    id: "guard-protocol",
    templateId: "guard_protocol",
    name: "Guard Protocol",
    type: "defense",
    staminaCost: 1,
    cooldownTurns: 2,
    tier: "common",
    defenseEffect: "guard",
    damageReduction: 0.5,
    evadeChance: 0,
    counterDamageMultiplier: 0,
  });

  const evadeCard = createCard({
    id: "perfect-reversal",
    templateId: "perfect_reversal",
    name: "Perfect Reversal",
    type: "defense",
    staminaCost: 4,
    cooldownTurns: 4,
    tier: "legendary",
    defenseEffect: "perfect_reversal",
    damageReduction: 1,
    evadeChance: 1,
    counterDamageMultiplier: 0.8,
  });

  const strikeCard = createCard({
    id: "strike-card",
    templateId: "strike-card",
    type: "strike",
    baseDamage: 18,
    staminaCost: 3,
  });

  let state = ArenaCombatEngine.initializeBattle(createFighter("player"), createFighter("opponent"));
  state = {
    ...state,
    currentActorId: state.player.holobotId,
    player: { ...state.player, stamina: 3, staminaState: "gassed" },
  };

  const defenseState = ArenaCombatEngine.resolveAction(
    state,
    createAction(state, state.player.holobotId, state.opponent.holobotId, defenseCard),
  );
  assert(defenseState.player.stamina >= 5, "defense should restore stamina");
  assert(Boolean(defenseState.player.armedDefenseTrap), "defense should arm a trap");
  assert(defenseState.playerCardCooldowns.guard_protocol > 0, "defense should apply cooldown");
  assert(
    ArenaCombatEngine.canPlayCard(defenseState.player, defenseCard, defenseState, true) === false,
    "defense should not be playable again while trap is armed",
  );

  const attackIntoGuard = ArenaCombatEngine.resolveAction(
    defenseState,
    createAction(
      defenseState,
      defenseState.opponent.holobotId,
      defenseState.player.holobotId,
      strikeCard,
    ),
  );
  assert(!attackIntoGuard.player.armedDefenseTrap, "trap should be consumed after an incoming attack");
  assert(
    attackIntoGuard.player.currentHP > defenseState.player.currentHP - 18,
    "guard trap should reduce incoming damage",
  );

  const cooldownState = ArenaCombatEngine.passTurn(attackIntoGuard);
  assert(
    (cooldownState.playerCardCooldowns.guard_protocol ?? 0) < (defenseState.playerCardCooldowns.guard_protocol ?? 0),
    "cooldown should tick down each turn",
  );

  const lowStaminaState = {
    ...state,
    player: { ...state.player, stamina: 0, staminaState: "exhausted" },
  };
  assert(
    ArenaCombatEngine.canPlayCard(lowStaminaState.player, strikeCard, lowStaminaState, true) === false,
    "cards cannot be played without enough stamina",
  );

  const lowDefense = ArenaCombatEngine.calculateDamage(
    createFighter("attacker", { attack: 24 }),
    createFighter("defender", { defense: 6 }),
    strikeCard,
  );
  const highDefense = ArenaCombatEngine.calculateDamage(
    createFighter("attacker", { attack: 24 }),
    createFighter("defender", { defense: 24 }),
    strikeCard,
  );
  assert(lowDefense.finalDamage > highDefense.finalDamage, "damage formula should respect DEF");

  const lowAttack = ArenaCombatEngine.calculateDamage(
    createFighter("attacker", { attack: 12 }),
    createFighter("defender", { defense: 10 }),
    strikeCard,
  );
  const highAttack = ArenaCombatEngine.calculateDamage(
    createFighter("attacker", { attack: 32 }),
    createFighter("defender", { defense: 10 }),
    strikeCard,
  );
  assert(highAttack.finalDamage > lowAttack.finalDamage, "damage formula should respect ATK");

  let strikeMeterState = ArenaCombatEngine.initializeBattle(createFighter("player"), createFighter("opponent"));
  strikeMeterState = {
    ...strikeMeterState,
    currentActorId: strikeMeterState.player.holobotId,
  };
  assert(ArenaCombatEngine.getComboMeter(strikeMeterState.player) === 1, "combo meter should start at x1");
  const strikeMeterAfterHit = ArenaCombatEngine.resolveAction(
    strikeMeterState,
    createAction(strikeMeterState, strikeMeterState.player.holobotId, strikeMeterState.opponent.holobotId, strikeCard),
  );
  assert(ArenaCombatEngine.getComboMeter(strikeMeterAfterHit.player) === 2, "strike should raise combo meter to x2");

  const comboCard = createCard({
    id: "combo-card",
    templateId: "combo-card",
    type: "combo",
    baseDamage: 10,
    staminaCost: 2,
    requirements: [{ type: "combo", operator: "gte", value: 1 }],
  });
  const comboBase = ArenaCombatEngine.calculateDamage(
    createFighter("attacker", { attack: 20, comboCounter: 1 }),
    createFighter("defender", { defense: 10 }),
    comboCard,
    { comboLength: 1 },
  );
  const comboBoosted = ArenaCombatEngine.calculateDamage(
    createFighter("attacker", { attack: 20, comboCounter: 3 }),
    createFighter("defender", { defense: 10 }),
    comboCard,
    { comboLength: 3 },
  );
  assert(comboBoosted.finalDamage >= comboBase.finalDamage * 2, "combo card damage should scale with combo meter");

  let comboBreakState = ArenaCombatEngine.initializeBattle(
    createFighter("player", { comboCounter: 3 }),
    createFighter("opponent"),
  );
  comboBreakState = {
    ...comboBreakState,
    currentActorId: comboBreakState.player.holobotId,
    player: { ...comboBreakState.player, comboCounter: 3, stamina: 7 },
  };
  const comboBrokenByDefense = ArenaCombatEngine.resolveAction(
    comboBreakState,
    createAction(comboBreakState, comboBreakState.player.holobotId, comboBreakState.opponent.holobotId, defenseCard),
  );
  assert(comboBrokenByDefense.player.comboCounter === 0, "defense cards should break combo meter");

  let perfectTrapState = ArenaCombatEngine.initializeBattle(createFighter("player"), createFighter("opponent"));
  perfectTrapState = {
    ...perfectTrapState,
    currentActorId: perfectTrapState.player.holobotId,
    player: { ...perfectTrapState.player, stamina: 7 },
    opponent: { ...perfectTrapState.opponent, attack: 30 },
  };
  const armedPerfectTrap = ArenaCombatEngine.resolveAction(
    perfectTrapState,
    createAction(
      perfectTrapState,
      perfectTrapState.player.holobotId,
      perfectTrapState.opponent.holobotId,
      evadeCard,
    ),
  );
  const resolvedPerfectTrap = ArenaCombatEngine.resolveAction(
    armedPerfectTrap,
    createAction(
      armedPerfectTrap,
      armedPerfectTrap.opponent.holobotId,
      armedPerfectTrap.player.holobotId,
      strikeCard,
    ),
  );
  const lastAction = resolvedPerfectTrap.actionHistory[resolvedPerfectTrap.actionHistory.length - 1];
  assert(lastAction.perfectDefense === true, "perfect reversal should be able to fully evade");
  assert(lastAction.wasCountered === true, "perfect reversal should counter the attacker");
})();
