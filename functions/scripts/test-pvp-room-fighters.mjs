import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {mintPvpRoomFighter,readPvpRoomFighters,pvpRoomFighterRequest,pvpRoomSeatReply,pvpRoomReadReply,readPvpRoomSeats,PVP_ROOM_REFUSALS,PVP_ROOM_TIER,PVP_ROOM_SEATS}=require('../lib/pvp/pvpRoomFighters');
const {arenaFighterSnapshot}=require('../lib/lib/arenaFighterSnapshot');
const Ajv=require('ajv');
const load=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const fixture=load('./fixtures/pvp-room/room-fighters-1.json');
const schema=load('../../Schemas/pvp-room-fighters-1.json');
const ajv=new Ajv({strict:false});ajv.addSchema(schema);
const ID=schema.$id,validateReply=ajv.getSchema(ID);
const validateRequest=ajv.compile({$ref:`${ID}#/definitions/request`}),validateDoc=ajv.compile({$ref:`${ID}#/definitions/seatsDoc`});
const {p1,p2}=fixture.profiles,bad=fixture.knownBad.room,roomId=bad.roomId,R=fixture.replies;
const profileOf={[p1.uid]:p1,[p2.uid]:p2};
const clone=x=>x===undefined?undefined:structuredClone(x);
const mint=(room,uid,id,{profile=profileOf[uid],seats}={})=>mintPvpRoomFighter(clone(room),clone(profile),clone(seats),uid,roomId,id);
const code=c=>e=>e.code===c;
// Firestore set(..., {merge:true}) semantics: nested maps merge key by key; nothing absent from the write is removed.
const applyWrite=(doc,write)=>{const out=clone(doc)??{};const m=(t,src)=>{for(const [k,v] of Object.entries(src)){if(v&&typeof v==='object'&&!Array.isArray(v)&&t[k]&&typeof t[k]==='object')m(t[k],v);else t[k]=clone(v);}};m(out,write);return out;};
const docFor=(uid,fighters)=>({schemaVersion:'pvp-room-fighters-1',roomId,byUid:{[uid]:{fighters}}});

test('premise: the recorded client-authored room carries local levels (99 / 50) and no host snapshot',()=>{
 assert.deepEqual([bad.players.p1.level,bad.players.p2.level],[99,50]);
 assert.equal(bad.hostFighters,undefined);
 assert.deepEqual([R.seatP1.fighter.level,R.seatP2.fighter.level],[21,12]);
 assert.equal(PVP_ROOM_SEATS,'pvpRoomSeats');
});

test('pure rulings reproduce the recorded emulator replies and stored doc from the owned bots only',()=>{
 const a=mint(bad,p1.uid,'ace');
 assert.deepEqual(pvpRoomSeatReply(roomId,a),R.seatP1);
 const b=mint(bad,p2.uid,'kuma',{seats:applyWrite(undefined,a.write)});
 assert.deepEqual(pvpRoomSeatReply(roomId,b),R.seatP2);
 assert.deepEqual(fixture.seatsDoc,applyWrite(applyWrite(undefined,a.write),b.write));
 assert.deepEqual(Object.keys(b.write.byUid),[p2.uid]); // A mint writes only the caller's own entry.
 assert.deepEqual(pvpRoomReadReply(roomId,readPvpRoomFighters(clone(bad),clone(fixture.seatsDoc),p1.uid,roomId)),R.readP1);
 assert.deepEqual(pvpRoomReadReply(roomId,readPvpRoomFighters(clone(bad),clone(fixture.seatsDoc),p2.uid,roomId)),R.readP2);
 // #118 shape exactly, tier is the host PvP constant.
 assert.deepEqual(a.fighter,arenaFighterSnapshot({holobotId:'ace',level:21},PVP_ROOM_TIER));assert.equal(PVP_ROOM_TIER,0);
 // The local room level never feeds the ruling: forging it changes nothing.
 assert.equal(mint({...bad,players:{...bad.players,p1:{...bad.players.p1,level:1}}},p1.uid,'ace').fighter.level,21);
});

