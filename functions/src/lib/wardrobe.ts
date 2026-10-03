import { MARKETPLACE_PART_PRICES, MarketplacePartRarity } from './economy';
export const WARDROBE_SCHEMA = 'wardrobe-1';
export const SLOTS = ['hair','body','jacket','pants','footwear'] as const;
export type Slot = typeof SLOTS[number];
export const STARTER: Record<Slot,string[]> = {
 hair:['hair-cyan','hair-white','hair-violet'], body:['body-base'],
 jacket:['jacket-vector','jacket-courier','jacket-night'], pants:['legs-vector','legs-drift'],
 footwear:['feet-hyper','feet-drift','feet-solar']
};
// Existing free creator choices remain free. Only previously uninstalled vault variants are sold.
export const CLOTHING = [
 ['hair-red','hair','Red hair','rare'], ['hair-silver','hair','Silver hair','epic'],
 ['legs-courier','pants','Courier pants','common'], ['legs-night','pants','Night pants','rare'],
 ['feet-courier','footwear','Courier shoes','common'], ['feet-night','footwear','Night shoes','rare']
].map(([id,slot,name,rarity]) => ({ id,slot:slot as Slot,name,rarity:rarity as MarketplacePartRarity,price:MARKETPLACE_PART_PRICES[rarity as MarketplacePartRarity] }));
export class WardrobeError extends Error {}
export type Recipe = {schemaVersion:string; frame:string; parts:Record<Slot,string>};
export type Command = {schemaVersion:string;requestId:string;operation:'purchase'|'equip';itemId?:string;recipe?:Recipe};
export function command(raw:unknown): Command {
 const c=raw as Command;
 if(!c || c.schemaVersion!==WARDROBE_SCHEMA || typeof c.requestId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(c.requestId)) throw new WardrobeError('invalid_request');
 if(c.operation==='purchase' && CLOTHING.some(i=>i.id===c.itemId)) return {schemaVersion:WARDROBE_SCHEMA,requestId:c.requestId,operation:c.operation,itemId:c.itemId};
 if(c.operation==='equip' && c.recipe?.schemaVersion===WARDROBE_SCHEMA && c.recipe.frame==='pilot-a' && c.recipe.parts && Object.keys(c.recipe.parts).length===SLOTS.length && SLOTS.every(s=>typeof c.recipe!.parts[s]==='string')) return {schemaVersion:WARDROBE_SCHEMA,requestId:c.requestId,operation:c.operation,recipe:{schemaVersion:WARDROBE_SCHEMA,frame:'pilot-a',parts:Object.fromEntries(SLOTS.map(s=>[s,c.recipe!.parts[s]])) as Record<Slot,string>}};
 throw new WardrobeError('invalid_request');
}
export function reduceWardrobe(profile:Record<string,unknown>,state:Record<string,unknown>,c:Command) {
 const owned=Array.isArray(state.entitlements)?state.entitlements.filter((s):s is string=>typeof s==='string'):[];
 let balance=profile.holosTokens;
 if(typeof balance!=='number'||!Number.isSafeInteger(balance)||balance<0) throw new WardrobeError('unavailable');
 let next:Record<string,unknown>={...state,schemaVersion:WARDROBE_SCHEMA,entitlements:owned};
 if(c.operation==='purchase') {
  const item=CLOTHING.find(i=>i.id===c.itemId)!;
  if(!owned.includes(item.id)) {if(balance<item.price) throw new WardrobeError('not_enough_holos'); balance-=item.price; next.entitlements=[...owned,item.id];}
 } else {
  for(const s of SLOTS) {const id=c.recipe!.parts[s]; if(!STARTER[s].includes(id) && !CLOTHING.some(i=>i.id===id&&i.slot===s&&owned.includes(id))) throw new WardrobeError('not_owned');}
  next.recipe=c.recipe;
 }
 return {state:next,balance,reply:{schemaVersion:WARDROBE_SCHEMA,entitlements:next.entitlements,recipe:next.recipe??null,holosTokens:balance,requestId:c.requestId,alreadyProcessed:false}};
}
