import {describe,it,expect} from 'vitest';
import contract from '../../../../docs/contracts/healing-items-1.json';
import {HEALING_ITEMS,repairUse} from '../../../../functions/src/lib/repairItems';
import {buildCatalog} from '../../../../functions/src/lib/vendors';
import {arenaOpen,duelOpen} from '../../../../functions/src/lib/healingGuards';
import {withRankHealingReward} from '../../../../functions/src/lib/rankHealingReward';
import {HEALING_RECIPES} from '../../../../functions/src/lib/healingRecipes';
import {issueVitals} from '../../../../functions/src/lib/rivalHealth';
export const HEALING_PARITY_KEYS=contract.parityKeys;
describe('healing-items-1 client contract',()=>{
 it('healingCatalogServerParity',()=>{const catalog=buildCatalog({holosTokens:1000},'marketplace',0);expect(catalog.listings.filter(l=>l.details.healFraction).map(l=>({itemId:l.listingId,price:l.price,fraction:Number(l.details.healFraction)}))).toEqual(contract.items);});
 // DECISIONS #72.1 "floor + item": a heal on a bot below the city-recovery floor (KO, or under 40 %) starts FROM the floor.
 it('healingUseServerParity',()=>{const floor=150*contract.cityRecoveryFraction;const table:Record<string,[number,number,number]>={'item.emergency_patch':[97.5,97.5,127.5],'item.repair_kit':[135,135,150],'item.full_restore':[150,150,150]};
  for(const item of HEALING_ITEMS){const fraction=contract.items.find(i=>i.itemId===item.id)!.fraction;
   [0,30,90].forEach((hp,col)=>{const p={travelSquad:{holobotIds:['ace']},emergencyPatches:1,itemStocks:{repair_kit:1,full_restore:1},holobotVitals:{ace:{currentHealth:hp,maxHealth:150}}};const r=repairUse(p,'ace',item.id);
    expect(r.result.currentHealth).toBe(Math.min(150,Math.max(hp,floor)+150*fraction));expect(r.result.currentHealth).toBe(table[item.id][col]);expect(r.result.currentHealth).toBeGreaterThanOrEqual(floor);});}});
 it('healingWorkshopServerParity',()=>{expect(arenaOpen(undefined)).toBe(false);expect(arenaOpen({schemaVersion:'arena-healing-1',matchId:'m',open:true})).toBe(true);expect(duelOpen({schemaVersion:'duel-healing-1',runId:'d',open:true})).toBe(true);expect(()=>arenaOpen({open:false})).toThrow();expect(contract.workshop).toEqual({cost:0,fraction:1,maxSquad:3});});
 it('healingGrantServerParity',()=>{const p={holobots:[{name:'ACE',level:1}],itemStocks:{full_restore:2}};const r=withRankHealingReward(p,{holobots:[{name:'ACE',level:11}]});expect((r.itemStocks as Record<string,number>).repair_kit).toBe(contract.rankKitGrant);expect((r.itemStocks as Record<string,number>).full_restore).toBe(2);expect(withRankHealingReward(p,{holobots:p.holobots})).toEqual({holobots:p.holobots});});
 it('healingCraftServerParity',()=>{expect(Object.entries(HEALING_RECIPES).map(([output,r])=>({output,...r}))).toEqual(contract.recipes);});
 it('healingCityRecoveryParity',()=>{const v=issueVitals({holobotVitals:{ace:{currentHealth:0,maxHealth:150}}},[{holobotId:'ace',maxHealth:150}]);expect(v.ace.currentHealth).toBe(150*contract.cityRecoveryFraction);expect(v.ace.currentHealth).toBe(60);});
});
