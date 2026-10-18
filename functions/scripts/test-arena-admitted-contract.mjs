import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const Ajv=createRequire(new URL('../../rules-tests/package.json',import.meta.url))('ajv');
const ajv=new Ajv({strict:false});
const load=n=>JSON.parse(readFileSync(new URL(n,import.meta.url)));
const request=ajv.compile(load('../../Schemas/arena-match-request-1.json'));
const reply=ajv.compile(load('../../Schemas/arena-match-1.json'));
const fixture=load('./fixtures/arena-match/admitted-lifecycle.json');
test('frozen callable fixture validates every request/reply and one match identity',()=>{
 for(const step of fixture.steps){assert.ok(request(step.request),JSON.stringify(request.errors));assert.ok(reply(step.reply),JSON.stringify(reply.errors));}
 assert.equal(new Set(fixture.steps.map(s=>s.reply.matchId).filter(Boolean)).size,1);
});
test('schema rejects missing lifecycle identity and out-of-contract client outcome flags',()=>{
 const admitted=structuredClone(fixture.steps.find(s=>s.request.operation==='issue'));
 delete admitted.reply.match.entryReceipt;assert.equal(reply(admitted.reply),false);
 assert.equal(request({schemaVersion:'arena-match-1',operation:'settle',matchId:'am_'+'0'.repeat(32),didWin:true}),false);
 assert.equal(request({schemaVersion:'arena-match-1',operation:'resume'}),true);
});
test('too_fast refusal (hardening-2): a callable error with details.retryAfterMs, then the identical settle succeeds once',()=>{
 assert.equal(fixture.refusals.length,1);
 const [{request:sent,refusal}]=fixture.refusals;
 assert.ok(request(sent),JSON.stringify(request.errors));assert.equal(sent.operation,'settle');
 assert.deepEqual(Object.keys(refusal).sort(),['code','details','message']);
 assert.equal(refusal.code,'failed-precondition');assert.equal(refusal.message,'too_fast');
 assert.deepEqual(Object.keys(refusal.details).sort(),['rejectionCode','retryAfterMs']);
 assert.equal(refusal.details.rejectionCode,'too_fast');
 assert.ok(Number.isSafeInteger(refusal.details.retryAfterMs)&&refusal.details.retryAfterMs>0&&refusal.details.retryAfterMs<=3000,'within the 3 s CPU floor');
 const settles=fixture.steps.filter(s=>s.request.operation==='settle');
 assert.deepEqual(settles[0].request,sent,'the resend is byte-identical');
 assert.equal(settles[0].reply.match.state,'settled');assert.equal(settles[0].reply.alreadyProcessed,false);
 const start=fixture.steps.find(s=>s.request.operation==='start').reply.match.startedAtMs;
 assert.ok(settles[0].reply.match.closedAtMs-start>=3000,'the accepted win is at or past the floor');
});
test('payoutCapped (hardening-2): issue replies carry a boolean, no other operation does; the schema rejects a non-boolean',()=>{
 for(const step of fixture.steps){
  if(step.request.operation==='issue')assert.equal(step.reply.payoutCapped,false,'fixture account is under the cap');
  else assert.equal(Object.hasOwn(step.reply,'payoutCapped'),false,step.request.operation);
 }
 const issued=structuredClone(fixture.steps.find(s=>s.request.operation==='issue').reply);
 issued.payoutCapped=true;assert.equal(reply(issued),true);
 issued.payoutCapped='yes';assert.equal(reply(issued),false);
});
