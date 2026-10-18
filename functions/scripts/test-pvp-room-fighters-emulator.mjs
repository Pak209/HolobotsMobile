import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw new Error('Loopback demo emulator only');
const {db}=require('../lib/admin');
const {transactPvpRoomFighter}=require('../lib/pvp/pvpRoomFighters');
const {calculateExperience}=require('../lib/lib/progression');
const Ajv=require('ajv');
const ajv=new Ajv({strict:false});ajv.addSchema(JSON.parse(readFileSync(new URL('../../Schemas/pvp-room-fighters-1.json',import.meta.url))));
const ID='https://holobots.local/schemas/pvp-room-fighters-1.json';
const validateReply=ajv.getSchema(ID),validateField=ajv.compile({$ref:`${ID}#/definitions/roomHostFighters`});
// Disposable demo uids, deleted after the run. Fixed so the recorded fixture is stable.
const P1='demo_pvp_fighters_p1',P2='demo_pvp_fighters_p2',STRANGER='demo_pvp_fighters_stranger',rooms=[];
after(async()=>{for(const id of rooms)await db.doc(`battle_rooms/${id}`).delete();for(const uid of [P1,P2,STRANGER])await db.doc(`users/${uid}`).delete();});
const bot=(name,level)=>({name,level,experience:0,nextLevelExp:calculateExperience(level+1),attributePoints:0});
const profiles={[P1]:{username:'Pilot One',holobots:[bot('ACE',21),bot('HARE',4)]},[P2]:{username:'Pilot Two',holobots:[bot('KUMA',12)]},[STRANGER]:{username:'Stranger',holobots:[bot('ACE',30)]}};
// The client-authored fighter doc (buildPvpFighterDoc shape, trimmed). `level` is the LOCAL profile value.
const seat=(uid,holobotName,level)=>({uid,username:uid?profiles[uid].username:'',holobotName,level,archetype:'balanced',maxHP:uid?150:0,currentHP:uid?150:0,attack:8,defense:6,speed:7,intelligence:5,stamina:7,maxStamina:7,specialMeter:0,comboCounter:0,guardStacks:0,isInDefenseMode:false,armedDefenseTrap:null,moveCooldowns:{},abilityRuntime:{firedCount:0},moves:[],totalDamageDealt:0,isConnected:!!uid});
const clientRoom=(roomId,extra={})=>({roomId,roomCode:'PVPFX1',rulesVersion:3,status:'waiting',mode:'1v1',players:{p1:seat(P1,'ACE',99),p2:seat('','',0)},turnNumber:0,winner:null,battleLog:[],createdAt:1792267200000,...extra});
const call=(uid,body)=>transactPvpRoomFighter(db,uid,body);
const refused=code=>e=>e.code===code;
async function seed(){for(const [uid,p] of Object.entries(profiles))await db.doc(`users/${uid}`).set(p);}
async function newRoom(extra){const ref=db.collection('battle_rooms').doc();rooms.push(ref.id);await ref.set(clientRoom(ref.id,extra));return ref;}

test('known-bad control: a client-authored room carries only local levels and no host snapshot',async()=>{
 await seed();const ref=await newRoom();const room=(await ref.get()).data();
 assert.equal(room.hostFighters,undefined);assert.equal(room.players.p1.level,99); // Local value; ACE is 21 on the host record.
});

