import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??''))throw Error('Local emulator required');process.env.GCLOUD_PROJECT='demo-holobots-wardrobe';
const require=createRequire(import.meta.url),{db}=require('../lib/admin.js'),{transactWardrobe:T}=require('../lib/vendors/wardrobeStore.js'),{deleteUserData:D}=require('../lib/account/deleteUserAccount.js');
const uid='wardrobe_'+Date.now(),c={schemaVersion:'wardrobe-1',requestId:'buy',operation:'purchase',itemId:'legs-courier'};
test('transaction retries, concurrency, refusal, equip and account deletion',async()=>{
await db.doc(`users/${uid}`).set({holosTokens:600});const results=await Promise.all([T(db,uid,c),T(db,uid,c)]);assert.equal(results.filter(r=>r.alreadyProcessed).length,1);assert.equal((await db.doc(`users/${uid}`).get()).get('holosTokens'),300);
await assert.rejects(T(db,uid,{...c,itemId:'feet-courier'}),/sequence_conflict/);
const r=await T(db,uid,{...c,requestId:'second'});assert.equal(r.holosTokens,300);
await assert.rejects(T(db,uid,{...c,requestId:'expensive',itemId:'hair-silver'}),/not_enough_holos/);assert.equal((await db.doc(`wardrobes/${uid}/receipts/expensive`).get()).exists,false);
await T(db,uid,{schemaVersion:'wardrobe-1',requestId:'equip',operation:'equip',recipe:{schemaVersion:'wardrobe-1',frame:'pilot-a',parts:{hair:'hair-cyan',body:'body-base',jacket:'jacket-vector',pants:'legs-courier',footwear:'feet-hyper'}}});assert.equal((await db.doc(`wardrobes/${uid}`).get()).get('recipe.parts.pants'),'legs-courier');
await D(db,uid);assert.equal((await db.doc(`wardrobes/${uid}`).get()).exists,false);assert.equal((await db.collection(`wardrobes/${uid}/receipts`).get()).size,0);
});
test('callable rejects anonymous requests and returns only the signed-in wardrobe',async()=>{
 const {wardrobeHost}=require('../lib/vendors/wardrobeHost.js');
 await assert.rejects(wardrobeHost.run({data:{operation:'read',schemaVersion:'wardrobe-1'}}),e=>e.code==='unauthenticated');
 const u=uid+'_read';await db.doc(`users/${u}`).set({holosTokens:0});await db.doc(`wardrobes/${u}`).set({entitlements:['feet-night'],recipe:null});
 const result=await wardrobeHost.run({auth:{uid:u,token:{}},data:{operation:'read',schemaVersion:'wardrobe-1',uid:'someone_else'}});assert.deepEqual(result.entitlements,['feet-night']);await D(db,u);
});
