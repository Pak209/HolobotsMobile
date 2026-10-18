// zone-run-4 utility results through the real host transaction and callable. Demo emulator only; never production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {T,CONFIG,profile} from './zone-expedition-fixtures.mjs';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Loopback demo emulator required');
const {db}=require('../lib/admin.js'),{transactExpedition:run}=require('../lib/holozone/expeditionStore.js'),{holoZoneHost}=require('../lib/holozone/holoZoneHost.js');
const {UTILITY_COOLDOWN_MS:CD}=require('../lib/holozone/expedition.js');
let n=0;const id=()=>`zu_${Date.now()}_${n++}`,user=async uid=>(await db.doc(`users/${uid}`).get()).data();
async function setup(){const uid=id();await db.doc(`users/${uid}`).set(JSON.parse(JSON.stringify(profile())));return uid;}
const cmd=(operation,fields={},wire='zone-run-4')=>({schemaVersion:['extract','emergency_start','emergency_finish','wipe'].includes(operation)?'zone-extract-1':wire,operation,...(!['layout','status'].includes(operation)?{requestId:id()}:{}),...fields});
const call=(uid,c,now=T)=>run(db,uid,c,now,{config:CONFIG});
const utilityAt=(r,band)=>r.layout.sectors.find(s=>s.band===band&&s.utility);
async function enter(uid,wire='zone-run-4'){return (await call(uid,cmd('issue',{repairKits:2,carryExtractionCharge:true},wire))).run;}
async function walk(uid,runId,band,now=T,wire='zone-run-4'){await call(uid,cmd('move',{runId,sectorId:`gate${band}`},wire),now);}

