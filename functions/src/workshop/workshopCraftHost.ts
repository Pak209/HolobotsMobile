import {Firestore} from 'firebase-admin/firestore';
import {HttpsError,onCall} from 'firebase-functions/v2/https';
import {db} from '../admin';
import {healingDelta,RepairError} from '../lib/repairItems';
import {HEALING_RECIPES} from "../lib/healingRecipes";
export {HEALING_RECIPES} from "../lib/healingRecipes";
export async function transactWorkshopCraft(firestore:Firestore,uid:string,raw:unknown,now=Date.now()){
 const c=raw as Record<string,unknown>;
 if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['schemaVersion','operation','itemId','requestId'].includes(k))||c.schemaVersion!=='healing-workshop-1'||c.operation!=='craft'||typeof c.itemId!=='string'||!Object.hasOwn(HEALING_RECIPES,c.itemId)||typeof c.requestId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(c.requestId))throw new RepairError('invalid_request');
 const itemId=c.itemId as keyof typeof HEALING_RECIPES;const recipe=HEALING_RECIPES[itemId];
 const userRef=firestore.doc(`users/${uid}`),receiptRef=firestore.doc(`workshopCrafts/${uid}/receipts/${c.requestId}`);
 return firestore.runTransaction(async tx=>{
  const user=await tx.get(userRef),receipt=await tx.get(receiptRef);
  if(!user.exists)throw new RepairError('unavailable');
  if(receipt.exists){if(receipt.data()!.itemId!==itemId)throw new RepairError('sequence_conflict');return {...receipt.data()!.reply,alreadyProcessed:true};}
  const profile=user.data()!;const stocks=profile.itemStocks;
  if(stocks!==undefined&&(!stocks||typeof stocks!=='object'||Array.isArray(stocks)))throw new RepairError('unavailable');
  const fragments=stocks?.blueprint_fragment??0;
  if(typeof fragments!=='number'||!Number.isSafeInteger(fragments)||fragments<0)throw new RepairError('unavailable');
  if(fragments<recipe.fragments)throw new RepairError('not_enough_fragments');
  const lower=healingDelta(profile,recipe.lower,-1);
  const increment=healingDelta({...profile,...lower},itemId,1);
  const updates={...lower,...increment,itemStocks:{...stocks,...lower.itemStocks as object,...increment.itemStocks as object,blueprint_fragment:fragments-recipe.fragments}};
  const reply={schemaVersion:'healing-workshop-1',operation:'craft',itemId,quantity:1,fragmentsSpent:recipe.fragments,lowerItemSpent:recipe.lower,alreadyProcessed:false};
  tx.update(userRef,updates);tx.create(receiptRef,{itemId,reply,createdAtMs:now});return reply;
 });
}
export const workshopCraftHost=onCall(async request=>{
 if(!request.auth)throw new HttpsError('unauthenticated','Sign in to craft.');
 try{return await transactWorkshopCraft(db,request.auth.uid,request.data);}
 catch(e){if(e instanceof RepairError)throw new HttpsError('failed-precondition',e.code,{rejectionCode:e.code});throw e;}
});
