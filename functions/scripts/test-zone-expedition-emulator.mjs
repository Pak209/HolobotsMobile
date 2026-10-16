import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {T,CONFIG,profile} from './zone-expedition-fixtures.mjs';
const require=createRequire(import.meta.url);
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('demo emulator required');
const {db}=require('../lib/admin.js'),{transactExpedition:run}=require('../lib/holozone/expeditionStore.js');
const {holoZoneHost}=require('../lib/holozone/holoZoneHost.js');
const {transactHoloZoneRun}=require('../lib/holozone/holoZoneStore.js');
const {transactRivalBattle}=require('../lib/rival/rivalBattleStore.js');
const {transactWorkshopHeal}=require('../lib/workshop/workshopHealHost.js');
const {transactDesktopItems}=require('../lib/vendors/desktopItemsHost.js');
const {transactDuelHealing}=require('../lib/duels/duelHealingHost.js');
const {transactArenaMatch}=require('../lib/arena/arenaMatchStore.js');
const {buildCatalog}=require('../lib/lib/vendors.js');
let n=0;const id=()=>`w13_${Date.now()}_${n++}`,user=async uid=>(await db.doc(`users/${uid}`).get()).data();
async function setup(extra={}){const uid=id();await db.doc(`users/${uid}`).set(JSON.parse(JSON.stringify(profile(extra))));return uid;}
const extraction=op=>['extract','emergency_start','emergency_finish','wipe'].includes(op);
const cmd=(operation,fields={})=>({schemaVersion:extraction(operation)?'zone-extract-1':'zone-run-3',operation,...(!['layout','status'].includes(operation)?{requestId:id()}:{}),...fields});
const call=(uid,c,now=T,opts={})=>run(db,uid,c,now,{config:CONFIG,...opts});
const enter=uid=>call(uid,cmd('issue',{repairKits:2,carryExtractionCharge:true}));
async function loot(uid,r){const runId=r.runId;await call(uid,cmd('move',{runId,sectorId:'gate1'}));const s=r.layout.sectors.find(s=>s.band===1&&s.cache);await call(uid,cmd('move',{runId,sectorId:s.id}));const fight=await call(uid,cmd('fight',{runId,playerIntents:['strike','heavy','defend']}));assert.equal(fight.duelReceipt.winner,'player');return await call(uid,cmd('cache',{runId}));}

