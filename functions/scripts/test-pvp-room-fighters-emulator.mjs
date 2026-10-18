import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw new Error('Loopback demo emulator only');
const {db}=require('../lib/admin');
const {transactPvpRoomFighter,PVP_ROOM_SEATS}=require('../lib/pvp/pvpRoomFighters');
const {calculateExperience}=require('../lib/lib/progression');
const Ajv=require('ajv');
const ajv=new Ajv({strict:false});ajv.addSchema(JSON.parse(readFileSync(new URL('../../Schemas/pvp-room-fighters-1.json',import.meta.url))));
const ID='https://holobots.local/schemas/pvp-room-fighters-1.json';
const validateReply=ajv.getSchema(ID),validateDoc=ajv.compile({$ref:`${ID}#/definitions/seatsDoc`});
// Disposable demo uids, deleted after the run. Fixed so the recorded fixture is stable.
const P1='demo_pvp_fighters_p1',P2='demo_pvp_fighters_p2',STRANGER='demo_pvp_fighters_stranger',rooms=[];
after(async()=>{for(const id of rooms){await db.doc(`battle_rooms/${id}`).delete();await db.doc(`${PVP_ROOM_SEATS}/${id}`).delete();}for(const uid of [P1,P2,STRANGER])await db.doc(`users/${uid}`).delete();});
const bot=(name,level)=>({name,level,experience:0,nextLevelExp:calculateExperience(level+1),attributePoints:0});
const profiles={[P1]:{username:'Pilot One',holobots:[bot('ACE',21),bot('HARE',4)]},[P2]:{username:'Pilot Two',holobots:[bot('KUMA',12)]},[STRANGER]:{username:'Stranger',holobots:[bot('ACE',30)]}};
// The client-authored fighter doc (buildPvpFighterDoc shape, trimmed). `level` is the LOCAL profile value.
const seat=(uid,holobotName,level)=>({uid,username:uid?profiles[uid].username:'',holobotName,level,archetype:'balanced',maxHP:uid?150:0,currentHP:uid?150:0,attack:8,defense:6,speed:7,intelligence:5,stamina:7,maxStamina:7,specialMeter:0,comboCounter:0,guardStacks:0,isInDefenseMode:false,armedDefenseTrap:null,moveCooldowns:{},abilityRuntime:{firedCount:0},moves:[],totalDamageDealt:0,isConnected:!!uid});
const clientRoom=(roomId,extra={})=>({roomId,roomCode:'PVPFX1',rulesVersion:3,status:'waiting',mode:'1v1',players:{p1:seat(P1,'ACE',99),p2:seat('','',0)},turnNumber:0,winner:null,battleLog:[],createdAt:1792267200000,...extra});
const call=(uid,body)=>transactPvpRoomFighter(db,uid,body);
const seatOp=(uid,roomId,holobotId)=>call(uid,{operation:'seat',roomId,holobotId});
const readOp=(uid,roomId)=>call(uid,{operation:'read',roomId});
const refused=code=>e=>e.code===code;
const valid=r=>{assert.ok(validateReply(r),JSON.stringify(validateReply.errors));return r;};
const seatsDoc=async id=>(await db.doc(`${PVP_ROOM_SEATS}/${id}`).get()).data();
async function seed(){for(const [uid,p] of Object.entries(profiles))await db.doc(`users/${uid}`).set(p);}
async function newRoom(extra,id){const ref=id?db.doc(`battle_rooms/${id}`):db.collection('battle_rooms').doc();if(!rooms.includes(ref.id))rooms.push(ref.id);await ref.set(clientRoom(ref.id,extra));return ref;}

test('known-bad control: a client-authored room carries only local levels and the host has minted nothing',async()=>{
 await seed();const ref=await newRoom();const room=(await ref.get()).data();
 assert.equal(room.players.p1.level,99); // Local value; ACE is 21 on the host record.
 assert.equal(await seatsDoc(ref.id),undefined);
});

