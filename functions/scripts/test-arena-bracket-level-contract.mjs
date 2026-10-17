import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {readArenaBracket,advanceArenaBracket}=require('../lib/story/arenaBracket');
const {duelFighterFromCombatant}=require('../lib/lib/duelResolver');
const fixture=()=>JSON.parse(readFileSync(new URL('./fixtures/arena-bracket/levels-start.json',import.meta.url)));
const schema=JSON.parse(readFileSync(new URL('../../Schemas/arena-bracket-1.json',import.meta.url)));
// Known bad first: an omitted level must never silently turn into a displayed LV 1.
test('known-bad omitted, fractional and out-of-range published levels are refused',()=>{
 for(const value of [undefined,0,100,1.5,'21',null]){
  const b=fixture().reply.bracket;
  if(value===undefined)delete b.entrants[0].fighter.level;else b.entrants[0].fighter.level=value;
  assert.throws(()=>readArenaBracket(b),e=>e.code==='unavailable');
 }
});
test('frozen fixture levels survive host validation and the next round unchanged',()=>{
 const b=readArenaBracket(fixture().reply.bracket);
 assert.equal(b.entrants.length,9);
 assert.equal(b.entrants.find(e=>e.isPlayer).fighter.level,21);
 assert.deepEqual(b.entrants.filter(e=>!e.isPlayer).map(e=>e.fighter.level),Array(8).fill(12));
 assert.deepEqual(advanceArenaBracket(b).entrants,b.entrants);
});
test('schema requires the published integer level with existing host bounds',()=>{
 const fighter=schema.properties.bracket.properties.entrants.items.properties.fighter;
 assert.ok(fighter.required.includes('level'));
 assert.equal(fighter.properties.level.type,'integer');
 assert.equal(fighter.properties.level.minimum,1);assert.equal(fighter.properties.level.maximum,99);
});
test('only combatant adapter input defaults missing level to 1; explicit host level wins',()=>{
 const c={holobotId:'ace',maxHealth:100,attack:20,defense:5};
 assert.equal(duelFighterFromCombatant(c).level,1);
 assert.equal(duelFighterFromCombatant({...c,level:21}).level,21);
});
