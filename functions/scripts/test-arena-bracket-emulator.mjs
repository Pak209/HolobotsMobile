import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'') || !process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw new Error('Loopback demo emulator only; production forbidden');
const {db}=require('../lib/admin.js');
const {tournamentBracketHost}=require('../lib/story/tournamentBracketHost.js');
const {transactTournamentBracket}=require('../lib/story/tournamentBracketStore.js');
const {transactArenaMatch,ARENA_MATCH_TTL_MS}=require('../lib/arena/arenaMatchStore.js');
const {transactTournamentResult}=require('../lib/story/tournamentResultStore.js');
const {transactArenaGathering,gatheringRoster}=require('../lib/story/arenaGathering.js');
const {calculateExperience}=require('../lib/lib/progression.js');
const {readArenaBracket,advanceArenaBracket}=require('../lib/story/arenaBracket.js');
const S='arena-bracket-1',T0=Date.UTC(2026,9,15,7);let serial=0;
const flags={arenaGatheringSeen:true,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false};
const bot=(level=99,strong=true)=>({name:'ACE',level,experience:0,nextLevelExp:calculateExperience(level+1),attributePoints:0,boostedAttributes:strong?{attack:1000,defense:1000,health:1000,speed:1000}:{}});
async function setup(level=99,extra={},strong=true){const uid=`bracket_throwaway_${Date.now()}_${serial++}`;await db.doc(`users/${uid}`).set({holobots:[bot(level,strong)],storyFlags:flags,arenaPassses:10,holosTokens:1000,syncPoints:0,wins:0,losses:0,...extra});return uid;}
const user=async uid=>(await db.doc(`users/${uid}`).get()).data();
const arena=(uid,operation,fields={},now=T0)=>transactArenaMatch(db,uid,{schemaVersion:'arena-match-1',operation,...fields},now);
const issue=(uid,tournamentId='starter',now=T0)=>arena(uid,'issue',{requestId:`bracket_request_${serial++}`,tierId:'rookie',paymentMethod:'pass',holobotId:'ace',opponentName:'HARE',...(tournamentId?{tournamentId}:{})},now);
const call=(uid,operation,matchId,fields={},now=T0)=>transactTournamentBracket(db,uid,{schemaVersion:S,operation,matchId,...fields},now);
const code=c=>e=>e.code===c;
const state=async(uid,id)=>({user:await user(uid),match:(await db.doc(`arenaMatches/${uid}/matches/${id}`).get()).data(),lease:(await db.doc(`arenaMatches/${uid}`).get()).data(),bracket:(await db.doc(`arenaBrackets/${uid}/brackets/${id}`).get()).data()});
async function refused(uid,id,fn,expected){const before=await state(uid,id);await assert.rejects(fn,code(expected));assert.deepEqual(await state(uid,id),before);}
async function begin(level=99,extra={},strong=true){const uid=await setup(level,extra,strong),admission=await issue(uid);return{uid,id:admission.matchId,admission,started:await call(uid,'start',admission.matchId)};}