test('create -> seat -> join -> seat -> read: both snapshots in the replies, stored server-only, room doc untouched',async()=>{
 await seed();const ref=await newRoom();
 const a=valid(await seatOp(P1,ref.id,'ace'));
 assert.deepEqual(a,{schemaVersion:'pvp-room-fighters-1',operation:'seat',roomId:ref.id,role:'p1',alreadyProcessed:false,fighter:{holobotId:'ace',level:21,displayName:'ACE',tier:0},seats:{p1:{uid:P1,fighters:{ace:a.fighter}}}});
 await assert.rejects(()=>seatOp(P2,ref.id,'kuma'),refused('not_participant')); // Not seated until joined.
 await assert.rejects(()=>readOp(P2,ref.id),refused('not_participant'));
 await ref.update({'players.p2':seat(P2,'KUMA',50),status:'active'}); // joinRoom's client write.
 const joined=(await ref.get()).data();
 const b=valid(await seatOp(P2,ref.id,'kuma'));
 assert.equal(b.role,'p2');assert.equal(b.fighter.level,12);assert.deepEqual(Object.keys(b.seats).sort(),['p1','p2']);
 const readP1=valid(await readOp(P1,ref.id)),readP2=valid(await readOp(P2,ref.id));
 assert.deepEqual(readP1.seats,b.seats);assert.deepEqual(readP2.seats,b.seats);assert.equal(readP1.role,'p1');assert.equal(readP2.role,'p2');
 await assert.rejects(()=>readOp(STRANGER,ref.id),refused('not_participant'));
 const stored=await seatsDoc(ref.id);
 assert.ok(validateDoc(stored),JSON.stringify(validateDoc.errors));
 assert.deepEqual(stored,{schemaVersion:'pvp-room-fighters-1',roomId:ref.id,byUid:{[P1]:{fighters:{ace:a.fighter}},[P2]:{fighters:{kuma:b.fighter}}}});
 assert.deepEqual((await ref.get()).data(),joined); // The host never writes battle_rooms.
 // Frozen: a later level-up does not rewrite this room's badge, and a retry is a replay.
 await db.doc(`users/${P1}`).update({holobots:[bot('ACE',45),bot('HARE',4)]});
 const replay=valid(await seatOp(P1,ref.id,'ace'));assert.equal(replay.alreadyProcessed,true);assert.equal(replay.fighter.level,21);
 // A finished room can still be read for its result screen, but no longer seated.
 await ref.update({status:'completed'});
 assert.deepEqual(valid(await readOp(P1,ref.id)).seats,b.seats);
 await assert.rejects(()=>seatOp(P1,ref.id,'hare'),refused('room_closed'));
 if(process.env.PVP_ROOM_FIXTURE_OUT)writeFileSync(process.env.PVP_ROOM_FIXTURE_OUT,JSON.stringify({
  provenance:'Throwaway loopback demo emulator (demo- project, 127.0.0.1); real transactPvpRoomFighter calls; disposable demo uids deleted after the run.',
  schemaVersion:'pvp-room-fighters-1',
  profiles:{p1:{uid:P1,...profiles[P1]},p2:{uid:P2,...profiles[P2]}},
  knownBad:{note:'Client-authored room. players.*.level is the LOCAL profile value (99 / 50) and must never reach a badge; the room doc never carries host snapshots.',room:joined},
  replies:{seatP1:a,seatP2:b,readP1,readP2},
  seatsDoc:stored,
 },null,2)+'\n');
});

test('refusals: stranger, unowned, unseated, forged body fields, unknown room; no refusal writes',async()=>{
 await seed();const ref=await newRoom({players:{p1:seat(P1,'ACE',99),p2:seat(P2,'KUMA',50)},status:'active'});
 await assert.rejects(()=>seatOp(STRANGER,ref.id,'ace'),refused('not_participant'));
 await assert.rejects(()=>seatOp(P1,ref.id,'hare'),refused('not_seated')); // Owned, but not the seated bot.
 for(const body of [{operation:'seat',roomId:ref.id,holobotId:'ace',level:99},{operation:'seat',roomId:ref.id,holobotId:'ace',uid:P2},{roomId:ref.id,holobotId:'ace'},{operation:'read',roomId:ref.id,role:'p2'}])
  await assert.rejects(()=>call(P1,body),refused('invalid_request'),JSON.stringify(body));
 await ref.update({'players.p2.holobotName':'ACE'}); // P2 seats a bot P2 does not own.
 await assert.rejects(()=>seatOp(P2,ref.id,'ace'),refused('not_owned'));
 await assert.rejects(()=>seatOp(P1,'A'.repeat(20),'ace'),refused('unknown_room'));
 await assert.rejects(()=>readOp(P1,'A'.repeat(20)),refused('unknown_room'));
 assert.equal(await seatsDoc(ref.id),undefined);
});

