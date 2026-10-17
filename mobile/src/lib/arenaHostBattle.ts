import type { ActionCard, BattleState } from '@/types/arena';
import { ArenaCombatEngine } from '@/features/arena/combatEngine';
import { getHolobotFullImageSource } from '@/config/holobots';
import { cityCombatantFighter } from './cityRivalBattle';
import type { ArenaMatch, ArenaSnapshot } from './arenaMatchFlow';
/** Existing generic client practice simulation only, not verified host combat. */
export function arenaHostBattle(match: ArenaMatch, uid: string) {
    if (match.state !== 'active')
        throw Error('arena_not_started');
    const fighter = (s: ArenaSnapshot, side: 'player' | 'rival') => {
        const f = cityCombatantFighter({ ...s, currentHealth: s.currentHealth ?? s.maxHealth, commandRules: { version: 1, maxStamina: s.commandRules.maxStamina, staminaRegen: s.commandRules.staminaRegen } }, side, uid);
        f.avatar = getHolobotFullImageSource(s.holobotId);
        return f;
    };
    const cards = (s: ArenaSnapshot): ActionCard[] => [['gap_closer', 'strikeCost', 'strikeSync', 'strike'], ['break_heavy', 'comboCost', 'comboSync', 'combo']].map(([id, cost, sync, type]) => {
        const move = s.moves.find(m => m.moveId === id);
        if (!move || ![cost, sync].every(k => Number.isFinite(s.commandRules[k])) || s.commandRules[cost] > s.commandRules.maxStamina)
            throw Error('arena_moves_unavailable');
        return { id, templateId: `host.${id}`, name: id.replaceAll('_', ' ').toUpperCase(), type: type as 'strike' | 'combo', staminaCost: s.commandRules[cost], requirements: [], baseDamage: s.attack * move.damageScale, hostDamageScale: move.damageScale, speedModifier: 0, hostSyncGain: s.commandRules[sync], effects: [], animationId: id, description: 'Issued host move; client practice simulation' };
    });
    const playerMoves = cards(match.entrant), opponentMoves = cards(match.opponent);
    const battle: BattleState = ArenaCombatEngine.initializeBattle(fighter(match.entrant, 'player'), fighter(match.opponent, 'rival'), { battleType: 'pve', allowPlayerControl: true, potentialRewards: { exp: 0, syncPoints: 0 } });
    battle.battleId = match.matchId;
    battle.hostSnapshot = { playerRegen: match.entrant.commandRules.staminaRegen, opponentRegen: match.opponent.commandRules.staminaRegen };
    return { battle, playerMoves, opponentMoves };
}