test('S4 OPEN (documented, not fixed here): ownership AND level come from the owner-writable users/{uid}.holobots',()=>{
 // An owner who writes WOLF LV 99 into their own profile and seats WOLF gets a WOLF 99 snapshot. The stored seat
 // cannot be forged by a client, but its source can, until host-economy-hardening-1 protects holobots.
 const room={...bad,players:{...bad.players,p1:{...bad.players.p1,holobotName:'WOLF'}}};
 const forgedProfile={...p1,holobots:[...p1.holobots,{name:'WOLF',level:99}]};
 assert.deepEqual(mint(room,p1.uid,'wolf',{profile:forgedProfile}).fighter,{holobotId:'wolf',level:99,displayName:'WOLF',tier:0});
});

test('frozen: once minted, a level-up replays the stored snapshot instead of re-minting',()=>{
 const levelled={...p1,holobots:p1.holobots.map(h=>h.name==='ACE'?{...h,level:45}:h)};
 const r=mint(bad,p1.uid,'ace',{profile:levelled,seats:fixture.seatsDoc});
 assert.equal(r.alreadyProcessed,true);assert.equal(r.fighter.level,21);assert.deepEqual(r.seats,R.readP1.seats);assert.equal(r.write,null);
 assert.equal(mint(bad,p1.uid,'ace',{profile:levelled}).fighter.level,45); // A fresh room mints the current record.
});

test('stale seats: a snapshot minted for an earlier occupant of a reused room id is never returned',()=>{
 const reseated={...bad,players:{...bad.players,p1:{...bad.players.p1,uid:'demo_new_occupant'}}};
 assert.deepEqual(readPvpRoomFighters(clone(reseated),clone(fixture.seatsDoc),p2.uid,roomId).seats,{p2:R.readP1.seats.p2});
 const r=mint(reseated,'demo_new_occupant','ace',{profile:{holobots:[{name:'ACE',level:7}]},seats:fixture.seatsDoc});
 assert.deepEqual(r.seats,{p1:{uid:'demo_new_occupant',fighters:{ace:{holobotId:'ace',level:7,displayName:'ACE',tier:0}}},p2:R.readP1.seats.p2});
 assert.deepEqual(Object.keys(applyWrite(fixture.seatsDoc,r.write).byUid).sort(),[p1.uid,p2.uid,'demo_new_occupant'].sort());
});

test('seat-swap tampering on the room doc: a mint cannot erase the other snapshot, and freezing holds per uid in any seat',()=>{
 const swapped={...bad,players:{p1:{...bad.players.p1,holobotName:'HARE'},p2:{...bad.players.p2,uid:'x'}}};
 const m=mint(swapped,p1.uid,'hare',{seats:fixture.seatsDoc});
 assert.deepEqual(Object.keys(m.write.byUid),[p1.uid]);
 const doc=applyWrite(fixture.seatsDoc,m.write);
 assert.deepEqual(readPvpRoomFighters(clone(bad),doc,p2.uid,roomId).seats.p2,R.readP1.seats.p2);
 const levelled={...p1,holobots:p1.holobots.map(h=>h.name==='ACE'?{...h,level:45}:h)};
 const flipped={...bad,players:{p1:bad.players.p2,p2:bad.players.p1}};
 const r=mint(flipped,p1.uid,'ace',{profile:levelled,seats:fixture.seatsDoc});
 assert.equal(r.role,'p2');assert.equal(r.alreadyProcessed,true);assert.equal(r.fighter.level,21);assert.equal(r.write,null);
});

