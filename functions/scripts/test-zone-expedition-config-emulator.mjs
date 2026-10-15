import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { profile, T } from './zone-expedition-fixtures.mjs';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Loopback demo emulator required');
const {db}=require('../lib/admin.js'),{transactExpedition}=require('../lib/holozone/expeditionStore.js'),{holoZoneHost}=require('../lib/holozone/holoZoneHost.js'),{readVendorCatalog}=require('../lib/vendors/vendorStore.js');
const C=require('../lib/config/zoneExpedition.js');let serial=0;
const id=()=>`w17_${Date.now()}_${serial++}`;
const command=(operation,fields={})=>({schemaVersion:operation.startsWith('emergency_')?'zone-extract-1':'zone-run-3',operation,...(!['status','layout'].includes(operation)?{requestId:id()}:{}),...fields});
async function pilot(extra={}){const uid=id();await db.doc(`users/${uid}`).set(profile(extra));return uid;}
async function selection(value,fn){const prior=process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;try{if(value===undefined)delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;else process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG=value;return await fn();}finally{if(prior===undefined)delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;else process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG=prior;}}

test('runtime default selector loads quotes and buys from the table, while no selection remains disabled',async()=>{
 const uid=await pilot({expeditionSupplies:{energy:0,extractionCharges:0}}),c=command('buy',{itemId:'item.expedition_energy'});
 await selection(undefined,async()=>{await assert.rejects(()=>transactExpedition(db,uid,c,T),/expedition_unavailable/);const catalog=await readVendorCatalog(db,uid,{operation:'catalog',vendorId:'marketplace'},T);assert.ok(!catalog.listings.some(l=>l.listingId==='item.expedition_energy'));});
 await selection(C.ZONE_EXPEDITION_DEFAULT_SELECTOR,async()=>{
  const catalog=await readVendorCatalog(db,uid,{operation:'catalog',vendorId:'marketplace'},T),quote=catalog.listings.find(l=>l.listingId==='item.expedition_energy');assert.equal(quote.price,100);assert.equal(quote.quantity,50);
  const buy=await transactExpedition(db,uid,c,T);assert.equal(buy.holosTokens,9900);assert.equal(buy.supplies.energy,50);assert.equal((await transactExpedition(db,uid,c,T)).alreadyProcessed,true);
  const charge=await transactExpedition(db,uid,command('buy',{itemId:'item.extraction_charge'}),T);assert.equal(charge.holosTokens,9800);assert.equal(charge.supplies.extractionCharges,1);
  const issue=await transactExpedition(db,uid,command('issue',{repairKits:1,carryExtractionCharge:true}),T);assert.deepEqual(issue.run.config,C.loadZoneExpeditionDefaults());
 });
});
test('actual callable refuses unresolved-fight extraction without spending charge or creating receipt',async()=>{
 const uid=await pilot();await selection(C.ZONE_EXPEDITION_DEFAULT_SELECTOR,async()=>{
  const issued=await transactExpedition(db,uid,command('issue',{repairKits:0,carryExtractionCharge:true}),T),runId=issued.run.runId;
  for(const sectorId of ['gate1','b1a'])await transactExpedition(db,uid,command('move',{runId,sectorId}),T);
  const ref=db.doc(`holoZoneRuns/${uid}/expeditions/${runId}`),before=(await ref.get()).data(),request=command('emergency_start',{runId});
  await assert.rejects(()=>holoZoneHost.run({auth:{uid},data:request}),e=>e.details?.rejectionCode==='encounter_pending');assert.deepEqual((await ref.get()).data(),before);
  assert.equal((await db.doc(`holoZoneRuns/${uid}/expeditionRequests/${request.requestId}`).get()).exists,false);assert.equal(before.charge,1);
  const fight=await transactExpedition(db,uid,command('fight',{runId,playerIntents:['strike','heavy','defend']}),T);assert.equal(fight.duelReceipt.winner,'player');
  const start=await transactExpedition(db,uid,request,T);assert.equal(start.run.charge,0);assert.equal(start.run.extraction.startedAtMs,T);
 });
});
