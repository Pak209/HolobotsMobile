import { expeditionOpen } from '../lib/arenaActivity';
import {Firestore} from 'firebase-admin/firestore';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {readTravelSquad} from '../acquisition/captureOwnership';
import {arenaOpen,duelOpen} from '../lib/healingGuards';
import {RepairError} from '../lib/repairItems';
import {requireLivingVitals} from '../lib/rivalHealth';
import {commitVitals,waitWords} from '../lib/autoHeal';
import {readOpenBattles,buildPlayerCombatants} from '../lib/rivalLadder';
import {readHoloZoneRuns} from '../lib/holoZoneRuns';
import {onboardingAfterEvent} from '../lib/onboarding';
/**
 * workshop-daily-1 (Pak 2026-11-12): the free full-squad heal is once per UTC day per account. The day it was used lives in
 * the server-only doc workshopHeals/{uid} (no client rule: firestore.rules' default deny; deleteUserData already removes
 * workshopHeals/{uid} recursively). A second heal the same day is refused `workshop_daily_used` with nextFreeAtMs /
 * nextFreeInMs (the next UTC midnight) and a game-voice `message`. Receipt replays stay free and unchanged.
 */
export const WORKSHOP_DAILY_SCHEMA='workshop-heal-daily-1';
const DAY_MS=86_400_000;
export const workshopUtcDay=(ms:number)=>new Date(ms).toISOString().slice(0,10);
export const workshopNextFreeAtMs=(ms:number)=>Math.floor(ms/DAY_MS)*DAY_MS+DAY_MS;
export function workshopDailyRefusal(now:number){
 const nextFreeAtMs=workshopNextFreeAtMs(now),nextFreeInMs=nextFreeAtMs-now;
 return {nextFreeAtMs,nextFreeInMs,message:`The workshop crew already patched your squad today. Next free repair in ${waitWords(nextFreeInMs)}.`};
}
export class WorkshopDailyError extends RepairError{constructor(public readonly detail:Record<string,unknown>){super('workshop_daily_used');}}
export async function transactWorkshopHeal(firestore:Firestore,uid:string,raw:unknown,now=Date.now()){
 const c=raw as Record<string,unknown>;
 if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['schemaVersion','operation','requestId'].includes(k))||c.schemaVersion!=='healing-workshop-1'||c.operation!=='heal'||typeof c.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(c.requestId))throw new RepairError('invalid_request');
 const userRef=firestore.doc(`users/${uid}`),dailyRef=firestore.doc(`workshopHeals/${uid}`),receiptRef=firestore.doc(`workshopHeals/${uid}/receipts/${c.requestId}`);
 return firestore.runTransaction(async tx=>{
  const user=await tx.get(userRef),receipt=await tx.get(receiptRef);
  if(!user.exists)throw new RepairError('unavailable');if(receipt.exists)return {...receipt.data()!.reply,alreadyProcessed:true};
  const arena=await tx.get(firestore.doc(`arenaMatches/${uid}`)),duel=await tx.get(firestore.doc(`duelHealingRuns/${uid}`)),rival=await tx.get(firestore.doc(`rivalBattles/${uid}`)),zone=await tx.get(firestore.doc(`holoZoneRuns/${uid}`)),daily=await tx.get(dailyRef);
  if(arenaOpen(arena.data()))throw new RepairError('arena_no_heal');
  if(expeditionOpen(zone.data())||duelOpen(duel.data())||Object.keys(readOpenBattles(rival.data(),now)).length||readHoloZoneRuns(zone.data()).some(r=>r.settlement===null&&r.closedAtMs===null&&now<=r.expiresAtMs))throw new RepairError('battle_open');
  const profile=user.data()!;requireLivingVitals(profile,[],now);const squad=readTravelSquad(profile).holobotIds;if(!squad.length)throw new RepairError('no_squad');
  const combatants=buildPlayerCombatants(profile,squad);if(combatants.length!==squad.length)throw new RepairError('health_unavailable');
  const vitals={...profile.holobotVitals};for(const bot of combatants){if(!Number.isFinite(bot.maxHealth)||bot.maxHealth<=0)throw new RepairError('health_unavailable');vitals[bot.holobotId]={currentHealth:bot.maxHealth,maxHealth:bot.maxHealth};}
  // workshop-daily-1: checked last, so a heal refused for any other reason never spends the day.
  if(daily.data()?.day===workshopUtcDay(now))throw new WorkshopDailyError(workshopDailyRefusal(now));
  const nextFreeAtMs=workshopNextFreeAtMs(now);
  const reply={schemaVersion:'healing-workshop-1',operation:'heal',holobotIds:squad,vitals:Object.fromEntries(squad.map(id=>[id,vitals[id]])),cost:0,alreadyProcessed:false,nextFreeAtMs,nextFreeInMs:nextFreeAtMs-now};
  // onboarding-host-1 (#72.3–#72.5): the first workshop heal completes the repair beat.
  tx.update(userRef,{holobotVitals:commitVitals(profile.holobotVitals,vitals,now),...onboardingAfterEvent(profile,'repair',now)});tx.set(dailyRef,{schemaVersion:WORKSHOP_DAILY_SCHEMA,day:workshopUtcDay(now),usedAtMs:now,requestId:c.requestId});tx.create(receiptRef,{reply,createdAtMs:now});return reply;
 });
}
export const workshopHealHost=onCall(async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','Sign in to heal.');
 if(request.auth.token?.holoServer===true)throw new HttpsError('permission-denied','server_not_allowed');
 try{return await transactWorkshopHeal(db,request.auth.uid,request.data);}
 catch(e){const reason=(e as {code?:string}).code??(e as Error).message;throw new HttpsError('failed-precondition',reason,{...(e instanceof WorkshopDailyError?e.detail:{}),rejectionCode:reason});}
});