const NO_PROFILE=Symbol('no users/{uid} doc');
const ownedBots=holobots=>({...p1,holobots});
const fakeSeat=(fighter)=>docFor(p1.uid,{ace:fighter});
const SEAT_REFUSALS=[
 ['stranger is not a participant','not_participant',()=>[bad,'demo_stranger','ace',{profile:p1}]],
 ['one account in both seats','not_participant',()=>[{...bad,players:{p1:bad.players.p1,p2:{...bad.players.p2,uid:p1.uid}}},p1.uid,'ace']],
 ['owned but not seated','not_seated',()=>[bad,p1.uid,'hare']],
 ['seated but not owned','not_owned',()=>[{...bad,players:{...bad.players,p2:{...bad.players.p2,holobotName:'ACE'}}},p2.uid,'ace']],
 ['not a catalog bot','not_owned',()=>[{...bad,players:{...bad.players,p1:{...bad.players.p1,holobotName:'GHOSTBOT'}}},p1.uid,'ghostbot',{profile:ownedBots([{name:'GHOSTBOT',level:5}])}]],
 ['completed room','room_closed',()=>[{...bad,status:'completed'},p1.uid,'ace']],
 ['abandoned room','room_closed',()=>[{...bad,status:'abandoned'},p1.uid,'ace']],
 ['no profile','profile_invalid',()=>[bad,p1.uid,'ace',{profile:NO_PROFILE}]],
 ['duplicate owned records','profile_invalid',()=>[bad,p1.uid,'ace',{profile:ownedBots([...p1.holobots,{name:'ace',level:3}])}]],
 ...['21',0,-1,1.5,null,NaN].map(level=>[`stored level ${String(level)}`,'profile_invalid',()=>[bad,p1.uid,'ace',{profile:ownedBots([{name:'ACE',level}])}]]),
 ['stored level 100 is refused, never clamped','profile_invalid',()=>[bad,p1.uid,'ace',{profile:ownedBots([{name:'ACE',level:100}])}]],
 ['3v3 lineup larger than three','room_invalid',()=>[{...bad,mode:'3v3',teams:{p1:{members:[1,2,3,4].map(()=>bad.players.p1)},p2:{members:[]}}},p1.uid,'ace']],
 ['seats doc with another schema','seats_invalid',()=>[bad,p1.uid,'ace',{seats:{...fixture.seatsDoc,schemaVersion:'pvp-room-fighters-0'}}]],
 ['seats doc for another room','seats_invalid',()=>[bad,p1.uid,'ace',{seats:{...fixture.seatsDoc,roomId:'B'.repeat(20)}}]],
 ['seats doc with an extra key','seats_invalid',()=>[bad,p1.uid,'ace',{seats:{...fixture.seatsDoc,level:99}}]],
 ['seats doc without byUid','seats_invalid',()=>[bad,p1.uid,'ace',{seats:{schemaVersion:'pvp-room-fighters-1',roomId}}]],
 ['seats doc with a role-keyed seat','seats_invalid',()=>[bad,p1.uid,'ace',{seats:{...fixture.seatsDoc,p1:{uid:p1.uid,fighters:{}}}}]],
 ['byUid entry with an extra key','seats_invalid',()=>[bad,p1.uid,'ace',{seats:{...fixture.seatsDoc,byUid:{...fixture.seatsDoc.byUid,[p1.uid]:{fighters:{},role:'p1'}}}}]],
 ['stored snapshot with a fifth key','seats_invalid',()=>[bad,p1.uid,'ace',{seats:fakeSeat({...R.seatP1.fighter,uid:p1.uid})}]],
 ['stored snapshot with a non-PvP tier','seats_invalid',()=>[bad,p1.uid,'ace',{seats:fakeSeat({...R.seatP1.fighter,tier:3})}]],
 ['stored snapshot level 100','seats_invalid',()=>[bad,p1.uid,'ace',{seats:fakeSeat({...R.seatP1.fighter,level:100})}]],
];
test('seat refusal table: every refusal is a documented code and no refusal yields a fighter',()=>{
 for(const [name,expected,args] of SEAT_REFUSALS){
  const [room,uid,id,opts={}]=args();
  const profile=opts.profile===NO_PROFILE?undefined:(opts.profile??profileOf[uid]);
  assert.throws(()=>mintPvpRoomFighter(clone(room),clone(profile),clone(opts.seats),uid,roomId,id),code(expected),name);
  assert.ok(Object.hasOwn(PVP_ROOM_REFUSALS,expected),name);
 }
 assert.deepEqual(Object.keys(PVP_ROOM_REFUSALS).sort(),['invalid_request','not_owned','not_participant','not_seated','profile_invalid','room_closed','room_invalid','seats_invalid','unknown_room']);
 // Every refusal is permanent for the same inputs: none tells the client to retry.
 assert.ok(!Object.values(PVP_ROOM_REFUSALS).includes('unavailable'));
 assert.throws(()=>mintPvpRoomFighter(null,clone(p1),undefined,p1.uid,roomId,'ace'),code('room_invalid'));
});
test('read refusals: participants only (any room status); a corrupt seats doc fails closed',()=>{
 assert.throws(()=>readPvpRoomFighters(clone(bad),clone(fixture.seatsDoc),'demo_stranger',roomId),code('not_participant'));
 assert.throws(()=>readPvpRoomFighters({...bad,players:{p1:bad.players.p1,p2:{...bad.players.p2,uid:p1.uid}}},clone(fixture.seatsDoc),p1.uid,roomId),code('not_participant'));
 assert.deepEqual(readPvpRoomFighters({...clone(bad),status:'completed'},clone(fixture.seatsDoc),p1.uid,roomId).seats,R.readP1.seats);
 assert.deepEqual(readPvpRoomFighters(clone(bad),undefined,p1.uid,roomId).seats,{});
 assert.throws(()=>readPvpRoomFighters(clone(bad),{...fixture.seatsDoc,byUid:{...fixture.seatsDoc.byUid,[p2.uid]:{fighters:{kuma:{...R.seatP2.fighter,level:'12'}}}}},p1.uid,roomId),code('seats_invalid'));
});

