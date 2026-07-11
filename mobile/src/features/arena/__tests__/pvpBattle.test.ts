import { describe, expect, it, vi } from 'vitest';

import type { ArenaFighter } from '@/types/arena';
import type { BattleRoom, PvpFighterDoc } from '@/types/battle-room';
import type { UserHolobot, UserProfile } from '@/types/profile';

// react-native cannot load under vitest (Flow syntax), so the two config
// modules that import it are stubbed with equivalent pure builders. The
// mapping/engine logic under test is untouched.
vi.mock('@/config/holobots', () => ({
  getHolobotFullImageSource: () => 'test://avatar',
}));

vi.mock('@/config/arenaConfig', async () => {
  const { getSignatureFinisher } = await vi.importActual<typeof import('../moveKits')>('../moveKits');
  const { getAbility } = await vi.importActual<typeof import('../abilities')>('../abilities');
  return {
    buildPlayerFighter: (uid: string, holobot: UserHolobot): ArenaFighter => ({
      holobotId: `player-${holobot.name.toLowerCase()}`,
      ownerUserId: uid,
      name: holobot.name.toUpperCase(),
      avatar: 'test://avatar',
      archetype: 'balanced',
      level: holobot.level || 1,
      maxHP: 150,
      currentHP: 150,
      attack: 40,
      defense: 30,
      speed: 25,
      intelligence: 25,
      stamina: 7,
      maxStamina: 7,
      specialMeter: 0,
      staminaState: 'fresh',
      isInDefenseMode: false,
      comboCounter: 0,
      lastActionTime: 0,
      statusEffects: [],
      staminaEfficiency: 1,
      defenseTimingWindow: 500,
      counterDamageBonus: 1.25,
      damageMultiplier: 1,
      speedBonus: 0,
      totalDamageDealt: 0,
      signatureFinisher: getSignatureFinisher(holobot.name),
      ability: getAbility(holobot.name),
      abilityRuntime: { firedCount: 0 },
    }),
  };
});

import { ArenaCombatEngine } from '../combatEngine';
import { resolveMove } from '../moveKits';
import {
  battleStateToRoomUpdates,
  buildPvpFighterDoc,
  PVP_FIGHTER_IDS,
  roomToBattleState,
} from '../pvpBattle';

function makeHolobot(name: string, overrides: Partial<UserHolobot> = {}): UserHolobot {
  return { name, level: 10, experience: 0, nextLevelExp: 100, ...overrides };
}

const OWNED_CARDS = {
  'combo.chainBurst': 1,
  'defense.guardUp': 1,
  'finisher.tacticalOverride': 1,
  'strike.quickJab': 1,
  'strike.snapShot': 1,
};

function makeProfile(): Pick<UserProfile, 'arena_deck_template_ids' | 'battle_cards'> {
  return { arena_deck_template_ids: [], battle_cards: OWNED_CARDS };
}

