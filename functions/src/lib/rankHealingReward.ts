import {toHolobotKey} from "./mintingEconomy";
import {HOLOBOT_RANK_TIERS} from "./progression";
import {healingDelta} from "./repairItems";
/**
 * DECISIONS #58 (3) (replaces #72's 11 / 21 / 31 / 41 BLUEPRINT_TIERS table): one Repair Kit per crossed mobile
 * Holobot rank tier — every boundary of HOLOBOT_RANK_TIERS (lib/progression.ts), Rookie -> Starter included. A jump
 * that spans two tiers grants two. Never on mint / new ownership or a retry.
 * Once per bot per tier: users/{uid}.rankKitTiers {botKey: highest tier index granted} (server-only, firestore.rules)
 * is written with the grant in the caller's transaction; a later re-crossing (a level reset and re-climb) pays nothing.
 * No retroactive grant: a bot with no record starts from the tier it held before this update.
 */
export const RANK_KIT_TIERS_FIELD = "rankKitTiers";
export function rankTierIndex(level:unknown):number{return typeof level==="number"&&Number.isFinite(level)?HOLOBOT_RANK_TIERS.filter(t=>level>=t.startLevel).length:0;}
export function withRankHealingReward(profile:Record<string,unknown>,updates:Record<string,unknown>){
 const before=Array.isArray(profile.holobots)?profile.holobots as Record<string,unknown>[]:[];
 if(!Array.isArray(updates.holobots))return updates;
 const raw=profile[RANK_KIT_TIERS_FIELD];
 const record:Record<string,number>=raw&&typeof raw==="object"&&!Array.isArray(raw)?Object.fromEntries(Object.entries(raw as Record<string,unknown>).filter(([,v])=>typeof v==="number"&&Number.isSafeInteger(v)&&v>=0)) as Record<string,number>:{};
 let amount=0;const next={...record};
 for(const bot of updates.holobots as Record<string,unknown>[]){
  if(typeof bot.name!=="string")continue;const key=toHolobotKey(bot.name);
  const old=before.find(b=>typeof b.name==="string"&&toHolobotKey(b.name)===key);if(!old)continue;
  const floor=Math.max(rankTierIndex(old.level),next[key]??0),now=rankTierIndex(bot.level);
  if(now>floor){amount+=now-floor;next[key]=now;}
 }
 return amount?{...updates,...healingDelta({...profile,...updates},"item.repair_kit",amount),[RANK_KIT_TIERS_FIELD]:next}:updates;
}
