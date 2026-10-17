import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), S=require('../lib/sim');
const {moveFighter}=require('../lib/sim/movement');
const {verifyRivalInputLog}=require('../lib/rival/rivalInputVerification');
const {vectors}=JSON.parse(readFileSync(new URL('./fixtures/duel-sim/movement-vectors.json',import.meta.url)));
const run=v=>S.simulate(v.rules,v.seed,v.log), copy=name=>structuredClone(vectors.find(v=>v.name===name));
for(const v of vectors)test(`movement frozen vector: ${v.name}`,()=>{
 const before=JSON.stringify(v),out=run(v);assert.deepEqual(out,run(v));assert.equal(JSON.stringify(v),before);
 assert.equal(out.initialHash,v.expected.initialHash);assert.equal(out.finalHash,v.expected.finalHash);
 assert.deepEqual(out.ticks.map(t=>t.hash),v.expected.tickHashes);
 for(const f of out.finalState.fighters)assert.ok(BigInt(f.x)**2n+BigInt(f.z)**2n<=BigInt(12000-v.rules.fighters.find(d=>d.id===f.id).radiusMm)**2n);
});
test('producer placeholders, tiers and speed-scaled cooldowns are pinned',()=>{
 assert.deepEqual(S.MOVEMENT_SPEEDS,{ace:3200,wolf:3000,hare:3200,shadow:3000,ken:2600,tsuin:2600,wake:2400,jusan:2400,kurai:2400,era:2200,gama:2000,kuma:1600,tora:1600});
 assert.deepEqual(S.RANGE_TIERS_MM,{Close:1500,Mid:4000,Long:8000});
 assert.equal(S.dashCooldownTicks(3000),120);assert.equal(S.dashCooldownTicks(1600),225);assert.equal(S.dashCooldownTicks(3200),113);
});
test('dash travels exactly 4000 mm in 9 ticks for 1 STA, then cooldown prevents another',()=>{
 const v=copy('fast-vs-slow-chase'),f=run({...v,rules:{...v.rules,maxTicks:1}}).finalState.fighters[0];
 Object.assign(f,{x:0,z:0,stamina:2,movement:{queued:null,dashReadyTick:0,dashTicks:0,dashX:0,dashZ:0,runRemainder:0}});
 let dashes=0;const rule={speedMmPerSecond:3000,preferredRangeMm:1500};
 for(let tick=0;tick<9;tick++)moveFighter(f,rule,tick,{x:10000,z:0},1500,200,()=>dashes++);
 assert.equal(f.x,4000);assert.equal(f.stamina,1);assert.equal(f.movement.dashReadyTick,120);assert.equal(dashes,1);
 moveFighter(f,rule,9,{x:10000,z:0},1500,200,()=>dashes++);assert.equal(f.x,4100);assert.equal(dashes,1);
 moveFighter(f,rule,120,{x:10000,z:0},1500,200,()=>dashes++);assert.equal(dashes,2);assert.equal(f.stamina,0);
});
test('zero STA still runs exactly the per-second speed on an axis',()=>{
 const f=run(copy('zero-sta-runs-free')).finalState.fighters[0];
 Object.assign(f,{x:0,z:0,stamina:0,movement:{queued:null,dashReadyTick:0,dashTicks:0,dashX:0,dashZ:0,runRemainder:0}});
 for(let tick=0;tick<30;tick++)moveFighter(f,{speedMmPerSecond:3200,preferredRangeMm:1500},tick,{x:11000,z:0},1500,200,()=>assert.fail('no free dash'));
 assert.equal(f.x,3200);assert.equal(f.stamina,0);
});
test('long opener strikes immediately; queued close cannot spend STA below zero',()=>{
 const long=run(copy('long-range-opener'));assert.ok(long.ticks[0].events.some(e=>e.actor==='a'&&e.reason==='accepted'&&e.action==='strike'));
 assert.ok(long.ticks.flatMap(t=>t.events).some(e=>e.actor==='a'&&e.reason==='contact'));
 const out=run(copy('dash-out-of-sta'));assert.equal(out.finalState.fighters[0].stamina,0);
 assert.ok(out.ticks.flatMap(t=>t.events).some(e=>e.reason==='insufficient_stamina'));
 assert.ok(!out.ticks.flatMap(t=>t.events).some(e=>e.actor==='a'&&e.damage>0));
});
test('fast chaser closes sooner; faster escape can make a queued strike whiff',()=>{
 const events=name=>run(copy(name)).ticks.flatMap(t=>t.events);
 const start=name=>events(name).find(e=>e.actor==='a'&&e.action==='strike'&&e.reason==='accepted')?.tick ?? 90;
 assert.ok(start('fast-vs-slow-chase') < start('slow-vs-fast-escape')); 
 assert.ok(!events('slow-vs-fast-escape').some(e=>e.actor==='a'&&e.reason==='contact'));
});
test('strict v2 shape rejects illegal speeds, tiers, corner spawns and ambiguous old speed',()=>{
 for(const mutate of [v=>v.rules.movement.a.speedMmPerSecond=1599,v=>v.rules.movement.a.extra=1,v=>v.rules.movement.a.preferredRangeMm=2000,v=>v.rules.fighters[0].moves.strike.rangeMm=1499,v=>v.rules.fighters[0].speedMmPerTick=10,v=>{v.rules.fighters[0].x=11000;v.rules.fighters[0].z=11000;},v=>v.rules.arenaHalfSizeMm=15500]){const v=copy('fast-vs-slow-chase');mutate(v);assert.throws(()=>run(v));}
});
test('dormant host verification refuses movement v2 even with a valid rules hash',()=>{
 const v=copy('long-range-opener');assert.throws(()=>verifyRivalInputLog({battleId:'rb_movement',duel:{mode:'input-log',seed:v.seed,rulesHash:S.canonicalHash(v.rules),rules:v.rules}},v.log),e=>e.code==='invalid_snapshot');
});
test('queued attacks spend their cost only on execution, and an interrupt cancels an active dash',()=>{
 const v=copy('fast-vs-slow-chase');v.rules.maxTicks=1;v.rules.fighters[0].stamina=10;v.rules.fighters[0].moves.strike.staminaCost=5;
 const queued=run(v);assert.equal(queued.finalState.fighters[0].stamina,9);assert.equal(queued.finalState.fighters[0].movement.queued.move,'strike');
 const h=copy('long-range-opener');h.rules.maxTicks=3;h.rules.fighters[0].moves.strike.interruptTicks=5;
 const out=run(h),b=out.finalState.fighters[1];assert.ok(b.stunnedUntil>out.finalState.tick);assert.equal(b.movement.dashTicks,0);assert.equal(b.movement.dashX,0);assert.equal(b.movement.dashZ,0);
});
