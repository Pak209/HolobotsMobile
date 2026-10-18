import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw new Error('Loopback demo emulator only');
const {db}=require('../lib/admin');
const Ajv=createRequire(new URL('../../rules-tests/package.json',import.meta.url))('ajv');
const ajv=new Ajv({strict:false});
const validateMatch=ajv.compile(JSON.parse(readFileSync(new URL('../../Schemas/arena-match-1.json',import.meta.url))));
const validateBracket=ajv.compile(JSON.parse(readFileSync(new URL('../../Schemas/arena-bracket-1.json',import.meta.url))));
const {transactArenaMatch,ARENA_MIN_SETTLE_MS_CPU}=require('../lib/arena/arenaMatchStore');
const {transactTournamentBracket}=require('../lib/story/tournamentBracketStore');
const {calculateExperience}=require('../lib/lib/progression');
const T=Date.UTC(2026,9,17,20);let serial=0;const users=[];
after(async()=>{for(const uid of users){await db.recursiveDelete(db.doc(`arenaMatches/${uid}`));await db.recursiveDelete(db.doc(`arenaBrackets/${uid}`));await db.doc(`users/${uid}`).delete();}});
const bot=level=>({name:'ACE',level,experience:0,nextLevelExp:calculateExperience(level+1),attributePoints:0,boostedAttributes:{attack:1000,defense:1000,health:1000}});
async function pilot(){const uid=`snapshot_throwaway_${Date.now()}_${serial++}`;users.push(uid);await db.doc(`users/${uid}`).set({holobots:[bot(21)],storyFlags:{arenaGatheringSeen:true,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false},arenaPassses:10,holosTokens:1000,syncPoints:0,wins:0,losses:0});return uid;}
const arena=(uid,operation,extra={},time=T)=>transactArenaMatch(db,uid,{schemaVersion:'arena-match-1',operation,...extra},time);
const issue=(uid,extra={})=>arena(uid,'issue',{requestId:`snapshot_request_${serial++}`,tierId:'rookie',paymentMethod:'pass',holobotId:'ace',opponentName:'HARE',...extra});
const bracket=(uid,operation,matchId,extra={})=>transactTournamentBracket(db,uid,{schemaVersion:'arena-bracket-1',operation,matchId,...extra},T+100,{createSeed:()=>12345});
const assertMatch=reply=>{assert.ok(validateMatch(reply),JSON.stringify(validateMatch.errors));for(const side of ['entrant','opponent']){const f=reply.match[side];assert.equal(f.displayName,f.holobotId.toUpperCase());assert.equal(f.tier,0);assert.ok(f.level>=1&&f.level<=99);}};
test('match issue/start/resume/retry/cancel publish frozen snapshots; legacy saved record and client tamper',async()=>{
 const uid=await pilot();await assert.rejects(()=>issue(uid,{fighterSnapshot:{holobotId:'wolf',level:99}}),e=>e.code==='invalid_request');
 const a=await issue(uid);assertMatch(a);
 const stored=(await db.doc(`arenaMatches/${uid}/matches/${a.matchId}`).get()).data();assert.equal(stored.opponent.displayName,undefined); // old saved shape remains byte-compatible
 await db.doc(`users/${uid}`).update({holobots:[bot(45)]});
 assertMatch(await arena(uid,'resume',{matchId:a.matchId}));
 const retry=await arena(uid,'issue',{requestId:stored.requestId,tierId:'rookie',paymentMethod:'pass',holobotId:'ace',opponentName:'HARE'});assertMatch(retry);assert.equal(retry.match.entrant.level,21);
 assertMatch(await arena(uid,'start',{matchId:a.matchId}));
 assertMatch(await arena(uid,'cancel',{matchId:a.matchId,playerFinalHealth:a.match.entrant.currentHealth},T+2000));
 assertMatch(await arena(uid,'resume',{}));
 const b=await issue(uid);assertMatch(b);await arena(uid,'start',{matchId:b.matchId});
 const result=await arena(uid,'settle',{matchId:b.matchId,playerFinalHealth:b.match.entrant.currentHealth,opponentFinalHealth:0,combosCompleted:0,perfectDefenses:0},T+2000+ARENA_MIN_SETTLE_MS_CPU);assertMatch(result);
 if(process.env.ARENA_SNAPSHOT_FIXTURE_OUT)writeFileSync(process.env.ARENA_SNAPSHOT_FIXTURE_OUT,JSON.stringify({provenance:'Throwaway loopback demo emulator; arenaMatchHost transaction issue reply.',reply:b},null,2)+'\n');
});
test('all eight citizen entrants plus player project same fighter identity/stats on every bracket reply',async()=>{
 const uid=await pilot(),a=await issue(uid,{tournamentId:'starter'}),id=a.matchId;
 await assert.rejects(()=>bracket(uid,'start',id,{fighterSnapshot:{level:99}}),e=>e.code==='invalid_request');
 const start=await bracket(uid,'start',id);
 const check=r=>{assert.ok(validateBracket(r),JSON.stringify(validateBracket.errors));assert.equal(r.bracket.entrants.length,9);for(const e of r.bracket.entrants){assert.equal(e.fighter.displayName,e.fighter.holobotId.toUpperCase());assert.deepEqual(Object.keys(e).sort(),['entrantId','fighter','holobotId','isPlayer','pilotName']);}assert.deepEqual(r.bracket.entrants,start.bracket.entrants);};
 check(start);check(await bracket(uid,'start',id));check(await bracket(uid,'resume',id));
 const saved=(await db.doc(`arenaBrackets/${uid}/brackets/${id}`).get()).data();assert.ok(saved.bracket.entrants.every(e=>!e.fighter.displayName));
 await db.doc(`users/${uid}`).update({holobots:[bot(45)]});
 const next=await bracket(uid,'advance',id,{expectedRound:0});check(next);check(await bracket(uid,'advance',id,{expectedRound:0}));
 if(next.bracket.playerAlive&&!next.bracket.done)check(await bracket(uid,'cancel',id));
 check(await bracket(uid,'resume',id));
});
