import {KO_FALLBACK_FRACTION} from "./rivalHealth";
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
/**
 * desktop-items-quantity-1 (HolobotsUnity DECISIONS #72.32; mirrors market-quantity-host-1 / Mobile #175 for the
 * healing items): an optional `quantity` on a desktop-items-2 `buy` buys 1-99 of ONE healing item as ONE purchase.
 * Holos spent = unit price x quantity, in the same update that raises the stock by quantity. A healing stock may not
 * pass HEALING_STACK_CAP after a quantity buy (over_cap, checked before funds). Grants from other sources (genesis kit,
 * cache patch, rewards, Workshop craft) and the legacy one-per-buy request stay uncapped, as today.
 */
export const HEALING_QUANTITY_MIN = 1;
export const HEALING_QUANTITY_MAX = 99;
/** The most of one healing item a pilot may hold after a quantity buy (the marketplace-item-purchase-1 cap). */
export const HEALING_STACK_CAP = 999;
/** Strict reads (stored balance / stock never coerced); refusals throw before any write, in the order over_cap, not_enough_holos. */
export function healingQuantityPurchase(profile:Record<string,unknown>,id:string,quantity:number){
 const item=healingItem(id);if(!item)throw new RepairError("unknown_item");
 if(!Number.isInteger(quantity)||quantity<HEALING_QUANTITY_MIN||quantity>HEALING_QUANTITY_MAX)throw new RepairError("invalid_request");
 const balance=profile.holosTokens??0;
 if(typeof balance!=="number"||!Number.isFinite(balance)||balance<0)throw new RepairError("unavailable");
 const owned=healingStock(profile,id);
 if(owned+quantity>HEALING_STACK_CAP)throw new RepairError("over_cap",{cap:HEALING_STACK_CAP,owned,maxQuantity:Math.max(0,HEALING_STACK_CAP-owned)});
 const price=item.price*quantity;
 if(balance<price)throw new RepairError("not_enough_holos",{price,holosTokens:balance,shortfall:price-balance});
 return {updates:{...healingDelta(profile,id,quantity),holosTokens:balance-price},unitPrice:item.price,price,owned:owned+quantity};
}
export function healingPurchase(profile:Record<string,unknown>,id:string){
 const item=healingItem(id);if(!item)throw new RepairError("unknown_item");const balance=profile.holosTokens??0;
 if(typeof balance!=="number"||!Number.isFinite(balance)||balance<0)throw new RepairError("unavailable");
 if(balance<item.price)throw new RepairError("not_enough_holos");return {...healingDelta(profile,id,1),holosTokens:balance-item.price};
}
/** `extra` (quantity path only) adds host numbers to the callable error's details next to rejectionCode. */
export class RepairError extends Error { constructor(public code:string,public readonly extra?:Readonly<Record<string,number>>){super(code);} }
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
export function repairUse(profile:Record<string,unknown>,botId:string|undefined,itemId:string=REPAIR_ITEM){
 if(!botId)throw new RepairError("choose_holobot");
 const squad=profile.travelSquad as {holobotIds?:unknown[]}|undefined;
 if(!squad?.holobotIds?.includes(botId))throw new RepairError("not_in_squad");
 const item=healingItem(itemId);if(!item)throw new RepairError("unknown_item");
 if(healingStock(profile,itemId)<1)throw new RepairError("no_item");
 // Existing practice health is session-local. Missing server health fails closed; never infer a wounded bot.
 const ledger=profile.holobotVitals as Record<string,{currentHealth:number;maxHealth:number}>|undefined;
 const v=ledger?.[botId];
 if(!v||!Number.isFinite(v.currentHealth)||!Number.isFinite(v.maxHealth)||v.maxHealth<=0||v.currentHealth<0||v.currentHealth>v.maxHealth)throw new RepairError("health_unavailable");
 if(v.currentHealth>=v.maxHealth)throw new RepairError("already_full");
 // DECISIONS #72.1 "floor + item": a bot below the KO fallback (HP 0, or under 40 %) heals FROM the fallback, so a heal
 // never leaves it lower than not healing would (the unhealed bot enters its next rival duel at the fallback).
 // Shared by the city item use and duel_repair (desktopItemsHost); Workshop heals to full and does not come here.
 const start=Math.max(v.currentHealth,v.maxHealth*KO_FALLBACK_FRACTION);
 // The client prints this value verbatim ({hp}/{max}); strip binary-float noise from the floor sum (192*.4+48 is
 // 124.80000000000001) without changing the amount.
 const health=Math.min(v.maxHealth,Math.round((start+v.maxHealth*item.fraction)*1e6)/1e6);
 return {updates:{...healingDelta(profile,itemId,-1),holobotVitals:{...ledger,[botId]:{...v,currentHealth:health}}},result:{kind:"repair",itemId,holobotId:botId,currentHealth:health,maxHealth:v.maxHealth}};
}
