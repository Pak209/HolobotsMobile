import { ENTRY_LOCK_MS, SEND_IN_DEADLINE_MS, SWITCH_COOLDOWN_MS, TEAM_SIZE } from '@/features/arena/teamBattle';
import type { BattleLogEntry, BattleRoom, PlayerRole, PvpFighterDoc, PvpTeamSide } from '@/types/battle-room';
import type { PvpRoomUpdates } from '@/features/arena/pvpBattle';

/**
 * 3v3 Showdown PvP — the team layer over the shared battle room
 * (arena-3v3-mode-plan.md Phase C).
 *
 * Design invariant: `players.pX` is ALWAYS the live active fighter, so
 * every 1v1 transaction (playMove/useSignature) and both clients' HUD
 * rendering work unchanged. `teams.pX.members` holds the persistent
 * fighter docs: authoritative for benched/KO'd fighters, a stale entry
 * snapshot for whichever slot is currently active. Switch/send-in
 * transactions write the live doc back into its slot before activating
 * another, and use the same tempo rules as PvE (10s switch cooldown,
 * 1.5s entry lock, 5s send-in deadline with auto-pick self-healing).
 */

export { ENTRY_LOCK_MS, SEND_IN_DEADLINE_MS, SWITCH_COOLDOWN_MS, TEAM_SIZE };

export function getRoomMode(room: Pick<BattleRoom, 'mode'>): '1v1' | '3v3' {
  return room.mode === '3v3' ? '3v3' : '1v1';
}

/** Retreat rules on the serialized doc — mirrors teamBattle.applyRetreat. */
export function applyRetreatToDoc(doc: PvpFighterDoc): PvpFighterDoc {
  return {
    ...doc,
    armedDefenseTrap: null,
    isInDefenseMode: false,
    defenseActive: false,
    defendedAt: null,
    comboCounter: 0,
    guardStacks: 0,
  };
}

export function buildPvpTeamSide(members: PvpFighterDoc[]): PvpTeamSide {
  return {
    members,
    activeIndex: 0,
    switchCooldownUntil: 0,
    entryLockUntil: 0,
  };
}

export function isDocKnockedOut(doc: PvpFighterDoc): boolean {
  return doc.currentHP <= 0;
}

/** Bench slots that could still fight (not active, not KO'd). */
export function livingBenchIndexes(side: PvpTeamSide): number[] {
  return side.members
    .map((member, index) => ({ member, index }))
    .filter(({ member, index }) => index !== side.activeIndex && !isDocKnockedOut(member))
    .map(({ index }) => index);
}

export type PvpSwitchRefusal =
  | 'not_team_room'
  | 'not_active'
  | 'awaiting_send_in'
  | 'invalid_slot'
  | 'knocked_out'
  | 'already_active'
  | 'cooldown';

export function validatePvpSwitch(
  room: BattleRoom,
  role: PlayerRole,
  toIndex: number,
  now: number = Date.now(),
): PvpSwitchRefusal | null {
  if (getRoomMode(room) !== '3v3' || !room.teams) return 'not_team_room';
  if (room.status !== 'active') return 'not_active';
  if ((room.phase ?? 'active') === 'awaiting_send_in') return 'awaiting_send_in';
  const side = room.teams[role];
  const target = side.members[toIndex];
  if (!target) return 'invalid_slot';
  if (isDocKnockedOut(target)) return 'knocked_out';
  if (toIndex === side.activeIndex) return 'already_active';
  if (now < side.switchCooldownUntil) return 'cooldown';
  return null;
}

function preservePresence(incoming: PvpFighterDoc, outgoing: PvpFighterDoc): PvpFighterDoc {
  // Presence belongs to the PLAYER, not the fighter: carry it across swaps.
  return {
    ...incoming,
    isConnected: outgoing.isConnected,
    ...(outgoing.lastHeartbeat !== undefined ? { lastHeartbeat: outgoing.lastHeartbeat } : {}),
  };
}

function appendLog(room: BattleRoom, message: string, now: number): BattleLogEntry[] {
  return [
    ...(room.battleLog || []),
    { turnNumber: room.turnNumber ?? 0, message, timestamp: now },
  ].slice(-40);
}

/**
 * Voluntary rotation: writes the live active (with retreat applied) back
 * into its slot and activates the chosen bench member.
 */
export function buildSwitchUpdates(
  room: BattleRoom,
  role: PlayerRole,
  toIndex: number,
  now: number = Date.now(),
): PvpRoomUpdates {
  const side = room.teams![role];
  const live = room.players[role];
  const members = side.members.map((member, index) =>
    index === side.activeIndex ? applyRetreatToDoc(live) : member,
  );
  const incoming = preservePresence(members[toIndex], live);

  return {
    [`players.${role}`]: incoming,
    [`teams.${role}`]: {
      members,
      activeIndex: toIndex,
      switchCooldownUntil: now + SWITCH_COOLDOWN_MS,
      entryLockUntil: now + ENTRY_LOCK_MS,
    },
    battleLog: appendLog(room, `${live.username || live.holobotName} rotated ${incoming.holobotName} in.`, now),
    lastActionAt: now,
  };
}

