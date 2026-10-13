import {describe,it,expect} from 'vitest';
import contract from '../../../../docs/contracts/economy-host-1.json';
import {BATTLE_LOSS_HOLOS,BATTLE_WIN_HOLOS,RIVAL_COOLDOWN_MS,RIVAL_MIN_XP_MS,requireRivalOffCooldown} from '../../../../functions/src/lib/rivalLadder';
import {BLUEPRINT_FRAGMENT_STOCK,HOLOZONE_CLEAR_BLUEPRINT_FRAGMENTS,HOLOZONE_MIN_XP_MS} from '../../../../functions/src/lib/holoZoneRuns';
import {HOLOBOT_RANK_TIERS} from '../../../../functions/src/lib/progression';
import {withRankHealingReward} from '../../../../functions/src/lib/rankHealingReward';
import {getHolobotRank} from '../progression';
/** economy-host-1 (DECISIONS #58): the host numbers the client may display, pinned to the shared fixture. */
export const ECONOMY_PARITY_KEYS=contract.parityKeys;
describe('economy-host-1 client contract',()=>{
 it('economyBattleHolosParity',()=>{expect(BATTLE_WIN_HOLOS).toBe(contract.battleWinHolos);expect(BATTLE_LOSS_HOLOS).toBe(contract.battleLossHolos);expect(RIVAL_MIN_XP_MS).toBe(contract.antiFarmMinMs);expect(HOLOZONE_MIN_XP_MS).toBe(contract.antiFarmMinMs);});
 it('economyRivalCooldownParity',()=>{expect(RIVAL_COOLDOWN_MS).toBe(contract.rivalCooldownMs);try{requireRivalOffCooldown({rival_tier_0:0},'rival_tier_0',1000);throw new Error('expected refusal');}catch(e){const r=e as {code:string;retryAfterMs:number};expect(r.code).toBe(contract.rivalCooldownRejection);expect(r.retryAfterMs).toBe(contract.rivalCooldownMs-1000);}expect(()=>requireRivalOffCooldown({rival_tier_0:0},'rival_tier_1',1000)).not.toThrow();});
 it('economyZoneFragmentParity',()=>{expect(HOLOZONE_CLEAR_BLUEPRINT_FRAGMENTS).toBe(contract.zoneClearBlueprintFragments);expect(BLUEPRINT_FRAGMENT_STOCK).toBe('blueprint_fragment');});
 it('economyRankTierKitParity',()=>{expect(HOLOBOT_RANK_TIERS.map(t=>t.startLevel)).toEqual(contract.rankTierStartLevels);for(const t of HOLOBOT_RANK_TIERS){expect(getHolobotRank(t.startLevel)).toBe(t.rank);if(t.startLevel>1)expect(getHolobotRank(t.startLevel-1)).not.toBe(t.rank);}const r=withRankHealingReward({holobots:[{name:'ACE',level:1}]},{holobots:[{name:'ACE',level:2}]});expect((r.itemStocks as Record<string,number>).repair_kit).toBe(1);});
});
