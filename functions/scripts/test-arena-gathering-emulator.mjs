import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Loopback demo emulator only; production forbidden');
const { db } = require('../lib/admin.js');
const { arenaGatheringHost } = require('../lib/story/arenaGatheringHost.js');
const { tournamentResultHost } = require('../lib/story/tournamentResultHost.js');
const { transactArenaGathering, gatheringRoster, CV1_CITIZENS, GATHERING_HOLOBOTS, GATHERING_RING_COLORS } = require('../lib/story/arenaGathering.js');
const { tournamentAdmission } = require('../lib/story/arenaTournament.js');
const { transactTournamentResult } = require('../lib/story/tournamentResultStore.js');
const { transactArenaMatch, ARENA_MIN_SETTLE_MS } = require('../lib/arena/arenaMatchStore.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { desktopAccountSnapshot } = require('../lib/desktop/desktopAccountSnapshot.js');
const { calculateExperience } = require('../lib/lib/progression.js');
const { HOLOBOT_NAMES } = require('../lib/lib/economy.js');
const defaults = {arenaGatheringSeen:false,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false};
const T0=Date.UTC(2026,9,14,20), G='arena-gathering-1', T='arena-tournament-1';
let serial=0;
const bot=level=>({name:'ACE',level,experience:0,nextLevelExp:calculateExperience(level+1),attributePoints:0,boostedAttributes:{}});
async function setup(level=21, extra={}) {
 const uid=`gathering_throwaway_${Date.now()}_${serial++}`;
 await db.doc(`users/${uid}`).set({holobots:[bot(level)],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']},buddyUnits:{light:0,medium:0,heavy:0},holosTokens:1000,arenaPassses:20,syncPoints:0,wins:0,losses:0,...extra});
 return uid;
}
const profile=async uid=>(await db.doc(`users/${uid}`).get()).data();
const gather=uid=>transactArenaGathering(db,uid,{schemaVersion:G});
const result=(uid,tournamentId,matchId)=>transactTournamentResult(db,uid,{schemaVersion:T,tournamentId,matchId});
const call=(uid,operation,fields={},now=T0)=>transactArenaMatch(db,uid,{schemaVersion:'arena-match-1',operation,...fields},now);
async function issue(uid,tournamentId,now=T0) {
 return call(uid,'issue',{requestId:`request_${serial++}`,tierId:'rookie',paymentMethod:'pass',holobotId:'ace',opponentName:'HARE',...(tournamentId?{tournamentId}:{})},now);
}
async function win(uid,tournamentId,now=T0) {
 // Historical terminal-receipt fixture: ordinary paid play is settled before admin tags
 // the receipt as a pre-bracket tournament. New tagged public outcomes are blocked.
 const issued=await issue(uid,undefined,now), id=issued.matchId;
 await call(uid,'start',{matchId:id},now);
 const settled=await call(uid,'settle',{matchId:id,playerFinalHealth:issued.match.entrant.currentHealth,opponentFinalHealth:0,combosCompleted:0,perfectDefenses:0},now+1500+ARENA_MIN_SETTLE_MS);
 if(tournamentId){const tournament=tournamentAdmission((await profile(uid)).storyFlags,tournamentId,issued.match.entrant.level);await db.doc(`arenaMatches/${uid}/matches/${id}`).update({tournament});
  const before=await profile(uid),replay=await call(uid,'settle',{matchId:id,playerFinalHealth:issued.match.entrant.currentHealth,opponentFinalHealth:0,combosCompleted:0,perfectDefenses:0},now+2000+ARENA_MIN_SETTLE_MS);assert.equal(replay.alreadyProcessed,true);assert.deepEqual(await profile(uid),before);return replay;}
 return settled;
}
const hasCode=code=>e=>e.code===code;
async function refused(uid,fn,code) {
 const before=await profile(uid);
 await assert.rejects(fn,hasCode(code));
 assert.deepEqual(await profile(uid),before,'refusal must not mutate account');
}

test('known-bad input first: arbitrary client victory, rank, or count cannot flip story gates',async()=>{
 const uid=await setup();
 await refused(uid,()=>transactTournamentResult(db,uid,{schemaVersion:T,tournamentId:'starter',matchId:'am_'+'a'.repeat(32),didWin:true,rank:21,tournamentsWon:3}),'invalid_request');
 await refused(uid,()=>result(uid,'starter','am_'+'a'.repeat(32)),'unknown_match');
 assert.equal((await profile(uid)).storyFlags,undefined);
});

test('desktop versions lazily backfill defaults and return the identical four story fields',async()=>{
 const uid=await setup();
 for(const schemaVersion of ['desktop-account-1','desktop-account-2','desktop-account-3']) {
  const r=await desktopAccountSnapshot.run({auth:{uid},data:{schemaVersion}});
  assert.deepEqual(r.storyFlags,defaults);
 }
 assert.deepEqual((await profile(uid)).storyFlags,defaults);
});

test('gathering yields eight stable CV1 pilots from all twelve bots and the exact ring palette; concurrent and later calls are idempotent',async()=>{
 const uid=await setup(), before=await profile(uid);
 const [a,b]=await Promise.all([gather(uid),gather(uid)]);
 assert.deepEqual(a,b); assert.equal(a.schemaVersion,G); assert.equal(a.roster.length,8);
 assert.equal(new Set(a.roster.map(r=>r.citizenId)).size,8);
 assert.deepEqual([...GATHERING_HOLOBOTS].sort(),HOLOBOT_NAMES.map(s=>s.toLowerCase()).sort());
 for(const row of a.roster) {
  assert.deepEqual(Object.keys(row),['citizenId','pilotName','holobotId','rank','ringColor']);
  assert.ok(CV1_CITIZENS.some(([id])=>id===row.citizenId));
  assert.ok(GATHERING_HOLOBOTS.includes(row.holobotId)); assert.ok(GATHERING_RING_COLORS.includes(row.ringColor));assert.equal(row.rank,'Rookie');
 }
 for(let sample=0;sample<200;sample++) { const rows=gatheringRoster(`palette_sample_${sample}`);assert.equal(new Set(rows.map(r=>`${r.holobotId}:${r.ringColor}`)).size,8); }
 assert.deepEqual(a.roster,gatheringRoster(uid)); assert.notDeepEqual(a.roster,gatheringRoster(uid+'_other'));
 assert.deepEqual(await profile(uid),{...before,storyFlags:{...defaults,arenaGatheringSeen:true}});
 const snapshot=await db.doc(`users/${uid}`).get();
 assert.deepEqual(await gather(uid),a);
 assert.equal((await db.doc(`users/${uid}`).get()).updateTime.toMillis(),snapshot.updateTime.toMillis());
});

test('callable auth and strict gathering/tournament input refusals',async()=>{
 for(const host of [arenaGatheringHost,tournamentResultHost]) await assert.rejects(()=>host.run({data:{}}),hasCode('unauthenticated'));
 const uid=await setup();
 for(const raw of [null,[],{}, {schemaVersion:'bad'}, {schemaVersion:G,uid:'foreign'}]) await refused(uid,()=>transactArenaGathering(db,uid,raw),'invalid_request');
 for(const raw of [null,[],{}, {schemaVersion:T,tournamentId:'elite',matchId:'am_'+'a'.repeat(32)},{schemaVersion:T,tournamentId:'starter',matchId:'../foreign'}]) await refused(uid,()=>transactTournamentResult(db,uid,raw),'invalid_request');
 await assert.rejects(()=>gather('gathering_throwaway_missing'),hasCode('unavailable'));
 await assert.rejects(()=>result('gathering_throwaway_missing','starter','am_'+'a'.repeat(32)),hasCode('unavailable'));
 await assert.rejects(()=>arenaGatheringHost.run({auth:{uid},data:{}}),e=>e.code==='invalid-argument'&&e.details.rejectionCode==='invalid_request');
 await assert.rejects(()=>tournamentResultHost.run({auth:{uid},data:{schemaVersion:T,tournamentId:'starter',matchId:'am_'+'a'.repeat(32)}}),e=>e.code==='not-found'&&e.details.rejectionCode==='unknown_match');
});

test('malformed story state fails closed; partial absent fields default without resetting existing progress',async()=>{
 for(const storyFlags of [null,[],{tournamentsWon:4},{tournamentsWon:-1},{tournamentsWon:1.5},{arenaArcBuilt:true},{arenaGatheringSeen:'yes'},{holoZonesArcBuilt:null}]) {
  const uid=await setup(21,{storyFlags});
  await refused(uid,()=>gather(uid),'unavailable');
  await refused(uid,()=>result(uid,'starter','am_'+'a'.repeat(32)),'unavailable');
  await assert.rejects(()=>desktopAccountSnapshot.run({auth:{uid},data:{schemaVersion:'desktop-account-3'}}),hasCode('unavailable'));
 }
 const uid=await setup(21,{storyFlags:{arenaGatheringSeen:true}});
 assert.deepEqual((await gather(uid)).storyFlags,{...defaults,arenaGatheringSeen:true});
});

const rival=(uid,fields,now=T0)=>transactRivalBattle(db,uid,{schemaVersion:'rival-battle-3',...fields},now,()=>0,{issueLegacy:true}); // #80 historical didWin compatibility fixture.
const rivalIssue=(uid,id,now=T0)=>rival(uid,{operation:'issue',storySchema:G,rivalId:id},now);
test('all eight roster citizens issue their assigned bot, retain 100/25 rewards and settle replay, and use the same 5-minute cooldown',async()=>{
 const uid=await setup();const {roster}=await gather(uid);
 for(let i=0;i<8;i++) {
  const row=roster[i], now=T0+i*1000;
  const issued=await rivalIssue(uid,row.citizenId,now);
  assert.equal(issued.encounter.opponentPilot.pilotId,row.citizenId);
  assert.equal(issued.encounter.opponentPilot.displayName,row.pilotName);
  assert.equal(issued.encounter.opponentSquad.length,1);
  assert.equal(issued.encounter.opponentSquad[0].holobotId,row.holobotId);
  const command={operation:'settle',battleId:issued.battleId,didWin:i%2===0,fielded:['ace']};
  const settled=await rival(uid,command,now+20000);
  assert.equal(settled.holosGranted,i%2===0?100:25);
  const before=await profile(uid), replay=await rival(uid,command,now+21000);
  assert.equal(replay.alreadyProcessed,true);assert.deepEqual(await profile(uid),before);
  await refused(uid,()=>rivalIssue(uid,row.citizenId,now+20001),'rival_cooldown');
 }
 const retry=await rivalIssue(uid,roster[0].citizenId,T0+320000);
 assert.equal(retry.encounter.opponentPilot.pilotId,roster[0].citizenId);
 assert.equal((await profile(uid)).rivalWins,4);
});

test('citizen rival refuses before gathering, a non-roster citizen, foreign ids, wrong schemas and operations',async()=>{
 const uid=await setup(), row=gatheringRoster(uid)[0];
 await refused(uid,()=>rivalIssue(uid,row.citizenId),'invalid_request');
 await gather(uid);
 const outside=CV1_CITIZENS.find(([id])=>!gatheringRoster(uid).some(r=>r.citizenId===id))[0];
 for(const id of [outside,'zell','foreign',42,'']) await refused(uid,()=>rivalIssue(uid,id),'invalid_request');
 for(const data of [{operation:'status',storySchema:G,rivalId:row.citizenId},{operation:'issue',storySchema:G},{operation:'issue',storySchema:G,rivalId:row.citizenId,schemaVersion:'rival-battle-2'}]) await refused(uid,()=>rival(uid,data),'invalid_request');
});

test('rank thresholds 2/11/21 are enforced at admission without spending an entry; sequence cannot be skipped',async()=>{
 for(const [id,level,count] of [['starter',1,0],['champion',10,1],['rare',20,2]]) {
  const uid=await setup(level,{storyFlags:{...defaults,arenaGatheringSeen:true,tournamentsWon:count}});
  await refused(uid,()=>issue(uid,id),'rank_too_low');
  assert.equal((await db.doc(`arenaMatches/${uid}`).get()).exists,false);
 }
 const uid=await setup();
 await refused(uid,()=>issue(uid,'champion'),'tournament_locked');
 await refused(uid,()=>result(uid,'rare','am_'+'a'.repeat(32)),'tournament_locked');
 await refused(uid,()=>issue(uid,'legend'),'invalid_request');
});

test('three historical tagged terminal wins at exact boundaries flip only Arena; duplicate and concurrent results never advance twice',async()=>{
 const uid=await setup(2); await gather(uid);
 for(const [index,id,level] of [[0,'starter',2],[1,'champion',11],[2,'rare',21]]) {
  await db.doc(`users/${uid}`).update({holobots:[bot(level)]});
  const receipt=await win(uid,id,T0+index*10000);
  const before=await profile(uid);
  const calls=await Promise.allSettled([result(uid,id,receipt.matchId),result(uid,id,receipt.matchId)]);
  assert.equal(calls.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(calls.find(r=>r.status==='rejected').reason.code,'already_won');
  const reply=calls.find(r=>r.status==='fulfilled').value;
  assert.deepEqual(reply,{schemaVersion:T,tournamentId:id,matchId:receipt.matchId,storyFlags:{...defaults,arenaGatheringSeen:true,tournamentsWon:index+1,arenaArcBuilt:index===2}});
  assert.deepEqual(await profile(uid),{...before,storyFlags:reply.storyFlags},'result adds no economy grants');
  await refused(uid,()=>result(uid,id,receipt.matchId),'already_won');
  await refused(uid,()=>issue(uid,id,T0+index*10000+3000),'already_won');
  assert.equal((await gather(uid)).storyFlags.holoZonesArcBuilt,false);
 }
 const desktop=await desktopAccountSnapshot.run({auth:{uid},data:{schemaVersion:'desktop-account-3'}});
 assert.equal(desktop.storyFlags.arenaArcBuilt,true);assert.equal(desktop.storyFlags.holoZonesArcBuilt,false);
});

test('foreign, ordinary practice, wrong tournament and unfinished receipts cannot qualify',async()=>{
 const uid=await setup(), other=await setup();
 const normal=await win(uid,undefined);
 await refused(uid,()=>result(uid,'starter',normal.matchId),'invalid_match');
 const tagged=await issue(uid,'starter',T0+3000);
 await refused(other,()=>result(other,'starter',tagged.matchId),'unknown_match');
 await refused(uid,()=>result(uid,'starter',tagged.matchId),'win_required');
 await call(uid,'cancel',{matchId:tagged.matchId},T0+4000);
 await refused(uid,()=>result(uid,'starter',tagged.matchId),'win_required');
 await db.doc(`users/${uid}`).update({storyFlags:{...defaults,tournamentsWon:1}});
 await refused(uid,()=>result(uid,'champion',tagged.matchId),'invalid_match');
});

test('loss and malformed host receipts fail closed; low admission level and corrupted tags refuse',async()=>{
 const uid=await setup();
 const i=await issue(uid,undefined); await call(uid,'start',{matchId:i.matchId});
 await call(uid,'settle',{matchId:i.matchId,playerFinalHealth:0,opponentFinalHealth:i.match.opponent.maxHealth,combosCompleted:0,perfectDefenses:0},T0+1500+ARENA_MIN_SETTLE_MS);
 await db.doc(`arenaMatches/${uid}/matches/${i.matchId}`).update({tournament:tournamentAdmission((await profile(uid)).storyFlags,'starter',i.match.entrant.level)});
 await refused(uid,()=>result(uid,'starter',i.matchId),'win_required');
 const ref=db.doc(`arenaMatches/${uid}/matches/${i.matchId}`), original=(await ref.get()).data();
 await ref.update({'settlementReceipt.settlement.holos':999});
 await refused(uid,()=>result(uid,'starter',i.matchId),'unavailable');
 await ref.set(original);await ref.update({'entrant.level':1});
 await refused(uid,()=>result(uid,'starter',i.matchId),'rank_too_low');
 await ref.set(original);await ref.update({'tournament.requiredLevel':0});
 await refused(uid,()=>result(uid,'starter',i.matchId),'unavailable');
});

test('admission request replay preserves its tag and rejects changing a practice request into a tournament',async()=>{
 const uid=await setup(), fields={requestId:'stable_request',tierId:'rookie',paymentMethod:'pass',holobotId:'ace',opponentName:'HARE',tournamentId:'starter'};
 const a=await call(uid,'issue',fields), b=await call(uid,'issue',fields);
 assert.equal(b.alreadyProcessed,true);assert.equal(a.matchId,b.matchId);assert.equal(b.match.tournament.tournamentId,'starter');
 await refused(uid,()=>call(uid,'issue',{...fields,tournamentId:'champion'}),'request_conflict');
 const {tournamentId,...normal}=fields;
 await refused(uid,()=>call(uid,'issue',normal),'request_conflict');
});

// Real client rules checks share only this demo project's loopback emulator.
const rulesRequire=createRequire(new URL('../../rules-tests/package.json',import.meta.url));
const {initializeTestEnvironment,assertFails,assertSucceeds}=rulesRequire('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,deleteField,deleteDoc}=rulesRequire('firebase/firestore');
let env;
after(async()=>{if(env) await env.cleanup();await db.terminate();});
test('rules deny client story creation, nested edits, replacement, deletion, foreign reads and forged match receipts; unchanged merges work',async()=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
 env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{host,port:Number(port),rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});
 const uid=await setup(), client=env.authenticatedContext(uid).firestore(), userRef=doc(client,`users/${uid}`);
 await assertFails(updateDoc(userRef,{storyFlags:{...defaults,arenaArcBuilt:true,tournamentsWon:3}}));
 const fresh=`gathering_rules_${serial++}`;
 await assertFails(setDoc(doc(env.authenticatedContext(fresh).firestore(),`users/${fresh}`),{storyFlags:defaults}));
 await gather(uid); const flags=(await profile(uid)).storyFlags;
 for(const [key,value] of Object.entries({arenaGatheringSeen:false,tournamentsWon:3,arenaArcBuilt:true,holoZonesArcBuilt:true})) await assertFails(updateDoc(userRef,{[`storyFlags.${key}`]:value}));
 await assertFails(updateDoc(userRef,{storyFlags:deleteField()}));await assertFails(updateDoc(userRef,{'storyFlags.arenaArcBuilt':deleteField()}));
 await assertFails(setDoc(userRef,{displayName:'erase flags'}));await assertFails(deleteDoc(userRef));
 await assertSucceeds(updateDoc(userRef,{storyFlags:flags,displayName:'Throwaway'}));await assertSucceeds(getDoc(userRef));
 await assertFails(getDoc(doc(env.authenticatedContext('gathering_rules_foreign').firestore(),`users/${uid}`)));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),`users/${uid}`)));
 await assertFails(setDoc(doc(client,`arenaMatches/${uid}/matches/am_${'a'.repeat(32)}`),{state:'settled',settlementReceipt:{outcome:'win'}}));
});
