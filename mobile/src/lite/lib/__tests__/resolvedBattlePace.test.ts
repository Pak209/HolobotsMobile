import { it, expect, vi } from 'vitest';
vi.mock('@/config/holobots',()=>({getHolobotFullImageSource:()=>1}));
import { arenaHostBattle } from '../arenaHostBattle';
import { readArenaReply } from '../arenaMatchFlow';
import fixture from '../../qa/fixtures/arena-admitted-lifecycle.json';
import { resolvedBattlePace } from '../bots/resolvedBattlePace';
import type { BattleAction } from '../../types/arena';
const match=readArenaReply(fixture.steps.find(s=>s.request.operation==='start')!.reply).match!;
function setup(){
  const {battle,playerMoves}=arenaHostBattle(match,'pace-offline');
  const action:BattleAction={id:'resolved-1',turnNumber:1,actorId:battle.player.holobotId,actorRole:'player',targetId:battle.opponent.holobotId,card:playerMoves[0],actionType:'strike',timestamp:1000,outcome:'hit',damageDealt:10,actualDamage:10,staminaChange:-1,specialMeterChange:10,wasCountered:false,triggeredCombo:false,perfectDefense:false};
  return {battle,action};
}
it('maps a resolved hit and host HP KO without changing any input, number, result or turn',()=>{
 const {battle,action}=setup();battle.opponent.currentHP=0;const before=JSON.stringify({battle,action});
 expect(resolvedBattlePace(action,battle)).toMatchObject({attacker:'player',damaged:'rival',ko:'rival',kind:'light'});
 expect(JSON.stringify({battle,action})).toBe(before);
});
it('countered/reflected damage strikes the attacker, including its KO',()=>{
 for(const outcome of ['counter','countered']as const){const {battle,action}=setup();action.outcome=outcome;battle.player.currentHP=0;
 expect(resolvedBattlePace(action,battle)).toMatchObject({attacker:'player',damaged:'player',ko:'player'});}
});
it('an earlier batched row cannot borrow the latest zero HP to claim an early KO',()=>{
 const {battle,action}=setup();battle.opponent.currentHP=0;expect(resolvedBattlePace(action,battle,false).ko).toBeNull();
});
it('miss and dodge request an evade and never invent damage or a KO',()=>{
 for(const outcome of ['missed','dodged']as const){const {battle,action}=setup();action.outcome=outcome;action.actualDamage=0;action.damageDealt=0;
 expect(resolvedBattlePace(action,battle)).toMatchObject({damaged:null,ko:null,evade:true});}
});
it('guard and zero-damage block have no hit event',()=>{
 const {battle,action}=setup();action.actionType='defense';action.outcome='blocked';action.actualDamage=0;action.damageDealt=0;
 expect(resolvedBattlePace(action,battle)).toMatchObject({kind:'guard',damaged:null,ko:null,evade:false});
});
it('uses explicit rival role even when both Holobot ids match',()=>{
 const {battle,action}=setup();battle.opponent.holobotId=battle.player.holobotId;action.actorRole='opponent';
 expect(resolvedBattlePace(action,battle)).toMatchObject({attacker:'rival',target:'player',damaged:'player'});
});
