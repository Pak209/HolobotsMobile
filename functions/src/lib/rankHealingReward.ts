import {BLUEPRINT_TIERS,toHolobotKey} from "./mintingEconomy";
import {healingDelta} from "./repairItems";
/** One Kit per crossed mobile Holobot rank tier, never on mint/new ownership or a retry. */
export function withRankHealingReward(profile:Record<string,unknown>,updates:Record<string,unknown>){
 const before=Array.isArray(profile.holobots)?profile.holobots as Record<string,unknown>[]:[];
 if(!Array.isArray(updates.holobots))return updates;
 const tier=(level:unknown)=>typeof level==="number"&&Number.isFinite(level)?BLUEPRINT_TIERS.filter(t=>level>=t.startLevel).length:0;
 let amount=0;
 for(const bot of updates.holobots as Record<string,unknown>[]){if(typeof bot.name!=="string")continue;const old=before.find(b=>typeof b.name==="string"&&toHolobotKey(b.name)===toHolobotKey(bot.name as string));if(old)amount+=Math.max(0,tier(bot.level)-tier(old.level));}
 return amount?{...updates,...healingDelta({...profile,...updates},"item.repair_kit",amount)}:updates;
}
