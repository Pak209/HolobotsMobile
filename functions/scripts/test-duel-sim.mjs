import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const S=require('../lib/sim');
const {vectors}=JSON.parse(readFileSync(new URL('./fixtures/duel-sim/vectors.json',import.meta.url)));
const copy=x=>structuredClone(x), vector=name=>copy(vectors.find(v=>v.name===name));
const run=v=>S.simulate(v.rules,v.seed,v.log);
for(const v of vectors)test(`frozen vector: ${v.name}`,()=>{
 const before=JSON.stringify(v),a=run(v),b=run(v);
 assert.deepEqual(a,b);assert.equal(JSON.stringify(v),before);
 assert.equal(a.initialHash,v.expected.initialHash);assert.equal(a.finalHash,v.expected.finalHash);
 assert.deepEqual(a.ticks.map(t=>t.hash),v.expected.tickHashes);
 assert.equal(a.finalState.winner,v.expected.winner);assert.equal(a.finalState.reason,v.expected.reason);
});
test('hand-encoded canonical primitive/object bytes and independent Python SHA256 RNG vectors',()=>{
 assert.equal(S.canonicalBytes({b:-2,a:1}).toString('hex'),'060200000004010000006103010000000000000004010000006203feffffffffffffff');
 assert.equal(S.canonicalBytes([null,false,true]).toString('hex'),'0503000000000102');
 assert.equal(S.rngWord('00'.repeat(32),1,0,0,0),1684579882);
 assert.equal(S.rngWord(Array.from({length:32},(_,i)=>i.toString(16).padStart(2,'0')).join(''),2,31,7,4),2015496340);
 assert.notEqual(S.rngWord('00'.repeat(32),1,0,0,0),S.rngWord('00'.repeat(32),2,0,0,0));
 let draws=0;assert.equal(S.boundedWord(3,i=>{draws++;return i===0?0xffffffff:5;}),2);assert.equal(draws,2);
 assert.throws(()=>S.boundedWord(3,()=>0xffffffff),/rng_exhausted/);
});
test('arithmetic truncates toward zero and rejects overflow/nonintegers',()=>{
 assert.equal(S.mulDiv(-7,3,2),-10);assert.equal(S.mulDiv(7,3,-2),-10);
 assert.throws(()=>S.mulDiv(Number.MAX_SAFE_INTEGER,1000000,1),/overflow/);
 assert.throws(()=>S.mulDiv(1.5,1,1));assert.throws(()=>S.mulDiv(1,1,0));
});
test('hand-calculated strike, guard, trade, cancel, resource and held-input outcomes',()=>{
 const final=name=>run(vector(name)).finalState, a=name=>final(name).fighters.find(f=>f.id==='a'),b=name=>final(name).fighters.find(f=>f.id==='b');
 assert.equal(b('strike').hp,900);assert.equal(b('heavy').hp,800);assert.equal(b('finisher').hp,600);
 assert.equal(b('guard').hp,975);assert.equal(b('guard-expired').hp,900);assert.equal(b('guard-release').hp,900);
 assert.equal(b('insufficient-sync').hp,1000);assert.equal(b('insufficient-sta').hp,1000);
 assert.equal(a('strike').stamina,80);assert.equal(a('finisher').sync,10);
 assert.equal(b('cancel').hp,1000);assert.equal(b('cancel-denied').hp,800);
 assert.equal(a('interrupt').hp,1000);assert.equal(b('interrupt').hp,900);
 assert.equal(final('mutual-ko').winner,null);assert.equal(final('mutual-ko').reason,'ko');
 assert.equal(a('held-expiry').x,-2500);assert.equal(a('diagonal').x,-1750);assert.equal(a('diagonal').z,750);
 assert.equal(a('regen').stamina,100);assert.equal(final('deploy').fighters.find(f=>f.id==='c').deployed,true);
});
test('actor array/object insertion order does not affect replay or pinned rule hash',()=>{
 const v=vector('variance'),baseline=run(v);v.rules.fighters.reverse();v.rules=Object.fromEntries(Object.entries(v.rules).reverse());assert.deepEqual(run(v),baseline);
});
test('every command action is exercised; illegal commands are explicit denials',()=>{
 const actions=new Set(vectors.flatMap(v=>v.log.events.map(e=>e.action)));
 for(const a of ['move','strike','heavy','finisher','guard_down','guard_up','disengage','deploy','select_target'])assert.ok(actions.has(a),a);
 for(const [name,reason]of[['insufficient-sta','insufficient_stamina'],['insufficient-sync','insufficient_sync'],['cancel-denied','cancel_window']])assert.ok(run(vector(name)).ticks.flatMap(t=>t.events).some(e=>e.reason===reason));
});
test('malformed logs, identity, hidden fields and unsafe integers fail before replay',()=>{
 const mutations=[v=>v.log.didWin=true,v=>v.log.events[0].damage=999,v=>v.log.events[0].seq=1,v=>v.log.events[0].tick=-1,v=>v.log.events[0].tick=1.5,v=>v.log.events[0].tick=24,v=>v.log.events[0].actor='unknown',v=>v.log.events[0].target='a',v=>v.log.events[0].action='teleport',v=>v.log.events[0].x=0,v=>v.rules.fighters[0].hp=Number.MAX_SAFE_INTEGER,v=>v.rules.fighters[0].x=Infinity,v=>v.rules.fighters[0].stamina=-0,v=>v.rules.fighters[0].moves.strike.damage=NaN,v=>v.rules.fighters[0].cpu=true,v=>v.rules.fighters[0].id='b',v=>v.rules.tickHz=60,v=>v.rules.maxTicks=7201,v=>v.seed='z'.repeat(64),v=>v.log.events=Array(2),v=>v.rules.fighters=Array(2)];
 for(const mutate of mutations){const v=vector('strike');mutate(v);assert.throws(()=>run(v),mutate.toString());}
 const v=vector('strike');v.log.events=Array.from({length:5},(_,seq)=>({...v.log.events[0],seq}));assert.throws(()=>run(v),/too_many_commands/);
});
test('canonical encoding rejects holes, undefined, Unicode, floats, unsafe widths and oversize input',()=>{
 for(const v of [Array(1),[undefined],{x:undefined},'é',NaN,Infinity,-0,0.5,Number.MAX_SAFE_INTEGER+1,Array(8193).fill(0),new Date()])assert.throws(()=>S.canonicalBytes(v));
 assert.throws(()=>S.canonicalBytes(Array(8192).fill('x'.repeat(256))),/encoding_size/);
});
test('swept collisions stop tunnelling; boundary motion clamps and guard refresh has no infinite perfect window',()=>{
 const v=vector('collision');v.rules.fighters.forEach(f=>f.speedMmPerTick=100000);const got=run(v);assert.equal(got.finalState.fighters[0].x,-1000);assert.equal(got.finalState.fighters[1].x,1000);
 const w=vector('held-expiry');w.rules.fighters[0].speedMmPerTick=100000;assert.equal(run(w).finalState.fighters[0].x,-9800);
 const g=vector('guard-expired');g.log.events.splice(1,0,{seq:1,tick:5,actor:'b',action:'guard_down'});g.log.events[2].seq=2;assert.equal(run(g).finalState.fighters[1].hp,900);
});
test('seed/rule changes affect pinned state; snapshot resources remain bounded',()=>{
 const v=vector('variance'),baseline=run(v);v.seed='ff'.repeat(32);assert.notEqual(run(v).finalHash,baseline.finalHash);
 v.rules.fighters[0].moves.strike.damage++;assert.notEqual(run(v).finalState.rulesHash,baseline.finalState.rulesHash);
 for(const original of vectors){const out=run(original);for(const f of out.finalState.fighters){const rule=original.rules.fighters.find(r=>r.id===f.id);assert.ok(f.hp>=0&&f.hp<=rule.maxHp);assert.ok(f.stamina>=0&&f.stamina<=rule.maxStamina);assert.ok(f.sync>=0&&f.sync<=rule.maxSync);}}
});
