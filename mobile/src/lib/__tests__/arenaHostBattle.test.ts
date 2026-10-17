import {it,expect,vi} from 'vitest';
vi.mock('@/config/holobots',()=>({getHolobotFullImageSource:()=>1}));
import {arenaHostBattle} from '../arenaHostBattle';
import {readArenaReply} from '../arenaMatchFlow';
import {ArenaCombatEngine} from '@/features/arena/combatEngine';
import fixture from '../../qa/fixtures/arena-admitted-lifecycle.json';
const match=readArenaReply(fixture.steps.find(s=>s.request.operation==='start')!.reply).match!;
it('copies host fighter stats and only issued strike/heavy command scales/costs',()=>{
 const {battle,playerMoves}=arenaHostBattle(match,'demo');
 expect(battle.battleId).toBe(match.matchId);expect(battle.player.attack).toBe(match.entrant.attack);expect(battle.player.currentHP).toBe(match.entrant.currentHealth);
 expect(playerMoves.map(m=>m.id)).toEqual(['gap_closer','break_heavy']);expect(playerMoves[0].staminaCost).toBe(match.entrant.commandRules.strikeCost);
 expect(playerMoves[0].hostDamageScale).toBe(match.entrant.moves[0].damageScale);expect(battle.player.ability).toBeUndefined();expect(battle.player.signatureFinisher).toBeUndefined();
 battle.player.specialMeter=100;expect(ArenaCombatEngine.canUseSignatureFinisher(battle,'player')).toBe(false);
 battle.player.stamina=0;expect(ArenaCombatEngine.regenerateStamina(battle).player.stamina).toBe(match.entrant.commandRules.staminaRegen*2);
});
it('refuses absent moves before activation rather than installing a default kit',()=>{
 const missing=structuredClone(match);missing.opponent.moves=[];expect(()=>arenaHostBattle(missing,'demo')).toThrow('arena_moves_unavailable');
 expect(()=>arenaHostBattle({...match,state:'issued'},'demo')).toThrow('arena_not_started');
});
