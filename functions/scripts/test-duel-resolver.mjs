import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const D=require('../lib/lib/duelResolver.js');
const {rivalTierBattleStats}=require('../lib/lib/rivalTierStats.js');
const fighter=(tier=0,id='wolf')=>D.duelFighterFromCombatant({holobotId:id,...rivalTierBattleStats(tier)});
const input=(seed=17)=>({seed,player:[fighter()],opponent:[fighter()],playerIntents:['strike','heavy','defend']});

test('same host snapshot, seed and intents produce byte-identical receipts without mutation',()=>{
 const original=input(), before=JSON.stringify(original);
 const a=D.resolveDuel(original),b=D.resolveDuel(original);
 assert.equal(JSON.stringify(a),JSON.stringify(b)); assert.equal(JSON.stringify(original),before);
 assert.equal(a.schemaVersion,'duel-receipt-1'); assert.notDeepEqual(a,D.resolveDuel(input(18)));
 assert.ok(a.rounds.length<=120); assert.ok(['player','opponent'].includes(a.winner));
});
test('validation rejects malformed seeds, teams, stats and every non-intent input',()=>{
 for(const seed of [-1,2**32,NaN,1.1])assert.throws(()=>D.resolveDuel({...input(),seed}),/invalid_seed/);
 for(const player of [[],[fighter(),fighter()], [{...fighter(),attack:NaN}], [{...fighter(),currentHealth:-1}], [{...fighter(),currentHealth:0}]])assert.throws(()=>D.resolveDuel({...input(),player}));
 for(const playerIntents of [[],['win'],[{}],new Array(121).fill('strike'),null])assert.throws(()=>D.resolveDuel({...input(),playerIntents}),/invalid_intents/);
});
test('insufficient stamina and uncharged finishers never underflow or deal invented damage',()=>{
 const low={...fighter(),maxStamina:0.5,staminaRegen:0};
 const r=D.resolveDuel({...input(),player:[low],playerIntents:['finisher','heavy','strike']});
 for(const round of r.rounds){assert.equal(round.player.action,'wait');assert.equal(round.player.damage,0);assert.equal(round.player.stamina,0.5);assert.equal(round.player.refusal,'insufficient_stamina');}
 const uncharged=D.resolveDuel({...input(),playerIntents:['finisher']});
 assert.equal(uncharged.rounds[0].player.refusal,'sync_not_ready');
});
test('defend restores bounded STA, attacks build SYNC and charged finisher spends exactly 4/100',()=>{
 const tank={...fighter(),maxHealth:100000,attack:1,defense:0};
 const r=D.resolveDuel({seed:11,player:[tank],opponent:[tank],playerIntents:[...Array(10).fill('strike'),'defend','defend','finisher']});
 assert.ok(r.rounds.some(x=>x.player.action==='finisher'));
 for(const round of r.rounds){assert.ok(round.player.stamina>=0&&round.player.stamina<=7);assert.ok(round.player.sync>=0&&round.player.sync<=100);if(round.player.action==='finisher')assert.equal(round.player.sync,0);}
});
test('round limit has a deterministic winner and short intents repeat without autoplay',()=>{
 const tank={...fighter(),maxHealth:1000000,attack:0,defense:1000000};
 const r=D.resolveDuel({seed:0,player:[tank],opponent:[tank],playerIntents:['defend']});
 assert.equal(r.reason,'round_limit');assert.equal(r.rounds.length,120);
 assert.ok(r.rounds.every(x=>x.player.requested==='defend'));assert.deepEqual(r,D.resolveDuel({seed:0,player:[tank],opponent:[tank],playerIntents:['defend']}));
});
test('every issued squad fighter participates and carryover health is not reset',()=>{
 const weak={...fighter(),currentHealth:1,attack:1,speed:0};
 const strong={...fighter(9,'ace'),attack:100000};
 const r=D.resolveDuel({seed:1,player:[weak,strong],opponent:[fighter(3)],playerIntents:['strike']});
 assert.equal(r.playerFinal[0].currentHealth,0);assert.ok(r.rounds.some(x=>x.player.holobotId==='ace'));assert.equal(r.winner,'player');
 const c=D.duelFighterFromCombatant({...fighter(),currentHealth:3});assert.equal(c.currentHealth,3);assert.equal(c.maxStamina,7);assert.equal(c.staminaRegen,0.5);
});
test('1000 seeds for each of 100 tier pairs: reproducible bounds and stronger-tier sanity',()=>{
 const matrix=[];
 for(let p=0;p<10;p++){const row=[];for(let o=0;o<10;o++){
  let wins=0;
  for(let seed=0;seed<1000;seed++){
   const r=D.resolveDuel({seed,player:[fighter(p)],opponent:[fighter(o)]});
   wins+=Number(r.winner==='player');assert.ok(r.rounds.length>0&&r.rounds.length<=120);
   for(const f of [...r.playerFinal,...r.opponentFinal]){assert.ok(f.currentHealth>=0&&f.currentHealth<=f.maxHealth);assert.ok(f.stamina>=0&&f.stamina<=f.maxStamina);}
  }
  if(p===o)assert.ok(wins>=400&&wins<=600,`equal tier ${p}: ${wins}`);
  if(p>o)assert.ok(wins>=500,`stronger tier ${p}/${o}: ${wins}`);
  if(p<o)assert.ok(wins<=500,`weaker tier ${p}/${o}: ${wins}`);
  row.push(wins);
 }matrix.push(row);}
 console.log('TIER_PAIR_PLAYER_WINS_PER_1000='+JSON.stringify(matrix));
});
