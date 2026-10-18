import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Loopback demo emulator required');
const {db}=require('../lib/admin');
const {arenaMatchHost}=require('../lib/arena/arenaMatchHost');
const {ARENA_MIN_SETTLE_MS}=require('../lib/arena/arenaMatchStore');
const {chargeArenaEntry}=require('../lib/arena/chargeArenaEntry');
const Ajv=createRequire(new URL('../../rules-tests/package.json',import.meta.url))('ajv');
const ajv=new Ajv({strict:false});
const validators=Object.fromEntries(['arena-match-request-1','arena-match-1'].map(n=>[n,ajv.compile(JSON.parse(readFileSync(new URL(`../../Schemas/${n}.json`,import.meta.url))))]));
const uid=`admitted_contract_throwaway_${Date.now()}`;
after(async()=>{await db.recursiveDelete(db.doc(`arenaMatches/${uid}`));await db.doc(`users/${uid}`).delete();});
test('KNOWN-BAD legacy balance-only charge is closed, not a second admission',async()=>{
 await assert.rejects(()=>chargeArenaEntry.run({auth:{uid},data:{tierId:'rookie',paymentMethod:'tokens'}}),e=>e.details?.rejectionCode==='arena_match_required');
 assert.equal((await db.doc(`users/${uid}`).get()).exists,false);
});
test('callable lifecycle uses one paid ID and frozen snapshots across recovery and terminal retry',async()=>{
 await db.doc(`users/${uid}`).set({holobots:[{name:'ACE',level:4,experience:1700,nextLevelExp:2500,attributePoints:0}],holosTokens:1000,arenaPassses:3,syncPoints:0,wins:0,losses:0});
 const steps=[];
 async function call(operation,fields={}){
  const request={schemaVersion:'arena-match-1',operation,...fields};
  assert.ok(validators['arena-match-request-1'](request),JSON.stringify(validators['arena-match-request-1'].errors));
  const reply=await arenaMatchHost.run({auth:{uid},data:request});
  assert.ok(validators['arena-match-1'](reply),JSON.stringify(validators['arena-match-1'].errors));steps.push({request,reply});return reply;
 }
 const empty=await call('resume');assert.equal(empty.match,null);
 const issue={requestId:'admitted_fixture_01',tierId:'rookie',paymentMethod:'tokens',holobotId:'ace',opponentName:'HARE'};
 const a=await call('issue',issue),matchId=a.matchId;
 assert.equal(a.match.entryReceipt.amount,50);assert.equal(a.match.entryReceipt.balanceAfter,950);
 assert.deepEqual((await call('issue',issue)).match,a.match);
 assert.deepEqual((await call('resume')).match,a.match);
 await call('start',{matchId});
 await new Promise(resolve=>setTimeout(resolve,ARENA_MIN_SETTLE_MS+50)); // S1 win floor (was 1,050 ms past the old 1 s floor)
 const done=await call('settle',{matchId,playerFinalHealth:30,opponentFinalHealth:0,combosCompleted:0,perfectDefenses:0});
 assert.equal(done.match.state,'settled');assert.equal(done.match.settlementReceipt.outcome,'win');
 const account=(await db.doc(`users/${uid}`).get()).data();assert.equal(account.holosTokens,1050);assert.equal(account.wins,1);
 assert.deepEqual((await call('resume')).match,done.match);
 const replay=await call('settle',{matchId,playerFinalHealth:0,opponentFinalHealth:1,combosCompleted:0,perfectDefenses:0});assert.deepEqual(replay.match,done.match);
 assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),account);
 for(const step of steps.filter(s=>s.reply.match)){
  assert.equal(step.reply.matchId,matchId);assert.deepEqual(step.reply.match.entrant,a.match.entrant);assert.deepEqual(step.reply.match.opponent,a.match.opponent);
 }
 for(const forged of [{...steps[1].request,didWin:true},{...steps[4].request,fighterSnapshot:{level:99}}]){
  assert.equal(validators['arena-match-request-1'](forged),false);
  await assert.rejects(()=>arenaMatchHost.run({auth:{uid},data:forged}),e=>e.details?.rejectionCode==='invalid_request');
 }
 if(process.env.ARENA_ADMITTED_FIXTURE_OUT)writeFileSync(process.env.ARENA_ADMITTED_FIXTURE_OUT,JSON.stringify({schemaVersion:'arena-match-1',provenance:'Offline demo emulator, authenticated throwaway callable flow. CPU outcome remains client-reported HP, not verified combat.',steps},null,2)+'\n');
});
