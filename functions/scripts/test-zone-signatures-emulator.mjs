// zone-run-5 signature pilot through the real host transaction and callable. Demo emulator only; never production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {T,CONFIG,squadProfile} from './zone-signature-fixtures.mjs';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Loopback demo emulator required');
const {db}=require('../lib/admin.js'),{transactExpedition:run}=require('../lib/holozone/expeditionStore.js'),{holoZoneHost}=require('../lib/holozone/holoZoneHost.js');
const {SIGNATURE_COOLDOWN_MS:CD}=require('../lib/holozone/expedition.js');
let n=0;const id=()=>`zs_${Date.now()}_${n++}`;
async function setup(ids=['ace','wolf','hare']){const uid=id();await db.doc(`users/${uid}`).set(JSON.parse(JSON.stringify(squadProfile(ids))));return uid;}
const cmd=(operation,fields={},wire='zone-run-5')=>({schemaVersion:['extract','emergency_start','emergency_finish','wipe'].includes(operation)?'zone-extract-1':wire,operation,...(!['layout','status'].includes(operation)?{requestId:id()}:{}),...fields});
const call=(uid,c,now=T,signatures=true)=>run(db,uid,c,now,{config:CONFIG,signatures});
const side=(r,band,flag)=>r.layout.sectors.find(s=>s.band===band&&s[flag]).id;
const stored=async(uid,runId)=>(await db.doc(`holoZoneRuns/${uid}/expeditions/${runId}`).get()).data();

