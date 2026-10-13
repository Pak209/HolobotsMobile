import {RepairError} from './repairItems';
/** Absence = no host-recorded arena. Any malformed existing record fails closed. */
export function arenaOpen(raw:unknown):boolean{
 if(raw===undefined)return false;const r=raw as Record<string,unknown>;
 if(!r||r.schemaVersion!=='arena-healing-1'||typeof r.matchId!=='string'||typeof r.open!=='boolean')throw new RepairError('unavailable');return r.open;
}
export function duelOpen(raw:unknown):boolean{
 if(raw===undefined)return false;const r=raw as Record<string,unknown>;
 if(!r||r.schemaVersion!=='duel-healing-1'||typeof r.runId!=='string'||typeof r.open!=='boolean')throw new RepairError('unavailable');return r.open;
}