export type PvpSendInRefusal =
  | 'not_awaiting'
  | 'not_your_pick'
  | 'invalid_slot'
  | 'knocked_out';

/**
 * A send-in is valid for the downed side's owner — or, once the deadline
 * passes, for EITHER client (self-healing auto-pick if the chooser
 * disappears, same style as matchmaking).
 */
export function validatePvpSendIn(
  room: BattleRoom,
  actingRole: PlayerRole,
  toIndex: number,
  now: number = Date.now(),
): PvpSendInRefusal | null {
  if ((room.phase ?? 'active') !== 'awaiting_send_in' || !room.teams || !room.pendingSendInRole) {
    return 'not_awaiting';
  }
  const deadlinePassed = now >= (room.sendInDeadline ?? 0);
  if (actingRole !== room.pendingSendInRole && !deadlinePassed) return 'not_your_pick';
  const side = room.teams[room.pendingSendInRole];
  const target = side.members[toIndex];
  if (!target) return 'invalid_slot';
  if (toIndex === side.activeIndex || isDocKnockedOut(target)) return 'knocked_out';
  return null;
}

/** First living bench slot, for the auto-pick path. */
export function autoPickSendInIndex(side: PvpTeamSide): number {
  return livingBenchIndexes(side)[0] ?? -1;
}

export function buildSendInUpdates(
  room: BattleRoom,
  toIndex: number,
  now: number = Date.now(),
): PvpRoomUpdates {
  const role = room.pendingSendInRole!;
  const side = room.teams![role];
  const downed = room.players[role];
  const members = side.members.map((member, index) =>
    index === side.activeIndex ? downed : member,
  );
  const incoming = preservePresence(members[toIndex], downed);

  return {
    [`players.${role}`]: incoming,
    [`teams.${role}`]: {
      members,
      activeIndex: toIndex,
      switchCooldownUntil: side.switchCooldownUntil,
      entryLockUntil: now + ENTRY_LOCK_MS,
    },
    phase: 'active',
    pendingSendInRole: null,
    sendInDeadline: null,
    battleLog: appendLog(room, `${incoming.username || incoming.holobotName} sent ${incoming.holobotName} in!`, now),
    lastActionAt: now,
  };
}

/**
 * Post-resolution KO handling for team rooms: the engine marks the ROOM
 * completed whenever an active fighter hits zero, but in 3v3 a KO with
 * bench remaining freezes the room into the send-in phase instead. Call
 * with the updates produced by battleStateToRoomUpdates; returns them
 * adjusted.
 */
export function interceptTeamKo(
  room: BattleRoom,
  updates: PvpRoomUpdates,
  now: number = Date.now(),
): PvpRoomUpdates {
  if (getRoomMode(room) !== '3v3' || !room.teams) return updates;
  if (updates.status !== 'completed' || !updates.winner) return updates;

  const downedRole: PlayerRole = updates.winner === 'p1' ? 'p2' : 'p1';
  const side = room.teams[downedRole];
  if (livingBenchIndexes(side).length === 0) {
    return updates; // Whole team down: the match really is over.
  }

  const adjusted: PvpRoomUpdates = {
    ...updates,
    status: 'active',
    winner: null,
    phase: 'awaiting_send_in',
    pendingSendInRole: downedRole,
    sendInDeadline: now + SEND_IN_DEADLINE_MS,
  };
  delete adjusted.completedAt;
  return adjusted;
}

export type PvpActRefusal = 'awaiting_send_in' | 'entry_locked';

/** Extra 3v3 gates on top of the 1v1 checks in playMove/useSignature. */
export function validateTeamAct(
  room: BattleRoom,
  role: PlayerRole,
  now: number = Date.now(),
): PvpActRefusal | null {
  if (getRoomMode(room) !== '3v3' || !room.teams) return null;
  if ((room.phase ?? 'active') === 'awaiting_send_in') return 'awaiting_send_in';
  if (now < room.teams[role].entryLockUntil) return 'entry_locked';
  return null;
}

/** Bench members' stamina regen (+1 per tick, meter frozen, KO'd skipped). */
export function regenBenchMembers(side: PvpTeamSide): PvpFighterDoc[] {
  return side.members.map((member, index) => {
    if (index === side.activeIndex || isDocKnockedOut(member)) return member;
    if (member.stamina >= member.maxStamina) return member;
    return { ...member, stamina: Math.min(member.maxStamina, member.stamina + 1) };
  });
}
