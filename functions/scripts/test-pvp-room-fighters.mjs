import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {mintPvpRoomFighter,pvpRoomFighterRequest,pvpRoomFighterReply,readPvpSeatFighters,PVP_ROOM_REFUSALS,PVP_ROOM_TIER}=require('../lib/pvp/pvpRoomFighters');
const {arenaFighterSnapshot}=require('../lib/lib/arenaFighterSnapshot');
const Ajv=require('ajv');
const load=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const fixture=load('./fixtures/pvp-room/room-fighters-1.json');
const schema=load('../../Schemas/pvp-room-fighters-1.json');
const ajv=new Ajv({strict:false});ajv.addSchema(schema);
const ID=schema.$id,validateReply=ajv.getSchema(ID);
const validateRequest=ajv.compile({$ref:`${ID}#/definitions/request`}),validateField=ajv.compile({$ref:`${ID}#/definitions/roomHostFighters`});
const {p1,p2}=fixture.profiles,bad=fixture.knownBad.room,roomId=bad.roomId;
const profileOf={[p1.uid]:p1,[p2.uid]:p2};
const mint=(room,uid,id,profile=profileOf[uid])=>mintPvpRoomFighter(structuredClone(room),structuredClone(profile),uid,id);
const code=c=>e=>e.code===c;

test('known-bad control: the client-authored room has no host snapshot and its local levels are not the host levels',()=>{
 assert.equal(bad.hostFighters,undefined);
 assert.deepEqual([bad.players.p1.level,bad.players.p2.level],[99,50]);
 assert.deepEqual([fixture.replies.p1.fighter.level,fixture.replies.p2.fighter.level],[21,12]);
});

test('pure ruling reproduces the recorded emulator replies and stored field from the owned bots only',()=>{
 const a=mint(bad,p1.uid,'ace'),b=mint(bad,p2.uid,'kuma');
 assert.deepEqual(pvpRoomFighterReply(roomId,a),fixture.replies.p1);
 assert.deepEqual(pvpRoomFighterReply(roomId,b),fixture.replies.p2);
 assert.deepEqual(fixture.room.hostFighters,{schemaVersion:'pvp-room-fighters-1',p1:{uid:p1.uid,fighters:{ace:a.fighter}},p2:{uid:p2.uid,fighters:{kuma:b.fighter}}});
 // #118 shape exactly, tier is the host PvP constant, and the client players docs are untouched.
 assert.deepEqual(a.fighter,arenaFighterSnapshot({holobotId:'ace',level:21},PVP_ROOM_TIER));assert.equal(PVP_ROOM_TIER,0);
 const {hostFighters,...rest}=fixture.room;assert.deepEqual(rest,bad);
 // The local room level never feeds the ruling: forging it changes nothing.
 assert.deepEqual(mint({...bad,players:{...bad.players,p1:{...bad.players.p1,level:1}}},p1.uid,'ace').fighter.level,21);
});

test('frozen: once minted, a level-up replays the stored snapshot instead of re-minting',()=>{
 const levelled={...p1,holobots:p1.holobots.map(h=>h.name==='ACE'?{...h,level:45}:h)};
 const r=mint(fixture.room,p1.uid,'ace',levelled);
 assert.equal(r.alreadyProcessed,true);assert.equal(r.fighter.level,21);
 assert.equal(mint(bad,p1.uid,'ace',levelled).fighter.level,45); // A fresh room mints the current record.
});

