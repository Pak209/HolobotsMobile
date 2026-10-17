import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Loopback demo emulator only');
const {db}=require('../lib/admin');
const {desktopAccountSnapshot}=require('../lib/desktop/desktopAccountSnapshot');
const {tournamentAdmission}=require('../lib/story/arenaTournament');
let serial=0;
const flags=n=>({arenaGatheringSeen:false,tournamentsWon:n,arenaArcBuilt:n===3,holoZonesArcBuilt:false});
const setup=async(level=1,won=0,extra={})=>{const uid=`w68_throwaway_${Date.now()}_${serial++}`;await db.doc(`users/${uid}`).set({holobots:[{name:'ACE',level}],storyFlags:flags(won),...extra});return uid;};
const snap=(uid,data={})=>desktopAccountSnapshot.run({auth:{uid},data});
const ack=(uid,id)=>snap(uid,{operation:'ackTournamentUnlock',tournamentId:id});
const row=(tournamentId,requiredLevel,level=requiredLevel,holobotId='ace')=>({tournamentId,requiredLevel,holobotId,level});
after(()=>db.terminate());
test('defaults persist empty host-owned queue and acknowledgements',async()=>{
 const uid=await setup();assert.deepEqual((await snap(uid)).tournamentUnlocks,[]);
 const p=(await db.doc(`users/${uid}`).get()).data();assert.deepEqual(p.tournamentUnlocks,[]);assert.deepEqual(p.tournamentUnlockAcknowledged,[]);
});
for(const [i,id,level] of [[0,'starter',2],[1,'champion',11],[2,'rare',21]])test(`${id} matches admission threshold ${level} and prior wins`,async()=>{
 const uid=await setup(level-1,i);assert.deepEqual((await snap(uid)).tournamentUnlocks,[]);
 assert.throws(()=>tournamentAdmission(flags(i),id,level-1),e=>e.code==='rank_too_low');
 await db.doc(`users/${uid}`).update({holobots:[{name:'ACE',level}]});
 for(const schemaVersion of ['desktop-account-1','desktop-account-2','desktop-account-3'])assert.deepEqual((await snap(uid,{schemaVersion})).tournamentUnlocks,[row(id,level)]);
 assert.equal(tournamentAdmission(flags(i),id,level).requiredLevel,level);
 if(i){await db.doc(`users/${uid}`).update({storyFlags:flags(i-1)});assert.ok((await snap(uid)).tournamentUnlocks.every(r=>r.tournamentId!==id));}
});
test('ack removes only its tournament, stays cleared across levels/bots, and permits next unlock',async()=>{
 const uid=await setup(21);assert.deepEqual((await snap(uid)).tournamentUnlocks,[row('starter',2,21)]);
 assert.deepEqual((await ack(uid,'starter')).tournamentUnlocks,[]);assert.deepEqual((await ack(uid,'starter')).tournamentUnlocks,[]);
 await db.doc(`users/${uid}`).update({holobots:[{name:'WOLF',level:25}],travelSquad:{schemaVersion:'travel-squad-1',revision:2,holobotIds:['wolf']}});assert.deepEqual((await snap(uid)).tournamentUnlocks,[]);
 await db.doc(`users/${uid}`).update({storyFlags:flags(1)});assert.deepEqual((await ack(uid,'starter')).tournamentUnlocks,[row('champion',11,25,'wolf')]);
 assert.deepEqual((await ack(uid,'champion')).tournamentUnlocks,[]);
 await db.doc(`users/${uid}`).update({storyFlags:flags(3)});assert.deepEqual((await snap(uid)).tournamentUnlocks,[]);
});
test('stable qualifying bot choice and no unlock for duplicate/unknown identities',async()=>{
 const uid=await setup(1,0,{holobots:[{name:'WOLF',level:4},{name:'ACE',level:2}]});assert.deepEqual((await snap(uid)).tournamentUnlocks,[row('starter',2)]);
 await db.doc(`users/${uid}`).update({holobots:[{name:'ACE',level:2},{name:'ACE',level:20},{name:'WOLF',level:4}]});assert.deepEqual((await snap(uid)).tournamentUnlocks,[row('starter',2,4,'wolf')]);
});
test('auth, unknown operation/id, early ack and spoofed fields refuse without writes',async()=>{
 const uid=await setup(),before=(await db.doc(`users/${uid}`).get()).data();
 await assert.rejects(()=>desktopAccountSnapshot.run({data:{}}),e=>e.code==='unauthenticated');
 for(const data of [{operation:'bad'},{operation:'ackTournamentUnlock'},{operation:'ackTournamentUnlock',tournamentId:'bad'},{operation:'ackTournamentUnlock',tournamentId:'starter',level:21},{operation:'ackTournamentUnlock',tournamentId:'starter',uid:'other'}])await assert.rejects(()=>snap(uid,data),e=>e.details?.rejectionCode==='invalid_request');
 await assert.rejects(()=>ack(uid,'starter'),e=>e.details?.rejectionCode==='not_eligible');
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),before);
});
test('concurrent snapshots and acknowledgements do not resurrect a cleared unlock',async()=>{
 const uid=await setup(2);await Promise.all([snap(uid),ack(uid,'starter'),ack(uid,'starter'),snap(uid)]);
 assert.deepEqual((await snap(uid)).tournamentUnlocks,[]);
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data().tournamentUnlockAcknowledged,['starter']);
});
test('stale won-tournament ack cannot clear the new pending tournament',async()=>{
 const uid=await setup(21,1);assert.deepEqual((await ack(uid,'starter')).tournamentUnlocks,[row('champion',11,21)]);
});
test('corrupt acknowledgement state fails closed',async()=>{
 for(const value of [['forged'],null,['starter','starter']]){const uid=await setup(2,0,{tournamentUnlockAcknowledged:value});await assert.rejects(()=>snap(uid),e=>e.code==='unavailable');}
});
