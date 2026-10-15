import { DUEL_PREVIEW_SCHEMA, type DuelAction, type DuelRound, type DuelState } from '../lib/bots/duelPlayback';

/** Synthetic recorded presentation fixture. This is NOT a rivalBattleHost reply.
 * All outcomes and resource snapshots are authored here; the viewer only plays them.
 * Costs match catalog quickJab/tempoThrust/guardUp/tacticalOverride (7 stamina maximum).
 */
const initialState: DuelState = {
  player: { hp: 40, maxHp: 40, stamina: 7, maxStamina: 7 },
  rival: { hp: 30, maxHp: 30, stamina: 7, maxStamina: 7 },
};
const afterStrike: DuelState = {
  player: { hp: 40, maxHp: 40, stamina: 6, maxStamina: 7 },
  rival: { hp: 21, maxHp: 30, stamina: 7, maxStamina: 7 },
};
const afterEvade: DuelState = {
  player: { hp: 40, maxHp: 40, stamina: 6, maxStamina: 7 },
  rival: { hp: 21, maxHp: 30, stamina: 5, maxStamina: 7 },
};
const finalState: DuelState = {
  player: { hp: 40, maxHp: 40, stamina: 2, maxStamina: 7 },
  rival: { hp: 0, maxHp: 30, stamina: 5, maxStamina: 7 },
};
const rounds: DuelRound[] = [
  { roundNumber: 1, attacker: 'player', action: 'Strike', attackClip: 'Skybreaker', outcome: 'hit', evaded: false, damage: 9, label: 'Skybreaker · 9 DMG', before: initialState, after: afterStrike },
  { roundNumber: 2, attacker: 'rival', action: 'Heavy', attackClip: 'LowRoundhouse', outcome: 'evade', evaded: true, damage: 0, label: 'Low Roundhouse · EVADE', before: afterStrike, after: afterEvade },
  { roundNumber: 3, attacker: 'player', action: 'Finisher', attackClip: 'MeteorHammer', outcome: 'hit', evaded: false, damage: 21, label: 'Meteor Hammer · 21 DMG', before: afterEvade, after: finalState },
];
export const DUEL_PREVIEW_RECEIPT = {
  schemaVersion: DUEL_PREVIEW_SCHEMA,
  synthetic: true,
  battleId: 'synthetic-ace-wolf-three-rounds',
  sourceLabel: 'SYNTHETIC RECEIPT · NO REWARDS',
  combatants: { player: { holobotId: 'ACE' }, rival: { holobotId: 'WOLF' } },
  commandCosts: { Strike: 1, Heavy: 2, Defend: 2, Finisher: 4 } satisfies Record<DuelAction, number>,
  initialState,
  roundCount: 3,
  rounds,
  settlement: { didWin: true },
};
