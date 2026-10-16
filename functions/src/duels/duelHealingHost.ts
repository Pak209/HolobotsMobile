import { expeditionOpen } from '../lib/arenaActivity';
import {randomUUID} from 'node:crypto';
import {Firestore} from 'firebase-admin/firestore';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {readTravelSquad} from '../acquisition/captureOwnership';
import {arenaOpen,duelOpen} from '../lib/healingGuards';
import {RepairError} from '../lib/repairItems';
import {healthRows,Vitals} from '../lib/rivalHealth';
import {readOpenBattles} from '../lib/rivalLadder';
import {readHoloZoneRuns} from '../lib/holoZoneRuns';
export const DUEL_SWITCH_LOCKOUT_MS=3000;
/** Local-duel accounting only. No multiplayer sim/principal/anti-cheat authority is added. */
export async function transactDuelHealing(firestore:Firestore,uid:string,raw:unknown,now=Date.now()){
 const c=raw as Record<string,unknown>;
 if(!c||typeof c!=='object'||c.schemaVersion!=='duel-healing-1'||!['issue','deploy','observe','settle'].includes(String(c.operation))||Object.keys(c).some(k=>!['schemaVersion','operation','runId','fielded','health'].includes(k)))throw new RepairError('invalid_request');
 const freshId=randomUUID(),userRef=firestore.doc(`users/${uid}`),ref=firestore.doc(`duelHealingRuns/${uid}`);
 return firestore.runTransaction(async tx=>{
  const user=await tx.get(userRef),stored=await tx.get(ref),arena=await tx.get(firestore.doc(`arenaMatches/${uid}`));
  if(!user.exists)throw new RepairError('unavailable');const profile=user.data()!;const r=stored.data();
  if(arenaOpen(arena.data()))throw new RepairError('arena_no_heal');
  const deployment=(squad:string[])=>{if(!Array.isArray(c.fielded)||c.fielded.length<1||c.fielded.length>3||new Set(c.fielded).size!==c.fielded.length||c.fielded.some(id=>typeof id!=='string'||!squad.includes(id)))throw new RepairError('invalid_request');return c.fielded as string[];};
  if(c.operation==='issue'){
   if(c.runId!==undefined||c.health!==undefined)throw new RepairError('invalid_request');
   if(duelOpen(r))throw new RepairError('battle_open');
   const rival=await tx.get(firestore.doc(`rivalBattles/${uid}`)),zone=await tx.get(firestore.doc(`holoZoneRuns/${uid}`));
   if(expeditionOpen(zone.data())||Object.keys(readOpenBattles(rival.data(),now)).length||readHoloZoneRuns(zone.data()).some(x=>x.settlement===null&&x.closedAtMs===null&&now<=x.expiresAtMs))throw new RepairError('battle_open');
   const squad=readTravelSquad(profile).holobotIds,fielded=deployment(squad),vitals:Vitals={};
   for(const id of squad){const v=profile.holobotVitals?.[id];if(!v||!Number.isFinite(v.currentHealth)||!Number.isFinite(v.maxHealth)||v.maxHealth<=0||v.currentHealth<0||v.currentHealth>v.maxHealth)throw new RepairError('health_unavailable');if(fielded.includes(id)&&v.currentHealth===0)throw new RepairError("holobot_ko");vitals[id]={...v};}
   const record={schemaVersion:'duel-healing-1',runId:freshId,open:true,squad,fielded,vitals,heals:[],switchLockedUntilMs:0,issuedAtMs:now};tx.set(ref,record);return record;
  }
  if(!r||c.runId!==r.runId)throw new RepairError('unknown_run');
  if(c.operation==='settle'&&r.open===false)return {...r.settlement,alreadyProcessed:true};
  if(!duelOpen(r))throw new RepairError('run_closed');
  if(c.operation==='deploy'){
   if(c.health!==undefined)throw new RepairError('invalid_request');if(now<r.switchLockedUntilMs)throw new RepairError('switch_lockout');
   const fielded=deployment(r.squad);if(fielded.some(id=>r.vitals[id].currentHealth===0))throw new RepairError("holobot_ko");
   const next={...r,fielded,switchLockedUntilMs:now+DUEL_SWITCH_LOCKOUT_MS};tx.set(ref,next);return next;
  }
  if(c.fielded!==undefined)throw new RepairError('invalid_request');const rows=healthRows(c.health);if(!rows)throw new RepairError('invalid_request');
  if(c.operation==='settle'&&(rows.length!==r.squad.length||r.squad.some((id:string)=>!rows.some(row=>row.holobotId===id))))throw new RepairError('invalid_request');
  const vitals={...r.vitals} as Vitals;
  for(const row of rows){const v=vitals[row.holobotId];if(!r.squad.includes(row.holobotId)||!Object.hasOwn(vitals,row.holobotId)||!v||row.currentHealth>v.currentHealth)throw new RepairError('invalid_request');vitals[row.holobotId]={...v,currentHealth:row.currentHealth};}
  if(c.operation==='observe'){tx.set(ref,{...r,vitals});return {schemaVersion:'duel-healing-1',runId:r.runId,vitals};}
  const ledger={...profile.holobotVitals};for(const id of r.squad){const issued=vitals[id],current=ledger[id];if(!current||current.maxHealth!==issued.maxHealth)throw new RepairError('health_unavailable');ledger[id]={...issued};}
  const settlement={schemaVersion:'duel-healing-1',runId:r.runId,vitals,heals:r.heals,settledAtMs:now,alreadyProcessed:false};
  tx.update(userRef,{holobotVitals:ledger});tx.set(ref,{...r,vitals,open:false,settlement});return settlement;
 });
}
export const duelHealingHost=onCall(async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','Sign in.');
 try{return await transactDuelHealing(db,request.auth.uid,request.data);}
 catch(e){throw new HttpsError('failed-precondition',(e as Error).message,{rejectionCode:(e as RepairError).code??(e as Error).message});}
});
