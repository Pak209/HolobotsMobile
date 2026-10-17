import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {verifyRivalInputLog}=require('../lib/rival/rivalBattleStore');
const {RivalInputVerificationError}=require('../lib/rival/rivalInputVerification');
const {canonicalHash}=require('../lib/sim');
const {vectors}=JSON.parse(readFileSync(new URL('./fixtures/duel-sim/vectors.json',import.meta.url)));
const copy=x=>structuredClone(x);
const issue=v=>({battleId:'rb_fixture',duel:{mode:'input-log',seed:v.seed,rulesHash:canonicalHash({...v.rules,fighters:[...v.rules.fighters].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)}),rules:copy(v.rules)}});
const refuses=(fn,code)=>assert.throws(fn,e=>e instanceof RivalInputVerificationError&&e.code===code);
for(const v of vectors) test(`verify frozen issued snapshot: ${v.name}`,()=>{
 const issued=issue(v),log=copy(v.log),before=JSON.stringify({issued,log});
 const result=verifyRivalInputLog(issued,log);
 assert.equal(result.schemaVersion,'duel-sim-receipt-1');assert.equal(result.battleId,'rb_fixture');
 assert.equal(result.initialHash,v.expected.initialHash);assert.equal(result.finalHash,v.expected.finalHash);
 assert.deepEqual(result.ticks.map(t=>t.hash),v.expected.tickHashes);
 assert.equal(result.finalState.winner,v.expected.winner);assert.equal(result.finalState.reason,v.expected.reason);
 assert.equal(result.finalState.rulesHash,issued.duel.rulesHash);assert.equal(result.inputHash,canonicalHash(log));
 assert.deepEqual(verifyRivalInputLog(issued,log),result,'repeated verification is deterministic, no grants or writes');
 assert.equal(JSON.stringify({issued,log}),before,'trusted inputs stay immutable');
});
test('refuses legacy/resolver/missing/unknown modes before inspecting a log',()=>{
 for(const mode of ['legacy','resolver','future',undefined])refuses(()=>verifyRivalInputLog({duel:{mode}},null),'unsupported_mode');
 refuses(()=>verifyRivalInputLog(null,null),'unsupported_mode');
});
test('refuses corrupt pinned rules, hash, seed, version and unknown snapshot fields',()=>{
 const v=vectors[0];
 for(const mutate of [x=>x.duel.rules.maxTicks=7201,x=>x.duel.rules.tickHz=60,x=>x.duel.rulesHash='0'.repeat(64),x=>x.duel.seed='bad',x=>x.duel.rules.simVersion='future',x=>x.battleId='rb_bad\n',x=>x.rules=v.rules,x=>x.duel.didWin=true]){
  const pinned=issue(v);mutate(pinned);refuses(()=>verifyRivalInputLog(pinned,v.log),'invalid_snapshot');
 }
});
test('rejects client damage, outcome and snapshot substitution in the accepted-log shape',()=>{
 const v=vectors.find(v=>v.log.events.length),pinned=issue(v);
 for(const key of ['didWin','damage','seed','rules','rulesHash']){
  const log=copy(v.log);log[key]=key==='rules'?v.rules:1;refuses(()=>verifyRivalInputLog(pinned,log),'invalid_log');
 }
 for(const key of ['damage','didWin','hp']){const log=copy(v.log);log.events[0][key]=1;refuses(()=>verifyRivalInputLog(pinned,log),'invalid_log');}
});
test('rejects sequence, tick, per-tick and total-log overflows before replay',()=>{
 const v=vectors.find(v=>v.log.events.length),pinned=issue(v),e={seq:0,tick:0,actor:v.log.events[0].actor,action:'guard_up'};
 for(const events of [[{...e,seq:1}],[{...e,tick:-0}],[{...e,tick:v.rules.maxTicks}],[{...e,tick:2},{...e,seq:1,tick:1}],Array.from({length:5},(_,seq)=>({...e,seq})),Array.from({length:8193},(_,seq)=>({...e,seq}))]){
  refuses(()=>verifyRivalInputLog(pinned,{schemaVersion:'duel-inputs-1',events}),'invalid_log');
 }
});
test('rejects actor/target spoofing and CPU input without changing the issued snapshot',()=>{
 const v=vectors.find(v=>v.rules.fighters.some(f=>f.cpu)),pinned=issue(v),cpu=v.rules.fighters.find(f=>f.cpu),human=v.rules.fighters.find(f=>!f.cpu);
 for(const event of [{seq:0,tick:0,actor:'unknown',action:'guard_up'},{seq:0,tick:0,actor:cpu.id,action:'guard_up'},{seq:0,tick:0,actor:human.id,action:'strike',target:human.id}])
  refuses(()=>verifyRivalInputLog(pinned,{schemaVersion:'duel-inputs-1',events:[event]}),'invalid_log');
});
test('mutual KO and timeout draws stay draws, not fabricated player losses',()=>{
 const draws=vectors.filter(v=>v.expected.winner===null);assert.ok(draws.length);
 for(const v of draws)assert.equal(verifyRivalInputLog(issue(v),v.log).finalState.winner,null);
});
test('no callable mode dispatch or issuance branch is added',()=>{
 // Regression tripwire: verification remains an internal export, not an invocation.
 const store=readFileSync(new URL('../src/rival/rivalBattleStore.ts',import.meta.url),'utf8');
 assert.equal((store.match(/verifyRivalInputLog/g)||[]).length,1);
 assert.doesNotMatch(store,/mode\s*:\s*['"]input-log['"]/);
 assert.doesNotMatch(store,/request\.(inputLog|acceptedLog)/);
 assert.match(store,/HOLOCITY_RIVAL_ISSUE_RESOLVER !== '1'/);
});