test('callable authentication, unavailable default, default inventory, strict tamper refusal',async()=>{
 const uid=await setup({expeditionSupplies:undefined});
 await assert.rejects(()=>holoZoneHost.run({data:cmd('status')}),e=>e.code==='unauthenticated');
 const absent=await run(db,uid,cmd('status'),T,{config:null});assert.deepEqual(absent.supplies,{energy:0,extractionCharges:0});assert.equal(absent.enabled,false);
 for(const op of [cmd('buy',{itemId:'item.expedition_energy'}),cmd('issue',{repairKits:0,carryExtractionCharge:false}),cmd('layout')])await assert.rejects(()=>run(db,uid,op,T,{config:null}),/expedition_unavailable/);
 await assert.rejects(()=>call(uid,cmd('issue',{repairKits:0,carryExtractionCharge:false,seed:1})),/invalid_request/);
});
test('concurrent town purchase spends once; changed request identity rejected; vendor uses exact configured quote',async()=>{
 const uid=await setup({expeditionSupplies:{energy:0,extractionCharges:0}}),c=cmd('buy',{itemId:'item.expedition_energy'});
 const replies=await Promise.all([call(uid,c),call(uid,c),call(uid,c)]);assert.equal(replies.filter(r=>!r.alreadyProcessed).length,1);assert.equal((await user(uid)).holosTokens,9900);assert.equal((await user(uid)).expeditionSupplies.energy,50);
 await assert.rejects(()=>call(uid,{...c,itemId:'item.extraction_charge'}),/request_conflict/);
 process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG=JSON.stringify(CONFIG);const catalog=buildCatalog(await user(uid),'marketplace',T);delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;
 assert.equal(catalog.listings.find(x=>x.listingId==='item.extraction_charge').price,CONFIG.extractionChargePrice);assert.equal(catalog.listings.find(x=>x.listingId==='item.expedition_energy').purchase.callable,'holoZoneHost');
});
test('issue atomically transfers kits/charge once, pins config/stats/private seed and UTC day; reentry/refill refused',async()=>{
 const uid=await setup(),c=cmd('issue',{repairKits:2,carryExtractionCharge:true}),replies=await Promise.all([call(uid,c),call(uid,c)]),r=replies[0].run;
 assert.equal(replies.filter(x=>!x.alreadyProcessed).length,1);assert.equal((await user(uid)).itemStocks.repair_kit,3);assert.equal((await user(uid)).expeditionSupplies.extractionCharges,1);assert.ok(!JSON.stringify(r).includes('privateSeed'));
 const stored=(await db.doc(`holoZoneRuns/${uid}/expeditions/${r.runId}`).get()).data();assert.equal(typeof stored.privateSeed,'number');assert.deepEqual(r.opponents,stored.opponents);
 await assert.rejects(()=>enter(uid),/expedition_open/);await assert.rejects(()=>call(uid,cmd('buy',{itemId:'item.expedition_energy'})),/expedition_open/);
 const later=await call(uid,cmd('move',{runId:r.runId,sectorId:'gate1'}),T+1000,{config:null});assert.equal(later.run.layout.day,'2026-10-14');assert.deepEqual(later.run.config,CONFIG);
});
test('legacy zone, rival, Arena, duel and external healing cannot enter or alter an active expedition',async()=>{
 const uid=await setup(),r=(await enter(uid)).run,before=await user(uid);
 await assert.rejects(()=>transactHoloZoneRun(db,uid,{operation:'issue',zoneId:'neonforest'},T),/activity_conflict/);
 await assert.rejects(()=>transactHoloZoneRun(db,uid,{operation:'settle',runId:r.runId,kills:1,bossDefeated:false,fielded:['ace']},T),/activity_conflict/);
 await assert.rejects(()=>transactRivalBattle(db,uid,{schemaVersion:'rival-battle-3',operation:'issue'},T),/activity_conflict/);
 await assert.rejects(()=>transactWorkshopHeal(db,uid,{schemaVersion:'healing-workshop-1',operation:'heal',requestId:id()},T),/battle_open/);
 await assert.rejects(()=>transactDesktopItems(db,uid,{schemaVersion:'desktop-items-2',operation:'use',itemId:'item.repair_kit',requestId:id(),holobotId:'ace'},T),/safe_room_required/);
 await assert.rejects(()=>transactDesktopItems(db,uid,{schemaVersion:'desktop-items-2',operation:'buy',itemId:'item.repair_kit',requestId:id()},T),/between_battles_only/);
 await assert.rejects(()=>transactDuelHealing(db,uid,{schemaVersion:'duel-healing-1',operation:'issue',fielded:['ace']},T),/battle_open/);
 await assert.rejects(()=>transactArenaMatch(db,uid,{schemaVersion:'arena-match-1',operation:'issue',requestId:id(),tierId:'rookie',paymentMethod:'tokens',holobotId:'ace',opponentName:'HARE'},T),/activity_conflict/);
 assert.deepEqual(await user(uid),before);
});
test('legacy or Arena existing activity blocks expedition issue and purchase atomically',async()=>{
 for(const kind of ['zone','arena','duel','rival']){
  const uid=await setup();if(kind==='zone')await transactHoloZoneRun(db,uid,{operation:'issue',zoneId:'neonforest'},T);
  if(kind==='arena')await db.doc(`arenaMatches/${uid}`).set({schemaVersion:'arena-healing-1',matchId:'held',open:true});
  if(kind==='duel')await db.doc(`duelHealingRuns/${uid}`).set({schemaVersion:'duel-healing-1',runId:'held',open:true});
  if(kind==='rival')await transactRivalBattle(db,uid,{schemaVersion:'rival-battle-3',operation:'issue'},T);
  const before=await user(uid);await assert.rejects(()=>enter(uid),/activity_conflict/);await assert.rejects(()=>call(uid,cmd('buy',{itemId:'item.extraction_charge'})),/activity_conflict/);assert.deepEqual(await user(uid),before);
 }
});
test('concurrent fight resolves once; replay preserves exact receipt despite later seed/clock/config',async()=>{
 const uid=await setup(),r=(await enter(uid)).run,runId=r.runId;await call(uid,cmd('move',{runId,sectorId:'gate1'}));await call(uid,cmd('move',{runId,sectorId:'b1a'}));
 const c=cmd('fight',{runId,playerIntents:['strike']}),results=await Promise.all([call(uid,c),call(uid,c)]);assert.equal(results.filter(r=>!r.alreadyProcessed).length,1);assert.deepEqual(results[0].duelReceipt,results[1].duelReceipt);
 const replay=await call(uid,c,T+86400000,{config:null});assert.deepEqual(replay.duelReceipt,results[0].duelReceipt);await assert.rejects(()=>call(uid,{...c,playerIntents:['defend']}),/request_conflict/);
});
test('cache replay cannot farm; extraction versus wipe atomically closes and banks exactly one outcome',async()=>{
 const uid=await setup(),r=(await enter(uid)).run,runId=r.runId,cache=await loot(uid,r);await call(uid,cmd('protect',{runId,haulId:cache.run.haul[0].id}));await call(uid,cmd('move',{runId,sectorId:'gate1'}));
 const results=await Promise.all([call(uid,cmd('extract',{runId,mode:'normal'})),call(uid,cmd('wipe',{runId}))]);
 assert.equal(results.filter(r=>!r.alreadyProcessed).length,1);const receipt=results.find(r=>!r.alreadyProcessed).receipt;assert.deepEqual(results.find(r=>r.alreadyProcessed).receipt,receipt);
 const u=await user(uid);assert.equal(u.itemStocks.blueprint_fragment,11);assert.equal(u.itemStocks.repair_kit,5);assert.equal(u.expeditionSupplies.extractionCharges,2);assert.deepEqual(u.holobots,profile().holobots);
 assert.equal((await db.doc(`holoZoneRuns/${uid}`).get()).data().expedition.open,false);
});
test('emergency extraction clock, charge, replay, bulky loss and no wrong-owner lookup',async()=>{
 const uid=await setup(),other=await setup(),r=(await enter(uid)).run,runId=r.runId;await loot(uid,r);
 await assert.rejects(()=>call(other,cmd('wipe',{runId})),/unknown_run/);
 const c=cmd('emergency_start',{runId});await call(uid,c);await call(uid,c);await assert.rejects(()=>call(uid,cmd('emergency_finish',{runId}),T+7999),e=>e.code==='extraction_channeling'&&e.details.retryAfterMs===1);
 await assert.rejects(()=>call(uid,cmd('move',{runId,sectorId:'gate1'})),/extraction_in_progress/);
 const x=await call(uid,cmd('emergency_finish',{runId}),T+8000);assert.equal(x.receipt.outcome,'emergency');const u=await user(uid);assert.equal(u.expeditionSupplies.extractionCharges,1);assert.equal(u.expeditionBank.bulkySalvage,0);assert.equal(u.itemStocks.blueprint_fragment,11);
});
test('guardian flag and rare discovery remain host-only; bank feeds existing fragments without unlocking story/13th',async()=>{
 const uid=await setup(),r=(await enter(uid)).run,runId=r.runId;
 for(let band=1;band<=3;band++){await call(uid,cmd('move',{runId,sectorId:`gate${band}`}));const at=r.layout.sectors.find(s=>s.band===band&&s.cache);await call(uid,cmd('move',{runId,sectorId:at.id}));await call(uid,cmd('fight',{runId,playerIntents:['strike','defend','heavy']}));await call(uid,cmd('cache',{runId}));}
 await call(uid,cmd('move',{runId,sectorId:'gate3'}));await call(uid,cmd('extract',{runId,mode:'normal'}));const u=await user(uid);assert.equal(u.expeditionBank.guardianDefeated,true);assert.equal(u.expeditionBank.rareBlueprints,1);assert.equal(u.itemStocks.blueprint_fragment,14);assert.equal(u.storyFlags.holoZonesArcBuilt,false);assert.equal(u.holobots.length,3);
});
test('client Firestore writes cannot mint inventory, bank, leases, receipts, or seeds',async()=>{
 const rr=createRequire(new URL('../../rules-tests/package.json',import.meta.url));const {initializeTestEnvironment,assertFails,assertSucceeds}=rr('@firebase/rules-unit-testing'),{doc,setDoc,updateDoc}=rr('firebase/firestore');
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':'),env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{host,port:Number(port),rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});
 try{const uid=await setup(),client=env.authenticatedContext(uid).firestore();await assertSucceeds(updateDoc(doc(client,'users',uid),{presenceOptOut:true}));
 const fresh=id(),freshClient=env.authenticatedContext(fresh).firestore();await assertSucceeds(setDoc(doc(freshClient,'users',fresh),{displayName:'Demo control'}));
 for(const field of ['expeditionSupplies','expeditionBank']){const forged=id(),fc=env.authenticatedContext(forged).firestore();await assertFails(setDoc(doc(fc,'users',forged),{[field]:{energy:999}}));}
 for(const field of ['expeditionSupplies','expeditionBank'])await assertFails(updateDoc(doc(client,'users',uid),{[field]:{energy:999,rareBlueprints:999}}));
 for(const path of [`holoZoneRuns/${uid}`,`holoZoneRuns/${uid}/expeditions/fake`,`holoZoneRuns/${uid}/expeditionRequests/fake`])await assertFails(setDoc(doc(client,path),{privateSeed:1,open:true}));
 }finally{await env.cleanup();}
});