test('3v3: every lineup member mints into the seat; a non-member is refused',async()=>{
 await seed();
 const member=(uid,name)=>seat(uid,name,77);
 const ref=await newRoom({mode:'3v3',status:'active',players:{p1:member(P1,'ACE'),p2:member(P2,'KUMA')},
  teams:{p1:{members:[member(P1,'ACE'),member(P1,'HARE')],activeIndex:0,switchCooldownUntil:0,entryLockUntil:0},p2:{members:[member(P2,'KUMA')],activeIndex:0,switchCooldownUntil:0,entryLockUntil:0}}});
 assert.equal(valid(await seatOp(P1,ref.id,'ace')).fighter.level,21);
 assert.equal(valid(await seatOp(P1,ref.id,'hare')).fighter.level,4);
 await assert.rejects(()=>seatOp(P2,ref.id,'ace'),refused('not_seated'));
 const doc=await seatsDoc(ref.id);assert.ok(validateDoc(doc));assert.deepEqual(Object.keys(doc.byUid[P1].fighters).sort(),['ace','hare']);
});

test('reused room id: a snapshot minted for an earlier occupant is never shown; the new occupant mints their own',async()=>{
 await seed();const ref=await newRoom({players:{p1:seat(P1,'ACE',99),p2:seat(P2,'KUMA',50)},status:'active'});
 await seatOp(P1,ref.id,'ace');
 await ref.delete();await newRoom({players:{p1:seat(STRANGER,'ACE',1),p2:seat(P2,'KUMA',50)},status:'active'},ref.id);
 assert.deepEqual(valid(await readOp(STRANGER,ref.id)).seats,{});
 const s=valid(await seatOp(STRANGER,ref.id,'ace'));assert.equal(s.fighter.level,30);assert.deepEqual(Object.keys(s.seats),['p1']);
 assert.deepEqual(Object.keys((await seatsDoc(ref.id)).byUid).sort(),[P1,STRANGER].sort());
});

test('seat-swap tampering on the client-authored room cannot erase the other snapshot or unfreeze your own',async()=>{
 await seed();const ref=await newRoom({players:{p1:seat(P1,'ACE',99),p2:seat(P2,'KUMA',50)},status:'active'});
 await seatOp(P1,ref.id,'ace');await seatOp(P2,ref.id,'kuma');
 const before=valid(await readOp(P1,ref.id)).seats;
 // P1 (a participant, so the rules allow it) rewrites P2's seat uid, seats another owned bot, then restores the room.
 await ref.update({'players.p2.uid':'x','players.p1.holobotName':'HARE'});
 assert.equal(valid(await seatOp(P1,ref.id,'hare')).fighter.level,4);
 await ref.update({'players.p2.uid':P2,'players.p1.holobotName':'ACE'});
 const after=valid(await readOp(P2,ref.id)).seats;
 assert.deepEqual(after.p2,before.p2);assert.deepEqual(after.p1.fighters.ace,before.p1.fighters.ace);
 // P1 levels ACE, then swaps seats so P1 sits in p2 and asks again: still the frozen first-mint level.
 await db.doc(`users/${P1}`).update({holobots:[bot('ACE',45),bot('HARE',4)]});
 await ref.update({'players.p1':seat(P2,'KUMA',50),'players.p2':seat(P1,'ACE',99)});
 const replay=valid(await seatOp(P1,ref.id,'ace'));assert.equal(replay.alreadyProcessed,true);assert.equal(replay.fighter.level,21);assert.equal(replay.role,'p2');
});
