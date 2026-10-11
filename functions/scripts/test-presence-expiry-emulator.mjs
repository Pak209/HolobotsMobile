// M1 town presence: expiry gates on the LOCAL Firestore emulator (design 2026-10-10 §1: expiresAtMs = updatedAtMs + 90 s,
// rows past expiry are pruned whenever the host writes). Every clock is transactPresence's injected `now`; nothing sleeps.
// Own demo project namespace, so emulator files running in parallel can never prune (or be pruned by) these rows.
// Also: the parallel-heartbeat gate made deterministic (a forced read-read-commit-commit overlap) with its known-bad.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('LOCAL demo emulator only');
const require=createRequire(import.meta.url),{initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const {transactPresence}=require('../lib/presence/presenceStore.js'),P=require('../lib/presence/presenceDomain.js');
const db=getFirestore(initializeApp({projectId:'demo-holobots-presence-expiry'},'presence-expiry-tests'));
const T0=1_791_700_000_000, TTL=90_000, E=T0+TTL, SCENE=db.doc('presenceScenes/HoloCity_Main');
const heartbeat=(x=0)=>({schemaVersion:'presence-1',operation:'heartbeat',scene:'HoloCity_Main',pos:[x,0,0],yaw:0,deployed:['ace']});
const LEAVE={schemaVersion:'presence-1',operation:'leave'}, WAVE={schemaVersion:'presence-1',operation:'emote',emote:'wave'};
const pilots=async()=>(await SCENE.get()).data()?.pilots ?? {};
// Empty scene doc + freshly seeded profiles (each test starts from the same state).
async function fresh(...uids){await SCENE.delete();await Promise.all(uids.map(uid=>db.doc(`users/${uid}`).set({username:uid,holobots:[{name:'ACE',level:3,rank:'Rookie'}],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']}})));}
// 'edge' expires at exactly E; 'other' outlives it by 1 s.
async function edgeAndOther(){await fresh('edge','other','newcomer');await transactPresence(db,'edge',heartbeat(),T0);await transactPresence(db,'other',heartbeat(5),T0+1_000);}

test('a heartbeat row carries expiresAtMs = updatedAtMs + 90000, and the ack echoes it',async()=>{
 await fresh('ttl');const ack=await transactPresence(db,'ttl',heartbeat(),T0);const row=(await pilots()).ttl;
 assert.equal(P.PRESENCE_TTL_MS,90_000);assert.equal(row.updatedAtMs,T0);assert.equal(row.expiresAtMs,T0+90_000);assert.equal(row.expiresAtMs-row.updatedAtMs,90_000);
 assert.deepEqual(ack,{schemaVersion:'presence-1',visible:true,expiresAtMs:T0+90_000});
});
test('boundary: ANY pilot\'s next write at now == expiresAtMs prunes the row; the same write at expiresAtMs - 1 keeps it unchanged',async()=>{
 const writes={'heartbeat by another pilot':now=>transactPresence(db,'other',heartbeat(5),now),'leave by another pilot':now=>transactPresence(db,'other',LEAVE,now),'wave by another pilot':now=>transactPresence(db,'other',WAVE,now),'first heartbeat by a newcomer':now=>transactPresence(db,'newcomer',heartbeat(9),now)};
 for(const [label,write] of Object.entries(writes))for(const [now,survives] of [[E-1,true],[E,false]]){
  await edgeAndOther();const before=(await pilots()).edge;assert.equal(before.expiresAtMs,E);await write(now);const after=(await pilots()).edge;
  if(survives)assert.deepEqual(after,before,`${label} at E-1 must keep the row unchanged`);else assert.equal(after,undefined,`${label} at E must prune the row`);
 }
});
test('a fresh heartbeat refreshes expiresAtMs and moves the prune boundary with it',async()=>{
 await fresh('refresh','witness');await transactPresence(db,'refresh',heartbeat(),T0);const ack=await transactPresence(db,'refresh',heartbeat(2),T0+30_000);
 const row=(await pilots()).refresh;assert.equal(row.updatedAtMs,T0+30_000);assert.equal(row.expiresAtMs,T0+120_000);assert.equal(ack.expiresAtMs,T0+120_000);
 await transactPresence(db,'witness',heartbeat(),E);assert.deepEqual((await pilots()).refresh,row,'the old boundary no longer prunes it');
 await transactPresence(db,'witness',heartbeat(),T0+120_000-1);assert.deepEqual((await pilots()).refresh,row,'1 ms before the new boundary it survives');
 await transactPresence(db,'witness',heartbeat(),T0+120_000);assert.equal((await pilots()).refresh,undefined,'the new boundary prunes it');
});
test('an expired pilot\'s wave is refused (invalid_request), writes nothing and never resurrects the row',async()=>{
 await fresh('ghost','witness');await transactPresence(db,'ghost',heartbeat(),T0);await transactPresence(db,'witness',heartbeat(),T0+1_000);
 await transactPresence(db,'ghost',WAVE,E-1);const waved=(await pilots()).ghost;
 assert.equal(waved.emote,'wave');assert.equal(waved.emoteExpiresAtMs,E-1+P.EMOTE_TTL_MS);assert.equal(waved.expiresAtMs,E,'a wave never extends the row (only heartbeats do)');
 const before=(await SCENE.get()).data();await assert.rejects(()=>transactPresence(db,'ghost',WAVE,E),/invalid_request/);assert.deepEqual((await SCENE.get()).data(),before,'the refused wave wrote nothing');
 await transactPresence(db,'witness',heartbeat(),E);assert.equal((await pilots()).ghost,undefined);
 await assert.rejects(()=>transactPresence(db,'ghost',WAVE,E+1),/invalid_request/);assert.equal((await pilots()).ghost,undefined);
});
test('leave removes the caller\'s row immediately, long before expiry, without touching the other row',async()=>{
 await fresh('leaver','stayer');await transactPresence(db,'leaver',heartbeat(),T0);await transactPresence(db,'stayer',heartbeat(3),T0);const stayer=(await pilots()).stayer;
 const ack=await transactPresence(db,'leaver',LEAVE,T0+1);assert.deepEqual(ack,{schemaVersion:'presence-1',visible:false,expiresAtMs:0});
 let s=await pilots();assert.equal(s.leaver,undefined);assert.deepEqual(s.stayer,stayer);
 await transactPresence(db,'stayer',heartbeat(4),T0+2);assert.equal((await pilots()).leaver,undefined,'a later write does not bring it back');
});
test('a pruned row never reappears on later writes by other pilots',async()=>{
 await fresh('expired','a','b');await transactPresence(db,'expired',heartbeat(),T0);await transactPresence(db,'a',heartbeat(),T0+10_000);
 await transactPresence(db,'a',heartbeat(),E);assert.equal((await pilots()).expired,undefined);
 for(const [uid,command,now] of [['b',heartbeat(1),E+1],['a',WAVE,E+2],['b',LEAVE,E+3],['a',heartbeat(2),E+60_000],['b',heartbeat(3),E+60_001]]){
  await transactPresence(db,uid,command,now);assert.equal((await pilots()).expired,undefined,`${uid} ${command.operation} at E+${now-E}`);
 }
});
test('one pilot\'s expiry never touches another pilot\'s row (every field, including its wave)',async()=>{
 await fresh('short','long','writer');await transactPresence(db,'short',heartbeat(),T0);await transactPresence(db,'long',heartbeat(6),T0+60_000);await transactPresence(db,'long',WAVE,E-500);
 const long=(await pilots()).long;await transactPresence(db,'writer',heartbeat(),E);const s=await pilots();
 assert.equal(s.short,undefined);assert.deepEqual(s.long,long);assert.ok(s.writer);
});
// KNOWN-BAD control: copies of the prune rule with the boundary moved. Each must disagree with the real prunePresence exactly
// where the gates above look (and agree away from it), so a host shipping any of them fails those gates.
const keepIf=cmp=>(raw,now)=>({schemaVersion:'presence-1',pilots:Object.fromEntries(Object.entries(raw?.pilots ?? {}).filter(([,v])=>v && Number.isSafeInteger(v.expiresAtMs) && cmp(v.expiresAtMs,now)))});
const weakPrune=keepIf((exp,now)=>exp>=now), noExpiry=keepIf(()=>true), overPrune=keepIf((exp,now)=>exp>now+1);
test('KNOWN-BAD control: a >= prune keeps the boundary row prunePresence drops (pure and on the emulator); dropped / over-eager rules also disagree',async()=>{
 await edgeAndOther();const stored=(await SCENE.get()).data(),has=(state,uid='edge')=>uid in state.pilots;
 assert.equal(has(P.prunePresence(stored,E)),false);assert.equal(has(weakPrune(stored,E)),true,'>= keeps the row AT expiry');
 for(const t of [E-1,E+1])assert.deepEqual(Object.keys(weakPrune(stored,t).pilots).sort(),Object.keys(P.prunePresence(stored,t).pilots).sort(),`the >= copy agrees with the real rule at E${t-E>0?'+':''}${t-E}`);
 assert.equal(has(P.prunePresence(stored,E+10**9)),false);assert.equal(has(noExpiry(stored,E+10**9)),true,'no comparison keeps it forever');
 assert.equal(has(P.prunePresence(stored,E-1)),true);assert.equal(has(overPrune(stored,E-1)),false,'over-eager drops it 1 ms early');
 // The same boundary write on the emulator: a host pruning with >= leaves the row in the doc; the real host removes it.
 await db.runTransaction(async tx=>{const snap=await tx.get(SCENE);tx.set(SCENE,weakPrune(snap.data(),E));});
 assert.deepEqual((await pilots()).edge,stored.pilots.edge,'weak host: the boundary row is still in the doc');
 await SCENE.set(stored);await transactPresence(db,'other',heartbeat(5),E);
 assert.equal((await pilots()).edge,undefined,'real host: pruned');
});
// Forces read-read-commit-commit: each pilot's first attempt holds its commit until every pilot has read the scene doc.
// isolated=true runs the host's real transaction; false is the KNOWN-BAD runner (same reads and writes, no transaction).
function overlapped(n,isolated){let arrived=0,release,attempts=0;const all=new Promise(r=>release=r),hold=async()=>{if(arrived<n){arrived++;if(arrived===n)release();await all;}};
 const run=isolated?(fn,o)=>db.runTransaction(async tx=>{attempts++;const r=await fn(tx);await hold();return r;},o)
  :async fn=>{attempts++;const writes=[],r=await fn({get:ref=>ref.get(),set:(ref,data)=>writes.push([ref,data])});await hold();for(const [ref,data] of writes)await ref.set(data);return r;};
 return {db:new Proxy(db,{get:(t,p)=>p==='runTransaction'?run:(typeof t[p]==='function'?t[p].bind(t):t[p])}),attempts:()=>attempts};}
test('parallel heartbeats forced to overlap keep both rows (the conflict retries); KNOWN-BAD: the same overlap without a transaction loses one',async()=>{
 await fresh('pa','pb');const real=overlapped(2,true);await Promise.all(['pa','pb'].map(uid=>transactPresence(real.db,uid,heartbeat(),T0)));
 assert.deepEqual(Object.keys(await pilots()).sort(),['pa','pb']);assert.ok(real.attempts()>2,`the overlap really conflicted and retried (${real.attempts()} attempts)`);
 await fresh('pa','pb');const bad=overlapped(2,false);await Promise.all(['pa','pb'].map(uid=>transactPresence(bad.db,uid,heartbeat(),T0)));
 const rows=Object.keys(await pilots());assert.equal(['pa','pb'].filter(uid=>rows.includes(uid)).length,1,'no transaction: last write wins, one pilot is lost');
});
