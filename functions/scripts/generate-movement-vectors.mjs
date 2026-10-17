// Deliberate authoring command; tests never rewrite frozen expectations.
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {simulate} = createRequire(import.meta.url)('../lib/sim');
const original = JSON.parse(readFileSync(new URL('./fixtures/duel-sim/vectors.json', import.meta.url))).vectors[0];
function bout(name, modify) {
    const v = structuredClone(original); v.name = name;
    v.rules.simVersion = 'duel-sim-2'; v.rules.arenaHalfSizeMm = 12000; v.rules.maxTicks = 90;
    v.rules.movement = {a:{speedMmPerSecond:3200,preferredRangeMm:1500}, b:{speedMmPerSecond:1600,preferredRangeMm:1500}};
    v.rules.fighters.forEach((f,i) => {
        f.speedMmPerTick = 0; f.x = i ? 3500 : -3500;
        f.regenPerTick = f.disengageRegenPerTick = 0;
        for (const m of Object.values(f.moves)) {m.rangeMm = 1500; m.staminaCost = 1; m.syncCost = 0;}
    });
    v.log.events = [];
    modify(v);
    v.log.events.forEach((e,i) => e.seq = i);
    const result = simulate(v.rules,v.seed,v.log);
    v.expected = {initialHash:result.initialHash,finalHash:result.finalHash,tickHashes:result.ticks.map(t=>t.hash),winner:result.finalState.winner,reason:result.finalState.reason};
    return v;
}
const command = (actor,action,target,tick=0) => ({seq:0,tick,actor,action,...(target?{target}:{})});
const vectors = [
    bout('fast-vs-slow-chase',v=>{v.rules.fighters.forEach(f=>f.stamina=0);v.rules.fighters[0].moves.strike.staminaCost=0;v.log.events=[command('a','strike','b'),command('b','disengage')];}),
    bout('slow-vs-fast-escape',v=>{v.rules.movement.a.speedMmPerSecond=1600;v.rules.movement.b.speedMmPerSecond=3200;v.rules.fighters.forEach(f=>f.stamina=0);v.rules.fighters[0].moves.strike.staminaCost=0;v.log.events=[command('a','strike','b'),command('b','disengage')];}),
    bout('long-range-opener',v=>{v.rules.maxTicks=12;v.rules.fighters[0].moves.strike.rangeMm=8000;v.log.events=[command('a','strike','b')];}),
    bout('dash-out-of-sta',v=>{v.rules.fighters[0].stamina=1;v.log.events=[command('a','strike','b')];}),
    bout('zero-sta-runs-free',v=>{v.rules.fighters.forEach(f=>f.stamina=0);v.log.events=[command('a','select_target','b')];}),
    bout('ring-bound-diagonal',v=>{v.rules.fighters[0].x=8000;v.rules.fighters[0].z=8000;v.log.events=[{seq:0,tick:0,actor:'a',action:'move',x:127,z:127}];}),
    bout('keep-range-mid',v=>{v.rules.fighters[0].x=-1000;v.rules.fighters[1].x=1000;v.rules.movement.a.preferredRangeMm=4000;v.log.events=[command('a','select_target','b')];}),
    bout('back-off-long',v=>{v.rules.fighters[0].moves.finisher.rangeMm=8000;v.log.events=[command('b','disengage')];}),
];
writeFileSync(new URL('./fixtures/duel-sim/movement-vectors.json',import.meta.url),JSON.stringify({vectorVersion:'duel-sim-movement-vectors-2',vectors},null,2)+'\n');
