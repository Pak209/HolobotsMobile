import { expeditionOpen } from '../lib/arenaActivity';
import {ActivityError,arenaOpen,duelOpen} from "../lib/arenaActivity";
import {DUEL_SWITCH_LOCKOUT_MS} from "../duels/duelHealingHost";
import {readHoloZoneRuns,HoloZoneError} from "../lib/holoZoneRuns";
import {readOpenBattles} from "../lib/rivalLadder";
import {REPAIR_ITEM,RepairError,healingItem,repairUse} from "../lib/repairItems";
import {randomInt} from "node:crypto";
import {Firestore} from "firebase-admin/firestore";
import {HttpsError,onCall} from "firebase-functions/v2/https";
import {db} from "../admin";
import {applyItemCommand,itemSnapshot,validateItemCommand,ItemError} from "../lib/desktopItems";
export async function transactDesktopItems(firestore:Firestore,uid:string,raw:unknown,now=Date.now()){
 const c=validateItemCommand(raw);const draws=Array.from({length:100},()=>randomInt(0,0x100000000)/0x100000000);
 const userRef=firestore.doc(`users/${uid}`),stateRef=firestore.doc(`itemInventories/${uid}`);
 const receiptRef=c.operation==="read"?null:stateRef.collection("receipts").doc(c.requestId!);
 const identity=JSON.stringify(c);
 return firestore.runTransaction(async tx=>{
  const user=await tx.get(userRef),state=await tx.get(stateRef),receipt=receiptRef?await tx.get(receiptRef):null;
  if(!user.exists)throw new ItemError("unavailable");
  if(receipt?.exists){const saved=receipt.data()!;if(saved.identity!==identity)throw new ItemError("sequence_conflict");return {...saved.reply,alreadyProcessed:true};}
  const favorite=typeof state.data()?.favoriteId==="string"?state.data()!.favoriteId:null;
  if(c.operation==="read")return itemSnapshot(user.data()!,favorite,now);
  if(c.operation==='buy'&&healingItem(c.itemId!)){const zoneLease=await tx.get(firestore.doc(`holoZoneRuns/${uid}`));if(expeditionOpen(zoneLease.data()))throw new ItemError('between_battles_only');}
  let useProfile=user.data()!;
  let duel:FirebaseFirestore.DocumentSnapshot|undefined,zone:FirebaseFirestore.DocumentSnapshot|undefined;
  if(c.operation==="use"&&healingItem(c.itemId!)){
   // #78: the Arena parent is read in the repair transaction, before any stock/HP/receipt write.
    // Receipt replays above are read-only and remain available while another activity owns the lease.
    const arena=await tx.get(firestore.doc(`arenaMatches/${uid}`));
    try{if(arenaOpen(arena.data()))throw new ItemError("arena_no_heal");}
    catch(e){if(e instanceof ActivityError)throw new ItemError("unavailable");throw e;}
   
   duel=await tx.get(firestore.doc(`duelHealingRuns/${uid}`));zone=await tx.get(firestore.doc(`holoZoneRuns/${uid}`));
   if(expeditionOpen(zone.data()))throw new ItemError('safe_room_required');
   const open=await tx.get(firestore.doc(`rivalBattles/${uid}`));if(Object.keys(readOpenBattles(open.data(),now)).length)throw new ItemError("between_battles_only");
   if(duelOpen(duel.data())){
    const d=duel.data()!;if(!c.holobotId||!d.squad.includes(c.holobotId))throw new ItemError("not_in_squad");if(d.fielded.includes(c.holobotId))throw new ItemError("bench_only");if(now<d.switchLockedUntilMs)throw new ItemError("switch_lockout");
    if(c.currentHealth!==undefined){const v=d.vitals[c.holobotId];if(!v||c.currentHealth>v.currentHealth)throw new ItemError("invalid_request");d.vitals={...d.vitals,[c.holobotId]:{...v,currentHealth:c.currentHealth}};}
    const repaired=repairUse({...user.data()!,travelSquad:{holobotIds:d.squad},holobotVitals:d.vitals},c.holobotId,c.itemId);
    const {holobotVitals,...stock}=repaired.updates;const vitals=holobotVitals as Record<string,unknown>;
    const event={requestId:c.requestId,itemId:c.itemId,holobotId:c.holobotId,before:d.vitals[c.holobotId].currentHealth,after:repaired.result.currentHealth,usedAtMs:now};
    tx.update(userRef,stock);tx.set(duel.ref,{...d,vitals,heals:[...d.heals,event],switchLockedUntilMs:now+DUEL_SWITCH_LOCKOUT_MS});
    const reply={...itemSnapshot({...user.data()!,...stock},favorite,now),result:{...repaired.result,kind:"duel_repair",runId:d.runId,switchLockedUntilMs:now+DUEL_SWITCH_LOCKOUT_MS}};
    tx.create(receiptRef!,{identity,reply,createdAtMs:now});return reply;
   }
  }
  if(c.currentHealth!==undefined && zone){
   const active=readHoloZoneRuns(zone.data()).find(x=>x.settlement===null&&x.closedAtMs===null&&now<=x.expiresAtMs);
   const v=active?.issuedVitals?.[c.holobotId!];const ledger=user.data()!.holobotVitals?.[c.holobotId!];
   if(!v||!ledger||c.currentHealth>v.currentHealth||c.currentHealth>ledger.currentHealth)throw new ItemError("invalid_request");
   useProfile={...useProfile,holobotVitals:{...useProfile.holobotVitals,[c.holobotId!]:{...ledger,currentHealth:c.currentHealth}}};
  }else if(c.currentHealth!==undefined)throw new ItemError("invalid_request");
  let i=0;const r=applyItemCommand(useProfile,favorite,c,now,()=>draws[i++%draws.length]);
  if(zone && r.updates.holobotVitals){
   const runs=readHoloZoneRuns(zone.data());const active=runs.filter(x=>x.settlement===null&&x.closedAtMs===null&&now<=x.expiresAtMs);
   if(active.some(x=>x.healthSchema!=="rival-health-1"||!x.issuedVitals||!x.squad.includes(c.holobotId!)))throw new ItemError("health_unavailable");
   if(active.length)tx.set(zone.ref,{...zone.data(),runs:runs.map(x=>active.includes(x)?{...x,issuedVitals:{...x.issuedVitals,[c.holobotId!]:(r.updates.holobotVitals as Record<string,unknown>)[c.holobotId!]},healingItems:[...(x as typeof x & {healingItems?:unknown[]}).healingItems??[],{requestId:c.requestId,itemId:c.itemId,holobotId:c.holobotId,usedAtMs:now}]}:x)});
  }
  if(Object.keys(r.updates).length)tx.update(userRef,r.updates);
  tx.set(stateRef,{schemaVersion:"desktop-items-2",favoriteId:r.favoriteId},{merge:true});
  tx.create(receiptRef!,{identity,reply:r.reply,createdAtMs:now});return r.reply;
 });
}
export const desktopItemsHost=onCall(async request=>{
 if(!request.auth)throw new HttpsError("unauthenticated","Sign in to use items.");
 try{return await transactDesktopItems(db,request.auth.uid,request.data);}
 catch(e){if(e instanceof ItemError||e instanceof RepairError||e instanceof HoloZoneError)throw new HttpsError("failed-precondition",e.code,{rejectionCode:e.code});throw e;}
});