test('request: exactly {operation:"seat", roomId, holobotId} or {operation:"read", roomId}; anything else is refused',()=>{
 const seat={operation:'seat',roomId,holobotId:'ace'},read={operation:'read',roomId};
 assert.deepEqual(pvpRoomFighterRequest(seat),seat);assert.deepEqual(pvpRoomFighterRequest(read),read);
 assert.ok(validateRequest(seat));assert.ok(validateRequest(read));
 for(const body of [{...seat,level:99},{...seat,tier:0},{...seat,uid:p2.uid},{...seat,role:'p2'},{...seat,schemaVersion:'pvp-room-fighters-1'},
  {...read,holobotId:'ace'},{...read,uid:p2.uid},{roomId,holobotId:'ace'},{operation:'mint',roomId,holobotId:'ace'},{operation:'seat',roomId},
  {operation:'seat',roomId:'room1',holobotId:'ace'},{operation:'read',roomId:'../users/x/aaaaaaaaaa'},{operation:'seat',roomId,holobotId:'ACE'},{operation:'seat',roomId,holobotId:7},null,[],'ace']){
  assert.throws(()=>pvpRoomFighterRequest(body),code('invalid_request'),JSON.stringify(body));
  if(body&&typeof body==='object'&&!Array.isArray(body))assert.equal(validateRequest(body),false,JSON.stringify(body));
 }
});

test('schema: every recorded reply and the stored doc validate; fighter is the #118 four-field shape; seat reader round-trips',()=>{
 for(const r of Object.values(R))assert.ok(validateReply(r),JSON.stringify(validateReply.errors));
 assert.ok(validateDoc(fixture.seatsDoc),JSON.stringify(validateDoc.errors));
 assert.equal(validateReply({...R.seatP1,fighter:{...R.seatP1.fighter,level:100}}),false);
 assert.equal(validateReply({...R.readP1,seats:{...R.readP1.seats,p3:{}}}),false);
 assert.equal(validateReply({...R.readP1,fighter:R.seatP1.fighter}),false);
 // PvP tier is pinned to 0 ("unranked PvP"), so it cannot be read as an Arena tier index by mistake.
 assert.equal(validateReply({...R.seatP1,fighter:{...R.seatP1.fighter,tier:3}}),false);
 assert.equal(validateDoc({...fixture.seatsDoc,byUid:{x:{fighters:{ace:{...R.seatP1.fighter,tier:1}}}}}),false);
 const arena=load('../../Schemas/arena-match-1.json').properties.match.anyOf[1].properties.entrant;
 const resolve=p=>p.$ref?schema.definitions[p.$ref.split('/').pop()]:p;
 assert.deepEqual(schema.definitions.fighter.required,arena.required);
 for(const k of arena.required)assert.deepEqual(resolve(schema.definitions.fighter.properties[k]),arena.properties[k],k);
 assert.deepEqual(readPvpRoomSeats(clone(fixture.seatsDoc),roomId),fixture.seatsDoc.byUid);assert.deepEqual(readPvpRoomSeats(undefined,roomId),{});
 assert.equal(validateDoc({...fixture.seatsDoc,p1:R.readP1.seats.p1}),false);
});
