import { describe, expect, it } from 'vitest';

import {
  applyRetreatToDoc,
  autoPickSendInIndex,
  buildPvpTeamSide,
  buildSendInUpdates,
  buildSwitchUpdates,
  ENTRY_LOCK_MS,
  interceptTeamKo,
  livingBenchIndexes,
  regenBenchMembers,
  SEND_IN_DEADLINE_MS,
  SWITCH_COOLDOWN_MS,
  validatePvpSendIn,
  validatePvpSwitch,
  validateTeamAct,
} from '../pvpTeamBattle';
import type { BattleRoom, PvpFighterDoc, PvpTeamSide } from '@/types/battle-room';

const NOW = 5_000_000;

function makeDoc(name: string, overrides: Partial<PvpFighterDoc> = {}): PvpFighterDoc {
  return {
    uid: 'uid-1',
    username: 'Pilot',
    holobotName: name,
    level: 10,
    archetype: 'balanced',
    maxHP: 150,
    currentHP: 150,
    attack: 40,
    defense: 30,
    speed: 25,
    intelligence: 25,
    stamina: 7,
    maxStamina: 7,
    specialMeter: 40,
    comboCounter: 2,
    guardStacks: 1,
    isInDefenseMode: true,
    defenseActive: true,
    defendedAt: NOW - 100,
    armedDefenseTrap: {
      cardId: 'x',
      templateId: 'block',
      name: 'Guard Protocol',
      tier: 'common',
      effect: 'guard',
      damageReduction: 0.5,
      evadeChance: 0,
      counterDamageMultiplier: 0,
      cooldownTurns: 2,
    },
    moveCooldowns: {},
    abilityRuntime: { firedCount: 0 },
    moves: [],
    signatureFinisher: { id: 's', name: 'Burst', baseDamage: 38, animationId: 'a' },
    totalDamageDealt: 0,
    isConnected: true,
    ...overrides,
  };
}

function makeTeamRoom(overrides: Partial<BattleRoom> = {}): BattleRoom {
  const p1Team = [makeDoc('ACE'), makeDoc('KUMA', { specialMeter: 77 }), makeDoc('TSUIN')];
  const p2Team = [makeDoc('WOLF', { uid: 'uid-2' }), makeDoc('ERA', { uid: 'uid-2' }), makeDoc('KEN', { uid: 'uid-2' })];

  return {
    roomId: 'room-1',
    roomCode: 'ABCDEF',
    rulesVersion: 3,
    status: 'active',
    mode: '3v3',
    phase: 'active',
    pendingSendInRole: null,
    sendInDeadline: null,
    teams: {
      p1: buildPvpTeamSide(p1Team),
      p2: buildPvpTeamSide(p2Team),
    },
    players: { p1: { ...p1Team[0] }, p2: { ...p2Team[0] } },
    turnNumber: 4,
    winner: null,
    battleLog: [],
    createdAt: NOW,
    ...overrides,
  };
}

describe('retreat serialization', () => {
  it('drops trap, stance, chain, and stacks but keeps HP/stamina/meter', () => {
    const doc = makeDoc('ACE', { currentHP: 88, stamina: 3, specialMeter: 61 });
    const retreated = applyRetreatToDoc(doc);

    expect(retreated.armedDefenseTrap).toBeNull();
    expect(retreated.isInDefenseMode).toBe(false);
    expect(retreated.comboCounter).toBe(0);
    expect(retreated.guardStacks).toBe(0);
    expect(retreated.currentHP).toBe(88);
    expect(retreated.stamina).toBe(3);
    expect(retreated.specialMeter).toBe(61);
  });
});

describe('switching', () => {
  it('validates the full refusal matrix', () => {
    const room = makeTeamRoom();

    expect(validatePvpSwitch(room, 'p1', 1, NOW)).toBeNull();
    expect(validatePvpSwitch(room, 'p1', 0, NOW)).toBe('already_active');
    expect(validatePvpSwitch(room, 'p1', 9, NOW)).toBe('invalid_slot');

    room.teams!.p1.members[1] = makeDoc('KUMA', { currentHP: 0 });
    expect(validatePvpSwitch(room, 'p1', 1, NOW)).toBe('knocked_out');

    room.teams!.p1.switchCooldownUntil = NOW + 1;
    expect(validatePvpSwitch(room, 'p1', 2, NOW)).toBe('cooldown');

    const awaiting = makeTeamRoom({ phase: 'awaiting_send_in', pendingSendInRole: 'p1' });
    expect(validatePvpSwitch(awaiting, 'p1', 1, NOW)).toBe('awaiting_send_in');

    const duel = makeTeamRoom({ mode: '1v1', teams: undefined });
    expect(validatePvpSwitch(duel, 'p1', 1, NOW)).toBe('not_team_room');
  });

  it('writes the retreated live doc back and activates the target with tempo costs', () => {
    const room = makeTeamRoom();
    // The LIVE active has drifted from its stale members[] snapshot.
    room.players.p1 = { ...room.players.p1, currentHP: 42, specialMeter: 90 };

    const updates = buildSwitchUpdates(room, 'p1', 1, NOW);
    const side = updates['teams.p1'] as PvpTeamSide;
    const incoming = updates['players.p1'] as PvpFighterDoc;

    // Outgoing slot holds the LIVE state, retreated.
    expect(side.members[0].currentHP).toBe(42);
    expect(side.members[0].armedDefenseTrap).toBeNull();
    expect(side.members[0].comboCounter).toBe(0);
    // Incoming keeps its own persistent meter (KUMA banked 77).
    expect(incoming.holobotName).toBe('KUMA');
    expect(incoming.specialMeter).toBe(77);
    expect(side.activeIndex).toBe(1);
    expect(side.switchCooldownUntil).toBe(NOW + SWITCH_COOLDOWN_MS);
    expect(side.entryLockUntil).toBe(NOW + ENTRY_LOCK_MS);
  });
});

