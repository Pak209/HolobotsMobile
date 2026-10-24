import { useEffect, useMemo, useRef, useState } from 'react';
import { PvpArenaModalView, type PvpArenaSession } from '@/components/arena/PvpArenaModal';
import { buildPvpFighterDoc, roomToBattleState } from '@/features/arena/pvpBattle';
import type { BattleAction } from '@/types/arena';
import type { BattleRoom } from '@/types/battle-room';
import { pvpFightersFixtures } from './pvpFightersFixtures';

/** Signed-out synthetic transitions through the ACTUAL PvP parent + result UI. No live hook, listener, account or writes.
 * KO case uses seated ACE/KUMA fixture identities. Guard case changes the model to TSUIN and intentionally has no LV view.
 * These are already-resolved presentation inputs, not combat correctness or rewards evidence. */
const seated=pvpFightersFixtures.PvpFightersSeated;
const noop=()=>{};
const asyncNoop=async()=>{};
const CELLS={PvpTerminalKo:'ko',PvpTsuinGuard:'guard'} as const;
export const battleTerminalPreviewScreens=Object.fromEntries(Object.entries(CELLS).map(([cell,kind])=>[cell,function TerminalPreview(){
  const initial=useMemo(()=>{
    const fighter=(role:'p1'|'p2',name:string)=>buildPvpFighterDoc(seated.room.players[role].uid, 'QA / OFFLINE',
      {name,level:role==='p1'?21:12,experience:0,nextLevelExp:100},
      {arena_deck_template_ids:[],battle_cards:{'strike.quickJab':1,'defense.guardUp':1,'combo.chainBurst':1,'strike.snapShot':1}});
    const room:BattleRoom={...seated.room,roomCode:kind==='ko'?'QA-KO':'QA-GUARD',status:'active',winner:null,
      players:{p1:fighter('p1',kind==='guard'?'TSUIN':'ACE'),p2:fighter('p2','KUMA')}};
    return room;
  },[]);
  const [room,setRoom]=useState(initial);
  const count=useRef(0);
  useEffect(()=>{
    let next:ReturnType<typeof setInterval>|undefined;
    const fire=()=>setRoom(current=>{
      const state=roomToBattleState(current);
      const card=current.players.p1.moves.find(m=>m.type===(kind==='guard'?'defense':'strike'))!;
      const n=++count.current,damage=kind==='ko'?current.players.p2.currentHP:0;
      const action:BattleAction={id:`${cell}-${n}`,turnNumber:n,actorId:state.player.holobotId,actorRole:'player',targetId:state.opponent.holobotId,
        card,actionType:card.type,timestamp:Date.now(),outcome:kind==='guard'?'blocked':'hit',damageDealt:damage,actualDamage:damage,
        staminaChange:0,specialMeterChange:0,wasCountered:false,triggeredCombo:false,perfectDefense:false};
      console.info('[BattleTerminal:fixture] '+JSON.stringify({cell,id:action.id,atMs:Math.round(performance.now()),utc:new Date().toISOString(),status:kind==='ko'?'completed':'active'}));
      return {...current,lastAction:action,turnNumber:n,status:kind==='ko'?'completed':'active',winner:kind==='ko'?'p1':null,
        players:{...current.players,p2:{...current.players.p2,currentHP:current.players.p2.currentHP-damage}}};
    });
    const first=setTimeout(()=>{fire();if(kind==='guard')next=setInterval(fire,5000);},9000);
    return()=>{clearTimeout(first);if(next)clearInterval(next);};
  },[]);
  const session:PvpArenaSession={room,myRole:'p1',opponentRole:'p2',hostView:kind==='ko'?seated.view:null,
    hostSeatPending:{p1:false,p2:false},error:null,loading:false,matchmakingStatus:'idle',moveAvailability:{},
    createRoom:async()=> 'QA',joinRoom:asyncNoop,enterMatchmaking:asyncNoop,cancelMatchmaking:asyncNoop,
    leaveRoom:asyncNoop,playMove:asyncNoop,sendIn:asyncNoop,switchActive:asyncNoop,useSignature:asyncNoop};
  return <PvpArenaModalView session={session} visible onClose={noop} userHolobots={[]}/>;
}]));
