import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if (!/^127\.0\.0\.1:18089$/.test(process.env.FIRESTORE_EMULATOR_HOST??'') || process.env.GCLOUD_PROJECT!=='demo-holobots-citizen-rival') throw Error('Dedicated loopback demo emulator only');
const {db}=require('../lib/admin.js');
const {arenaGatheringHost}=require('../lib/story/arenaGatheringHost.js');
const {rivalBattleHost}=require('../lib/rival/rivalBattleHost.js');
const {rivalScaledCombatant,rivalScaledCombatantStats}=require('../lib/lib/rivalLadder.js');
const {gatheringRoster,CV1_CITIZENS}=require('../lib/story/arenaGathering.js');
const G='arena-gathering-1', V='rival-battle-3';
let serial=0;
async function setup(){
 const uid=`citizen_throwaway_${Date.now()}_${serial++}`;
 await db.doc(`users/${uid}`).set({holobots:[{name:'ACE',level:99,experience:0,nextLevelExp:400,attributePoints:0}],
  holosTokens:0,buddyUnits:{light:0,medium:0,heavy:0},travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']}});
 return uid;
}
const call=(uid,data)=>rivalBattleHost.run({auth:{uid},data:{schemaVersion:V,...data}});
const gather=uid=>arenaGatheringHost.run({auth:{uid},data:{schemaVersion:G}});
const issue=(uid,row)=>call(uid,{operation:'issue',healthSchema:'rival-health-1',storySchema:G,rivalId:row.citizenId});
const record=(uid,id)=>db.doc(`rivalBattles/${uid}/battles/${id}`);
async function age(uid,id){await record(uid,id).update({issuedAtMs:Date.now()-21000});}
const profile=async uid=>(await db.doc(`users/${uid}`).get()).data();
after(async()=>{await db.terminate();});

test('known-bad first: real callable gathering issue matches Unity projection, settles once and refuses cooldown',async()=>{
 delete process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER;
 const uid=await setup(), {roster}=await gather(uid), row=roster[0];
 const r=await issue(uid,row);
 assert.equal(Object.hasOwn(r,'playerCombatants'),false,'Unity citizen projection must omit playerCombatants');
 assert.equal(r.schemaVersion,V);
 assert.deepEqual(Object.keys(r).sort(),['schemaVersion','battleId','expiresAtMs','tier','encounter','status','duel'].sort());
 assert.deepEqual(r.encounter.opponentPilot,{pilotId:row.citizenId,displayName:row.pilotName,tier:'Rookie'});
 assert.equal(r.encounter.opponentSquad[0].holobotId,row.holobotId);
 assert.equal(r.duel.mode,'legacy');
 const pinned=(await record(uid,r.battleId).get()).data();
 assert.equal(pinned.healthSchema,'rival-health-1');assert.ok(pinned.issuedVitals.ace);
 await age(uid,r.battleId);
 const command={operation:'settle',battleId:r.battleId,didWin:true,fielded:['ace'],healthSchema:'rival-health-1',health:[{holobotId:'ace',currentHealth:1}]};
 const settled=await call(uid,command);assert.equal(settled.holosGranted,100);
 const before=await profile(uid);assert.equal(before.holobotVitals.ace.currentHealth,1);
 assert.equal((await call(uid,command)).alreadyProcessed,true);assert.deepEqual(await profile(uid),before);
 await assert.rejects(()=>issue(uid,row),e=>e.code==='failed-precondition'&&e.details.rejectionCode==='rival_cooldown'&&e.details.retryAfterMs>0&&e.details.retryAfterMs<=300000);
 assert.deepEqual(await profile(uid),before);
});

test('all roster pilots retain assigned opponent and ordinary rivals retain playerCombatants',async()=>{
 delete process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER;
 const uid=await setup();await db.doc(`users/${uid}`).update({rivalWins:90});
 const {roster}=await gather(uid);
 for(const row of roster){
  const r=await issue(uid,row);
  assert.equal(Object.hasOwn(r,'playerCombatants'),false);
  assert.deepEqual(r.encounter.opponentPilot,{pilotId:row.citizenId,displayName:row.pilotName,tier:'Rookie'});
  const b=(await record(uid,r.battleId).get()).data();
  assert.ok(b.tier>0,'fixture exercises difficulty beyond Rookie');
  const expected={...rivalScaledCombatant(row.holobotId,b.tier),...rivalScaledCombatantStats(b.tier)};
  for(const key of ['holobotId','level','attack','defense','maxHealth','speed','intelligence']) assert.equal(r.encounter.opponentSquad[0][key],expected[key]);
  await age(uid,r.battleId);
  assert.equal((await call(uid,{operation:'settle',battleId:r.battleId,didWin:false})).holosGranted,25);
 }
 const ordinary=await call(uid,{operation:'issue',healthSchema:'rival-health-1'});
 assert.ok(Array.isArray(ordinary.playerCombatants));assert.equal(ordinary.playerCombatants[0].holobotId,'ace');
});

test('callable refuses missing gathering, outside roster, wrong story schema and unauthenticated issue without writes',async()=>{
 delete process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER;
 const uid=await setup(),row=gatheringRoster(uid)[0];
 const invalid=e=>e.code==='invalid-argument'&&e.details.rejectionCode==='invalid_request';
 const before=await profile(uid);await assert.rejects(()=>issue(uid,row),invalid);assert.deepEqual(await profile(uid),before);
 await gather(uid);
 const outside=CV1_CITIZENS.find(([id])=>!gatheringRoster(uid).some(p=>p.citizenId===id))[0];
 const afterGather=await profile(uid);
 await assert.rejects(()=>issue(uid,{citizenId:outside}),invalid);
 await assert.rejects(()=>call(uid,{operation:'issue',storySchema:'arena-gathering-bad',rivalId:row.citizenId}),invalid);
 await assert.rejects(()=>rivalBattleHost.run({data:{schemaVersion:V,operation:'issue',storySchema:G,rivalId:row.citizenId}}),e=>e.code==='unauthenticated');
 assert.deepEqual(await profile(uid),afterGather);
 assert.equal((await db.doc(`rivalBattles/${uid}`).get()).exists,false);
});

test('explicit resolver flip preserves internal fighters and host receipt despite citizen projection omission',async()=>{
 process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER='1';
 try {
  const uid=await setup(),{roster}=await gather(uid),r=await issue(uid,roster[0]);
  assert.equal(Object.hasOwn(r,'playerCombatants'),false);assert.equal(r.duel.mode,'resolver');
  assert.equal(r.duel.player[0].holobotId,'ace');assert.equal(r.duel.opponent[0].holobotId,roster[0].holobotId);
  await age(uid,r.battleId);
  const settled=await call(uid,{operation:'settle',battleId:r.battleId,playerIntents:['strike'],didWin:false,damage:999999});
  assert.equal(settled.duelReceipt.schemaVersion,'duel-receipt-1');assert.equal(settled.didWin,settled.duelReceipt.winner==='player');
  assert.equal(settled.holosGranted,settled.didWin?100:25);
 } finally {delete process.env.HOLOCITY_RIVAL_ISSUE_RESOLVER;}
});
