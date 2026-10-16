import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { profile, T } from './zone-expedition-fixtures.mjs';
const require=createRequire(import.meta.url),C=require('../lib/config/zoneExpedition.js'),Z=require('../lib/holozone/expedition.js');
const {HEALING_ITEMS}=require('../lib/lib/repairItems.js');
function withSelection(value,fn){const old=process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;try{if(value===undefined)delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;else process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG=value;return fn();}finally{if(old===undefined)delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;else process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG=old;}}
function issued(){const p=profile(),x=Z.issueExpedition(p,{repairKits:1,carryExtractionCharge:true},'defaults_run',42,T,C.loadZoneExpeditionDefaults());return {profile:{...p,...x.updates},run:x.run};}
function advance(s,operation,fields={},now=T){const x=Z.advanceExpedition(s.profile,s.run,{operation,...fields},now);s.profile={...s.profile,...x.updates};s.run=x.run;return x;}

test('proposed defaults load as validated data with every explicit tuning value',()=>{
 assert.deepEqual(C.loadZoneExpeditionDefaults(),{version:'zone-config-proposed-1',energyCapacity:100,energyPackUnits:50,energyPackPrice:100,sectorEnergyCost:5,fightEnergyCost:10,extractionChargePrice:100,bandLevels:[1,11,21],cacheFragments:1,bulkySalvageUnits:1,rareBlueprintChanceBasisPoints:1000});
 assert.deepEqual(Z.expeditionConfig(C.loadZoneExpeditionDefaults()),C.loadZoneExpeditionDefaults());
});
test('healing defaults reuse existing catalog prices and fractions, only Kit is carried',()=>{
 assert.deepEqual(C.ZONE_EXPEDITION_HEALING_ITEMS,HEALING_ITEMS.map(i=>({itemId:i.id,holos:i.price,healFraction:i.fraction,carriedInExpedition:i.id==='item.repair_kit'})));
 assert.deepEqual(C.ZONE_EXPEDITION_HEALING_ITEMS.map(i=>[i.holos,i.healFraction]),[[100,.25],[250,.5],[600,1]]);
});
test('defaults and nested policy are immutable; each loader call returns an independent pinning copy',()=>{
 assert.ok(Object.isFrozen(C.ZONE_EXPEDITION_DEFAULTS));assert.ok(Object.isFrozen(C.ZONE_EXPEDITION_DEFAULTS.bandLevels));assert.ok(Object.isFrozen(C.ZONE_EXPEDITION_RULES.protectedSlot));
 const a=C.loadZoneExpeditionDefaults();a.bandLevels[1]=99;a.energyCapacity=1;assert.equal(C.loadZoneExpeditionDefaults().bandLevels[1],11);assert.equal(C.loadZoneExpeditionDefaults().energyCapacity,100);
});
test('activation remains explicit: absent/invalid selectors stay disabled; defaults-v1 selects proposed data',()=>{
 for(const value of [undefined,'','defaults','defaults-v2','null','{}','{"energyCapacity":100}'])withSelection(value,()=>assert.equal(Z.configuredExpedition(),null));
 withSelection(C.ZONE_EXPEDITION_DEFAULT_SELECTOR,()=>assert.deepEqual(Z.configuredExpedition(),C.loadZoneExpeditionDefaults()));
 assert.equal(C.ZONE_EXPEDITION_RULES.initialEnergy,0);assert.equal(Z.expeditionSupplies({}).energy,0);
});
test('existing explicit JSON override stays supported and cannot mutate the default table',()=>{
 const config={...C.loadZoneExpeditionDefaults(),version:'zone-config-reviewed-2',sectorEnergyCost:7};
 withSelection(JSON.stringify(config),()=>assert.deepEqual(Z.configuredExpedition(),config));assert.equal(C.loadZoneExpeditionDefaults().sectorEnergyCost,5);
});
test('global daily seed rolls exactly at 00:00 UTC; current run retains issued day and tuning',()=>{
 assert.deepEqual(C.ZONE_EXPEDITION_RULES.rollover,{timeZone:'UTC',hour:0,minute:0,second:0,existingRuns:'keep-issued-layout'});
 const boundary=Date.UTC(2026,9,15),before=Z.dailyLayout(boundary-1),after=Z.dailyLayout(boundary);assert.equal(before.day,'2026-10-14');assert.equal(after.day,'2026-10-15');assert.notEqual(before.seed,after.seed);assert.deepEqual(after,Z.dailyLayout(boundary+86399999));
 const s=issued(),original=structuredClone(s.run.config);advance(s,'move',{sectorId:'gate1'},boundary);assert.equal(s.run.layout.day,'2026-10-14');assert.deepEqual(s.run.config,original);
});
test('one protected stack survives wipe, permanent/banked items remain, emergency drops bulky salvage',()=>{
 assert.deepEqual(C.ZONE_EXPEDITION_RULES.protectedSlot,{count:1,unit:'one-existing-haul-stack',onWipe:'keep-protected-only',ownedAndBankedAtRisk:false});
 const s=issued();s.run.haul=[{id:'small',kind:'blueprint_fragment',amount:1,protected:false},{id:'bulky',kind:'bulky_salvage',amount:1,protected:false}];advance(s,'protect',{haulId:'bulky'});advance(s,'protect',{haulId:'small'});assert.equal(s.run.haul.filter(h=>h.protected).length,1);
 const owned=structuredClone(s.profile.holobots);advance(s,'wipe');assert.equal(s.profile.itemStocks.blueprint_fragment,11);assert.equal(s.profile.expeditionBank.bulkySalvage,0);assert.deepEqual(s.profile.holobots,owned);
 const e=issued();e.run.haul=[{id:'small',kind:'blueprint_fragment',amount:1,protected:false},{id:'bulky',kind:'bulky_salvage',amount:1,protected:true}];advance(e,'emergency_start');advance(e,'emergency_finish',{},T+C.ZONE_EXPEDITION_RULES.extraction.channelMs);assert.equal(e.profile.itemStocks.blueprint_fragment,11);assert.equal(e.profile.expeditionBank.bulkySalvage,0);
});
test('unresolved host fight refuses extraction before charge spend; cleared encounter permits channel',()=>{
 const s=issued();advance(s,'move',{sectorId:'gate1'});advance(s,'move',{sectorId:'b1a'});const before=structuredClone(s);
 assert.throws(()=>advance(s,'emergency_start'),e=>e.code==='encounter_pending');assert.deepEqual(s,before);assert.equal(s.run.charge,1);
 advance(s,'fight',{playerIntents:['strike','heavy','defend']});advance(s,'emergency_start');assert.equal(s.run.charge,0);assert.equal(s.run.extraction.startedAtMs,T);
 assert.equal(C.ZONE_EXPEDITION_RULES.extraction.unresolvedFight,'refuse-encounter_pending');assert.equal(C.ZONE_EXPEDITION_RULES.extraction.chargeConsumedOnRefusal,false);
});
