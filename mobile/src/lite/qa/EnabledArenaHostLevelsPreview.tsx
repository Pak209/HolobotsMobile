import { getHolobotFullImageSource } from "@/config/holobots";
import { Text, View } from 'react-native';
import { BattleArenaView } from '@/lite/components/arena/BattleArenaView';
import { cityCombatantFighter } from '@/lite/lib/cityRivalBattle';
import type { BattleState } from '@/lite/types/arena';
import fixture from './fixtures/arena-match-fighter-snapshots.json';
const reply=fixture.reply, match=reply.match;
// Host issue values copied for a static signed-out display. No engine, charge or settlement runs.
const player=cityCombatantFighter({...match.entrant,commandRules:{...match.entrant.commandRules,version:1}},'player','offline-fixture');
const opponent=cityCombatantFighter({...match.opponent,currentHealth:match.opponent.maxHealth,commandRules:{...match.opponent.commandRules,version:1}},'rival','offline-fixture');
player.avatar=getHolobotFullImageSource(match.entrant.holobotId);
opponent.avatar=getHolobotFullImageSource(match.opponent.holobotId);
const battle:BattleState={battleId:match.matchId,battleType:'pve',status:'active',player,opponent,turnNumber:1,currentActorId:player.holobotId,pendingActions:[],actionHistory:[],timer:180,neutralPhase:true,playerBattleStyle:'balanced',hackUsed:false,allowPlayerControl:false,potentialRewards:{exp:0,syncPoints:0}};
const noop=()=>{};
function Preview({knownBad=false}:{knownBad?:boolean}) {
  return <View style={{flex:1,backgroundColor:'#101820'}}>
    <Text style={{color:'#62DDE8',textAlign:'center',paddingTop:50,paddingBottom:8}}>QA / SIMULATED / NO REWARDS</Text>
    <BattleArenaView battle={battle} embedded roundProgress={{currentRound:1,totalRounds:1}}
      hostLevelAccount={{holobots:[{name:match.entrant.displayName,level:match.entrant.level}]}}
      hostMatchReply={knownBad?undefined:reply} hostMatchId={knownBad?undefined:match.matchId}
      playerCards={[]} playableCardIds={[]} cardAvailability={{}} lastAction={null} isAnimating={false} onCardPlay={noop} onSignaturePlay={noop}/>
  </View>;
}
export function ArenaHostLevelsPreview(){return <Preview/>;}
export function ArenaHostLevelsKnownBadPreview(){return <Preview knownBad/>;}
