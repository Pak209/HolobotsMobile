// zone-run-5 signatures x zone-run-6 real-time: the four flag cells through the real host transaction. Demo emulator only.
// HOLOCITY_FIGHT_REPLAY is on in production, so every cell runs with it on; "neither" also runs with it unset.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {T,CONFIG,squadProfile} from './zone-signature-fixtures.mjs';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Loopback demo emulator required');
const {db}=require('../lib/admin.js'),{transactExpedition}=require('../lib/holozone/expeditionStore.js');
const FLAGS=['HOLOCITY_ZONE_SIGNATURES','HOLOZONE_EXPEDITION_REALTIME','HOLOCITY_FIGHT_REPLAY'];
const CELLS={
 neither_replay_off:{},
 neither:{HOLOCITY_FIGHT_REPLAY:'1'},
 signatures:{HOLOCITY_FIGHT_REPLAY:'1',HOLOCITY_ZONE_SIGNATURES:'pilot-1'},
 realtime:{HOLOCITY_FIGHT_REPLAY:'1',HOLOZONE_EXPEDITION_REALTIME:'1'},
 both:{HOLOCITY_FIGHT_REPLAY:'1',HOLOCITY_ZONE_SIGNATURES:'pilot-1',HOLOZONE_EXPEDITION_REALTIME:'1'},
};
function cell(name){for(const k of FLAGS)delete process.env[k];Object.assign(process.env,CELLS[name]);}
test.afterEach(()=>{for(const k of FLAGS)delete process.env[k];});
let n=0;const id=()=>`zm_${Date.now()}_${n++}`;
async function user(){const uid=id();await db.doc(`users/${uid}`).set(JSON.parse(JSON.stringify(squadProfile(['ace','wolf','hare'],10))));return uid;}
const cmd=(wire,operation,fields={})=>({schemaVersion:wire,operation,...(!['layout','status'].includes(operation)?{requestId:id()}:{}),...fields});
// Signature flag comes from the environment (options.signatures omitted), exactly as the callable reads it.
const call=(uid,c,now=T)=>transactExpedition(db,uid,c,now,{config:CONFIG,seed:()=>7,newId:()=>'matrix_run'});
const code=async p=>{try{await p;return 'ok';}catch(e){if(!e.code)throw e;return e.code;}};
const stored=async uid=>(await db.doc(`holoZoneRuns/${uid}/expeditions/matrix_run`).get()).data();
const issue=(wire,extra={})=>cmd(wire,'issue',{repairKits:1,carryExtractionCharge:false,...extra});
const V6=wire=>wire==='zone-run-6'?{duelInputs:'duel-inputs-2'}:{};

/** A zone-run-4 run issued with every new flag off, then played on under the given cell. */
async function legacyFlow(name){
 cell('neither_replay_off');const uid=await user();
 const replies=[await call(uid,issue('zone-run-4'))];const r=replies[0].run;
 cell(name);
 const band1=r.layout.sectors.find(s=>s.band===1&&!s.safe&&s.cache).id;
 replies.push(await call(uid,cmd('zone-run-4','move',{runId:'matrix_run',sectorId:'gate1'}),T+1000));
 replies.push(await call(uid,cmd('zone-run-3','move',{runId:'matrix_run',sectorId:band1}),T+2000));
 replies.push(await call(uid,cmd('zone-run-4','fight',{runId:'matrix_run',playerIntents:['strike','strike','defend']}),T+3000));
 replies.push(await call(uid,cmd('zone-run-4','status'),T+4000));
 replies.push(await call(uid,cmd('zone-run-3','layout'),T+4000));
 return {replies,doc:await stored(uid)};
}

test('an already-issued zone-run-3/4 run replies and stores byte-identically in every flag cell',async()=>{
 const base=await legacyFlow('neither_replay_off');
 assert.ok(!('signaturePool' in base.doc)&&!('realtime' in base.doc)&&!('pendingFight' in base.doc));
 for(const name of Object.keys(CELLS)){
  const got=await legacyFlow(name);
  assert.equal(JSON.stringify(got.replies),JSON.stringify(base.replies),name);
  assert.equal(JSON.stringify(got.doc),JSON.stringify(base.doc),name);
 }
});

test('issue matrix: which wire each cell accepts or refuses',async()=>{
 const expected={
  neither_replay_off:{'zone-run-3':'ok','zone-run-4':'ok','zone-run-5':'invalid_request','zone-run-6':'invalid_request'},
  neither:{'zone-run-3':'ok','zone-run-4':'ok','zone-run-5':'invalid_request','zone-run-6':'invalid_request'},
  signatures:{'zone-run-3':'ok','zone-run-4':'ok','zone-run-5':'ok','zone-run-6':'invalid_request'},
  // zone-run-6 (#215): while real-time is on, every older issue is client_update_required. That includes zone-run-5.
  realtime:{'zone-run-3':'client_update_required','zone-run-4':'client_update_required','zone-run-5':'invalid_request','zone-run-6':'ok'},
  both:{'zone-run-3':'client_update_required','zone-run-4':'client_update_required','zone-run-5':'client_update_required','zone-run-6':'ok'},
 };
 for(const [name,row] of Object.entries(expected))for(const [wire,want] of Object.entries(row)){
  cell(name);const uid=await user();
  assert.equal(await code(call(uid,issue(wire,V6(wire)))),want,`${name} ${wire}`);
 }
});