// Known-bad input first: the existing client-reported combat shape must never win a bound bracket.
test('known-bad claimed victory and final HP cannot bypass the host bracket or mint rewards',async()=>{
 const {uid,id}=await begin(),before=await user(uid);
 await refused(uid,id,()=>call(uid,'advance',id,{expectedRound:0,didWin:true,playerFinalHealth:999999}),'invalid_request');
 await refused(uid,id,()=>arena(uid,'settle',{matchId:id,playerFinalHealth:1,opponentFinalHealth:0,combosCompleted:0,perfectDefenses:0},T0+2000),'bracket_bound');
 await refused(uid,id,()=>arena(uid,'cancel',{matchId:id,playerFinalHealth:1},T0+2000),'bracket_bound');
 assert.deepEqual(await user(uid),before);
});
test('bracket fighter levels are host admission snapshots on start, resume and advance; client level is refused',async()=>{
 const uid=await setup(21),a=await issue(uid),id=a.matchId;
 await refused(uid,id,()=>call(uid,'start',id,{level:99}),'invalid_request');
 const start=await call(uid,'start',id);
 const levels=rows=>rows.map(e=>[e.entrantId,e.fighter.level]);
 assert.equal(start.bracket.entrants.find(e=>e.isPlayer).fighter.level,a.match.entrant.level);
 assert.equal(a.match.entrant.level,21);
 for(const row of start.bracket.entrants.filter(e=>!e.isPlayer))assert.equal(row.fighter.level,a.match.opponent.level);
 assert.equal(a.match.opponent.level,12);
 // Profile changes after admission must not rewrite a bracket's immutable LV badge.
 await db.doc(`users/${uid}`).update({holobots:[bot(45)]});
 const resumed=await call(uid,'resume',id);
 assert.deepEqual(levels(resumed.bracket.entrants),levels(start.bracket.entrants));
 const advanced=await call(uid,'advance',id,{expectedRound:0});
 assert.deepEqual(levels(advanced.bracket.entrants),levels(start.bracket.entrants));
 assert.equal((await user(uid)).storyFlags.holoZonesArcBuilt,false);
});
test('unbound tournament admission cannot bypass the bracket with public start or claimed-HP settle',async()=>{
 const uid=await setup(),a=await issue(uid),id=a.matchId;
 await refused(uid,id,()=>arena(uid,'start',{matchId:id}),'bracket_required');
 const report={matchId:id,playerFinalHealth:a.match.entrant.currentHealth,opponentFinalHealth:0,combosCompleted:0,perfectDefenses:0};
 await refused(uid,id,()=>arena(uid,'settle',report,T0+2000),'bracket_required');
 await refused(uid,id,()=>transactTournamentResult(db,uid,{schemaVersion:'arena-tournament-1',tournamentId:'starter',matchId:id}),'win_required');
 assert.equal((await arena(uid,'resume',{matchId:id})).match.state,'issued');
 // A pre-release active tagged admission also cannot settle a new client-claimed win.
 await db.doc(`arenaMatches/${uid}/matches/${id}`).update({state:'active',startedAtMs:T0});
 await refused(uid,id,()=>arena(uid,'settle',report,T0+2000),'bracket_required');
 const cancelled=await arena(uid,'cancel',{matchId:id,playerFinalHealth:a.match.entrant.currentHealth},T0+2000);
 assert.equal(cancelled.match.state,'cancelled');assert.equal((await state(uid,id)).lease.open,false);
 assert.equal((await user(uid)).storyFlags.tournamentsWon,0);
});
test('callable requires auth, rejects foreign fields, and returns machine-readable refusal',async()=>{
 await assert.rejects(()=>tournamentBracketHost.run({data:{}}),code('unauthenticated'));
 const uid=await setup(),id='am_'+'a'.repeat(32);
 for(const data of [null,[],{}, {schemaVersion:S,operation:'start',matchId:'../foreign'}, {schemaVersion:S,operation:'advance',matchId:id}, {schemaVersion:S,operation:'advance',matchId:id,expectedRound:0.5}, {schemaVersion:S,operation:'start',matchId:id,uid:'foreign'}])await refused(uid,id,()=>transactTournamentBracket(db,uid,data),'invalid_request');
 await assert.rejects(()=>tournamentBracketHost.run({auth:{uid},data:{schemaVersion:S,operation:'start',matchId:id}}),e=>e.code==='failed-precondition'&&e.details.rejectionCode==='not_admitted');
});
test('missing, foreign, untagged, ungathered and already-started practice admissions refuse not_admitted',async()=>{
 const uid=await setup(),foreign=await setup(),id='am_'+'a'.repeat(32);
 await refused(uid,id,()=>call(uid,'start',id),'not_admitted');
 const ordinary=await issue(uid,null);await refused(uid,ordinary.matchId,()=>call(uid,'start',ordinary.matchId),'not_admitted');
 const tagged=await issue(foreign);await refused(uid,tagged.matchId,()=>call(uid,'start',tagged.matchId),'not_admitted');
 const ungathered=await setup(99,{storyFlags:{...flags,arenaGatheringSeen:false}}),a=await issue(ungathered);
 await refused(ungathered,a.matchId,()=>call(ungathered,'start',a.matchId),'not_admitted');
 // Privileged fixture models an active match issued before bracket enforcement.
 await db.doc(`arenaMatches/${foreign}/matches/${tagged.matchId}`).update({state:'active',startedAtMs:T0});
 await refused(foreign,tagged.matchId,()=>call(foreign,'start',tagged.matchId),'not_admitted');
});
test('Holobot level gates remain exactly2/11/21, unrelated pilotRank does not replace them',async()=>{
 for(const [t,level,count]of[['starter',2,0],['champion',11,1],['rare',21,2]]){
  const below=await setup(level-1,{pilotRank:999,storyFlags:{...flags,tournamentsWon:count}});
  await assert.rejects(()=>issue(below,t),code('rank_too_low'));assert.equal((await user(below)).arenaPassses,10);
  const exact=await setup(level,{pilotRank:0,storyFlags:{...flags,tournamentsWon:count}}),a=await issue(exact,t);
  assert.equal(a.match.tournament.requiredLevel,level);assert.equal((await call(exact,'start',a.matchId)).bracket.tournamentId,t);
 }
});
test('start is concurrent and restart-idempotent, charges only the existing admission and includes all8citizens plus player',async()=>{
 const uid=await setup(),a=await issue(uid),before=await user(uid);
 const starts=await Promise.all([call(uid,'start',a.matchId),call(uid,'start',a.matchId)]);
 assert.deepEqual(starts[0].bracket,starts[1].bracket);assert.equal(starts.filter(r=>!r.alreadyProcessed).length,1);
 const b=starts[0].bracket;assert.equal(b.entrants.length,9);assert.equal(b.round,0);assert.equal(b.matches.length,0);
 assert.deepEqual(b.entrants.filter(e=>!e.isPlayer).map(e=>e.entrantId).sort(),gatheringRoster(uid).map(e=>e.citizenId).sort());
 assert.equal(b.entrants.filter(e=>e.isPlayer).length,1);assert.deepEqual(await user(uid),before);
 assert.deepEqual((await call(uid,'resume',a.matchId)).bracket,b);assert.equal((await user(uid)).arenaPassses,9);
});
test('private start seed is absent from refundable admission, generated once, and immutable on replay',async()=>{
 const uid=await setup(),a=await issue(uid),id=a.matchId;
 assert.equal(a.match.seed,undefined);assert.equal(a.match.bracket,undefined);assert.equal((await state(uid,id)).bracket,undefined);
 await refused(uid,id,()=>call(uid,'start',id,{seed:123}),'invalid_request');
 let draws=0;const start=await transactTournamentBracket(db,uid,{schemaVersion:S,operation:'start',matchId:id},T0,{createSeed:()=>{draws++;return 123456789;}});
 assert.equal(draws,1);assert.equal(start.bracket.seed,123456789);
 const replay=await transactTournamentBracket(db,uid,{schemaVersion:S,operation:'start',matchId:id},T0,{createSeed:()=>987654321});
 assert.deepEqual(replay.bracket,start.bracket);assert.equal(replay.alreadyProcessed,true);
 await refused(uid,id,()=>arena(uid,'cancel',{matchId:id}),'bracket_bound');assert.equal((await user(uid)).arenaPassses,9);
});
test('concurrent start versus refundable cancellation cannot reveal a bound seed and refund the same entry',async()=>{
 const uid=await setup(),a=await issue(uid),id=a.matchId;
 const results=await Promise.allSettled([transactTournamentBracket(db,uid,{schemaVersion:S,operation:'start',matchId:id},T0,{createSeed:()=>123}),arena(uid,'cancel',{matchId:id})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const s=await state(uid,id);
 if(results[0].status==='fulfilled'){assert.equal(s.user.arenaPassses,9);assert.equal(s.lease.open,true);assert.equal(s.bracket.bracket.seed,123);assert.equal(results[1].reason.code,'bracket_bound');}
 else{assert.equal(s.user.arenaPassses,10);assert.equal(s.lease.open,false);assert.equal(s.bracket,undefined);assert.equal(results[0].reason.code,'not_admitted');}
});
test('concurrent/replayed advance resolves exactly one play-in and never double-advances',async()=>{
 const {uid,id}=await begin(),before=await user(uid);
 const [a,b]=await Promise.all([call(uid,'advance',id,{expectedRound:0}),call(uid,'advance',id,{expectedRound:0})]);
 assert.deepEqual(a.bracket,b.bracket);assert.equal(a.bracket.round,1);assert.equal(a.bracket.matches.length,1);assert.equal(a.bracket.remaining.length,8);
 assert.deepEqual(await user(uid),before);const replay=await call(uid,'advance',id,{expectedRound:0});assert.equal(replay.alreadyProcessed,true);assert.equal(replay.bracket.round,1);
 await refused(uid,id,()=>call(uid,'advance',id,{expectedRound:3}),'invalid_request');
});
test('complete play-in and8-slot run settles once, feeds existing result, and refuses bracket_done',async()=>{
 const {uid,id,admission}=await begin(),before=await user(uid);let result;
 for(let round=0;round<4;round++) {result=await call(uid,'advance',id,{expectedRound:round},T0+1000+round);assert.equal(result.bracket.round,round+1);assert.equal(result.bracket.matches.length,[1,5,7,8][round]);}
 assert.equal(result.bracket.playerAlive,true);assert.equal(result.bracket.done,true);assert.deepEqual(result.bracket.remaining,['player']);
 const after=await user(uid);assert.equal(after.storyFlags.tournamentsWon,1);assert.equal(after.storyFlags.holoZonesArcBuilt,false);assert.equal(after.holosTokens-before.holosTokens,admission.match.rules.holos);assert.equal(after.wins-before.wins,1);assert.equal(after.arenaPassses,9);
 const persisted=await state(uid,id);assert.equal(persisted.lease.open,false);assert.equal(persisted.match.settlementReceipt.outcome,'win');
 const last=result.bracket.matches.at(-1),opponentId=last.leftId==='player'?last.rightId:last.leftId;
 assert.equal(persisted.match.opponent.holobotId,result.bracket.entrants.find(e=>e.entrantId===opponentId).holobotId);
 assert.equal(persisted.match.settlementReceipt.finalVitals.ace.currentHealth,result.bracket.health.player);
 await refused(uid,id,()=>call(uid,'advance',id,{expectedRound:4}),'bracket_done');
 const replay=await call(uid,'advance',id,{expectedRound:3});assert.equal(replay.alreadyProcessed,true);assert.deepEqual(await user(uid),after);
});
test('three complete tournament brackets feed unchanged progression and flip only the third Arena gate',async()=>{
 const uid=await setup();
 for(const [index,tournamentId] of ['starter','champion','rare'].entries()){
  const now=T0+index*10000,a=await issue(uid,tournamentId,now);
  await call(uid,'start',a.matchId,{},now);
  let r;for(let round=0;round<4;round++)r=await call(uid,'advance',a.matchId,{expectedRound:round},now+1000+round);
  assert.equal(r.storyFlags.tournamentsWon,index+1);assert.equal(r.storyFlags.arenaArcBuilt,index===2);assert.equal(r.storyFlags.holoZonesArcBuilt,false);
  const before=await user(uid);await call(uid,'resume',a.matchId,{},now+2000);assert.deepEqual(await user(uid),before);
 }
 assert.equal((await user(uid)).wins,3);assert.equal((await user(uid)).arenaPassses,7);
});
test('resume recovers progression after final receipt persisted, without duplicating Arena rewards',async()=>{
 const {uid,id}=await begin();for(let n=0;n<4;n++)await call(uid,'advance',id,{expectedRound:n},T0+1000+n);
 // Controlled admin fixture models interruption between the two committed transactions.
 await db.doc(`users/${uid}`).update({storyFlags:flags});const before=await user(uid);
 const recovered=await call(uid,'resume',id);assert.equal(recovered.storyFlags.tournamentsWon,1);
 assert.deepEqual(await user(uid),{...before,storyFlags:recovered.storyFlags});await call(uid,'resume',id);assert.equal((await user(uid)).storyFlags.tournamentsWon,1);
});
test('player elimination closes lease with host damage, loss once, and refuses player_eliminated',async()=>{
 const {uid,id}=await begin(2,{holobotVitals:{ace:{currentHealth:1,maxHealth:1000}}},false);let r;
 for(let n=0;n<4;n++){r=await call(uid,'advance',id,{expectedRound:n},T0+1000+n);if(!r.bracket.playerAlive)break;}
 assert.equal(r.bracket.playerAlive,false);assert.equal((await user(uid)).losses,1);assert.equal((await user(uid)).storyFlags.tournamentsWon,0);
 assert.equal((await state(uid,id)).lease.open,false);await refused(uid,id,()=>call(uid,'advance',id,{expectedRound:r.bracket.round}),'player_eliminated');
});
test('cancel after expiry keeps host-observed HP and releases the lease without reward or refund',async()=>{
 const damagedBot={...bot(2,false),boostedAttributes:{health:10000,defense:500}};
 const {uid,id,admission,started}=await begin(2,{holobots:[damagedBot]});
 // Cancellation needs a damaged survivor, not a particular random combat outcome.
 // Pin a bounded, purely simulated host seed in this throwaway admin fixture.
 let initial;for(let seed=0;seed<100;seed++){const candidate={...started.bracket,seed};let preview=advanceArenaBracket(candidate);if(preview.playerAlive)preview=advanceArenaBracket(preview);if(preview.playerAlive&&preview.health.player<admission.match.entrant.currentHealth){initial=candidate;break;}}
 assert.ok(initial,'bounded deterministic fixture includes partial damage');
 await db.doc(`arenaBrackets/${uid}/brackets/${id}`).set({schemaVersion:S,bracket:initial,cancelled:false});
 await call(uid,'advance',id,{expectedRound:0});
 const r=await call(uid,'advance',id,{expectedRound:1});const before=await user(uid);
 assert.ok(r.bracket.health.player<admission.match.entrant.currentHealth,'actual host damage before cancellation');
 await refused(uid,id,()=>call(uid,'advance',id,{expectedRound:2},T0+ARENA_MATCH_TTL_MS+1),'match_expired');
 const cancelled=await call(uid,'cancel',id,{},T0+ARENA_MATCH_TTL_MS+1);assert.equal(cancelled.cancelled,true);
 const s=await state(uid,id);assert.equal(s.lease.open,false);assert.equal(s.match.state,'expired');assert.equal(s.match.settlementReceipt.report.playerFinalHealth,r.bracket.health.player);
 assert.equal(s.user.holosTokens,before.holosTokens);assert.equal(s.user.arenaPassses,9);assert.equal(s.user.wins,before.wins);
 await refused(uid,id,()=>call(uid,'advance',id,{expectedRound:2}),'bracket_done');
});
test('corrupt persisted resolver receipts fail closed without partial writes',async()=>{
 const {uid,id}=await begin();await call(uid,'advance',id,{expectedRound:0});const ref=db.doc(`arenaBrackets/${uid}/brackets/${id}`),data=(await ref.get()).data();
 data.bracket.matches[0].winnerId='invented';await ref.set(data);await refused(uid,id,()=>call(uid,'advance',id,{expectedRound:1}),'unavailable');
});
const rulesRequire=createRequire(new URL('../../rules-tests/package.json',import.meta.url));
const {initializeTestEnvironment,assertFails}=rulesRequire('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,updateDoc,deleteDoc}=rulesRequire('firebase/firestore');let env;
after(async()=>{if(env)await env.cleanup();await db.terminate();});
test('rules deny owner and foreign bracket reads/writes at parent and child paths',async()=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');env=await initializeTestEnvironment({projectId:process.env.GCLOUD_PROJECT,firestore:{host,port:Number(port),rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});
 const {uid,id}=await begin();for(const auth of [uid,'bracket_throwaway_foreign']){const client=env.authenticatedContext(auth).firestore();for(const path of [`arenaBrackets/${uid}`,`arenaBrackets/${uid}/brackets/${id}`]){const ref=doc(client,path);await assertFails(getDoc(ref));await assertFails(setDoc(ref,{playerAlive:true}));await assertFails(updateDoc(ref,{playerAlive:true}));await assertFails(deleteDoc(ref));}}
});
