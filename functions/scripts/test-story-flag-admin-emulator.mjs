import test,{after} from 'node:test';import assert from 'node:assert/strict';

import {credentialMode,updateStoryFlags,createUserFirestore} from './admin/story-flags.mjs';
const project=process.env.GCLOUD_PROJECT;if(credentialMode(process.env,project)!=='emulator')throw Error('Demo emulator only');
const db=await createUserFirestore(project),uid=`story_admin_throwaway_${Date.now()}`,other=uid+'_other';
after(async()=>{await db.doc(`users/${uid}`).delete();await db.doc(`users/${other}`).delete();await db.terminate();});
test('transaction updates exactly selected fields of one existing UID with before/after',async()=>{
 const original={storyFlags:{arenaGatheringSeen:true,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false,extraFlag:'untouched'},pilotRank:2,holosTokens:731,holobots:[{name:'ACE',level:4}],privateField:{keep:true}};
 await db.doc(`users/${uid}`).set(original);await db.doc(`users/${other}`).set(original);
 const result=await updateStoryFlags(db,{uid,project,updates:{'storyFlags.holoZonesArcBuilt':true,pilotRank:9}});
 assert.equal(result.before.pilotRank,2);assert.equal(result.after.pilotRank,9);assert.equal(result.after.storyFlags.holoZonesArcBuilt,true);assert.equal(Object.hasOwn(result.before,'privateField'),false);
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),{...original,pilotRank:9,storyFlags:{...original.storyFlags,holoZonesArcBuilt:true}});
 assert.deepEqual((await db.doc(`users/${other}`).get()).data(),original);
 const before=(await db.doc(`users/${uid}`).get()).data();
 await assert.rejects(()=>updateStoryFlags(db,{uid,project,updates:{'storyFlags.arenaArcBuilt':true}}),/tournamentsWon/);
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),before);
});
test('unknown UID and unapproved fields never upsert or write',async()=>{
 const missing=uid+'_absent';await assert.rejects(()=>updateStoryFlags(db,{uid:missing,project,updates:{pilotRank:0}}),/Unknown UID/);assert.equal((await db.doc(`users/${missing}`).get()).exists,false);
 await assert.rejects(()=>updateStoryFlags(db,{uid,project,updates:{holosTokens:100000}}),/Unapproved/);
});
