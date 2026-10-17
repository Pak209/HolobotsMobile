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
