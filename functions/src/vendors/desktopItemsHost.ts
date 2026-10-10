import {readOpenBattles} from "../lib/rivalLadder";
import {REPAIR_ITEM,RepairError} from "../lib/repairItems";
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
  if(c.operation==="use"&&c.itemId===REPAIR_ITEM){const open=await tx.get(firestore.doc(`rivalBattles/${uid}`));if(Object.keys(readOpenBattles(open.data(),now)).length)throw new ItemError("between_battles_only");}
  let i=0;const r=applyItemCommand(user.data()!,favorite,c,now,()=>draws[i++%draws.length]);
  if(Object.keys(r.updates).length)tx.update(userRef,r.updates);
  tx.set(stateRef,{schemaVersion:"desktop-items-2",favoriteId:r.favoriteId},{merge:true});
  tx.create(receiptRef!,{identity,reply:r.reply,createdAtMs:now});return r.reply;
 });
}
export const desktopItemsHost=onCall(async request=>{
 if(!request.auth)throw new HttpsError("unauthenticated","Sign in to use items.");
 try{return await transactDesktopItems(db,request.auth.uid,request.data);}
 catch(e){if(e instanceof ItemError||e instanceof RepairError)throw new HttpsError("failed-precondition",e.code,{rejectionCode:e.code});throw e;}
});
