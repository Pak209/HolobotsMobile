import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {validate}=require('../lib/sim/validate');
const {vectors}=JSON.parse(readFileSync(new URL('./fixtures/duel-sim/vectors.json',import.meta.url)));
const fixture=()=>structuredClone(vectors.find(v=>v.log.events.length>0));
const check=v=>validate(v.rules,v.log,v.seed);
test('all 24 assembled logs satisfy host semantic validation',()=>{assert.equal(vectors.length,24);for(const v of vectors)check(v);});
test('sequence gaps, unordered ticks, fifth command and snapshot tick cap are refused',()=>{
 let v=fixture();v.log.events[0].seq=1;assert.throws(()=>check(v),/invalid_seq/);
 v=fixture();const e={seq:0,tick:1,actor:v.log.events[0].actor,action:'guard_up'};
 v.log.events=[e,{...e,seq:1,tick:0}];assert.throws(()=>check(v),/unordered_ticks/);
 v.log.events=Array.from({length:5},(_,seq)=>({...e,seq}));assert.throws(()=>check(v),/too_many_commands/);
 v.log.events=[{...e,tick:v.rules.maxTicks}];assert.throws(()=>check(v),/invalid_tick/);
});
test('snapshot actor and target ownership are refused independently of JSON shape',()=>{
 let v=fixture();v.log.events=[{seq:0,tick:0,actor:'unknown',action:'guard_up'}];assert.throws(()=>check(v),/invalid_actor/);
 v=fixture();const actor=v.rules.fighters.find(f=>!f.cpu);const opponent=v.rules.fighters.find(f=>f.side!==actor.side);
 for(const [action,target] of [['strike',actor.id],['deploy',opponent.id],['select_target','unknown']]){
  v.log.events=[{seq:0,tick:0,actor:actor.id,action,target}];assert.throws(()=>check(v),/invalid_target/);
 }
 v=structuredClone(vectors.find(v=>v.rules.fighters.some(f=>f.cpu)));const cpu=v.rules.fighters.find(f=>f.cpu);assert.ok(cpu);v.log.events=[{seq:0,tick:0,actor:cpu.id,action:'guard_up'}];assert.throws(()=>check(v),/invalid_actor/);
});
test('negative zero and injected client outcomes are refused by canonical runtime validation',()=>{
 let v=fixture();v.log.events[0].tick=-0;assert.throws(()=>check(v),/invalid_tick/);
 for(const key of ['damage','didWin']){v=fixture();v.log.events[0][key]=1;assert.throws(()=>check(v),/invalid_fields/);}
});