const ownedBots=(profile,holobots)=>({...profile,holobots});
const NO_PROFILE=Symbol('no users/{uid} doc');
const REFUSALS=[
 ['stranger is not a participant','not_participant',()=>[bad,'demo_stranger','ace',p1]],
 ['one account in both seats','not_participant',()=>[{...bad,players:{p1:bad.players.p1,p2:{...bad.players.p2,uid:p1.uid}}},p1.uid,'ace']],
 ['owned but not seated','not_seated',()=>[bad,p1.uid,'hare']],
 ['seated but not owned','not_owned',()=>[{...bad,players:{...bad.players,p2:{...bad.players.p2,holobotName:'ACE'}}},p2.uid,'ace']],
 ['not a catalog bot','not_owned',()=>[{...bad,players:{...bad.players,p1:{...bad.players.p1,holobotName:'GHOSTBOT'}}},p1.uid,'ghostbot',ownedBots(p1,[{name:'GHOSTBOT',level:5}])]],
 ['completed room','room_closed',()=>[{...bad,status:'completed'},p1.uid,'ace']],
 ['abandoned room','room_closed',()=>[{...bad,status:'abandoned'},p1.uid,'ace']],
 ['no profile','unavailable',()=>[bad,p1.uid,'ace',NO_PROFILE]],
 ['duplicate owned records','unavailable',()=>[bad,p1.uid,'ace',ownedBots(p1,[...p1.holobots,{name:'ace',level:3}])]],
 ...[ '21',0,-1,1.5,null,NaN].map(level=>[`stored level ${String(level)}`,'unavailable',()=>[bad,p1.uid,'ace',ownedBots(p1,[{name:'ACE',level}])]]),
 ['stored level 100 is refused, never clamped','unavailable',()=>[bad,p1.uid,'ace',ownedBots(p1,[{name:'ACE',level:100}])]],
 ['3v3 lineup larger than three','unavailable',()=>[{...bad,mode:'3v3',teams:{p1:{members:[1,2,3,4].map(()=>bad.players.p1)},p2:{members:[]}}},p1.uid,'ace']],
 ['corrupt host field schema','unavailable',()=>[{...bad,hostFighters:{schemaVersion:'pvp-room-fighters-0'}},p1.uid,'ace']],
 ['host seat belongs to another uid','unavailable',()=>[{...bad,hostFighters:{schemaVersion:'pvp-room-fighters-1',p1:{uid:'someone_else',fighters:{}}}},p1.uid,'ace']],
 ['host snapshot with a fifth key','unavailable',()=>[{...bad,hostFighters:{schemaVersion:'pvp-room-fighters-1',p1:{uid:p1.uid,fighters:{ace:{...fixture.replies.p1.fighter,uid:p1.uid}}}}},p1.uid,'ace']],
 ['host snapshot with a non-PvP tier','unavailable',()=>[{...bad,hostFighters:{schemaVersion:'pvp-room-fighters-1',p1:{uid:p1.uid,fighters:{ace:{...fixture.replies.p1.fighter,tier:3}}}}},p1.uid,'ace']],
];
test('refusal table: every refusal is a documented code and no refusal yields a fighter',()=>{
 for(const [name,expected,args] of REFUSALS){
  const [room,uid,id,profile=profileOf[uid]]=args();
  assert.throws(()=>mintPvpRoomFighter(structuredClone(room),profile===NO_PROFILE?undefined:structuredClone(profile),uid,id),code(expected),name);
  assert.ok(Object.hasOwn(PVP_ROOM_REFUSALS,expected),name);
 }
 assert.deepEqual(Object.keys(PVP_ROOM_REFUSALS).sort(),['invalid_request','not_owned','not_participant','not_seated','room_closed','unavailable','unknown_room']);
});

test('request: exactly roomId + holobotId; level, tier, uid, role or schemaVersion in the body is refused',()=>{
 const ok={roomId,holobotId:'ace'};
 assert.deepEqual(pvpRoomFighterRequest(ok),ok);assert.ok(validateRequest(ok));
 for(const body of [{...ok,level:99},{...ok,tier:0},{...ok,uid:p2.uid},{...ok,role:'p2'},{...ok,schemaVersion:'pvp-room-fighters-1'},
  {holobotId:'ace'},{roomId},{roomId:'room1',holobotId:'ace'},{roomId:'../users/x/aaaaaaaaaa',holobotId:'ace'},{roomId,holobotId:'ACE'},{roomId,holobotId:7},null,[],'ace']){
  assert.throws(()=>pvpRoomFighterRequest(body),code('invalid_request'),JSON.stringify(body));
  if(body&&typeof body==='object'&&!Array.isArray(body))assert.equal(validateRequest(body),false,JSON.stringify(body));
 }
});

test('schema: replies and stored field validate; fighter is the #118 four-field shape; host seat reader round-trips',()=>{
 for(const r of Object.values(fixture.replies))assert.ok(validateReply(r),JSON.stringify(validateReply.errors));
 assert.ok(validateField(fixture.room.hostFighters),JSON.stringify(validateField.errors));
 assert.equal(validateReply({...fixture.replies.p1,fighter:{...fixture.replies.p1.fighter,level:100}}),false);
 assert.equal(validateField({...fixture.room.hostFighters,p3:{}}),false);
 const arena=load('../../Schemas/arena-match-1.json').properties.match.anyOf[1].properties.entrant;
 assert.deepEqual(schema.definitions.fighter.required,arena.required);
 const resolve=p=>p.$ref?schema.definitions[p.$ref.split('/').pop()]:p;
 for(const k of arena.required)assert.deepEqual(resolve(schema.definitions.fighter.properties[k]),arena.properties[k],k);
 assert.deepEqual(readPvpSeatFighters(fixture.room.hostFighters,'p2'),fixture.room.hostFighters.p2);
 assert.equal(readPvpSeatFighters(undefined,'p1'),null);assert.equal(readPvpSeatFighters({schemaVersion:'pvp-room-fighters-1'},'p1'),null);
});