test('create -> join -> both seats mint frozen host snapshots; replies and stored field validate',async()=>{
 await seed();const ref=await newRoom();const before=(await ref.get()).data();
 const a=await call(P1,{roomId:ref.id,holobotId:'ace'});
 assert.ok(validateReply(a),JSON.stringify(validateReply.errors));
 assert.deepEqual(a,{schemaVersion:'pvp-room-fighters-1',roomId:ref.id,role:'p1',alreadyProcessed:false,fighter:{holobotId:'ace',level:21,displayName:'ACE',tier:0}});
 await assert.rejects(()=>call(P2,{roomId:ref.id,holobotId:'kuma'}),refused('not_participant')); // Not seated until joined.
 await ref.update({'players.p2':seat(P2,'KUMA',50),status:'active'}); // joinRoom's client write.
 const b=await call(P2,{roomId:ref.id,holobotId:'kuma'});
 assert.ok(validateReply(b),JSON.stringify(validateReply.errors));assert.equal(b.role,'p2');assert.equal(b.fighter.level,12);
 const room=(await ref.get()).data();
 assert.ok(validateField(room.hostFighters),JSON.stringify(validateField.errors));
 assert.deepEqual(room.hostFighters,{schemaVersion:'pvp-room-fighters-1',p1:{uid:P1,fighters:{ace:a.fighter}},p2:{uid:P2,fighters:{kuma:b.fighter}}});
 assert.equal(room.players.p1.level,99);assert.equal(room.players.p2.level,50); // Client combat docs untouched.
 // Frozen: a later level-up does not rewrite this room's badge, and a retry is a replay.
 await db.doc(`users/${P1}`).update({holobots:[bot('ACE',45),bot('HARE',4)]});
 const replay=await call(P1,{roomId:ref.id,holobotId:'ace'});assert.equal(replay.alreadyProcessed,true);assert.equal(replay.fighter.level,21);
 if(process.env.PVP_ROOM_FIXTURE_OUT)writeFileSync(process.env.PVP_ROOM_FIXTURE_OUT,JSON.stringify({
  provenance:'Throwaway loopback demo emulator (demo- project, 127.0.0.1); real transactPvpRoomFighter transactions; disposable demo uids deleted after the run.',
  schemaVersion:'pvp-room-fighters-1',
  profiles:{p1:{uid:P1,...profiles[P1]},p2:{uid:P2,...profiles[P2]}},
  knownBad:{note:'Client-authored room before any host answer. players.*.level is the LOCAL profile value (99 / 50) and must never reach a badge.',room:{...before,players:{p1:before.players.p1,p2:seat(P2,'KUMA',50)},status:'active'}},
  replies:{p1:a,p2:b},
  room,
 },null,2)+'\n');
});

test('refusals: stranger, unowned, unseated, forged body fields, closed room, unknown room',async()=>{
 await seed();const ref=await newRoom({players:{p1:seat(P1,'ACE',99),p2:seat(P2,'KUMA',50)},status:'active'});
 await assert.rejects(()=>call(STRANGER,{roomId:ref.id,holobotId:'ace'}),refused('not_participant'));
 await assert.rejects(()=>call(P1,{roomId:ref.id,holobotId:'hare'}),refused('not_seated')); // Owned, but not the seated bot.
 await assert.rejects(()=>call(P1,{roomId:ref.id,holobotId:'ace',level:99}),refused('invalid_request'));
 await assert.rejects(()=>call(P1,{roomId:ref.id,holobotId:'ace',uid:P2}),refused('invalid_request'));
 await ref.update({'players.p2.holobotName':'ACE'}); // P2 seats a bot P2 does not own.
 await assert.rejects(()=>call(P2,{roomId:ref.id,holobotId:'ace'}),refused('not_owned'));
 await ref.update({status:'completed'});
 await assert.rejects(()=>call(P1,{roomId:ref.id,holobotId:'ace'}),refused('room_closed'));
 await assert.rejects(()=>call(P1,{roomId:'A'.repeat(20),holobotId:'ace'}),refused('unknown_room'));
 assert.equal((await ref.get()).data().hostFighters,undefined); // No refusal wrote anything.
});

test('3v3: every lineup member mints into the seat; a non-member is refused',async()=>{
 await seed();
 const member=(uid,name)=>seat(uid,name,77);
 const ref=await newRoom({mode:'3v3',status:'active',players:{p1:member(P1,'ACE'),p2:member(P2,'KUMA')},
  teams:{p1:{members:[member(P1,'ACE'),member(P1,'HARE')],activeIndex:0,switchCooldownUntil:0,entryLockUntil:0},p2:{members:[member(P2,'KUMA')],activeIndex:0,switchCooldownUntil:0,entryLockUntil:0}}});
 assert.equal((await call(P1,{roomId:ref.id,holobotId:'ace'})).fighter.level,21);
 assert.equal((await call(P1,{roomId:ref.id,holobotId:'hare'})).fighter.level,4);
 await assert.rejects(()=>call(P2,{roomId:ref.id,holobotId:'ace'}),refused('not_seated'));
 const field=(await ref.get()).data().hostFighters;assert.ok(validateField(field));assert.deepEqual(Object.keys(field.p1.fighters).sort(),['ace','hare']);
});