test('terminal replay cannot close a new run or restore supplies again',async()=>{
 const uid=await setup(),first=(await enter(uid)).run,ending=cmd('extract',{runId:first.runId,mode:'normal'});const closed=await call(uid,ending),second=(await enter(uid)).run,before=await user(uid);
 assert.notEqual(first.runId,second.runId);const replay=await call(uid,ending);assert.deepEqual(replay.receipt,closed.receipt);assert.deepEqual(await user(uid),before);assert.equal((await db.doc(`holoZoneRuns/${uid}`).get()).data().expedition.runId,second.runId);
});
test('expedition issue versus Arena issue commits exactly one activity without double inventory transfer',async()=>{
 const uid=await setup(),before=await user(uid);const outcomes=await Promise.allSettled([enter(uid),transactArenaMatch(db,uid,{schemaVersion:'arena-match-1',operation:'issue',requestId:id(),tierId:'rookie',paymentMethod:'tokens',holobotId:'ace',opponentName:'HARE'},T)]);
 assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);assert.match(outcomes.find(o=>o.status==='rejected').reason.message,/activity_conflict/);
 const after=await user(uid),lease=(await db.doc(`holoZoneRuns/${uid}`).get()).data();assert.equal(after.itemStocks.repair_kit,lease?.expedition?.open?before.itemStocks.repair_kit-2:before.itemStocks.repair_kit);
});