test('flag on: issue builds the pool; forecast then slipstream end to end; stored bookkeeping matches the replies',async()=>{
 const uid=await setup(),r=(await call(uid,cmd('issue',{repairKits:2,carryExtractionCharge:true}))).run,runId=r.runId;
 assert.equal(r.schemaVersion,'zone-run-5');assert.deepEqual(r.signaturePool,{forecast:{charges:2,max:2,holders:['wolf']},slipstream:{charges:1,max:1,holders:['ace','hare']}});
 assert.ok(r.layout.sectors.every(s=>Array.isArray(s.signatureBlocked)));
 await call(uid,cmd('move',{runId,sectorId:'gate1'}));
 const f=await call(uid,cmd('signature',{runId,signature:'forecast',holobotId:'wolf',targetSectorId:side(r,1,'cache')}));
 assert.equal(f.signatureResult.effect,'forecast');assert.deepEqual(f.run.forecasts,[f.signatureResult.forecast]);
 await call(uid,cmd('move',{runId,sectorId:side(r,1,'cache')}),T+CD);
 const sl=await call(uid,cmd('signature',{runId,signature:'slipstream',holobotId:'hare'}),T+CD);
 assert.equal(sl.signatureResult.opensSectorId,'gate2');assert.deepEqual(sl.run.slipOpened,[side(r,1,'cache')]);
 await assert.rejects(()=>call(uid,cmd('fight',{runId,playerIntents:['strike']}),T+CD),/sector_slipped/);
 const moved=await call(uid,cmd('move',{runId,sectorId:'gate2'}),T+CD);assert.equal(moved.run.sectorId,'gate2');
 const doc=await stored(uid,runId);assert.equal(doc.schemaVersion,'zone-run-3');assert.equal(doc.signatureAtMs,T+CD);assert.equal(doc.signaturePool.slipstream.charges,0);assert.equal(doc.signaturePool.forecast.charges,1);
});
test('concurrent identical signature spends once; replay returns the same signatureResult; changed identity conflicts',async()=>{
 const uid=await setup(),r=(await call(uid,cmd('issue',{repairKits:0,carryExtractionCharge:false}))).run,runId=r.runId;await call(uid,cmd('move',{runId,sectorId:'gate1'}));
 const c=cmd('signature',{runId,signature:'forecast',holobotId:'wolf',targetSectorId:side(r,1,'cache')});
 const replies=await Promise.all([call(uid,c),call(uid,c),call(uid,c)]);
 assert.equal(replies.filter(x=>!x.alreadyProcessed).length,1);for(const x of replies)assert.deepEqual(x.signatureResult,replies[0].signatureResult);
 const later=await call(uid,c,T+10*CD);assert.equal(later.alreadyProcessed,true);assert.deepEqual(later.signatureResult,replies[0].signatureResult);
 assert.equal((await stored(uid,runId)).signaturePool.forecast.charges,1);
 await assert.rejects(()=>call(uid,{...c,targetSectorId:side(r,1,'utility')}),/request_conflict/);
});
test('racing different signature requests: cooldown admits exactly one; the loser writes nothing',async()=>{
 const uid=await setup(['wolf','era','ace']),r=(await call(uid,cmd('issue',{repairKits:0,carryExtractionCharge:false}))).run,runId=r.runId;await call(uid,cmd('move',{runId,sectorId:'gate1'}));
 const a=cmd('signature',{runId,signature:'forecast',holobotId:'wolf',targetSectorId:side(r,1,'cache')}),b=cmd('signature',{runId,signature:'forecast',holobotId:'era',targetSectorId:side(r,1,'utility')});
 const out=await Promise.allSettled([call(uid,a),call(uid,b)]);
 assert.equal(out.filter(x=>x.status==='fulfilled').length,1);assert.match(String(out.find(x=>x.status==='rejected').reason),/signature_cooling/);
 const doc=await stored(uid,runId);assert.equal(doc.forecasts.length,1);assert.equal(doc.signaturePool.forecast.charges,1);
});
test('flag off (default): the callable refuses zone-run-5 invalid_request; zone-run-4 runs carry no signature fields',async()=>{
 process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG=JSON.stringify(CONFIG);delete process.env.HOLOCITY_ZONE_SIGNATURES;
 try{const uid=await setup(),host=data=>holoZoneHost.run({auth:{uid},data});
  await assert.rejects(()=>host(cmd('layout')),e=>e.code==='invalid-argument'&&e.details.rejectionCode==='invalid_request');
  const r=(await host(cmd('issue',{repairKits:0,carryExtractionCharge:false},'zone-run-4'))).run;assert.ok(!('signaturePool' in r));
  const doc=await stored(uid,r.runId);assert.ok(!('signaturePool' in doc)&&!('signatureAtMs' in doc));
  await assert.rejects(()=>host(cmd('signature',{runId:r.runId,signature:'slipstream',holobotId:'ace'})),e=>e.details.rejectionCode==='invalid_request');
 }finally{delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;}
});
test('flag on via env: the callable routes zone-run-5; signature_cooling maps to failed-precondition with retryAfterMs',async()=>{
 process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG=JSON.stringify(CONFIG);process.env.HOLOCITY_ZONE_SIGNATURES='pilot-1';
 try{const uid=await setup(),host=data=>holoZoneHost.run({auth:{uid},data});
  const r=(await host(cmd('issue',{repairKits:0,carryExtractionCharge:false}))).run,runId=r.runId;assert.equal(r.schemaVersion,'zone-run-5');
  await host(cmd('move',{runId,sectorId:'gate1'}));
  const ok=await host(cmd('signature',{runId,signature:'forecast',holobotId:'wolf',targetSectorId:side(r,1,'cache')}));assert.equal(ok.signatureResult.spent,true);
  await assert.rejects(()=>host(cmd('signature',{runId,signature:'forecast',holobotId:'wolf',targetSectorId:side(r,1,'utility')})),
   e=>e.code==='failed-precondition'&&e.details.rejectionCode==='signature_cooling'&&Number.isInteger(e.details.retryAfterMs)&&e.details.retryAfterMs>0&&e.details.retryAfterMs<=CD);
  await assert.rejects(()=>host(cmd('signature',{runId,signature:'snare',holobotId:'ace'})),e=>e.details.rejectionCode==='signature_unknown');
 }finally{delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;delete process.env.HOLOCITY_ZONE_SIGNATURES;}
});
