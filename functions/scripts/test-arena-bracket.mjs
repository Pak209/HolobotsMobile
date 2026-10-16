import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createArenaBracket,advanceArenaBracket,readArenaBracket}=require('../lib/story/arenaBracket.js');
const {resolveDuel,duelFighterFromCombatant}=require('../lib/lib/duelResolver.js');
const matchId='am_'+'a'.repeat(32);
const fighter=(holobotId,overrides={})=>duelFighterFromCombatant({holobotId,level:1,tier:0,maxHealth:100,currentHealth:100,attack:20,defense:5,speed:10,...overrides});
const entrants=()=>Array.from({length:8},(_,i)=>({entrantId:i===0?'player':`citizen_${i}`,pilotName:`Pilot ${i}`,holobotId:i===0?'ace':'wolf',isPlayer:i===0,fighter:fighter(i===0?'ace':'wolf',i===0?{maxHealth:10000,currentHealth:10000,attack:1000,defense:1000,speed:100}:{} )}));
const initial=()=>createArenaBracket(matchId,'starter',123456789,entrants());
const code=c=>e=>e.code===c;

test('one advance must resolve four real receipts, never merely mark player winner',()=>{
 const next=advanceArenaBracket(initial());
 assert.equal(next.round,1);assert.equal(next.matches.length,4);assert.equal(next.remaining.length,4);
 for(const m of next.matches) {
  const left=next.entrants.find(e=>e.entrantId===m.leftId),right=next.entrants.find(e=>e.entrantId===m.rightId);
  assert.deepEqual(m.receipt,resolveDuel({seed:m.receipt.seed,player:[left.fighter],opponent:[right.fighter]}));
  assert.equal(m.winnerId,m.receipt.winner==='player'?m.leftId:m.rightId);
 }
});
test('complete eight-slot single elimination has 4/2/1 matches, one survivor and seven reproducible receipts',()=>{
 let a=initial();const original=structuredClone(a);
 for(const n of [4,6,7]) {const previous=structuredClone(a);a=advanceArenaBracket(a);assert.equal(a.matches.length,n);assert.deepEqual(readArenaBracket(a),a);assert.deepEqual(previous,readArenaBracket(previous));}
 assert.equal(a.round,3);assert.equal(a.done,true);assert.equal(a.playerAlive,true);assert.deepEqual(a.remaining,['player']);
 assert.deepEqual(original,initial());assert.throws(()=>advanceArenaBracket(a),code('bracket_done'));
 let replay=initial();for(let i=0;i<3;i++)replay=advanceArenaBracket(replay);assert.deepEqual(a,replay);
 assert.ok(Buffer.byteLength(JSON.stringify(a))<900000);
});
test('survivors carry only resolved HP into their next duel, with no between-round heal',()=>{
 const first=advanceArenaBracket(initial()),second=advanceArenaBracket(first);
 for(const m of second.matches.filter(m=>m.round===2)) {
  const left=first.entrants.find(e=>e.entrantId===m.leftId),right=first.entrants.find(e=>e.entrantId===m.rightId);
  assert.deepEqual(m.receipt,resolveDuel({seed:m.receipt.seed,player:[{...left.fighter,currentHealth:first.health[m.leftId]}],opponent:[{...right.fighter,currentHealth:first.health[m.rightId]}]}));
 }
});
test('a player knockout refuses further advance; no fabricated winner progression',()=>{
 const rows=entrants();rows[0].fighter=fighter('ace',{currentHealth:1,attack:0,defense:0,speed:0});rows[1].fighter=fighter('wolf',{attack:1000,speed:1000});
 const next=advanceArenaBracket(createArenaBracket(matchId,'starter',123,rows));
 assert.equal(next.playerAlive,false);assert.equal(next.done,false);assert.throws(()=>advanceArenaBracket(next),code('player_eliminated'));
});
test('persisted flags, winners, HP, round numbers and combat receipts cannot be changed independently',()=>{
 const good=advanceArenaBracket(initial());
 for(const mutate of [s=>s.playerAlive=false,s=>s.done=true,s=>s.remaining.reverse(),s=>s.health.player++,s=>s.matches[0].winnerId='invented',s=>s.matches[0].receipt.seed++,s=>s.round=3,s=>s.extra=true]) {
  const bad=structuredClone(good);mutate(bad);assert.throws(()=>readArenaBracket(bad),code('unavailable'));
 }
});
test('stored private seed reproduces every draw while different seeds change receipts',()=>{
 const a=createArenaBracket(matchId,'starter',123,entrants()),b=createArenaBracket(matchId,'starter',124,entrants());
 assert.deepEqual(advanceArenaBracket(a),advanceArenaBracket(structuredClone(a)));
 assert.notDeepEqual(advanceArenaBracket(a).matches,advanceArenaBracket(b).matches);
});
test('invalid eight-slot identities and stats fail closed',()=>{
 for(const mutate of [r=>r.pop(),r=>r.push(r[1]),r=>r[1].entrantId='player',r=>r[1].isPlayer=true,r=>r[0].fighter.currentHealth=0,r=>r[0].fighter.attack=NaN]) {
  const rows=entrants();mutate(rows);assert.throws(()=>createArenaBracket(matchId,'starter',1,rows));
 }
});