function makeRoom(p1: PvpFighterDoc, p2: PvpFighterDoc, overrides: Partial<BattleRoom> = {}): BattleRoom {
  return {
    roomId: 'room-1',
    roomCode: 'ABC234',
    rulesVersion: 2,
    status: 'active',
    players: { p1, p2 },
    turnNumber: 0,
    winner: null,
    battleLog: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function applyUpdates(room: BattleRoom, updates: Record<string, unknown>): BattleRoom {
  return {
    ...room,
    players: {
      p1: updates['players.p1'] as PvpFighterDoc,
      p2: updates['players.p2'] as PvpFighterDoc,
    },
    turnNumber: updates.turnNumber as number,
    status: updates.status as BattleRoom['status'],
    winner: updates.winner as BattleRoom['winner'],
    battleLog: updates.battleLog as BattleRoom['battleLog'],
  };
}

describe('buildPvpFighterDoc', () => {
  it('carries the resolved kit with move ranks applied', () => {
    const holobot = makeHolobot('ACE', {
      combatKit: {
        slots: ['strike.snapShot', 'defense.guardUp', 'combo.chainBurst', 'finisher.tacticalOverride'],
        revision: 1,
      },
      moveProgress: { 'strike.snapShot': { rank: 2, specializationId: 'strike.power' } },
    });

    const doc = buildPvpFighterDoc('user-1', 'Pilot', holobot, makeProfile());
    const baseDamage = resolveMove('strike.snapShot', 'base')!.baseDamage;

    expect(doc.moves.map((move) => move.templateId)).toEqual([
      'strike.snapShot',
      'defense.guardUp',
      'combo.chainBurst',
      'finisher.tacticalOverride',
    ]);
    expect(doc.moves[0].baseDamage).toBeGreaterThan(baseDamage);
    expect(doc.signatureFinisher.name).toBe('1st Strike');
  });

  it('is fully serializable for Firestore (JSON round trip)', () => {
    const doc = buildPvpFighterDoc('user-1', 'Pilot', makeHolobot('KUMA'), makeProfile());

    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it('applies ERA\'s meter floor at entry (head start)', () => {
    const era = buildPvpFighterDoc('user-1', 'Pilot', makeHolobot('ERA'), makeProfile());
    const ace = buildPvpFighterDoc('user-2', 'Rival', makeHolobot('ACE'), makeProfile());

    expect(era.specialMeter).toBe(25);
    expect(ace.specialMeter).toBe(0);
  });

  it('falls back to the stock kit for an empty collection', () => {
    const doc = buildPvpFighterDoc('user-1', 'Pilot', makeHolobot('WOLF'), {
      arena_deck_template_ids: [],
      battle_cards: {},
    });

    expect(doc.moves.map((move) => move.type)).toEqual(['strike', 'defense', 'combo', 'finisher']);
  });
});

describe('room <-> engine round trip', () => {
  it('a p2 strike resolves through the shared engine and lands on p1 in the room', () => {
    const p1 = buildPvpFighterDoc('user-1', 'PilotOne', makeHolobot('ACE'), makeProfile());
    const p2 = buildPvpFighterDoc('user-2', 'PilotTwo', makeHolobot('KUMA'), makeProfile());
    const room = makeRoom(p1, p2);

    const state = roomToBattleState(room);
    const strike = room.players.p2.moves.find((move) => move.type === 'strike')!;
    const next = ArenaCombatEngine.resolveAction(state, strike, PVP_FIGHTER_IDS.p2);
    expect(next).not.toBe(state);

    const updates = battleStateToRoomUpdates(room, next, 1234);
    const nextRoom = applyUpdates(room, updates);

    expect(nextRoom.players.p1.currentHP).toBeLessThan(p1.currentHP);
    expect(nextRoom.players.p2.stamina).toBe(p2.stamina - strike.staminaCost);
    expect(nextRoom.turnNumber).toBe(room.turnNumber + 1);
    expect(nextRoom.battleLog.at(-1)?.message).toContain('PilotTwo');
    expect(nextRoom.battleLog.at(-1)?.message).toContain(strike.name);

    // The rebuilt state from the committed room matches the resolved one.
    const rebuilt = roomToBattleState(nextRoom);
    expect(rebuilt.player.currentHP).toBe(next.player.currentHP);
    expect(rebuilt.opponent.stamina).toBe(next.opponent.stamina);
    expect(rebuilt.opponent.specialMeter).toBe(next.opponent.specialMeter);
  });

  it('kit finishers obey the same 4/7 meter gate as PvE', () => {
    const p1 = buildPvpFighterDoc('user-1', 'PilotOne', makeHolobot('ACE'), makeProfile());
    const p2 = buildPvpFighterDoc('user-2', 'PilotTwo', makeHolobot('KUMA'), makeProfile());
    const room = makeRoom(p1, p2);

    const state = roomToBattleState(room);
    const finisher = room.players.p1.moves.find((move) => move.type === 'finisher')!;
    const availability = ArenaCombatEngine.getCardAvailability(state, 'player', finisher);

    expect(availability.playable).toBe(false);
    expect(availability.reason).toBe('special_meter');
  });

  it('a signature finisher KO completes the room with the right winner', () => {
    const p1 = buildPvpFighterDoc('user-1', 'PilotOne', makeHolobot('ACE'), makeProfile());
    const p2 = buildPvpFighterDoc('user-2', 'PilotTwo', makeHolobot('KUMA'), makeProfile());
    p1.currentHP = 5;
    p2.specialMeter = 100;
    const room = makeRoom(p1, p2);

    const state = roomToBattleState(room);
    expect(ArenaCombatEngine.canUseSignatureFinisher(state, 'opponent')).toBe(true);

    const next = ArenaCombatEngine.resolveSignatureFinisher(state, PVP_FIGHTER_IDS.p2);
    const updates = battleStateToRoomUpdates(room, next, 1234);

    expect(updates.status).toBe('completed');
    expect(updates.winner).toBe('p2');
    expect((updates['players.p2'] as PvpFighterDoc).specialMeter).toBe(0);
  });

  it('rule-bend state persists across the room round trip (ACE pierce is one-shot)', () => {
    const p1 = buildPvpFighterDoc('user-1', 'PilotOne', makeHolobot('ACE'), makeProfile());
    const p2 = buildPvpFighterDoc('user-2', 'PilotTwo', makeHolobot('KUMA'), makeProfile());
    const room = makeRoom(p1, p2);

    // KUMA arms a trap; ACE's first attack pierces it (trap survives, hit clean).
    const state = roomToBattleState(room);
    const defend = room.players.p2.moves.find((move) => move.type === 'defense')!;
    const defended = ArenaCombatEngine.resolveAction(state, defend, PVP_FIGHTER_IDS.p2);
    const strike = room.players.p1.moves.find((move) => move.type === 'strike')!;
    const pierced = ArenaCombatEngine.resolveAction(defended, strike, PVP_FIGHTER_IDS.p1);

    expect(pierced.actionHistory.at(-1)?.outcome).toBe('hit');
    expect(pierced.opponent.armedDefenseTrap).not.toBeNull();

    // Commit to the room, rebuild, and attack again: the pierce is spent.
    const roomAfter = applyUpdates(room, battleStateToRoomUpdates(room, pierced, 1));
    expect(roomAfter.players.p1.abilityRuntime.bendUses).toBe(1);

    const state2 = roomToBattleState(roomAfter);
    const strike2 = roomAfter.players.p1.moves.find((move) => move.type === 'strike')!;
    const second = ArenaCombatEngine.resolveAction(state2, strike2, PVP_FIGHTER_IDS.p1);

    expect(second.actionHistory.at(-1)?.outcome).toBe('blocked');
  });
});
