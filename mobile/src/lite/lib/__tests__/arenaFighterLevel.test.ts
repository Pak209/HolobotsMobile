import {describe,it,expect} from 'vitest';
import {arenaFighterLevel} from '../bots/arenaFighterLevel';
import fixture from '../../qa/fixtures/arena-match-fighter-snapshots.json';
const r=fixture.reply,id=r.matchId;
describe('already-admitted Arena host levels',()=>{
 it('known-bad local CPU/PvP fighter DTOs cannot supply a level',()=>{
  expect(arenaFighterLevel(r.match.opponent,id,'opponent','hare')).toBeUndefined();
  expect(arenaFighterLevel({players:{p2:{holobotId:'hare',level:99}}},id,'opponent','hare')).toBeUndefined();
 });
 it('copies both issued levels by exact match and side identity',()=>{
  expect(arenaFighterLevel(r,id,'entrant','ACE')).toBe(r.match.entrant.level);
  expect(arenaFighterLevel(r,id,'opponent','HARE')).toBe(r.match.opponent.level);
  expect(arenaFighterLevel(r,id,'opponent','ACE')).toBeUndefined();
  expect(arenaFighterLevel(r,'am_'+'f'.repeat(32),'opponent','HARE')).toBeUndefined();
 });
 it('hides missing/invalid or old-host fields, never defaults or reads rank',()=>{
  for(const level of [undefined,null,'12',0,100,1.5]){
   const copy=structuredClone(r) as any;copy.match.opponent.level=level;
   expect(arenaFighterLevel(copy,id,'opponent','hare')).toBeUndefined();
  }
  for(const key of ['displayName','tier']){const copy=structuredClone(r) as any;delete copy.match.opponent[key];expect(arenaFighterLevel(copy,id,'opponent','hare')).toBeUndefined();}
 });
 it('enforces the host tier schema upper bound',()=>{
  for(const tier of [-1, 1.5, 1000001]){
   const copy=structuredClone(r);copy.match.opponent.tier=tier;
   expect(arenaFighterLevel(copy,id,'opponent','hare')).toBeUndefined();
  }
  const copy=structuredClone(r);copy.match.opponent.tier=1000000;
  expect(arenaFighterLevel(copy,id,'opponent','hare')).toBe(r.match.opponent.level);
 });
 it('retains the issued level on terminal replies without reading local result stats',()=>{
  expect(arenaFighterLevel({...r,match:{...r.match,state:'settled'}},id,'opponent','hare')).toBe(r.match.opponent.level);
 });
});
