import { createHash } from 'node:crypto';
import { DuelFighterStats, DuelReceipt, resolveDuel } from '../lib/duelResolver';
import { TournamentId, tournamentIndex } from './arenaTournament';
import { StoryError } from './storyFlags';

export const ARENA_BRACKET_SCHEMA = 'arena-bracket-1';
export type BracketEntrant = { entrantId:string; pilotName:string; holobotId:string; isPlayer:boolean; fighter:DuelFighterStats };
export type BracketMatch = { matchId:string; round:number; leftId:string; rightId:string; winnerId:string; receipt:DuelReceipt };
export type ArenaBracket = {
  schemaVersion:typeof ARENA_BRACKET_SCHEMA; matchId:string; tournamentId:TournamentId;
  seed:number; round:number; playerAlive:boolean; done:boolean;
  entrants:BracketEntrant[]; remaining:string[]; health:Record<string,number>; matches:BracketMatch[];
};
const hash = (parts:unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest().readUInt32BE(0);
const fail = ():never => { throw new StoryError('unavailable'); };
export function createArenaBracket(matchId:string,tournamentId:TournamentId,seed:number,entrants:BracketEntrant[]):ArenaBracket {
  tournamentIndex(tournamentId);
  if (!/^am_[a-f0-9]{32}$/.test(matchId) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff
    || ![8,9].includes(entrants.length) || new Set(entrants.map(e=>e.entrantId)).size !== entrants.length || entrants.filter(e=>e.isPlayer).length !== 1) return fail();
  const health:Record<string,number> = {};
  for(const e of entrants) {
    if (!e.entrantId || !e.pilotName || e.holobotId !== e.fighter.holobotId) return fail();
    // The shared resolver validates every numeric stat without granting health.
    resolveDuel({seed,player:[e.fighter],opponent:[e.fighter]});
    health[e.entrantId] = e.fighter.currentHealth ?? e.fighter.maxHealth;
    if (health[e.entrantId] <= 0) return fail();
  }
  return {schemaVersion:ARENA_BRACKET_SCHEMA,matchId,tournamentId,seed,round:0,playerAlive:true,done:false,
    entrants:structuredClone(entrants),remaining:entrants.map(e=>e.entrantId),health,matches:[]};
}
/** Nine entrants first play the bottom-seed pair; seven byes form the eight-slot draw.
 * One deterministic elimination round. CPU and player use the same host policy.
 * Survivors carry their remaining HP; the bracket never grants a between-round heal. */
export function advanceArenaBracket(previous:ArenaBracket):ArenaBracket {
  if (!previous.playerAlive) throw new StoryError('player_eliminated');
  if (previous.done) throw new StoryError('bracket_done');
  const next = structuredClone(previous), round = previous.round + 1;
  const playIn=previous.remaining.length===9;
  next.remaining = playIn?previous.remaining.slice(0,7):[];
  for(let i=playIn?7:0;i<previous.remaining.length;i+=2) {
    const leftId=previous.remaining[i],rightId=previous.remaining[i+1];
    const left=previous.entrants.find(e=>e.entrantId===leftId)!,right=previous.entrants.find(e=>e.entrantId===rightId)!;
    const receipt=resolveDuel({seed:hash([ARENA_BRACKET_SCHEMA,previous.seed,round,Math.floor(i/2)]),
      player:[{...left.fighter,currentHealth:previous.health[leftId]}],opponent:[{...right.fighter,currentHealth:previous.health[rightId]}]});
    const winnerId=receipt.winner==='player'?leftId:rightId;
    next.health[leftId]=receipt.playerFinal[0].currentHealth;
    next.health[rightId]=receipt.opponentFinal[0].currentHealth;
    next.remaining.push(winnerId);
    next.matches.push({matchId:`round_${round}_match_${Math.floor(i/2)}`,round,leftId,rightId,winnerId,receipt});
  }
  next.round=round;
  next.playerAlive=next.remaining.includes(previous.entrants.find(e=>e.isPlayer)!.entrantId);
  next.done=next.remaining.length===1;
  return next;
}
/** Recompute saved receipts from immutable seeds/stats before trusting persistent progress. */
export function readArenaBracket(raw:unknown):ArenaBracket {
  try {
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) return fail();
    const saved=raw as ArenaBracket;
    if (saved.schemaVersion!==ARENA_BRACKET_SCHEMA || !Number.isSafeInteger(saved.round) || saved.round<0 || saved.round>4) return fail();
    let expected=createArenaBracket(saved.matchId,saved.tournamentId,saved.seed,saved.entrants);
    for(let i=0;i<saved.round;i++) expected=advanceArenaBracket(expected);
    // Firestore object-key order is not stable; compare recursively by sorted keys.
    const canonical=(x:unknown):unknown => Array.isArray(x)?x.map(canonical):x&&typeof x==='object'
      ?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):x;
    if (JSON.stringify(canonical(saved))!==JSON.stringify(canonical(expected))) return fail();
    return expected;
  } catch { return fail(); }
}
