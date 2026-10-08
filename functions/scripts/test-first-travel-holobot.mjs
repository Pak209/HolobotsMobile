import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {projectFirstTravelHolobot} = require('../lib/acquisition/captureOwnership.js');
const owned = [{name:'SHADOW'},{name:'KUMA'},{name:'ACE'}];
test('missing squad gets only the first owned bot; records are untouched and repeated refresh is idempotent',()=>{
 const p={holobots:owned}; const before=structuredClone(p); const r=projectFirstTravelHolobot(p);
 assert.deepEqual(r.travelSquad,{schemaVersion:'travel-squad-1',revision:1,holobotIds:['shadow']});
 assert.deepEqual(p,before); assert.deepEqual(projectFirstTravelHolobot({...p,...r.updates}).updates,{});
});
test('existing companion team retains exact order and revision',()=>{
 const travelSquad={schemaVersion:'travel-squad-1',revision:7,holobotIds:['ace','shadow','kuma']};
 assert.deepEqual(projectFirstTravelHolobot({holobots:owned,travelSquad}),{travelSquad,updates:{}});
});
test('partial team is preserved; explicit empty squad fills once with advanced revision',()=>{
 const squad=(ids)=>({schemaVersion:'travel-squad-1',revision:4,holobotIds:ids});
 assert.deepEqual(projectFirstTravelHolobot({holobots:owned,travelSquad:squad(['kuma'])}).updates,{});
 assert.deepEqual(projectFirstTravelHolobot({holobots:owned,travelSquad:squad([])}).travelSquad,{schemaVersion:'travel-squad-1',revision:5,holobotIds:['shadow']});
});
test('no owned bots stays empty; malformed/unowned squads fail closed',()=>{
 assert.deepEqual(projectFirstTravelHolobot({holobots:[]}).updates,{});
 for(const p of [{holobots:[null]},{holobots:owned,travelSquad:null},{holobots:owned,travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['wolf']}}])assert.throws(()=>projectFirstTravelHolobot(p));
});