test('review: new terminal replay request ID is reserved and cannot later buy or issue',async()=>{
 const uid=await setup(),r=(await enter(uid)).run;await call(uid,cmd('extract',{runId:r.runId,mode:'normal'}));const replay=cmd('wipe',{runId:r.runId});await call(uid,replay);const before=await user(uid);
 await assert.rejects(()=>call(uid,cmd('buy',{itemId:'item.extraction_charge',requestId:replay.requestId})),/request_conflict/);assert.deepEqual(await user(uid),before);
});
test('review: actual callable maps KO and malformed shared-domain state to documented refusal',async()=>{
 process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG=JSON.stringify(CONFIG);
 try{for(const [extra,expected] of [[{holobotVitals:{ace:{currentHealth:0,maxHealth:100}}},'holobot_ko'],[{storyFlags:{arenaArcBuilt:true,tournamentsWon:0}},'unavailable'],[{travelSquad:{bad:true}},'unavailable'],[{itemStocks:{repair_kit:-1}},'unavailable']]){
  const uid=await setup(extra);await assert.rejects(()=>holoZoneHost.run({auth:{uid},data:cmd('issue',{repairKits:0,carryExtractionCharge:false})}),e=>e.details?.rejectionCode===expected&&e.code!=='internal');
 }}finally{delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;}
});
