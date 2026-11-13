import {describe,it,expect} from 'vitest';
import contract from '../../../../docs/contracts/healing-items-1.json';
import {HEALING_ITEMS,repairUse} from '../../../../functions/src/lib/repairItems';
import {buildCatalog} from '../../../../functions/src/lib/vendors';
import {arenaOpen,duelOpen} from '../../../../functions/src/lib/healingGuards';
import {withRankHealingReward} from '../../../../functions/src/lib/rankHealingReward';
import {HEALING_RECIPES} from '../../../../functions/src/lib/healingRecipes';
import {HealthError,issueVitals,KO_FALLBACK_FRACTION,requireLivingVitals} from '../../../../functions/src/lib/rivalHealth';
import {AUTO_HEAL_FULL_MS,KO_RETURN_FRACTION} from '../../../../functions/src/lib/autoHeal';
export const HEALING_PARITY_KEYS=contract.parityKeys;
// auto-heal-1: rows carry hpUpdatedAt (a row without it reads as fully healed); nowMs = hpUpdatedAt means no regen yet.
describe('healing-items-1 client contract',()=>{
 it('healingCatalogServerParity',()=>{const catalog=buildCatalog({holosTokens:1000},'marketplace',0);expect(catalog.listings.filter(l=>l.details.healFraction).map(l=>({itemId:l.listingId,price:l.price,fraction:Number(l.details.healFraction)}))).toEqual(contract.items);});
 // DECISIONS #72.1 "floor + item": a heal on a bot below the city-recovery floor (KO, or under 40 %) starts FROM the floor.
 it('healingUseServerParity',()=>{const floor=150*contract.cityRecoveryFraction;const table:Record<string,[number,number,number]>={'item.emergency_patch':[97.5,97.5,127.5],'item.repair_kit':[135,135,150],'item.full_restore':[150,150,150]};
  for(const item of HEALING_ITEMS){const fraction=contract.items.find(i=>i.itemId===item.id)!.fraction;
   [0,30,90].forEach((hp,col)=>{const p={travelSquad:{holobotIds:['ace']},emergencyPatches:1,itemStocks:{repair_kit:1,full_restore:1},holobotVitals:{ace:{currentHealth:hp,maxHealth:150,hpUpdatedAt:0}}};const r=repairUse(p,'ace',item.id,0);
    expect(r.result.currentHealth).toBe(Math.min(150,Math.max(hp,floor)+150*fraction));expect(r.result.currentHealth).toBe(table[item.id][col]);expect(r.result.currentHealth).toBeGreaterThanOrEqual(floor);});}});
 it('healingWorkshopServerParity',()=>{expect(arenaOpen(undefined)).toBe(false);expect(arenaOpen({schemaVersion:'arena-healing-1',matchId:'m',open:true})).toBe(true);expect(duelOpen({schemaVersion:'duel-healing-1',runId:'d',open:true})).toBe(true);expect(()=>arenaOpen({open:false})).toThrow();expect(contract.workshop).toEqual({cost:0,fraction:1,maxSquad:3});});
 it('healingGrantServerParity',()=>{const p={holobots:[{name:'ACE',level:1}],itemStocks:{full_restore:2}};const r=withRankHealingReward(p,{holobots:[{name:'ACE',level:11}]});expect((r.itemStocks as Record<string,number>).repair_kit).toBe(contract.rankKitGrant);expect((r.itemStocks as Record<string,number>).full_restore).toBe(2);expect(withRankHealingReward(p,{holobots:p.holobots})).toEqual({holobots:p.holobots});});
 it('healingCraftServerParity',()=>{expect(Object.entries(HEALING_RECIPES).map(([output,r])=>({output,...r}))).toEqual(contract.recipes);});
 // ko-return-25 + auto-heal-1 (Pak 2026-11-12): the issue-time 40 % KO floor is gone. cityRecoveryFraction (0.4) is now only
 // the item-heal floor (healingUseServerParity, KO_FALLBACK_FRACTION). A KO'd bot is refused admission until its regenerated
 // HP reaches 25 % of max, regenerates linearly to full in 6 h, and issueVitals hands out its effective HP unchanged.
 it('healingCityRecoveryParity',()=>{expect(KO_FALLBACK_FRACTION).toBe(contract.cityRecoveryFraction);expect(KO_RETURN_FRACTION).toBe(0.25);expect(AUTO_HEAL_FULL_MS).toBe(6*60*60*1000);
  const ko={holobotVitals:{ace:{currentHealth:0,maxHealth:150,hpUpdatedAt:0}}};
  expect(issueVitals(ko,[{holobotId:'ace',maxHealth:150}],0).ace.currentHealth).toBe(0);
  let refusal:unknown;try{requireLivingVitals(ko,['ace'],0);}catch(e){refusal=e;}
  expect(refusal).toBeInstanceOf(HealthError);expect((refusal as HealthError).message).toBe('holobot_ko');
  const readyAt=(refusal as HealthError).detail!.readyAtMs as number;expect(readyAt).toBe(Math.ceil(38*AUTO_HEAL_FULL_MS/150));
  expect(()=>requireLivingVitals(ko,['ace'],readyAt-1)).toThrow('holobot_ko');
  expect(()=>requireLivingVitals(ko,['ace'],readyAt)).not.toThrow();
  expect(issueVitals(ko,[{holobotId:'ace',maxHealth:150}],readyAt).ace.currentHealth).toBe(38);
  expect(issueVitals(ko,[{holobotId:'ace',maxHealth:150}],AUTO_HEAL_FULL_MS).ace.currentHealth).toBe(150);
  // A row without hpUpdatedAt (pre-auto-heal, or written full) reads as full.
  expect(issueVitals({holobotVitals:{ace:{currentHealth:0,maxHealth:150}}},[{holobotId:'ace',maxHealth:150}],0).ace.currentHealth).toBe(150);});
});
