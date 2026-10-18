import test,{after} from 'node:test';import assert from 'node:assert/strict';

import {Firestore} from '@google-cloud/firestore';
import {credentialMode,updateStoryFlags as updateViaRest,createRestClient} from './admin/story-flags.mjs';
const project=process.env.GCLOUD_PROJECT;if(credentialMode(process.env,project)!=='emulator')throw Error('Demo emulator only');
// Seeding/verification goes through the client library (independent transport); the tool under test speaks REST.
const db=new Firestore({projectId:project}),uid=`story_admin_throwaway_${Date.now()}`,other=uid+'_other';
const calls=[];let beforePatch=null;
const client=await createRestClient({project,fetchImpl:async(url,init)=>{calls.push(init.method);if(init.method==='POST'&&String(url).endsWith(':commit')&&beforePatch){const hook=beforePatch;beforePatch=null;await hook();}return fetch(url,init);}});
const updateStoryFlags=(_db,options)=>updateViaRest(client,options);
after(async()=>{await db.doc(`users/${uid}`).delete();await db.doc(`users/${other}`).delete();await db.terminate();});
test('one masked write updates exactly selected fields of one existing UID with before/after',async()=>{
 const original={storyFlags:{arenaGatheringSeen:true,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false,extraFlag:'untouched'},pilotRank:2,holosTokens:731,holobots:[{name:'ACE',level:4}],privateField:{keep:true}};
 await db.doc(`users/${uid}`).set(original);await db.doc(`users/${other}`).set(original);
 const result=await updateStoryFlags(db,{uid,project,updates:{'storyFlags.holoZonesArcBuilt':true,pilotRank:9}});
 assert.equal(result.before.pilotRank,2);assert.equal(result.after.pilotRank,9);assert.equal(result.after.storyFlags.holoZonesArcBuilt,true);assert.equal(Object.hasOwn(result.before,'privateField'),false);
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),{...original,pilotRank:9,storyFlags:{...original.storyFlags,holoZonesArcBuilt:true}});
 assert.deepEqual((await db.doc(`users/${other}`).get()).data(),original);
 const before=(await db.doc(`users/${uid}`).get()).data();
 await assert.rejects(()=>updateStoryFlags(db,{uid,project,updates:{'storyFlags.arenaArcBuilt':'invalid'}}),/exactly/);
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),before);
});
test('unknown UID and unapproved fields never upsert or write',async()=>{
 const missing=uid+'_absent';await assert.rejects(()=>updateStoryFlags(db,{uid:missing,project,updates:{pilotRank:0}}),/Unknown UID/);assert.equal((await db.doc(`users/${missing}`).get()).exists,false);
 await assert.rejects(()=>updateStoryFlags(db,{uid,project,updates:{holosTokens:100000}}),/Unapproved/);
});

test('Arena enable atomically completes all three fields, prints before/after and replays safely',async()=>{
 const original={storyFlags:{arenaGatheringSeen:false,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false,extraFlag:'untouched'},pilotRank:2,holosTokens:731,privateField:{keep:true}};
 await db.doc(`users/${uid}`).set(original);await db.doc(`users/${other}`).set(original);
 const options={uid,project,updates:{'storyFlags.arenaArcBuilt':true,pilotRank:9}};
 const result=await updateStoryFlags(db,options);
 const expected={...original,pilotRank:9,storyFlags:{...original.storyFlags,arenaGatheringSeen:true,tournamentsWon:3,arenaArcBuilt:true}};
 assert.deepEqual(result.before,{storyFlags:original.storyFlags,pilotRank:2});
 assert.deepEqual(result.after,{storyFlags:expected.storyFlags,pilotRank:9});
 assert.deepEqual(new Set(result.changedFields),new Set(['pilotRank','storyFlags.arenaArcBuilt','storyFlags.arenaGatheringSeen','storyFlags.tournamentsWon']));
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),expected);
 assert.deepEqual((await db.doc(`users/${other}`).get()).data(),original);
 const replay=await updateStoryFlags(db,options);assert.deepEqual(replay.before,replay.after);
 await assert.rejects(()=>updateStoryFlags(db,{uid,project,updates:{'storyFlags.arenaArcBuilt':false}}),/tournamentsWon/);
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),expected);
 await assert.rejects(()=>updateStoryFlags(db,{uid,project,updates:{'storyFlags.tournamentsWon':1}}),/Unapproved/);
});

test('a concurrent host write between the read and the commit refuses (updateTime precondition) and is not clobbered',async()=>{
 const original={storyFlags:{arenaGatheringSeen:true,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false},pilotRank:2,holosTokens:731};
 await db.doc(`users/${uid}`).set(original);
 beforePatch=()=>db.doc(`users/${uid}`).update({pilotRank:5,holosTokens:800});calls.length=0;
 await assert.rejects(()=>updateStoryFlags(db,{uid,project,updates:{pilotRank:9,'storyFlags.holoZonesArcBuilt':true}}),/concurrent write/);
 assert.deepEqual(calls,['GET','POST']);
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),{...original,pilotRank:5,holosTokens:800});
 const retry=await updateStoryFlags(db,{uid,project,updates:{pilotRank:9}});assert.equal(retry.before.pilotRank,5);assert.equal(retry.after.pilotRank,9);
 assert.equal((await db.doc(`users/${uid}`).get()).data().holosTokens,800);
});
test('a document deleted between the read and the commit is not recreated (no upsert)',async()=>{
 const ghost=uid+'_ghost';await db.doc(`users/${ghost}`).set({storyFlags:{tournamentsWon:0},pilotRank:1});
 beforePatch=()=>db.doc(`users/${ghost}`).delete();
 await assert.rejects(()=>updateStoryFlags(db,{uid:ghost,project,updates:{pilotRank:2}}),/concurrent write|Unknown UID/);
 assert.equal((await db.doc(`users/${ghost}`).get()).exists,false);
});
