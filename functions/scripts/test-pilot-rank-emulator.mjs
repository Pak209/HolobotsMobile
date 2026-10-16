import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !process.env.GCLOUD_PROJECT?.startsWith('demo-')) throw new Error('Loopback demo emulator only; production forbidden');
const { db } = require('../lib/admin.js');
const { createGenesisProfile } = require('../lib/account/createGenesisProfile.js');
const { desktopAccountSnapshot } = require('../lib/desktop/desktopAccountSnapshot.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { transactArenaGathering } = require('../lib/story/arenaGathering.js');
const { transactArenaMatch } = require('../lib/arena/arenaMatchStore.js');
const { transactTournamentResult } = require('../lib/story/tournamentResultStore.js');
const { calculateExperience } = require('../lib/lib/progression.js');
const { RIVAL_MIN_WIN_MS, RIVAL_COOLDOWN_MS } = require('../lib/lib/rivalLadder.js');
const T0 = Date.UTC(2026,9,14,22), defaults = {arenaGatheringSeen:false,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false};
let serial = 0;
const uidFor = () => `pilot_rank_throwaway_${Date.now()}_${serial++}`;
const bot = level => ({name:'ACE',level,experience:0,nextLevelExp:calculateExperience(level+1),attributePoints:0,boostedAttributes:{}});
async function setup(extra={},level=21) {
  const uid = uidFor();
  await db.doc(`users/${uid}`).set({holobots:[bot(level)],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']},buddyUnits:{light:0,medium:0,heavy:0},holosTokens:1000,arenaPassses:20,syncPoints:0,wins:0,losses:0,...extra});
  return uid;
}
const profile = async uid => (await db.doc(`users/${uid}`).get()).data();
const snapshot = (uid,schemaVersion='desktop-account-3') => desktopAccountSnapshot.run({auth:{uid},data:{schemaVersion}});
const rival = (uid,fields,now=T0) => transactRivalBattle(db,uid,{schemaVersion:'rival-battle-3',...fields},now,()=>0,{issueLegacy:true});
const arena = (uid,operation,fields={},now=T0) => transactArenaMatch(db,uid,{schemaVersion:'arena-match-1',operation,...fields},now);
const admission = (tournamentId='starter',extra={}) => ({requestId:`pilot_rank_request_${serial++}`,tierId:'rookie',paymentMethod:'pass',holobotId:'ace',opponentName:'HARE',tournamentId,...extra});
const code = expected => e => e.code===expected;
async function refused(uid,fn,expected) {
  const before = await profile(uid);
  await assert.rejects(fn,code(expected));
  assert.deepEqual(await profile(uid),before,'refusal must leave account unchanged');
}

test('known-bad control first: desktop replies must expose numeric pilotRank beside storyFlags',async()=>{
  const uid=await setup({rivalWins:40,syncRank:'Champion'});
  for(const version of ['desktop-account-1','desktop-account-2','desktop-account-3']) {
    const reply=await snapshot(uid,version);
    assert.equal(reply.pilotRank,0,'legacy rivalWins and syncRank are not a backfill');
    assert.deepEqual(reply.storyFlags,defaults);
  }
  assert.equal((await profile(uid)).pilotRank,0);
  const before=await db.doc(`users/${uid}`).get();
  await snapshot(uid);
  assert.equal((await db.doc(`users/${uid}`).get()).updateTime.toMillis(),before.updateTime.toMillis());
});

test('Genesis creates zero once; snapshots preserve an existing host rank',async()=>{
  const uid=uidFor();
  await createGenesisProfile.run({auth:{uid},data:{starterHolobot:'ACE',username:'Rank Throwaway'}});
  assert.equal((await profile(uid)).pilotRank,0);
  await db.doc(`users/${uid}`).update({pilotRank:9});
  assert.equal((await createGenesisProfile.run({auth:{uid},data:{starterHolobot:'KUMA',username:'Rank Throwaway'}})).created,false);
  for(const version of ['desktop-account-1','desktop-account-2','desktop-account-3']) assert.equal((await snapshot(uid,version)).pilotRank,9);
});

test('every rival wire version grants exactly +1 for its first win and never trusts a requested pilotRank',async()=>{
  for(const schemaVersion of ['rival-battle-1','rival-battle-2','rival-battle-3']) {
    const uid=await setup({pilotRank:7,rivalWins:20});
    const issued=await rival(uid,{operation:'issue',schemaVersion});
    const settled=await rival(uid,{operation:'settle',battleId:issued.battleId,didWin:true,pilotRank:999,schemaVersion},T0+RIVAL_MIN_WIN_MS);
    assert.equal(settled.didWin,true);assert.equal((await profile(uid)).pilotRank,8);
    const before=await profile(uid);
    assert.equal((await rival(uid,{operation:'settle',battleId:issued.battleId,didWin:false,schemaVersion},T0+RIVAL_MIN_WIN_MS+1)).alreadyProcessed,true);
    assert.deepEqual(await profile(uid),before);
    assert.equal((await snapshot(uid)).pilotRank,8);
  }
});

test('legacy missing rank starts at one on the first win; a gathering citizen counts identically',async()=>{
  const uid=await setup({rivalWins:30});
  const {roster}=await transactArenaGathering(db,uid,{schemaVersion:'arena-gathering-1'});
  const issued=await rival(uid,{operation:'issue',storySchema:'arena-gathering-1',rivalId:roster[0].citizenId});
  await rival(uid,{operation:'settle',battleId:issued.battleId,didWin:true},T0+RIVAL_MIN_WIN_MS);
  assert.equal((await profile(uid)).pilotRank,1);assert.equal((await profile(uid)).rivalWins,31);
});

test('loss, issue, status, too-fast refusal and replay never increment rank',async()=>{
  const uid=await setup({pilotRank:4});
  await rival(uid,{operation:'status'});
  const issued=await rival(uid,{operation:'issue'});
  assert.equal((await profile(uid)).pilotRank,4);
  await refused(uid,()=>rival(uid,{operation:'settle',battleId:issued.battleId,didWin:true},T0+RIVAL_MIN_WIN_MS-1),'too_fast');
  await rival(uid,{operation:'settle',battleId:issued.battleId,didWin:false},T0+RIVAL_MIN_WIN_MS);
  assert.equal((await profile(uid)).pilotRank,4);
  await rival(uid,{operation:'settle',battleId:issued.battleId,didWin:true},T0+RIVAL_MIN_WIN_MS+1);
  assert.equal((await profile(uid)).pilotRank,4);
});

test('parallel duplicate wins grant once; distinct concurrent wins each grant one',async()=>{
  const uid=await setup();
  const issued=await rival(uid,{operation:'issue'}), settle={operation:'settle',battleId:issued.battleId,didWin:true};
  const replies=await Promise.all(Array.from({length:6},()=>rival(uid,settle,T0+RIVAL_MIN_WIN_MS)));
  assert.equal(replies.filter(r=>!r.alreadyProcessed).length,1);assert.equal((await profile(uid)).pilotRank,1);
  const now=T0+RIVAL_MIN_WIN_MS+RIVAL_COOLDOWN_MS, battles=[];
  for(let i=0;i<3;i++) battles.push(await rival(uid,{operation:'issue'},now));
  await Promise.all(battles.map(b=>rival(uid,{operation:'settle',battleId:b.battleId,didWin:true},now+RIVAL_MIN_WIN_MS)));
  assert.equal((await profile(uid)).pilotRank,4);
});

test('historical settled wins are not backfilled by replay after pilotRank is absent',async()=>{
  const uid=await setup(), i=await rival(uid,{operation:'issue'});
  await rival(uid,{operation:'settle',battleId:i.battleId,didWin:true},T0+RIVAL_MIN_WIN_MS);
  const {FieldValue}=require('firebase-admin/firestore');
  await db.doc(`users/${uid}`).update({pilotRank:FieldValue.delete()});
  const before=await profile(uid);
  assert.equal((await rival(uid,{operation:'settle',battleId:i.battleId,didWin:true},T0+RIVAL_MIN_WIN_MS+1)).alreadyProcessed,true);
  assert.deepEqual(await profile(uid),before);
});

test('malformed rank and overflow refuse atomically instead of coercing or resetting it',async()=>{
  for(const pilotRank of [null,'9',-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    const uid=await setup({pilotRank}), issued=await rival(uid,{operation:'issue'});
    await refused(uid,()=>snapshot(uid),'unavailable');
    await refused(uid,()=>rival(uid,{operation:'settle',battleId:issued.battleId,didWin:true},T0+RIVAL_MIN_WIN_MS),'unavailable');
    assert.equal((await db.doc(`rivalBattles/${uid}/battles/${issued.battleId}`).get()).data().settlement,null);
  }
  const uid=await setup({pilotRank:Number.MAX_SAFE_INTEGER}), issued=await rival(uid,{operation:'issue'});
  await refused(uid,()=>rival(uid,{operation:'settle',battleId:issued.battleId,didWin:true},T0+RIVAL_MIN_WIN_MS),'unavailable');
});

test('Holobot level thresholds stay 2/11/21 even with high pilotRank; zero pilotRank admits at each exact threshold',async()=>{
  for(const [id,level,count] of [['starter',2,0],['champion',11,1],['rare',21,2]]) {
    const flags={...defaults,tournamentsWon:count};
    const low=await setup({pilotRank:999,storyFlags:flags},level-1);
    await refused(low,()=>arena(low,'issue',admission(id)),'rank_too_low');
    assert.equal((await db.doc(`arenaMatches/${low}`).get()).exists,false);
    const ready=await setup({pilotRank:0,storyFlags:flags},level);
    const issued=await arena(ready,'issue',admission(id));
    assert.deepEqual(issued.match.tournament,{schemaVersion:'arena-tournament-1',tournamentId:id,requiredLevel:level,pilotRankAtAdmission:0});
    assert.equal(issued.match.entrant.level,level);
  }
});

test('admission snapshots rank once, replay and terminal result keep it after account rank changes',async()=>{
  const uid=await setup({pilotRank:7},2), fields=admission();
  await refused(uid,()=>arena(uid,'issue',{...fields,pilotRankAtAdmission:999}),'invalid_request');
  const issued=await arena(uid,'issue',fields), ref=db.doc(`arenaMatches/${uid}/matches/${issued.matchId}`);
  assert.equal(issued.match.tournament.pilotRankAtAdmission,7);
  await db.doc(`users/${uid}`).update({pilotRank:12});
  const replay=await arena(uid,'issue',fields);
  assert.equal(replay.alreadyProcessed,true);assert.equal(replay.match.tournament.pilotRankAtAdmission,7);
  await refused(uid,()=>arena(uid,'start',{matchId:issued.matchId}),'bracket_required');
  // Historical terminal replay fixture: admin removes the tag while ordinary paid
  // practice settles, then restores the exact admission snapshot. New tagged
  // public outcomes remain refused above; host brackets are exercised separately.
  const {FieldValue}=require('firebase-admin/firestore');
  await ref.update({tournament:FieldValue.delete()});
  await arena(uid,'start',{matchId:issued.matchId});
  const outcome={matchId:issued.matchId,playerFinalHealth:issued.match.entrant.currentHealth,opponentFinalHealth:0,combosCompleted:0,perfectDefenses:0};
  await arena(uid,'settle',outcome,T0+1500);
  await ref.update({tournament:issued.match.tournament});
  const settled=await arena(uid,'settle',outcome,T0+2000);
  assert.equal(settled.alreadyProcessed,true);
  assert.equal(settled.match.tournament.pilotRankAtAdmission,7);
  await transactTournamentResult(db,uid,{schemaVersion:'arena-tournament-1',tournamentId:'starter',matchId:issued.matchId});
  assert.equal((await profile(uid)).pilotRank,12);
  assert.equal((await profile(uid)).storyFlags.holoZonesArcBuilt,false);
  assert.equal((await ref.get()).data().tournament.pilotRankAtAdmission,7);
});

test('missing rank defaults at admission; pre-pilot-rank #80 tags remain replayable',async()=>{
  const uid=await setup({},2), fields=admission(), issued=await arena(uid,'issue',fields);
  assert.equal(issued.match.tournament.pilotRankAtAdmission,0);assert.equal((await profile(uid)).pilotRank,0);
  const {FieldValue}=require('firebase-admin/firestore');
  await db.doc(`arenaMatches/${uid}/matches/${issued.matchId}`).update({'tournament.pilotRankAtAdmission':FieldValue.delete()});
  const legacy=await arena(uid,'issue',fields);
  assert.equal(legacy.alreadyProcessed,true);assert.equal('pilotRankAtAdmission' in legacy.match.tournament,false);
  await arena(uid,'cancel',{matchId:issued.matchId});
});

test('malformed account rank at admission and malformed persisted snapshot fail closed',async()=>{
  for(const pilotRank of [null,'5',-1,0.5]) {
    const uid=await setup({pilotRank});
    await refused(uid,()=>arena(uid,'issue',admission()),'unavailable');
    assert.equal((await db.doc(`arenaMatches/${uid}`).get()).exists,false);
  }
  const uid=await setup({pilotRank:4}), fields=admission(), issued=await arena(uid,'issue',fields);
  const ref=db.doc(`arenaMatches/${uid}/matches/${issued.matchId}`);
  for(const value of [null,'4',-1,0.5]) {
    await ref.update({'tournament.pilotRankAtAdmission':value});
    await refused(uid,()=>arena(uid,'resume',{matchId:issued.matchId}),'unavailable');
  }
});

const rulesRequire=createRequire(new URL('../../rules-tests/package.json',import.meta.url));
const {initializeTestEnvironment,assertFails,assertSucceeds}=rulesRequire('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,deleteField,deleteDoc}=rulesRequire('firebase/firestore');
let env;
after(async()=>{if(env)await env.cleanup();await db.terminate();});
test('client rules deny pilotRank creation, addition, increment, decrease, deletion and replacement; unchanged merges remain valid',async()=>{
  const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
  env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{host,port:Number(port),rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});
  for(const pilotRank of [0,7]) {
    const uid=uidFor(), ref=doc(env.authenticatedContext(uid).firestore(),`users/${uid}`);
    await assertFails(setDoc(ref,{pilotRank}));
  }
  const uid=await setup(), ref=doc(env.authenticatedContext(uid).firestore(),`users/${uid}`);
  await assertFails(updateDoc(ref,{pilotRank:0}));
  await db.doc(`users/${uid}`).update({pilotRank:5});
  for(const pilotRank of [6,4,'5',null]) await assertFails(updateDoc(ref,{pilotRank}));
  await assertFails(updateDoc(ref,{pilotRank:deleteField()}));
  await assertFails(setDoc(ref,{displayName:'erase rank'}));await assertFails(deleteDoc(ref));
  await assertSucceeds(updateDoc(ref,{pilotRank:5,displayName:'Throwaway'}));
  assert.equal((await profile(uid)).pilotRank,5);
});