test('real-time off: every zone-run-6 operation is refused invalid_request, as main answers an unknown version',async()=>{
 for(const name of ['neither_replay_off','neither','signatures']){cell(name);const uid=await user();
  for(const c of [cmd('zone-run-6','layout'),cmd('zone-run-6','status'),issue('zone-run-6',V6('zone-run-6')),cmd('zone-run-6','move',{runId:'matrix_run',sectorId:'gate1'}),
   cmd('zone-run-6','engage',{runId:'matrix_run',duelInputs:'duel-inputs-2'}),cmd('zone-run-6','flee',{runId:'matrix_run',fightId:'ef_x'})])
   assert.equal(await code(call(uid,c)),'invalid_request',`${name} ${c.operation}`);}
});

test('duelInputs is a zone-run-6 field only: older issue requests keep their exact key set in every cell',async()=>{
 for(const name of Object.keys(CELLS)){cell(name);const uid=await user();
  for(const wire of ['zone-run-3','zone-run-4'])assert.equal(await code(call(uid,issue(wire,{duelInputs:'duel-inputs-2'}))),'invalid_request',`${name} ${wire}`);}
});

test('signatures only: zone-run-5 run carries the pool and spends; no real-time fields',async()=>{
 cell('signatures');const uid=await user();
 const r=(await call(uid,issue('zone-run-5'))).run;
 assert.deepEqual(Object.keys(r.signaturePool).sort(),['forecast','slipstream']);
 await call(uid,cmd('zone-run-5','move',{runId:'matrix_run',sectorId:'gate1'}),T+1000);
 const target=r.layout.sectors.find(s=>s.band===1&&!s.safe&&s.cache).id;
 const f=await call(uid,cmd('zone-run-5','signature',{runId:'matrix_run',signature:'forecast',holobotId:'wolf',targetSectorId:target}),T+2000);
 assert.equal(f.signatureResult.spent,true);
 const doc=await stored(uid);assert.ok(!('realtime' in doc)&&!('pendingFight' in doc));
 for(const k of ['realtime','pendingFight','serverNowMs'])assert.ok(!(k in f.run)&&!(k in f),k);
 // Real-time off: zone-run-6 is an unknown version even for a status read.
 await assert.rejects(()=>call(uid,cmd('zone-run-6','status'),T+3000),/invalid_request/);
});

test('real-time only and both: zone-run-6 run stores no signature bookkeeping and refuses the signature wire',async()=>{
 for(const name of ['realtime','both']){
  cell(name);const uid=await user();
  const r=(await call(uid,issue('zone-run-6',V6('zone-run-6')))).run;
  assert.equal(r.schemaVersion,'zone-run-6');assert.ok(!('signaturePool' in r),name);
  const doc=await stored(uid);assert.equal(doc.realtime,true);
  for(const k of ['signaturePool','signatureArmed','forecasts','slipOpened','protectedSlots','signatureAtMs'])assert.ok(!(k in doc),`${name} ${k}`);
  await call(uid,cmd('zone-run-6','move',{runId:'matrix_run',sectorId:'gate1'}),T+1000);
  const band1=r.layout.sectors.find(s=>s.band===1&&!s.safe&&s.cache).id;
  await call(uid,cmd('zone-run-6','move',{runId:'matrix_run',sectorId:band1}),T+2000);
  const e=await call(uid,cmd('zone-run-6','engage',{runId:'matrix_run',duelInputs:'duel-inputs-2'}),T+3000);
  assert.equal(e.fightIssue.encounter.kind,'expedition');
  // The signature operation exists only on zone-run-5; a real-time run never answers it.
  const want=name==='both'?'client_update_required':'invalid_request';
  assert.equal(await code(call(uid,cmd('zone-run-5','signature',{runId:'matrix_run',signature:'slipstream',holobotId:'ace'}),T+4000)),want,name);
 }
});

test('both: a zone-run-5 run issued before real-time was switched on keeps its signatures',async()=>{
 cell('signatures');const uid=await user();
 const r=(await call(uid,issue('zone-run-5'))).run;
 cell('both');
 await call(uid,cmd('zone-run-5','move',{runId:'matrix_run',sectorId:'gate1'}),T+1000);
 const target=r.layout.sectors.find(s=>s.band===1&&!s.safe&&s.cache).id;
 const f=await call(uid,cmd('zone-run-5','signature',{runId:'matrix_run',signature:'forecast',holobotId:'wolf',targetSectorId:target}),T+2000);
 assert.equal(f.signatureResult.effect,'forecast');
 await assert.rejects(()=>call(uid,cmd('zone-run-6','engage',{runId:'matrix_run',duelInputs:'duel-inputs-2'}),T+3000),/client_update_required/);
});
