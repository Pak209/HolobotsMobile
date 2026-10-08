import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw new Error('Local demo emulator required');
const {db}=require('../lib/admin.js');
const {desktopAccountSnapshot}=require('../lib/desktop/desktopAccountSnapshot.js');
const {createGenesisProfile}=require('../lib/account/createGenesisProfile.js');
const {transactTravelSquad}=require('../lib/acquisition/travelSquadStore.js');
let serial=0;
const uid=()=>`first_squad_${Date.now()}_${serial++}`;
const snapshot=id=>desktopAccountSnapshot.run({auth:{uid:id},data:{schemaVersion:'desktop-account-3'}});
test('new signup stores its chosen starter in slot one, repeated signup leaves it unchanged',async()=>{
 const id=uid();const req={auth:{uid:id},data:{starterHolobot:'KUMA',username:'new pilot'}};
 assert.equal((await createGenesisProfile.run(req)).created,true);
 const before=(await db.doc(`users/${id}`).get()).data();assert.deepEqual(before.travelSquad.holobotIds,['kuma']);
 assert.equal((await createGenesisProfile.run(req)).created,false);
 assert.deepEqual((await db.doc(`users/${id}`).get()).data().travelSquad,before.travelSquad);
});
test('desktop and mobile concurrent refresh repair an older account once; both show the persisted squad',async()=>{
 const id=uid();await db.doc(`users/${id}`).set({holobots:[{name:'SHADOW'},{name:'ACE'}]});
 const replies=await Promise.all([snapshot(id),transactTravelSquad(db,id,{operation:'refresh'}),snapshot(id)]);
 const stored=(await db.doc(`users/${id}`).get()).data();
 assert.deepEqual(stored.travelSquad,{schemaVersion:'travel-squad-1',revision:1,holobotIds:['shadow']});
 for(const r of replies)assert.deepEqual(r.travelSquad,stored.travelSquad);
 assert.deepEqual((await snapshot(id)).travelSquad,stored.travelSquad);
});
test('full companion team is unchanged on desktop sign-in; host swap reaches desktop next refresh',async()=>{
 const id=uid();const team={schemaVersion:'travel-squad-1',revision:9,holobotIds:['kuma','ace','shadow']};
 await db.doc(`users/${id}`).set({holobots:['ACE','KUMA','SHADOW','HARE'].map(name=>({name})),travelSquad:team});
 assert.deepEqual((await snapshot(id)).travelSquad,team);
 await transactTravelSquad(db,id,{operation:'setSlot',intent:{schemaVersion:'travel-squad-1',requestId:'swap-one',expectedRevision:9,slotIndex:1,holobotId:'hare'}});
 const r=await snapshot(id);assert.deepEqual(r.travelSquad.holobotIds,['kuma','hare','shadow']);assert.equal(r.travelSquad.revision,10);
});
