/** Server-owned repair stock and health. No client-supplied amount/health is accepted. */
export const REPAIR_FIELD = "emergencyPatches";
export const REPAIR_ITEM = "item.emergency_patch";
export const REPAIR_FRACTION = 0.25; // DECISIONS #57: 25 percent.
export const HEALING_ITEMS = [
 {id:REPAIR_ITEM,name:"Emergency Patch",fraction:0.25,price:100,stockKey:"emergency_patch"},
 {id:"item.repair_kit",name:"Repair Kit",fraction:0.5,price:250,stockKey:"repair_kit"},
 {id:"item.full_restore",name:"Full Restore",fraction:1,price:600,stockKey:"full_restore"},
] as const;
export function healingItem(id:string){return HEALING_ITEMS.find(i=>i.id===id);}
export function healingStock(profile:Record<string,unknown>,id:string):number{
 if(id===REPAIR_ITEM)return repairStock(profile);
 const item=healingItem(id);if(!item)throw new RepairError("unknown_item");
 const stocks=profile.itemStocks;if(stocks!==undefined&&(!stocks||typeof stocks!=="object"||Array.isArray(stocks)))throw new RepairError("unavailable");
 const n=(stocks as Record<string,unknown>|undefined)?.[item.stockKey]??0;
 if(typeof n!=="number"||!Number.isSafeInteger(n)||n<0)throw new RepairError("unavailable");return n;
}
export function healingDelta(profile:Record<string,unknown>,id:string,delta:number):Record<string,unknown>{
 const item=healingItem(id);if(!item)throw new RepairError("unknown_item");const n=healingStock(profile,id)+delta;
 if(!Number.isSafeInteger(delta)||!Number.isSafeInteger(n)||n<0)throw new RepairError("no_item");
 return id===REPAIR_ITEM?{[REPAIR_FIELD]:n}:{itemStocks:{...(profile.itemStocks as Record<string,unknown>??{}),[item.stockKey]:n}};
}
export function healingPurchase(profile:Record<string,unknown>,id:string){
 const item=healingItem(id);if(!item)throw new RepairError("unknown_item");const balance=profile.holosTokens??0;
 if(typeof balance!=="number"||!Number.isFinite(balance)||balance<0)throw new RepairError("unavailable");
 if(balance<item.price)throw new RepairError("not_enough_holos");return {...healingDelta(profile,id,1),holosTokens:balance-item.price};
}
export class RepairError extends Error { constructor(public code:string){super(code);} }
export function repairStock(profile:Record<string,unknown>):number {
 const n=profile[REPAIR_FIELD]??0;
 if(typeof n!=="number"||!Number.isSafeInteger(n)||n<0)throw new RepairError("unavailable");
 return n;
}
export function repairGrant(profile:Record<string,unknown>,amount=1):Record<string,unknown>{
 const next=repairStock(profile)+amount;
 if(!Number.isSafeInteger(amount)||amount<0||!Number.isSafeInteger(next))throw new RepairError("unavailable");
 return {[REPAIR_FIELD]:next};
}
export function repairUse(profile:Record<string,unknown>,botId:string|undefined){
 if(!botId)throw new RepairError("choose_holobot");
 const squad=profile.travelSquad as {holobotIds?:unknown[]}|undefined;
 if(!squad?.holobotIds?.includes(botId))throw new RepairError("not_in_squad");
 if(repairStock(profile)<1)throw new RepairError("no_item");
 // Existing practice health is session-local. Missing server health fails closed; never infer a wounded bot.
 const ledger=profile.holobotVitals as Record<string,{currentHealth:number;maxHealth:number}>|undefined;
 const v=ledger?.[botId];
 if(!v||!Number.isFinite(v.currentHealth)||!Number.isFinite(v.maxHealth)||v.maxHealth<=0||v.currentHealth<0||v.currentHealth>v.maxHealth)throw new RepairError("health_unavailable");
 if(v.currentHealth>=v.maxHealth)throw new RepairError("already_full");
 const health=Math.min(v.maxHealth,v.currentHealth+v.maxHealth*REPAIR_FRACTION);
 return {updates:{[REPAIR_FIELD]:repairStock(profile)-1,holobotVitals:{...ledger,[botId]:{...v,currentHealth:health}}},result:{kind:"repair",itemId:REPAIR_ITEM,holobotId:botId,currentHealth:health,maxHealth:v.maxHealth}};
}
