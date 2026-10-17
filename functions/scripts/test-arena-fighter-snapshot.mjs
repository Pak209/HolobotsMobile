import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {arenaFighterSnapshot}=require('../lib/lib/arenaFighterSnapshot');
const {arenaBracketReply}=require('../lib/story/tournamentBracketStore');
const {readArenaBracket,advanceArenaBracket}=require('../lib/story/arenaBracket');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/arena-bracket/levels-start.json',import.meta.url)));
test('known-bad original #113 reply has no presentation snapshots',()=>{
 assert.equal(fixture.reply.bracket.entrants.filter(e=>e.fighter.displayName).length,0);
});
test('all nine entrants project frozen identity/level/tier without mutating persisted bracket',()=>{
 const saved=structuredClone(fixture.reply.bracket),before=JSON.stringify(saved);
 for(const reply of [arenaBracketReply(saved,false),arenaBracketReply(saved,false,true),arenaBracketReply(saved,true),arenaBracketReply(advanceArenaBracket(saved),false)]){
  assert.equal(reply.bracket.entrants.length,9);
  for(const e of reply.bracket.entrants){assert.equal(e.fighter.displayName,e.fighter.holobotId.toUpperCase());assert.deepEqual(Object.keys(e).sort(),['entrantId','fighter','holobotId','isPlayer','pilotName']); const original=saved.entrants.find(x=>x.entrantId===e.entrantId);const {displayName,...combat}=e.fighter;assert.deepEqual(combat,original.fighter);}
 }
 assert.equal(JSON.stringify(saved),before);assert.deepEqual(readArenaBracket(saved),saved);
});
test('snapshot refuses missing, invalid and fractional issued levels without defaults',()=>{
 for(const level of [undefined,null,'21',0,100,1.5])assert.throws(()=>arenaFighterSnapshot({holobotId:'ace',level},0),RangeError);
 assert.throws(()=>arenaFighterSnapshot({level:21},0),RangeError);
 assert.deepEqual(arenaFighterSnapshot({holobotId:'jusan',level:21},3),{holobotId:'jusan',level:21,displayName:'JUSAN',tier:3});
});
test('schemas require all four fields and fixture carries every citizen snapshot',()=>{
 for(const file of ['arena-match-1','arena-bracket-1']){
  const schema=JSON.parse(readFileSync(new URL(`../../Schemas/${file}.json`,import.meta.url)));
  const s=file==='arena-match-1'?schema.properties.match.anyOf[1].properties.opponent:schema.properties.bracket.properties.entrants.items.properties.fighter;
  assert.deepEqual(s.required,['holobotId','level','displayName','tier']);assert.equal(s.properties.level.maximum,99);
 }
 const projected=JSON.parse(readFileSync(new URL('./fixtures/arena-bracket/fighter-snapshots-start.json',import.meta.url)));
 assert.deepEqual(projected.reply,arenaBracketReply(fixture.reply.bracket,false));
 // Full Ajv validation runs in the emulator suite where rules dependencies exist.
 assert.ok(projected.reply.bracket.entrants.every(e=>typeof e.fighter.displayName==='string'));
});
