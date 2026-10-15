import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:(?:18086|18087)$/.test(process.env.FIRESTORE_EMULATOR_HOST??''))throw Error('Dedicated loopback emulator required');
process.env.GCLOUD_PROJECT='demo-holobots-duel-resolver';
const {db}=require('../lib/admin.js');
const {transactRivalBattle:host}=require('../lib/rival/rivalBattleStore.js');
const {rivalBattleHost}=require('../lib/rival/rivalBattleHost.js');
const D=require('../lib/lib/duelResolver.js');
const L=require('../lib/lib/rivalLadder.js');
const now=Date.UTC(2026,9,14), seed=()=>0.4;
const base={schemaVersion:'rival-battle-3'};
let serial=0;
const call=(uid,c,time=now,options={issueLegacy:false,allowLegacySettlement:false})=>host(db,uid,{...base,...c},time,seed,options);
const user=async uid=>(await db.doc(`users/${uid}`).get()).data();
const record=async(uid,id)=>(await db.doc(`rivalBattles/${uid}/battles/${id}`).get()).data();
async function setup({level=1,bench=false,...extra}={}){
 const uid=`duel10_${Date.now()}_${serial++}`;
 const holobots=[{name:'ACE',level,experience:0,nextLevelExp:400,attributePoints:0},...(bench?[{name:'KUMA',level:1,experience:0,nextLevelExp:400,attributePoints:0}]:[])];
 await db.doc(`users/${uid}`).set({holobots,holosTokens:0,buddyUnits:{light:0,medium:0,heavy:0},
  travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:bench?['ace','kuma']:['ace']},...extra});
 return uid;
}
test('default issue pins resolver mode, host stats, seed and HP; caller cannot select legacy or stats',async()=>{
 const uid=await setup();
 const issue=await call(uid,{operation:'issue',legacyDidWin:true,duel:{mode:'legacy'},seed:999,player:[{attack:1e9}]});
 const b=await record(uid,issue.battleId);
 assert.equal(issue.duel.mode,'resolver');assert.ok(Number.isInteger(b.duel.input.seed));assert.notEqual(b.duel.input.seed,b.seed);assert.notEqual(b.seed,999);
 assert.equal(issue.duel.input,undefined);assert.equal(issue.duel.seed,undefined);assert.deepEqual(issue.duel.player,b.duel.input.player);assert.ok(b.duel.input.player[0].attack<1e9);
 assert.equal(b.healthSchema,'rival-health-1');assert.ok(b.issuedVitals.ace);
 await assert.rejects(()=>call(uid,{operation:'issue'}),/too_many_open/);
});
test('host winner ignores forged outcome/damage/HP/fielded; only actual participants earn XP',async()=>{
 const uid=await setup({level:99,bench:true});
 const issue=await call(uid,{operation:'issue'}),b=await record(uid,issue.battleId);
 const intents=['strike']; const expected=D.resolveDuel({...b.duel.input,playerIntents:intents});
 assert.equal(expected.winner,'player');
 const result=await call(uid,{operation:'settle',battleId:issue.battleId,playerIntents:intents,didWin:false,
  damage:999999,healthSchema:'fake',health:[{holobotId:'ace',currentHealth:999999}],fielded:['kuma','foreign'],
  seed:0,stats:{attack:999999},duel:{mode:'legacy'}},now+20000,{issueLegacy:true,allowLegacySettlement:true});
 assert.equal(result.didWin,true);assert.equal(result.holosGranted,100);assert.deepEqual(result.duelReceipt,expected);
 assert.deepEqual(result.progression.map(x=>x.holobotId),['ace']);
 const stored=await record(uid,issue.battleId),profile=await user(uid);
 assert.deepEqual(stored.settlement.fielded,['ace']);assert.deepEqual(stored.duelReceipt,expected);
 assert.equal(profile.holobotVitals.ace.currentHealth,expected.playerFinal[0].currentHealth);
 assert.equal(profile.pilotRank,1,'the host-resolved win grants one pilot rank');
 assert.equal(profile.holobots.find(x=>x.name==='KUMA').experience,0);
});
test('host loss pays25 despite claimed win; pinned issue stats survive later profile/stat changes',async()=>{
 const uid=await setup({rivalWins:90});const issue=await call(uid,{operation:'issue'}),b=await record(uid,issue.battleId);
 const intents=['defend'];const expected=D.resolveDuel({...b.duel.input,playerIntents:intents});assert.equal(expected.winner,'opponent');
 const profile=await user(uid);profile.holobots[0].level=99;await db.doc(`users/${uid}`).update({holobots:profile.holobots});
 const result=await call(uid,{operation:'settle',battleId:issue.battleId,playerIntents:intents,didWin:true,damage:1e12},now+20000);
 assert.equal(result.didWin,false);assert.equal(result.holosGranted,25);assert.deepEqual(result.duelReceipt,expected);assert.equal((await user(uid)).rivalWins,90);assert.equal((await user(uid)).pilotRank,undefined,'a host loss never increments pilot rank');
});
test('missing/empty/invalid/oversized intents refuse with no settlement or reward writes',async()=>{
 const uid=await setup();const issue=await call(uid,{operation:'issue'}),before=await user(uid);
 for(const playerIntents of [undefined,[],['win'],new Array(121).fill('strike'),[{}]]){
  await assert.rejects(()=>call(uid,{operation:'settle',battleId:issue.battleId,playerIntents,didWin:true},now+20000),/invalid_request/);
  assert.equal((await record(uid,issue.battleId)).settlement,null);assert.deepEqual(await user(uid),before);
 }
});
test('duplicate/concurrent settles replay exact receipt and rewards despite changed/missing intents',async()=>{
 const uid=await setup({level:99});const issue=await call(uid,{operation:'issue'});
 const requests=await Promise.all(Array.from({length:5},()=>call(uid,{operation:'settle',battleId:issue.battleId,playerIntents:['strike'],didWin:false},now+20000)));
 assert.equal(requests.filter(x=>!x.alreadyProcessed).length,1);
 const before=await user(uid),stored=await record(uid,issue.battleId);
 for(const playerIntents of [['defend'],undefined,['invalid']]){
  const replay=await call(uid,{operation:'settle',battleId:issue.battleId,playerIntents,didWin:false},now+30000,{issueLegacy:true,allowLegacySettlement:true});
  assert.equal(replay.alreadyProcessed,true);assert.deepEqual(replay.duelReceipt,stored.duelReceipt);
 }
 assert.deepEqual(await user(uid),before);assert.deepEqual(await record(uid,issue.battleId),stored);assert.equal(before.holosTokens,100);assert.equal(before.pilotRank,1,'concurrent settles and replays increment pilot rank once');
});
test('legacy records require server migration flag; old missing-mode records survive its deliberate enable',async()=>{
 const uid=await setup();const issue=await call(uid,{operation:'issue'},now,{issueLegacy:true,allowLegacySettlement:true});
 assert.equal(issue.duel.mode,'legacy');
 await assert.rejects(()=>call(uid,{operation:'settle',battleId:issue.battleId,didWin:true,legacyDidWin:true},now+20000),/legacy_settlement_disabled/);
 const ref=db.doc(`rivalBattles/${uid}/battles/${issue.battleId}`);const b=await record(uid,issue.battleId);delete b.duel;await ref.set(b);
 const result=await call(uid,{operation:'settle',battleId:issue.battleId,didWin:true},now+20000,{issueLegacy:true,allowLegacySettlement:true});
 assert.equal(result.holosGranted,100);assert.equal(result.duelReceipt,undefined);
 const replay=await call(uid,{operation:'settle',battleId:issue.battleId},now+30000);assert.equal(replay.alreadyProcessed,true);
});
test('foreign/unknown/expired/too-fast requests cannot award from a deterministic receipt',async()=>{
 const alice=await setup({level:99}),bob=await setup();const i=await call(alice,{operation:'issue'});
 const settle={operation:'settle',battleId:i.battleId,playerIntents:['strike']};
 await assert.rejects(()=>call(bob,settle,now+20000),/unknown_battle/);
 await assert.rejects(()=>call(alice,{...settle,battleId:'rb_missing'},now+20000),/unknown_battle/);
 await assert.rejects(()=>call(alice,settle,now+1),/too_fast/);
 await assert.rejects(()=>call(alice,settle,now+L.RIVAL_BATTLE_TTL_MS+1),/battle_expired/);
 assert.equal((await record(alice,i.battleId)).settlement,null);
});
test('missing owned squad refuses resolver admission and callable exposes typed auth/refusal codes',async()=>{
 const uid=await setup({holobots:[],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:[]}});
 await assert.rejects(()=>call(uid,{operation:'issue'}),/squad_required/);
 await assert.rejects(()=>rivalBattleHost.run({data:{operation:'issue'}}),e=>e.code==='unauthenticated');
 const prior=process.env.HOLOCITY_RIVAL_ISSUE_LEGACY;delete process.env.HOLOCITY_RIVAL_ISSUE_LEGACY;
 try {await assert.rejects(()=>rivalBattleHost.run({auth:{uid},data:{...base,operation:'issue'}}),e=>e.code==='failed-precondition'&&e.details.rejectionCode==='squad_required');}
 finally{if(prior===undefined)delete process.env.HOLOCITY_RIVAL_ISSUE_LEGACY;else process.env.HOLOCITY_RIVAL_ISSUE_LEGACY=prior;}
});
test('existing 40% KO issue recovery remains and stored malformed resolver fails closed',async()=>{
 const uid=await setup({holobotVitals:{ace:{currentHealth:0,maxHealth:500}}});const i=await call(uid,{operation:'issue'});
 const b=await record(uid,i.battleId);assert.equal(b.issuedVitals.ace.currentHealth,i.playerCombatants[0].maxHealth*.4);
 assert.equal(b.duel.input.player[0].currentHealth,Math.floor(b.issuedVitals.ace.currentHealth));
 await db.doc(`rivalBattles/${uid}/battles/${i.battleId}`).update({'duel.input.seed':-1});
 await assert.rejects(()=>call(uid,{operation:'settle',battleId:i.battleId,playerIntents:['strike']},now+20000),/unavailable/);
});

test('migration defaults accept already-issued legacy while new issues remain resolver-on',async()=>{
 const uid=await setup();const i=await call(uid,{operation:'issue'},now,{issueLegacy:true});
 const oldIssue=process.env.HOLOCITY_RIVAL_ISSUE_LEGACY,oldAllow=process.env.HOLOCITY_RIVAL_ALLOW_LEGACY_DIDWIN;
 delete process.env.HOLOCITY_RIVAL_ISSUE_LEGACY;delete process.env.HOLOCITY_RIVAL_ALLOW_LEGACY_DIDWIN;
 try{
  const result=await host(db,uid,{...base,operation:'settle',battleId:i.battleId,didWin:false},now+20000,seed);
  assert.equal(result.holosGranted,25);
  const fresh=await setup();const issued=await host(db,fresh,{...base,operation:'issue'},now,seed);assert.equal(issued.duel.mode,'resolver');
 }finally{
  if(oldIssue!==undefined)process.env.HOLOCITY_RIVAL_ISSUE_LEGACY=oldIssue;
  if(oldAllow!==undefined)process.env.HOLOCITY_RIVAL_ALLOW_LEGACY_DIDWIN=oldAllow;
 }
});
