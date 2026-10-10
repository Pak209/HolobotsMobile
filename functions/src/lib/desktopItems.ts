import { buildCatalog, ITEM_INVENTORY_FIELD, buildBuddyUnitPurchase, validateBuddyPurchase } from "./vendors";
import { buildItemPurchaseUpdatesRaw, buildPackGrantUpdatesRaw, buildPackRewards, GACHA_PACKS, incrementBoosterPacksToday } from "./economy";
import { buildEnergyRefillUpdates, buildExpBoosterActivationRaw } from "./mintingEconomy";
import {repairStock,repairGrant,repairUse,RepairError,REPAIR_ITEM} from "./repairItems";
export const ITEMS_SCHEMA = "desktop-items-2";
export class ItemError extends Error { constructor(public code:string){super(code);} }
export type ItemCommand={schemaVersion:string;operation:"read"|"favorite"|"buy"|"use";itemId?:string;requestId?:string;packId?:string;holobotId?:string};
export function validateItemCommand(raw:unknown):ItemCommand {
 const c=raw as ItemCommand;
 if(!c||Object.keys(c).some(k=>!["schemaVersion","operation","itemId","requestId","packId","holobotId"].includes(k))||c.schemaVersion!==ITEMS_SCHEMA||!["read","favorite","buy","use"].includes(c.operation))throw new ItemError("invalid_request");
 if(c.operation!=="read"&&(typeof c.itemId!=="string"||c.itemId.length>80||typeof c.requestId!=="string"||!/^[a-zA-Z0-9_-]{1,128}$/.test(c.requestId)))throw new ItemError("invalid_request");
 if(c.packId!==undefined&&(typeof c.packId!=="string"||c.packId.length>60))throw new ItemError("invalid_request");
 if(c.holobotId!==undefined&&(typeof c.holobotId!=="string"||!/^([a-z]{2,12})$/.test(c.holobotId)))throw new ItemError("invalid_request");
 return {schemaVersion:ITEMS_SCHEMA,operation:c.operation,itemId:c.itemId,requestId:c.requestId,packId:c.packId,holobotId:c.holobotId};
}
function checked(profile:Record<string,unknown>){for(const key of [...Object.values(ITEM_INVENTORY_FIELD),"holosTokens","dailyEnergy","maxDailyEnergy","expBoosterActiveUntil"]){const v=profile[key];if(v!==undefined&&(typeof v!=="number"||!Number.isFinite(v)||v<0))throw new ItemError("unavailable");}}
export function itemSnapshot(profile:Record<string,unknown>,favoriteId:string|null,now:number){
 checked(profile);const catalog=buildCatalog(profile,"marketplace",now);
 const viewListings=[...catalog.listings];viewListings.push({listingId:"buddy.light",kind:"buddy_unit",displayName:"Light Buddy Unit",price:0,currency:"holos",quantity:1,owned:catalog.inventory.buddyUnits.light,affordable:false,available:false,availableAtMs:0,details:{tierId:"buddy_light"},purchase:{callable:"",request:{}}});
 const items=viewListings.filter(l=>l.kind==="item"||l.kind==="buddy_unit").map(l=>({...l,
 useMode:l.listingId==="item.energy_refill"?"energy":l.listingId==="item.exp_booster"?"boost":l.listingId==="item.gacha_ticket"?"cache":l.kind==="buddy_unit"?"capture":"context",
 canUse:l.owned>0&&(l.listingId==="item.energy_refill"?Number(profile.dailyEnergy||0)<Number(profile.maxDailyEnergy||100):l.listingId==="item.exp_booster"?Number(profile.expBoosterActiveUntil||0)<=now:l.listingId==="item.gacha_ticket"),
 description:l.listingId==="item.energy_refill"?"Refills account training energy. Does not heal a Holobot.":l.listingId==="item.exp_booster"?"Activates the host's arena experience boost.":l.listingId==="item.gacha_ticket"?"Open a Cache Check. The host rolls and grants the contents.":l.kind==="buddy_unit"?"Equip in the wild capture overlay.":"Used by its matching account activity."}));
 const concepts=[
 ["market_booster","Market Booster","A limited-use boost that improves rewards from eligible activities."],
 ["holo_pack","Holo Pack","A sealed reward pack containing Parts, materials, currency, or other useful items."],
 ["blueprint_fragment","Blueprint Fragment","Collect fragments to complete a Holobot Blueprint or unlock its next rank."],
 ["sync_shard","Sync Shard","Crystallized Sync energy for Holobot upgrades and advanced crafting."],
 ["holos_chip","HOLOS Chip","A physical HOLOS pickup used for purchases throughout HoloCity."],
 ["bond_catalyst","Bond Catalyst","Strengthens the Pilot–Holobot bond and accelerates Bond progression."],
 ["training_booster","Training Booster","Temporarily increases rewards earned from training activities."],
 ["power_module","Power Module","Improves offensive strength and Break damage."],
 ["guard_module","Guard Module","Improves defense and damage resistance."],
 ["speed_module","Speed Module","Improves movement, reaction speed, and recovery."],
 ["focus_module","Focus Module","Improves Special generation, accuracy, or ability efficiency."]];
 const stocks=profile.itemStocks as Record<string,unknown>|undefined;
 for(const [key,name,description] of concepts){const count=stocks?.[key]??0;if(typeof count!=="number"||!Number.isSafeInteger(count)||count<0)throw new ItemError("unavailable");items.push({listingId:"item."+key,kind:"item",displayName:name,price:0,currency:"holos",quantity:1,owned:count,affordable:false,available:false,availableAtMs:0,details:{},purchase:{callable:"",request:{}},useMode:"context",canUse:false,description:description+" Effect and reward source not connected yet."});}
 items.push({listingId:REPAIR_ITEM,kind:"item",displayName:"Emergency Patch",price:0,currency:"holos",quantity:1,owned:repairStock(profile),affordable:false,available:false,availableAtMs:0,details:{},purchase:{callable:"",request:{}},useMode:"repair",canUse:repairStock(profile)>0,description:"Repairs a deployed Holobot between battles. Consecutive uses cycle through deployed teammates. Awarded by Cache Checks and battle wins."});
 return {schemaVersion:ITEMS_SCHEMA,favoriteId:items.some(i=>i.listingId===favoriteId)?favoriteId:null,holosTokens:catalog.holosTokens,items,cachePacks:GACHA_PACKS.map(p=>({id:p.id,name:p.id,price:p.price})),result:null as unknown};
}
export function applyItemCommand(profile:Record<string,unknown>,favoriteId:string|null,c:ItemCommand,now:number,random:()=>number=Math.random){
 const snapshot=itemSnapshot(profile,favoriteId,now);const item=snapshot.items.find(i=>i.listingId===c.itemId);if(!item)throw new ItemError("unknown_item");
 let updates:Record<string,unknown>={};let result:unknown={kind:c.operation,itemId:c.itemId};let favorite=favoriteId;
 if(c.operation==="favorite")favorite=c.itemId!;
 else if(c.operation==="buy"){
  if(!item.available||!item.affordable)throw new ItemError(!item.available?"unavailable":"not_enough_holos");
  if(item.kind==="buddy_unit")updates=buildBuddyUnitPurchase(profile,validateBuddyPurchase({...item.purchase.request,requestId:c.requestId})).updates;
  else {const purchase=buildItemPurchaseUpdatesRaw(profile,item.displayName,new Date(now));if(!purchase)throw new ItemError("unavailable");updates=purchase.updates;}
 } else if(c.operation==="use"){
  if(!item.canUse)throw new ItemError(item.owned<=0?"no_item":"unavailable");
  if(item.useMode==="repair"){try{const r=repairUse(profile,c.holobotId);updates=r.updates;result=r.result;}catch(e){if(e instanceof RepairError)throw new ItemError(e.code);throw e;}}
  else if(item.useMode==="energy")updates=buildEnergyRefillUpdates(profile)!;
  else if(item.useMode==="boost"){const boost=buildExpBoosterActivationRaw(profile,now);if(boost.refusal!==null)throw new ItemError(boost.refusal);updates=boost.updates;}
  else if(item.useMode==="cache"){
   const pack=GACHA_PACKS.find(p=>p.id===c.packId);if(!pack)throw new ItemError("choose_cache");const tickets=Number(profile.gachaTickets||0);if(tickets<pack.price)throw new ItemError("no_item");
   const rewards=buildPackRewards(pack.id,random);updates={...buildPackGrantUpdatesRaw(profile,rewards),gachaTickets:tickets-pack.price,packHistory:[{id:"desktop_cache_"+c.requestId,items:[...rewards.map(item=>({name:item.label,rarity:item.rarity})),{name:"Emergency Patch",rarity:"common"}],openedAt:new Date(now).toISOString(),packId:pack.id},...(Array.isArray(profile.packHistory)?profile.packHistory:[])].slice(0,50),rewardSystem:incrementBoosterPacksToday(profile.rewardSystem,new Date(now))};result={kind:"cache",items:[...rewards,{id:"repair_"+c.requestId,label:"Emergency Patch",rarity:"common",grant:{type:"repair",amount:1}}]};
  }else throw new ItemError("context_required");
 }
 return {updates,favoriteId:favorite,reply:{...itemSnapshot({...profile,...updates},favorite,now),result}};
}
