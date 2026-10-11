import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('LOCAL demo emulator only');
const require=createRequire(import.meta.url),{db}=require('../lib/admin.js'),{transactPresence}=require('../lib/presence/presenceStore.js'),{presenceHost}=require('../lib/presence/presenceHost.js'),{deleteUserData}=require('../lib/account/deleteUserAccount.js');
const now=Date.now(), request={schemaVersion:'presence-1',operation:'heartbeat',scene:'HoloCity_Main',pos:[1,2,3],yaw:20,deployed:['ace']};
const seed=uid=>db.doc(`users/${uid}`).set({username:uid,holobots:[{name:'ACE',level:1,rank:'Rookie'}],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']}});
const scene=async()=>(await db.doc('presenceScenes/HoloCity_Main').get()).data();
test('KNOWN-BAD first: unauthenticated/server principals refused and invalid deployment writes nothing',async()=>{
 await assert.rejects(()=>presenceHost.run({data:request}),e=>e.code==='unauthenticated');await assert.rejects(()=>presenceHost.run({auth:{uid:'srv_dev',token:{holoServer:true}},data:request}),e=>e.code==='permission-denied');
 await seed('bad');const before=await scene();await assert.rejects(()=>transactPresence(db,'bad',{...request,deployed:['kuma']},now),/invalid_request/);assert.deepEqual(await scene(),before);
});
test('parallel heartbeats keep both pilots; point row is projected from profiles; leave, opt-out, deletion remove it',async()=>{
 await Promise.all(['alice','bob'].map(seed));await Promise.all(['alice','bob'].map(uid=>transactPresence(db,uid,request,now)));
 let s=await scene();assert.equal(s.pilots.alice.username,'alice');assert.equal(s.pilots.bob.username,'bob');
 await transactPresence(db,'alice',{schemaVersion:'presence-1',operation:'emote',emote:'wave'},now+100);s=await scene();assert.equal(s.pilots.alice.emote,'wave');assert.equal(s.pilots.alice.emoteExpiresAtMs,now+3100);
 await transactPresence(db,'alice',{schemaVersion:'presence-1',operation:'leave'},now+200);assert.equal((await scene()).pilots.alice,undefined);assert.ok((await scene()).pilots.bob);
 await db.doc('users/bob').update({presenceOptOut:true});await transactPresence(db,'bob',request,now+300);assert.equal((await scene()).pilots.bob,undefined);
 await seed('deleted');await transactPresence(db,'deleted',request,now+400);await deleteUserData(db,'deleted');assert.equal((await scene()).pilots.deleted,undefined);
 await transactPresence(db,'deleted',request,now+500);assert.equal((await scene()).pilots.deleted,undefined,'a heartbeat after profile deletion cannot resurrect the row');
});
test('expiry pruned on write; expired emote fails rather than reviving an absent pilot',async()=>{
 await seed('stale');await seed('fresh');await transactPresence(db,'stale',request,now);await transactPresence(db,'fresh',request,now+90001);assert.equal((await scene()).pilots.stale,undefined);await assert.rejects(()=>transactPresence(db,'stale',{schemaVersion:'presence-1',operation:'emote',emote:'wave'},now+90001),/invalid_request/);
});
