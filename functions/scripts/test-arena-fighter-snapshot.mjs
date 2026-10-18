import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const Ajv=require('ajv'); // functions-local devDependency (#134).
const {arenaFighterSnapshot}=require('../lib/lib/arenaFighterSnapshot');
const {arenaBracketReply}=require('../lib/story/tournamentBracketStore');
const {readArenaBracket,advanceArenaBracket}=require('../lib/story/arenaBracket');
const {desktopPracticeCommands}=require('../lib/lib/desktopPracticeCommands');
const {playerCombatant,RIVAL_BASELINE}=require('../lib/lib/rivalLadder');
const {HOLOBOT_BASE_STATS}=require('../lib/lib/progression');
const {ARENA_TIERS}=require('../lib/lib/arenaEconomy');
const load=n=>JSON.parse(readFileSync(new URL(n,import.meta.url)));
const fixture=load('./fixtures/arena-bracket/levels-start.json');
const matchSchema=load('../../Schemas/arena-match-1.json'),defs=matchSchema.definitions;
const ajv=new Ajv({strict:false});ajv.addSchema(matchSchema);
const validateMatch=ajv.getSchema(matchSchema.$id),validateFighter=ajv.compile({$ref:`${matchSchema.$id}#/definitions/fighter`});
/** Every recorded arena-match-1 reply: the admitted lifecycle (8 steps) and the snapshot issue reply. */
const replies=[...load('./fixtures/arena-match/admitted-lifecycle.json').steps.map(s=>s.reply),load('./fixtures/arena-bracket/match-fighter-snapshots-issue.json').reply];
const issued=replies.find(r=>r.payoutCapped===false); // The lifecycle's issue reply.
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
  const s=file==='arena-match-1'?schema.definitions.fighterSnapshot:schema.properties.bracket.properties.entrants.items.properties.fighter;
  assert.deepEqual(s.required,['holobotId','level','displayName','tier']);assert.equal(s.properties.level.maximum,99);
 }
 const match=matchSchema.properties.match.anyOf[1].properties;
 assert.deepEqual(defs.fighter.allOf[0],{$ref:'#/definitions/fighterSnapshot'});
 assert.deepEqual(match.opponent,{$ref:'#/definitions/fighter'});assert.deepEqual(match.entrant.allOf[0],{$ref:'#/definitions/fighter'});
 const projected=JSON.parse(readFileSync(new URL('./fixtures/arena-bracket/fighter-snapshots-start.json',import.meta.url)));
 assert.deepEqual(projected.reply,arenaBracketReply(fixture.reply.bracket,false));
 // Full Ajv validation runs in the emulator suite where rules dependencies exist.
 assert.ok(projected.reply.bracket.entrants.every(e=>typeof e.fighter.displayName==='string'));
});
test('F10: every recorded arena-match-1 reply validates; fighters carry name, rank, stats, commandRules and moves',()=>{
 assert.equal(replies.length,9);assert.equal(replies.filter(r=>r.match).length,8);
 for(const r of replies)assert.ok(validateMatch(r),JSON.stringify(validateMatch.errors));
 assert.deepEqual(defs.fighter.allOf[1].required,['name','rank','maxHealth','attack','defense','speed','intelligence','commandRules','moves']);
});
test('F10 known-bad: a reply trimmed to the old four-field fighter schema fails, and so does dropping any one client-read field',()=>{
 const trim=({holobotId,level,displayName,tier})=>({holobotId,level,displayName,tier});
 for(const r of replies.filter(r=>r.match)){
  const t=structuredClone(r);t.match.entrant=trim(t.match.entrant);t.match.opponent=trim(t.match.opponent);
  assert.equal(validateMatch(t),false,'schema-trimmed reply');
 }
 const edited=(side,edit)=>{const r=structuredClone(issued);edit(r.match[side]);return validateMatch(r);};
 assert.equal(edited('entrant',()=>{}),true);
 for(const side of ['entrant','opponent'])for(const k of defs.fighter.allOf[1].required)assert.equal(edited(side,f=>{delete f[k];}),false,`${side} without ${k}`);
 for(const k of defs.commandRules.required)assert.equal(edited('opponent',f=>{delete f.commandRules[k];}),false,`commandRules.${k}`);
 for(const k of defs.move.required)assert.equal(edited('entrant',f=>{delete f.moves[0][k];}),false,`moves[0].${k}`);
 assert.equal(edited('entrant',f=>{delete f.currentHealth;}),false,'the entrant carries its issued HP');
 assert.equal(edited('entrant',f=>{f.currentHealth=0;}),false,'a KO entrant is never issued');
 assert.equal(edited('entrant',f=>{f.intelligence=0;}),false);
 assert.equal(edited('entrant',f=>{f.commandRules.version=2;}),false);
 assert.equal(edited('opponent',f=>{f.moves=[];}),false);
 assert.equal(edited('opponent',f=>{f.moves=f.moves.filter(m=>m.moveId!=='break_heavy');}),false,'the practice battle needs break_heavy');
 assert.equal(edited('entrant',f=>{f.moves[0].chargeable='yes';}),false);
});
test('F10: the fighter schema is what the host builds — desktopPracticeCommands, RIVAL_BASELINE moves, playerCombatant for every bot',()=>{
 assert.deepEqual(defs.commandRules.required,Object.keys(desktopPracticeCommands('ace')));
 assert.deepEqual(defs.move.required,Object.keys(RIVAL_BASELINE.moves[0]));
 for(const r of replies.filter(r=>r.match))for(const side of ['entrant','opponent'])assert.deepEqual(r.match[side].commandRules,desktopPracticeCommands(r.match[side].holobotId));
 // arenaMatchStore issue + reply(): {...playerCombatant(id, record), name, currentHealth?, ...arenaFighterSnapshot({holobotId, level}, tierIndex)}.
 for(const name of Object.keys(HOLOBOT_BASE_STATS))for(const level of [1,99])for(const tier of [0,ARENA_TIERS.length-1]){
  const id=name.toLowerCase(),f={...playerCombatant(id,{name,level}),name,...arenaFighterSnapshot({holobotId:id,level},tier)};
  assert.ok(validateFighter(f),`${name} L${level} ${JSON.stringify(validateFighter.errors)}`);
 }
});