describe('KO interception', () => {
  it('a KO with bench remaining freezes into the send-in phase', () => {
    const room = makeTeamRoom();
    const updates = interceptTeamKo(
      room,
      { status: 'completed', winner: 'p1', completedAt: NOW },
      NOW,
    );

    expect(updates.status).toBe('active');
    expect(updates.winner).toBeNull();
    expect(updates.phase).toBe('awaiting_send_in');
    expect(updates.pendingSendInRole).toBe('p2');
    expect(updates.sendInDeadline).toBe(NOW + SEND_IN_DEADLINE_MS);
    expect(updates.completedAt).toBeUndefined();
  });

  it('a KO on an exhausted team really completes the match', () => {
    const room = makeTeamRoom();
    room.teams!.p2.members[1] = makeDoc('ERA', { currentHP: 0 });
    room.teams!.p2.members[2] = makeDoc('KEN', { currentHP: 0 });

    const updates = interceptTeamKo(room, { status: 'completed', winner: 'p1' }, NOW);
    expect(updates.status).toBe('completed');
    expect(updates.winner).toBe('p1');
  });

  it('leaves 1v1 rooms untouched', () => {
    const duel = makeTeamRoom({ mode: '1v1', teams: undefined });
    const updates = { status: 'completed', winner: 'p1' };
    expect(interceptTeamKo(duel, updates, NOW)).toBe(updates);
  });
});

describe('send-ins', () => {
  function downedRoom(): BattleRoom {
    const room = makeTeamRoom({
      phase: 'awaiting_send_in',
      pendingSendInRole: 'p2',
      sendInDeadline: NOW + SEND_IN_DEADLINE_MS,
    });
    room.players.p2 = { ...room.players.p2, currentHP: 0 };
    return room;
  }

  it('only the downed side may pick before the deadline; either after', () => {
    const room = downedRoom();

    expect(validatePvpSendIn(room, 'p2', 1, NOW)).toBeNull();
    expect(validatePvpSendIn(room, 'p1', 1, NOW)).toBe('not_your_pick');
    // Past the deadline the OTHER client may commit the auto-pick.
    expect(validatePvpSendIn(room, 'p1', 1, NOW + SEND_IN_DEADLINE_MS + 1)).toBeNull();
  });

  it('activates the pick, records the KO, and unfreezes the room', () => {
    const room = downedRoom();
    const updates = buildSendInUpdates(room, 1, NOW);
    const side = updates['teams.p2'] as PvpTeamSide;
    const incoming = updates['players.p2'] as PvpFighterDoc;

    expect(side.members[0].currentHP).toBe(0); // downed WOLF written back
    expect(incoming.holobotName).toBe('ERA');
    expect(side.activeIndex).toBe(1);
    expect(side.entryLockUntil).toBe(NOW + ENTRY_LOCK_MS);
    expect(updates.phase).toBe('active');
    expect(updates.pendingSendInRole).toBeNull();
    expect(updates.sendInDeadline).toBeNull();
  });

  it('auto-pick chooses the first living bench slot', () => {
    const side = buildPvpTeamSide([
      makeDoc('WOLF', { currentHP: 0 }),
      makeDoc('ERA', { currentHP: 0 }),
      makeDoc('KEN'),
    ]);
    expect(autoPickSendInIndex(side)).toBe(2);
    expect(livingBenchIndexes(side)).toEqual([2]);
  });
});

describe('act gating and bench regen', () => {
  it('blocks actions during send-ins and entry locks (3v3 only)', () => {
    const room = makeTeamRoom();
    expect(validateTeamAct(room, 'p1', NOW)).toBeNull();

    room.teams!.p1.entryLockUntil = NOW + 500;
    expect(validateTeamAct(room, 'p1', NOW)).toBe('entry_locked');
    expect(validateTeamAct(room, 'p2', NOW)).toBeNull();

    const awaiting = makeTeamRoom({ phase: 'awaiting_send_in', pendingSendInRole: 'p2' });
    expect(validateTeamAct(awaiting, 'p1', NOW)).toBe('awaiting_send_in');

    const duel = makeTeamRoom({ mode: '1v1', teams: undefined });
    expect(validateTeamAct(duel, 'p1', NOW)).toBeNull();
  });

  it("bench members regain stamina; active and KO'd do not; meter frozen", () => {
    const side = buildPvpTeamSide([
      makeDoc('ACE', { stamina: 2 }),
      makeDoc('KUMA', { stamina: 3, specialMeter: 55 }),
      makeDoc('TSUIN', { stamina: 5, currentHP: 0 }),
    ]);

    const regenerated = regenBenchMembers(side);
    expect(regenerated[0].stamina).toBe(2); // active: engine handles it
    expect(regenerated[1].stamina).toBe(4);
    expect(regenerated[1].specialMeter).toBe(55);
    expect(regenerated[2].stamina).toBe(5); // KO'd: stays down
  });
});
