import { createHash, randomBytes } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { ArenaError, readArenaMatchRecord, settleArenaBracketRecord, cancelArenaBracketRecord } from '../arena/arenaMatchStore';
import { ARENA_TIERS } from '../lib/arenaEconomy';
import { ActivityError, arenaOpen } from '../lib/arenaActivity';
import { duelFighterFromCombatant } from '../lib/duelResolver';
import { HealthError } from '../lib/rivalHealth';
import { playerCombatant, RivalError } from '../lib/rivalLadder';
import { ARENA_TOURNAMENT_SCHEMA, tournamentAdmission } from './arenaTournament';
import { ARENA_BRACKET_SCHEMA, ArenaBracket, BracketEntrant, createArenaBracket, advanceArenaBracket, readArenaBracket } from './arenaBracket';
import { gatheringRoster } from './arenaGathering';
import { readStoryFlags, StoryError } from './storyFlags';
import { transactTournamentResult } from './tournamentResultStore';

type Data=Record<string,any>;
type Command={schemaVersion:typeof ARENA_BRACKET_SCHEMA;operation:'start'|'advance'|'resume'|'cancel';matchId:string;expectedRound?:number};
function command(raw:unknown):Command {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new StoryError('invalid_request');
  const c=raw as Command;
  if (c.schemaVersion!==ARENA_BRACKET_SCHEMA || !['start','advance','resume','cancel'].includes(c.operation)
    || typeof c.matchId!=='string' || !/^am_[a-f0-9]{32}$/.test(c.matchId)
    || Object.keys(c).some(k=>!['schemaVersion','operation','matchId',...(c.operation==='advance'?['expectedRound']:[])].includes(k))
    || (c.operation==='advance' && (!Number.isSafeInteger(c.expectedRound) || c.expectedRound!<0 || c.expectedRound!>4))) throw new StoryError('invalid_request');
  return c;
}
function entrants(uid:string,m:Data,seed:number):BracketEntrant[] {
  const tier=ARENA_TIERS.findIndex(t=>t.id===m.tierId);
  const player:BracketEntrant={entrantId:'player',pilotName:'You',holobotId:m.entrant.holobotId,isPlayer:true,
    fighter:duelFighterFromCombatant({...m.entrant,tier} as Parameters<typeof duelFighterFromCombatant>[0])};
  const citizens=gatheringRoster(uid).map(row=>({entrantId:row.citizenId,pilotName:row.pilotName,holobotId:row.holobotId,isPlayer:false,
    fighter:duelFighterFromCombatant({...playerCombatant(row.holobotId,{name:row.holobotId.toUpperCase(),level:m.opponent.level}),tier})}));
  // All eight gathering citizens plus the player enter. Bottom seeds play in; top seven get byes.
  const order=(id:string)=>createHash('sha256').update(JSON.stringify([ARENA_BRACKET_SCHEMA,seed,uid,m.matchId,id])).digest('hex');
  return [player,...citizens].sort((a,b)=>order(a.entrantId).localeCompare(order(b.entrantId)) || a.entrantId.localeCompare(b.entrantId));
}
function saved(raw:unknown) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new StoryError('unavailable');
  const s=raw as Data;
  if (s.schemaVersion!==ARENA_BRACKET_SCHEMA || typeof s.cancelled!=='boolean') throw new StoryError('unavailable');
  return {bracket:readArenaBracket(s.bracket),cancelled:s.cancelled};
}
const response=(bracket:ArenaBracket,cancelled:boolean,alreadyProcessed=false)=>({schemaVersion:ARENA_BRACKET_SCHEMA,matchId:bracket.matchId,alreadyProcessed,bracket,cancelled});

