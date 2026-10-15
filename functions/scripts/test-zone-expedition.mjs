import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Z=require('../lib/holozone/expedition.js');
import {T,CONFIG,profile,issued} from './zone-expedition-fixtures.mjs';
function state(p=profile()){const r=issued(p);return {p:{...p,...r.updates},r:r.run};}
function step(s,operation,fields={},now=T){const x=Z.advanceExpedition(s.p,s.r,{operation,...fields},now);s.r=x.run;s.p={...s.p,...x.updates};return x;}
function rejects(s,op,fields,code){assert.throws(()=>step(s,op,fields),e=>e.code===code);}
function field(s,band=1){step(s,'move',{sectorId:`gate${band}`});const target=s.r.layout.sectors.find(n=>n.band===band&&n.cache);step(s,'move',{sectorId:target.id});return target;}

test('known-bad contract: deployed versions reject zone-run-3; new strict envelope accepts it',()=>{
 const old=require('../lib/lib/holoZoneRuns.js');assert.throws(()=>old.validateHoloZoneCommand({schemaVersion:'zone-run-3',operation:'issue',repairKits:0,carryExtractionCharge:false,requestId:'new'}),/invalid_request/);
 assert.equal(Z.validateExpeditionCommand({schemaVersion:'zone-run-3',operation:'issue',repairKits:0,carryExtractionCharge:false,requestId:'new'}).operation,'issue');
});
test('config is required, finite, bounded, versioned; no default free energy',()=>{
 assert.deepEqual(Z.expeditionSupplies({}),{energy:0,extractionCharges:0});
 for(const c of [null,{}, {...CONFIG,energyPackPrice:-1},{...CONFIG,bandLevels:[2,11,21]},{...CONFIG,bandLevels:[1,11,20]},{...CONFIG,rareBlueprintChanceBasisPoints:10001},{...CONFIG,extra:1}])assert.throws(()=>Z.expeditionConfig(c),/expedition_unavailable/);
 assert.deepEqual(Z.expeditionConfig(CONFIG),CONFIG);
});
test('daily UTC layout is global, deterministic, branching, changes at midnight, existing run pinned',()=>{
 assert.deepEqual(Z.dailyLayout(T),Z.dailyLayout(T-10000));assert.notDeepEqual(Z.dailyLayout(T),Z.dailyLayout(T+1000));
 const l=Z.dailyLayout(T);assert.equal(l.day,'2026-10-14');assert.equal(l.sectors.filter(s=>s.guardian).length,1);assert.equal(l.sectors.filter(s=>s.rareDiscovery).length,1);
 assert.equal(l.sectors.filter(s=>s.safe&&s.band>0).length,3);assert.equal(l.sectors.filter(s=>s.cache).length,3);
 const s=state();step(s,'move',{sectorId:'gate1'},T+1000);assert.deepEqual(s.r.layout,l);assert.ok(!('privateSeed' in Z.runView(s.r)));
});
test('strict envelopes refuse client seeds, outcomes, grants, HP, unknown schemas and absent intents',()=>{
 const good={schemaVersion:'zone-run-3',operation:'fight',runId:'r',requestId:'x',playerIntents:['strike']};
 for(const tamper of [{seed:1},{didWin:true},{loot:[1]},{currentHealth:100},{amount:100},{schemaVersion:'holozone-run-2'},{playerIntents:[]},{playerIntents:['cheat']}])assert.throws(()=>Z.validateExpeditionCommand({...good,...tamper}),/invalid_request|invalid_intents/);
 assert.throws(()=>Z.validateExpeditionCommand({...good,requestId:'../x'}),/invalid_request/);
 assert.throws(()=>Z.validateExpeditionCommand({schemaVersion:'zone-run-3',operation:'buy',requestId:'x',itemId:'unknown'}),/unknown_item/);
});
test('admission refuses locked Act 2, KO, empty squad, empty energy, missing kit/charge',()=>{
 for(const [extra,code] of [[{storyFlags:undefined},'arena_arc_required'],[{holobotVitals:{ace:{currentHealth:0,maxHealth:100}}},'holobot_ko'],[{travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:[]}},'squad_required'],[{expeditionSupplies:{energy:0,extractionCharges:1}},'no_energy'],[{itemStocks:{repair_kit:0}},'no_kit'],[{expeditionSupplies:{energy:100,extractionCharges:0}},'no_extraction_charge']])assert.throws(()=>issued(profile(extra)),new RegExp(code));
});
test('purchases use town balances, cap energy, use existing Kit 250/50%, refuse insufficient stock funds',()=>{
 assert.equal(Z.buyExpedition(profile({expeditionSupplies:{energy:80,extractionCharges:0}}),'item.expedition_energy',CONFIG).expeditionSupplies.energy,100);
 const kit=Z.buyExpedition(profile(),'item.repair_kit',CONFIG);assert.equal(kit.holosTokens,9750);assert.equal(kit.itemStocks.repair_kit,6);
 assert.throws(()=>Z.buyExpedition(profile(),'item.expedition_energy',CONFIG),/energy_full/);
 assert.throws(()=>Z.buyExpedition(profile({holosTokens:0}),'item.extraction_charge',CONFIG),/not_enough_holos/);
 assert.throws(()=>Z.buyExpedition(profile(),'bad',CONFIG),/unknown_item/);
});
test('routes, safe rooms, encounter gate and energy zero allow retreat without deeper advance',()=>{
 const s=state();rejects(s,'move',{sectorId:'gate3'},'invalid_route');rejects(s,'fight',{playerIntents:['strike']},'safe_room');rejects(s,'cache',{},'no_cache');field(s);
 rejects(s,'move',{sectorId:'gate2'},'sector_not_cleared');rejects(s,'cache',{},'sector_not_cleared');rejects(s,'heal',{holobotId:'ace'},'safe_room_required');rejects(s,'reorder',{order:['ace','kuma','shadow']},'safe_room_required');
 rejects(s,'extract',{},'beacon_required');rejects(s,'emergency_start',{},'encounter_pending');s.r.energy=0;step(s,'move',{sectorId:'gate1'});assert.equal(s.r.energy,0);rejects(s,'move',{sectorId:'b1a'},'no_energy');step(s,'move',{sectorId:'entry'});step(s,'extract');assert.equal(s.r.receipt.outcome,'normal');
});
test('host fights deterministic; zero energy does not disable bots, claims never enter resolver',()=>{
 const a=state(),b=state();field(a);field(b);a.r.energy=0;b.r.energy=0;const x=step(a,'fight',{playerIntents:['strike','defend','heavy']}),y=step(b,'fight',{playerIntents:['strike','defend','heavy']});
 assert.deepEqual(x.duelReceipt,y.duelReceipt);assert.equal(x.duelReceipt.winner,'player');assert.equal(a.r.energy,0);assert.equal(x.duelReceipt.schemaVersion,'duel-receipt-1');assert.ok(x.duelReceipt.rounds.some(r=>r.damage>0));rejects(a,'fight',{playerIntents:['strike']},'already_cleared');
});
test('no midrun banking; cache once; one protected slot; wipe loses only unprotected haul and KOs squad',()=>{
 const s=state();field(s);step(s,'fight',{playerIntents:['strike']});step(s,'cache');assert.equal(s.p.itemStocks.blueprint_fragment,10);rejects(s,'cache',{},'already_looted');rejects(s,'protect',{haulId:'fake'},'unknown_haul');
 step(s,'protect',{haulId:s.r.haul[1].id});step(s,'protect',{haulId:s.r.haul[0].id});assert.equal(s.r.haul.filter(h=>h.protected).length,1);
 const owned=structuredClone(s.p.holobots);step(s,'wipe');assert.equal(s.r.receipt.banked.length,1);assert.equal(s.r.receipt.lost.length,1);assert.equal(s.p.itemStocks.blueprint_fragment,11);assert.deepEqual(s.p.holobots,owned);assert.ok(Object.values(s.p.holobotVitals).every(v=>v.currentHealth===0));assert.equal(s.p.itemStocks.repair_kit,5);rejects(s,'move',{sectorId:'gate1'},'run_closed');
});
test('normal extraction banks all; emergency waits 8000ms, spends one, drops bulky, retains blueprints',()=>{
 for(const emergency of [false,true]){const s=state();field(s);step(s,'fight',{playerIntents:['strike']});step(s,'cache');
  if(emergency){step(s,'emergency_start');assert.equal(s.r.charge,0);rejects(s,'cache',{},'extraction_in_progress');assert.throws(()=>step(s,'emergency_finish',{},T+7999),e=>e.code==='extraction_channeling'&&e.details.retryAfterMs===1);step(s,'emergency_finish',{},T+8000);}
  else {step(s,'move',{sectorId:'gate1'});step(s,'extract');}
  assert.equal(s.p.itemStocks.blueprint_fragment,11);assert.equal(s.p.expeditionBank.bulkySalvage,emergency?0:1);assert.equal(s.p.expeditionSupplies.extractionCharges,emergency?1:2);
 }
});
test('host receipt hits interrupt a channel if a new host encounter exists; caller hit flag is never consumed',()=>{
 const s=state();field(s);s.r.cleared.push(s.r.sectorId);step(s,'emergency_start');s.r.cleared=[]; // trusted host encounter fixture, not a callable command
 const result=step(s,'fight',{playerIntents:['defend','strike']});assert.equal(result.interrupted,true);assert.equal(s.r.extraction,null);assert.equal(s.r.charge,0);rejects(s,'emergency_finish',{},'extraction_not_started');
});
test('safe-room kit consumes carried stock and heals 50%; reorder and utility check squad/living bot',()=>{
 const s=state();rejects(s,'heal',{holobotId:'ace'},'already_full');rejects(s,'heal',{holobotId:'wolf'},'not_in_squad');s.r.squad[0].currentHealth=0;step(s,'heal',{holobotId:'ace'});assert.equal(s.r.squad[0].currentHealth,s.r.squad[0].maxHealth*.5);assert.equal(s.r.kits,1);assert.equal(s.p.itemStocks.repair_kit,3);
 rejects(s,'reorder',{order:['wolf']},'not_in_squad');step(s,'reorder',{order:['shadow','ace','kuma']});assert.equal(s.r.squad[0].holobotId,'shadow');rejects(s,'utility',{utility:'ace'},'no_utility');
 step(s,'move',{sectorId:'gate1'});step(s,'move',{sectorId:s.r.layout.sectors.find(n=>n.band===1&&n.utility).id});step(s,'utility',{utility:'ace'});s.r.squad.find(b=>b.holobotId==='ace').currentHealth=0;rejects(s,'utility',{utility:'ace'},'companion_required');
});
test('three fixed bands, rare discovery, optional guardian flag, no 13th-bot or story completion grant',()=>{
 const s=state();for(let band=1;band<=3;band++){const at=field(s,band);assert.equal(Z.threat(s.r,at).level,CONFIG.bandLevels[band-1]);step(s,'fight',{playerIntents:['strike','heavy','defend']});step(s,'cache');}
 assert.equal(s.r.guardianDefeated,true);assert.equal(s.r.haul.filter(h=>h.kind==='rare_blueprint_fragment').length,1);step(s,'move',{sectorId:'gate3'});step(s,'extract');assert.equal(s.p.expeditionBank.guardianDefeated,true);assert.equal(s.p.storyFlags.holoZonesArcBuilt,false);assert.equal(s.p.holobots.length,3);
});