test('zone-run-4 layout/status/issue replies: preview copy on the layout, utilityUsed on the run; zone-run-3 unchanged',async()=>{
 const uid=await setup(),layout=await call(uid,cmd('layout'));assert.equal(layout.schemaVersion,'zone-run-4');
 assert.ok(layout.layout.sectors.every(s=>typeof s.glimpse==='string'&&(s.band===0?!('dangerLabel' in s):typeof s.dangerLabel==='string')));
 const old=await call(uid,cmd('layout',{},'zone-run-3'));assert.equal(old.schemaVersion,'zone-run-3');assert.ok(old.layout.sectors.every(s=>!('glimpse' in s)&&!('dangerLabel' in s)));
 const r=await enter(uid);assert.equal(r.schemaVersion,'zone-run-4');assert.deepEqual(r.utilityUsed,[]);assert.ok(!('utilityAtMs' in r)&&!('privateSeed' in r));
 const s3=await call(uid,cmd('status',{},'zone-run-3'));assert.equal(s3.run.schemaVersion,'zone-run-3');assert.ok(!('utilityUsed' in s3.run));
 const stored=(await db.doc(`holoZoneRuns/${uid}/expeditions/${r.runId}`).get()).data();assert.equal(stored.schemaVersion,'zone-run-3');assert.deepEqual(stored.utilityUsed,[]);assert.equal(stored.utilityAtMs,null);
});
test('ACE route, SHADOW cache, KUMA clear end to end; shadow loot unbanked until extraction then banked once',async()=>{
 const uid=await setup(),r=await enter(uid),runId=r.runId;
 await walk(uid,runId,1);await call(uid,cmd('move',{runId,sectorId:utilityAt(r,1).id}));
 const ace=await call(uid,cmd('utility',{runId,utility:'ace'}));assert.equal(ace.utilityResult.effect,'route');assert.equal(ace.utilityResult.opensSectorId,'gate2');assert.deepEqual(ace.run.utilityUsed,[utilityAt(r,1).id]);
 await walk(uid,runId,2);await call(uid,cmd('move',{runId,sectorId:utilityAt(r,2).id}));
 const shadow=await call(uid,cmd('utility',{runId,utility:'shadow'}),T+CD);assert.equal(shadow.utilityResult.effect,'cache');assert.equal(shadow.utilityResult.haul.length,1);
 assert.equal((await user(uid)).itemStocks.blueprint_fragment,10);
 await call(uid,cmd('fight',{runId,playerIntents:['strike','heavy','defend']}),T+CD);await walk(uid,runId,3,T+CD);await call(uid,cmd('move',{runId,sectorId:utilityAt(r,3).id}),T+CD);
 const kuma=await call(uid,cmd('utility',{runId,utility:'kuma'}),T+2*CD);assert.equal(kuma.utilityResult.effect,'clear');assert.ok(kuma.run.cleared.includes(utilityAt(r,3).id));assert.equal(kuma.run.utilityUsed.length,3);
 await call(uid,cmd('move',{runId,sectorId:'gate3'}),T+2*CD);const done=await call(uid,cmd('extract',{runId,mode:'normal'}),T+2*CD);
 assert.equal(done.schemaVersion,'zone-extract-1');assert.ok(!('utilityUsed' in done.run));assert.ok(done.receipt.banked.some(h=>h.id===shadow.utilityResult.haul[0].id));
 const u=await user(uid);assert.equal(u.itemStocks.blueprint_fragment,11);assert.equal(u.expeditionBank.rareBlueprints,shadow.utilityResult.haul[0].kind==='rare_blueprint_fragment'?1:0);
});
test('concurrent identical utility applies once; replay returns the same utilityResult without re-applying; changed identity conflicts',async()=>{
 const uid=await setup(),r=await enter(uid),runId=r.runId;await walk(uid,runId,1);
 const at=utilityAt(r,1);await call(uid,cmd('move',{runId,sectorId:at.id}));
 const c=cmd('utility',{runId,utility:'ace'}),replies=await Promise.all([call(uid,c),call(uid,c),call(uid,c)]);
 assert.equal(replies.filter(x=>!x.alreadyProcessed).length,1);for(const x of replies)assert.deepEqual(x.utilityResult,replies[0].utilityResult);
 const later=await call(uid,c,T+10*CD);assert.equal(later.alreadyProcessed,true);assert.deepEqual(later.utilityResult,replies[0].utilityResult);
 const stored=(await db.doc(`holoZoneRuns/${uid}/expeditions/${runId}`).get()).data();assert.deepEqual(stored.utilityUsed,[at.id]);assert.equal(stored.utilityAtMs,T);
 await assert.rejects(()=>call(uid,{...c,utility:'kuma'}),/request_conflict/);
});
test('callable: zone-run-4 routed; utility_spent and utility_cooling map to failed-precondition with retryAfterMs; refusal writes nothing',async()=>{
 process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG=JSON.stringify(CONFIG);
 try{const uid=await setup(),host=data=>holoZoneHost.run({auth:{uid},data});
  const r=(await host(cmd('issue',{repairKits:0,carryExtractionCharge:false}))).run,runId=r.runId;assert.equal(r.schemaVersion,'zone-run-4');
  await host(cmd('move',{runId,sectorId:'gate1'}));await host(cmd('move',{runId,sectorId:utilityAt(r,1).id}));
  const ok=await host(cmd('utility',{runId,utility:'ace'}));assert.equal(ok.utilityResult.spent,true);
  const before=(await db.doc(`holoZoneRuns/${uid}/expeditions/${runId}`).get()).data();
  await assert.rejects(()=>host(cmd('utility',{runId,utility:'ace'})),e=>e.code==='failed-precondition'&&e.details.rejectionCode==='utility_spent');
  await host(cmd('move',{runId,sectorId:'gate2'}));await host(cmd('move',{runId,sectorId:utilityAt(r,2).id}));
  await assert.rejects(()=>host(cmd('utility',{runId,utility:'shadow'})),e=>e.code==='failed-precondition'&&e.details.rejectionCode==='utility_cooling'&&Number.isInteger(e.details.retryAfterMs)&&e.details.retryAfterMs>0&&e.details.retryAfterMs<=CD);
  const after=(await db.doc(`holoZoneRuns/${uid}/expeditions/${runId}`).get()).data();assert.deepEqual(after.utilityUsed,before.utilityUsed);assert.equal(after.haul.length,0);
 }finally{delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;}
});
test('zone-run-3 client on the same run: same ruling, deployed reply shape (no utilityResult / utilityUsed)',async()=>{
 const uid=await setup(),r=await enter(uid,'zone-run-3'),runId=r.runId;assert.ok(!('utilityUsed' in r));
 await walk(uid,runId,1,T,'zone-run-3');await call(uid,cmd('move',{runId,sectorId:utilityAt(r,1).id},'zone-run-3'));
 const x=await call(uid,cmd('utility',{runId,utility:'ace'},'zone-run-3'));assert.deepEqual(Object.keys(x),['schemaVersion','operation','run','receipt','alreadyProcessed']);assert.equal(x.schemaVersion,'zone-run-3');
 const v4=await call(uid,cmd('status'));assert.deepEqual(v4.run.utilityUsed,[utilityAt(r,1).id]);
 await assert.rejects(()=>call(uid,cmd('utility',{runId,utility:'ace'},'zone-run-3')),/utility_spent/);
 const moved=await call(uid,cmd('move',{runId,sectorId:'gate2'},'zone-run-3'));assert.equal(moved.run.sectorId,'gate2');
});