/** Match admission is the existing paid Arena issue; no new prices or client outcomes. */
export async function transactTournamentBracket(db:Firestore,uid:string,raw:unknown,nowMs=Date.now(),options:{createSeed?:()=>number}={}) {
  const c=command(raw);
  if (!Number.isSafeInteger(nowMs) || nowMs<0) throw new StoryError('invalid_request');
  // Generated once outside Firestore retries, never disclosed until start commits.
  // This test seam is server-internal; command validation rejects any caller seed.
  const newSeed=c.operation==='start'?(options.createSeed??(()=>randomBytes(4).readUInt32BE(0)))():0;
  let reply;
  try {
    reply=await db.runTransaction(async tx=>{
      const userRef=db.doc(`users/${uid}`),matchRef=db.doc(`arenaMatches/${uid}/matches/${c.matchId}`),leaseRef=db.doc(`arenaMatches/${uid}`);
      const bracketRef=db.doc(`arenaBrackets/${uid}/brackets/${c.matchId}`);
      const [userSnap,matchSnap,bracketSnap,leaseSnap]=await tx.getAll(userRef,matchRef,bracketRef,leaseRef);
      if (!userSnap.exists) throw new StoryError('unavailable');
      if (!matchSnap.exists) throw new StoryError('not_admitted');
      const profile=userSnap.data()!,m=readArenaMatchRecord(matchSnap.data(),c.matchId),lease=leaseSnap.data();
      if (!m.tournament) throw new StoryError('not_admitted');
      if (c.operation==='start' && !bracketSnap.exists) {
        if (m.state!=='issued' || m.bracket || !readStoryFlags(profile.storyFlags).arenaGatheringSeen) throw new StoryError('not_admitted');
        tournamentAdmission(profile.storyFlags,m.tournament.tournamentId,m.entrant.level);
        if (!arenaOpen(lease) || lease?.matchId!==m.matchId) throw new StoryError('not_admitted');
        if (nowMs>m.expiresAtMs) throw new StoryError('match_expired');
        const bracket=createArenaBracket(m.matchId,m.tournament.tournamentId,newSeed,entrants(uid,m,newSeed));
        const bound={...m,state:'active',startedAtMs:nowMs,bracket:{schemaVersion:ARENA_BRACKET_SCHEMA,matchId:m.matchId,boundAtMs:nowMs}};
        readArenaMatchRecord(bound,m.matchId);
        tx.set(matchRef,bound);tx.create(bracketRef,{schemaVersion:ARENA_BRACKET_SCHEMA,bracket,cancelled:false});
        return response(bracket,false);
      }
      if (!bracketSnap.exists || !m.bracket) throw new StoryError('not_admitted');
      const state=saved(bracketSnap.data()),b=state.bracket;
      if (b.matchId!==m.matchId || b.tournamentId!==m.tournament.tournamentId) throw new StoryError('unavailable');
      if (c.operation==='start' || c.operation==='resume') return response(b,state.cancelled,true);
      if (c.operation==='advance' && c.expectedRound!<b.round) return response(b,state.cancelled,true);
      if (state.cancelled) throw new StoryError('bracket_done');
      if (!b.playerAlive) throw new StoryError('player_eliminated');
      if (b.done) throw new StoryError('bracket_done');
      if (c.operation==='advance' && c.expectedRound!==b.round) throw new StoryError('invalid_request');
      if (m.state!=='active' || !arenaOpen(lease) || lease?.matchId!==m.matchId) throw new StoryError('not_admitted');
      const player=b.entrants.find(e=>e.isPlayer)!;
      if (c.operation==='cancel') {
        const closed=cancelArenaBracketRecord(profile,m,b.health[player.entrantId],nowMs);
        tx.update(userRef,closed.updates);tx.set(matchRef,closed.match);tx.set(leaseRef,{...lease,open:false,closedAtMs:nowMs});
        tx.set(bracketRef,{schemaVersion:ARENA_BRACKET_SCHEMA,bracket:b,cancelled:true});
        return response(b,true);
      }
      if (nowMs>m.expiresAtMs) throw new StoryError('match_expired');
      const next=advanceArenaBracket(b);
      if (!next.playerAlive || next.done) {
        const last=[...next.matches].reverse().find(x=>x.leftId===player.entrantId || x.rightId===player.entrantId)!;
        const opponentId=last.leftId===player.entrantId?last.rightId:last.leftId;
        const opponent=next.entrants.find(e=>e.entrantId===opponentId)!;
        const opponentStats={...opponent.fighter,level:m.opponent.level,name:opponent.holobotId.toUpperCase()};
        const closed=settleArenaBracketRecord(profile,m,opponentStats,next.health[player.entrantId],next.health[opponentId],next.playerAlive,nowMs);
        tx.update(userRef,closed.updates);tx.set(matchRef,closed.match);tx.set(leaseRef,{...lease,open:false,closedAtMs:nowMs});
      }
      tx.set(bracketRef,{schemaVersion:ARENA_BRACKET_SCHEMA,bracket:next,cancelled:false});
      return response(next,false);
    });
  } catch(e) {
    if (e instanceof ArenaError) throw new StoryError(e.code);
    if (e instanceof ActivityError || e instanceof HealthError || e instanceof RivalError || e instanceof RangeError) throw new StoryError('unavailable');
    throw e;
  }
  // This existing transaction remains unchanged. If delivery interrupts here, resume or
  // replayed advance retries it; a concurrent/previous success is safely already_won.
  if (!reply.cancelled && reply.bracket.done && reply.bracket.playerAlive) {
    try {
      const progress=await transactTournamentResult(db,uid,{schemaVersion:ARENA_TOURNAMENT_SCHEMA,tournamentId:reply.bracket.tournamentId,matchId:c.matchId});
      return {...reply,storyFlags:progress.storyFlags};
    } catch(e) {
      if (!(e instanceof StoryError) || e.code!=='already_won') throw e;
      return {...reply,storyFlags:readStoryFlags((await db.doc(`users/${uid}`).get()).data()?.storyFlags)};
    }
  }
  return reply;
}
