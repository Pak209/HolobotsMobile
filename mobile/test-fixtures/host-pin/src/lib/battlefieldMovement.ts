import { getPlayerBattleStats } from './progressionEconomy';
import { normalizeUserHolobot, HOLOBOT_BASE_STATS } from './progression';
import { rivalTierBattleStats } from './rivalTierStats';
import { MOVEMENT_SPEEDS, MOVEMENT_PREFERRED_RANGE } from '../sim/movement';

export const BATTLEFIELD_MOVEMENT_SCHEMA = 'battlefield-movement-1' as const;
export type MovementSource = 'player' | 'rival';
export type FleetId = keyof typeof MOVEMENT_SPEEDS;
export const FLEET_IDS = Object.keys(MOVEMENT_SPEEDS) as FleetId[];
export function fleetId(value: string): FleetId {
  const id = value.trim().toLowerCase();
  if (!Object.hasOwn(MOVEMENT_SPEEDS, id)) throw new Error('unknown_movement_holobot');
  return id as FleetId;
}
export function movementReference(id: FleetId, source: MovementSource) {
  const ownStatsExist = Object.hasOwn(HOLOBOT_BASE_STATS, id.toUpperCase());
  return {
    referenceSpeedStat: source === 'rival' ? rivalTierBattleStats(0).speed : getPlayerBattleStats(normalizeUserHolobot({name:id.toUpperCase(),level:1})).speed,
    referenceSourceHolobotId: source === 'rival' ? 'wolf' : ownStatsExist ? id : 'ace',
    provisional: !ownStatsExist,
  };
}
/** Host-only calibration. Unity copies runMmPerSecond; it must not repeat this formula. */
export function battlefieldMovement(holobotId: string, sourceSpeedStat: number, source: MovementSource) {
  const id = fleetId(holobotId);
  if (!Number.isSafeInteger(sourceSpeedStat) || sourceSpeedStat < 0 || Object.is(sourceSpeedStat,-0)) throw new Error('invalid_movement_speed');
  if (source !== 'player' && source !== 'rival') throw new Error('invalid_movement_source');
  const reference = movementReference(id, source);
  const scaled = Number(BigInt(MOVEMENT_SPEEDS[id]) * BigInt(sourceSpeedStat) / BigInt(reference.referenceSpeedStat));
  const runMmPerSecond = Math.max(1600, Math.min(3200, scaled));
  return {holobotId:id,source,sourceSpeedStat,...reference,baseRunMmPerSecond:MOVEMENT_SPEEDS[id],runMmPerSecond,
    runMetersPerSecond:runMmPerSecond/1000,preferredRangeMm:MOVEMENT_PREFERRED_RANGE[id]};
}
export function battlefieldMovementCatalog() {
  return {schemaVersion:BATTLEFIELD_MOVEMENT_SCHEMA,minRunMmPerSecond:1600,maxRunMmPerSecond:3200,
    fleet:FLEET_IDS.map(id=>({holobotId:id,baseRunMmPerSecond:MOVEMENT_SPEEDS[id],preferredRangeMm:MOVEMENT_PREFERRED_RANGE[id],
      playerReference:movementReference(id,'player'),rivalReference:movementReference(id,'rival')}))};
}
/** Call after citizen/Zell lineup bindings. Publication only; does not affect resolution/settlement. */
export function battlefieldIssueMovement(reply: {schemaVersion:string;encounter:{opponentSquad:{holobotId:string;speed?:number}[]};playerCombatants:{holobotId:string;speed:number}[]}) {
  return {schemaVersion:BATTLEFIELD_MOVEMENT_SCHEMA,
    player:reply.playerCombatants.map(c=>battlefieldMovement(c.holobotId,c.speed,'player')),
    opponent:reply.encounter.opponentSquad.map(c=>battlefieldMovement(c.holobotId,c.speed!,'rival'))};
}
