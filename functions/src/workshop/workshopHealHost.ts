import {Firestore} from 'firebase-admin/firestore';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {readTravelSquad} from '../acquisition/captureOwnership';
import {arenaOpen,duelOpen} from '../lib/healingGuards';
import {RepairError} from '../lib/repairItems';
import {requireLivingVitals} from '../lib/rivalHealth';
import {readOpenBattles,buildPlayerCombatants} from '../lib/rivalLadder';
import {readHoloZoneRuns} from '../lib/holoZoneRuns';
export async function transactWorkshopHeal(firestore:Firestore,uid:string,raw:unknown,now=Date.now()){
 const c=raw as Record<string,unknown>;
 if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['schemaVersion','operation','requestId'].includes(k))||c.schemaVersion!=='healing-workshop-1'||c.operation!=='heal'||typeof c.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(c.requestId))throw new RepairError('invalid_request');
 const userRef=firestore.doc(`users/${uid}`),receiptRef=firestore.doc(`workshopHeals/${uid}/receipts/${c.requestId}`);
 return firestore.runTransaction(async tx=>{
  const user=await tx.get(userRef),receipt=await tx.get(receiptRef);
  if(!user.exists)throw new RepairError('unavailable');if(receipt.exists)return {...receipt.data()!.reply,alreadyProcessed:true};
  const arena=await tx.get(firestore.doc(`arenaMatches/${uid}`)),duel=await tx.get(firestore.doc(`duelHealingRuns/${uid}`)),rival=await tx.get(firestore.doc(`rivalBattles/${uid}`)),zone=await tx.get(firestore.doc(`holoZoneRuns/${uid}`));
  if(arenaOpen(arena.data()))throw new RepairError('arena_no_heal');
  if(duelOpen(duel.data())||Object.keys(readOpenBattles(rival.data(),now)).length||readHoloZoneRuns(zone.data()).some(r=>r.settlement===null&&r.closedAtMs===null&&now<=r.expiresAtMs))throw new RepairError('battle_open');
  const profile=user.data()!;requireLivingVitals(profile,[]);const squad=readTravelSquad(profile).holobotIds;if(!squad.length)throw new RepairError('no_squad');
  const combatants=buildPlayerCombatants(profile,squad);if(combatants.length!==squad.length)throw new RepairError('health_unavailable');
  const vitals={...profile.holobotVitals};for(const bot of combatants){if(!Number.isFinite(bot.maxHealth)||bot.maxHealth<=0)throw new RepairError('health_unavailable');vitals[bot.holobotId]={currentHealth:bot.maxHealth,maxHealth:bot.maxHealth};}
  const reply={schemaVersion:'healing-workshop-1',operation:'heal',holobotIds:squad,vitals:Object.fromEntries(squad.map(id=>[id,vitals[id]])),cost:0,alreadyProcessed:false};
  tx.update(userRef,{holobotVitals:vitals});tx.create(receiptRef,{reply,createdAtMs:now});return reply;
 });
}
export const workshopHealHost=onCall(async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','Sign in to heal.');
 if(request.auth.token?.holoServer===true)throw new HttpsError('permission-denied','server_not_allowed');
 try{return await transactWorkshopHeal(db,request.auth.uid,request.data);}
 catch(e){const reason=(e as {code?:string}).code??(e as Error).message;throw new HttpsError('failed-precondition',reason,{rejectionCode:reason});}
});