test('all nine entrants survive seeding: CPU play-in plus seven byes produces the eight-slot main draw',()=>{
 const rows=entrants();rows.push({...rows[7],entrantId:'citizen_8',pilotName:'Pilot 8'});
 const first=advanceArenaBracket(createArenaBracket(matchId,'starter',123,rows));
 assert.equal(first.matches.length,1);assert.equal(first.matches[0].leftId,'citizen_7');assert.equal(first.matches[0].rightId,'citizen_8');
 assert.equal(first.remaining.length,8);assert.deepEqual(first.remaining.slice(0,7),rows.slice(0,7).map(r=>r.entrantId));
 let state=first;for(let i=0;i<3;i++)state=advanceArenaBracket(state);
 assert.equal(state.round,4);assert.equal(state.matches.length,8);assert.equal(state.done,true);assert.deepEqual(readArenaBracket(state),state);
});
test('player can be seeded into the play-in and either advances or is eliminated',()=>{
 for(const strong of [true,false]) {
  const rows=entrants();rows.push({...rows[7],entrantId:'citizen_8',pilotName:'Pilot 8'});
  [rows[0],rows[8]]=[rows[8],rows[0]];
  if(!strong){rows[8].fighter=fighter('ace',{currentHealth:1,attack:0,defense:0,speed:0});rows[7].fighter=fighter('wolf',{attack:1000,speed:1000});}
  const next=advanceArenaBracket(createArenaBracket(matchId,'starter',123,rows));
  assert.equal(next.matches.length,1);assert.equal(next.matches[0].rightId,'player');assert.equal(next.playerAlive,strong);
  if(!strong)assert.throws(()=>advanceArenaBracket(next),code('player_eliminated'));
 }
});

test('worst-case nine-entrant bracket with eight120-turn bouts stays below Firestore1MiB',()=>{
 const rows=Array.from({length:9},(_,i)=>({entrantId:i===0?'player':`citizen_${i}`,pilotName:`Pilot ${i}`,holobotId:i===0?'ace':'wolf',isPlayer:i===0,
  fighter:fighter(i===0?'ace':'wolf',{maxHealth:1000000,currentHealth:1000000,attack:0,defense:1000000,speed:0})}));
 let complete;
 for(let seed=0;seed<100&&!complete;seed++){let b=createArenaBracket(matchId,'starter',seed,rows);while(b.playerAlive&&!b.done)b=advanceArenaBracket(b);if(b.done&&b.playerAlive)complete=b;}
 assert.ok(complete,'deterministic bounded sample includes a player champion');assert.equal(complete.matches.length,8);
 assert.ok(complete.matches.every(m=>m.receipt.reason==='round_limit'));
 const bytes=Buffer.byteLength(JSON.stringify({schemaVersion:'arena-bracket-1',bracket:complete,cancelled:false}));
 console.log(`Worst-case persisted bracket JSON: ${bytes} bytes; Firestore limit1048576; guard900000`);
 assert.ok(bytes<900000);assert.deepEqual(readArenaBracket(complete),complete);
});