test('review: rare discovery is an actual Workshop fragment on extract/protected wipe; bulky loss is unchanged',()=>{
 for(const outcome of ['normal','emergency','wipe']){const s=state();s.r.haul=[{id:'rare',kind:'rare_blueprint_fragment',amount:1,protected:true},{id:'bulk',kind:'bulky_salvage',amount:1,protected:false}];
  if(outcome==='normal')step(s,'extract');else if(outcome==='wipe')step(s,'wipe');else{step(s,'emergency_start');step(s,'emergency_finish',{},T+8000);}
  assert.equal(s.p.itemStocks.blueprint_fragment,11);assert.equal(s.p.expeditionBank.rareBlueprints,1);assert.equal(s.p.expeditionBank.bulkySalvage,outcome==='normal'?1:0);
 }
});
test('review: odd max HP kit matches exact 50%; integer combat snapshot rounds down only at resolver seam',()=>{
 const s=state();s.r.squad[0].maxHealth=101;s.r.squad[0].currentHealth=0;step(s,'heal',{holobotId:'ace'});assert.equal(s.r.squad[0].currentHealth,50.5);assert.equal(s.p.holobotVitals.ace.currentHealth,50.5);
 const view=Z.runView(s.r);assert.equal(view.seed,s.r.layout.seed);assert.equal(view.band,0);assert.equal(view.sector,'entry');assert.equal(view.protectedSlot,null);
});
test('remaining stock, kit, charge, malformed-storage and temporal refusals fail closed',()=>{
 assert.throws(()=>Z.buyExpedition(profile({expeditionSupplies:{energy:0,extractionCharges:1000000}}),'item.extraction_charge',CONFIG),/stock_full/);
 const s=state();s.r.kits=0;rejects(s,'heal',{holobotId:'ace'},'no_kit');s.r.charge=0;rejects(s,'emergency_start',{},'no_extraction_charge');
 assert.throws(()=>step(s,'move',{sectorId:'gate1'},T-1),/invalid_request/);
 for(const patch of [{energy:NaN},{squad:[]},{haul:[{id:'x',kind:'blueprint_fragment',amount:-1,protected:false}]},{extraction:{startedAtMs:Infinity}}])assert.throws(()=>Z.readExpedition({...s.r,...patch}),/unavailable/);
 assert.throws(()=>Z.expeditionSupplies({expeditionSupplies:{energy:-1,extractionCharges:0}}),/unavailable/);
});

test('callable mapper preserves known health/activity/story/ownership refusals and hides unknown exceptions',()=>{
 const {expeditionRejection:map}=require('../lib/holozone/expeditionErrors.js');
 const {HealthError}=require('../lib/lib/rivalHealth.js'),{RepairError}=require('../lib/lib/repairItems.js'),{ActivityError}=require('../lib/lib/arenaActivity.js'),{StoryError}=require('../lib/story/storyFlags.js'),{HostError}=require('../lib/acquisition/wildEncounterDomain.js');
 for(const error of [new HealthError('holobot_ko'),new RepairError('no_item'),new ActivityError(),new StoryError('unavailable'),new HostError('unavailable')])assert.equal(map(error).details.rejectionCode,error.code??error.message);
 assert.equal(map(new Error('private internal detail')),null);assert.equal(map(new Z.ExpeditionError('extraction_channeling',{retryAfterMs:1})).details.retryAfterMs,1);
});
