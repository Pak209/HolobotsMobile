import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url), P=require('../lib/presence/presenceDomain.js'), W=require('../lib/lib/wardrobe.js');
const now=1791660000000, profile={username:'Town Pilot',holobots:[{name:'ACE',level:4,rank:'Starter'}],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']},email:'PRIVATE',holosTokens:999};
const command=(extra={})=>({schemaVersion:'presence-1',operation:'heartbeat',scene:'HoloCity_Main',pos:[1.23,2.23,-4.21],yaw:450,deployed:['ace'],...extra});
test('KNOWN-BAD first: a forged level/name/look cannot cross the host projection',()=>{
 const c=P.validatePresenceCommand(command({username:'FORGED',level:999,pilot:{fake:true}})), row=P.projectPresence('alice',profile,undefined,c,now);
 assert.equal(row.username,'Town Pilot'); assert.equal(row.squad[0].level,4); assert.deepEqual(row.pilot,W.loadoutRecipes(W.emptyWardrobeState()).city); assert.equal(JSON.stringify(row).includes('PRIVATE'),false);assert.equal('holosTokens' in row,false);
 assert.notDeepEqual(row.squad[0],{holobotId:'ace',level:999,rank:'Legendary'});
});
test('projection copies canonical saved city wardrobe and squad, with no private fields',()=>{
 const state=W.emptyWardrobeState(), recipe=W.loadoutRecipes(state).city, split=W.splitRecipe(recipe);state.identity=split.identity;state.loadouts.city=split.outfit;
 const r=P.projectPresence('alice',profile,state,P.validatePresenceCommand(command()),now);
 assert.deepEqual(Object.keys(r),['username','pilot','squad','deployed','pos','yaw','updatedAtMs','expiresAtMs']);assert.deepEqual(r.pilot,recipe);assert.equal(r.squad[0].rank,'Starter');assert.deepEqual(r.pos,[1,2,-4]);assert.equal(r.yaw,90);assert.equal(r.expiresAtMs-now,90000);
});
test('unknown scene, non-finite coordinates, forged deployment, duplicate ids fail closed; bounds clamp',()=>{
 for(const x of [{scene:'NeonForest'},{pos:[NaN,0,0]},{pos:[0,0]},{yaw:Infinity},{deployed:['ace','ace']},{schemaVersion:'presence-0'}])assert.throws(()=>P.validatePresenceCommand(command(x)),/invalid_request/);
 assert.throws(()=>P.projectPresence('alice',profile,undefined,P.validatePresenceCommand(command({deployed:['kuma']})),now),/invalid_request/);
 const r=P.projectPresence('alice',profile,undefined,P.validatePresenceCommand(command({pos:[-1e9,1e9,1e9]})),now);assert.deepEqual(r.pos,[-256,256,256]);
});
test('expiry control: an expired pilot is pruned, future pilot retained, malformed aggregate refused',()=>{
 const r=P.projectPresence('abcdefghijk',{...profile,username:''},undefined,P.validatePresenceCommand(command()),now);
 assert.equal(r.username,'pilot_abcdefgh');const s=P.prunePresence({schemaVersion:'presence-1',pilots:{expired:{...r,expiresAtMs:now},live:r}},now);assert.deepEqual(Object.keys(s.pilots),['live']);assert.throws(()=>P.prunePresence({schemaVersion:'presence-0',pilots:{}},now),/unavailable/);
});
