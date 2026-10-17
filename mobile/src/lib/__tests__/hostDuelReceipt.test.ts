import { describe, it, expect } from 'vitest';
import squadFixture from '../../qa/fixtures/duel-receipt-1-squad.json';
import fixture from '../../qa/fixtures/duel-receipt-1.json';
import { normalizeDuelReceipt, buildPlaybackCues } from '../bots/duelPlayback';
const envelope = () => ({ issue: { battleId: 'offline-w10-seed17', duel: { player: fixture.input.player, opponent: fixture.input.opponent } }, settlement: { didWin: false, holosGranted: 100, duelReceipt: structuredClone(fixture.receipt) } });
describe('W10 duel-receipt-1 playback', () => {
  it('known-bad first: uses all16 host actions/8 rounds and winner instead of contrary didWin/client trace', () => {
    const result = normalizeDuelReceipt(envelope(), [{ attacker: 'rival', damage: 999 }]);
    expect(result.rounds).toHaveLength(16); expect(result.roundCount).toBe(8); expect(result.didWin).toBe(true);
    expect(result.traceSource).toBe('host'); expect(result.rounds.map(x => x.damage)).toEqual(fixture.receipt.rounds.map(x => x.damage));
  });
  it('accepts direct receipt, callable data envelope and nested settle', () => {
    for (const value of [fixture.receipt, { data: envelope() }, envelope()]) {
      const p = normalizeDuelReceipt(value); expect(p.didWin).toBe(true); expect(p.attackerBotId).toBe('ace'); expect(p.defenderBotId).toBe('wolf'); expect(p.rounds).toHaveLength(16);
    }
  });
  it('copies recorded resources without inventing regen or reconstructing initial HP', () => {
    const parsed = normalizeDuelReceipt(fixture.receipt);
    expect(parsed.initialState).toBeNull(); expect(parsed.rounds[0].observedState?.[fixture.receipt.rounds[0].side === 'player' ? 'player' : 'rival'].hp).toBeUndefined();
    fixture.receipt.rounds.forEach((r, i) => { const side = r.side === 'player' ? 'player' : 'rival', other = side === 'player' ? 'rival' : 'player'; expect(parsed.rounds[i].observedState?.[side].stamina).toBe(r.staAfter); expect(parsed.rounds[i].observedState?.[other].hp).toBe(r.defenderHpAfter); });
    expect(parsed.finalState?.player.stamina).toBe(fixture.receipt.playerFinal[0].stamina);
  });
  it('uses host move aliases, no attacking or hit reaction for refused actions', () => {
    const parsed = normalizeDuelReceipt(fixture.receipt), cues = buildPlaybackCues(parsed.rounds);
    fixture.receipt.rounds.forEach((r, i) => {
      const actions = cues.filter(c => c.roundIndex === i && ['attack','guard'].includes(c.kind));
      if (r.move === 'wait') expect(actions).toEqual([]);
      else expect(actions[0].clip).toBe(({strike:'Strike',heavy:'Heavy',defend:'Guard',finisher:'Finisher'} as Record<string,string>)[r.move]);
      expect(cues.some(c=>c.roundIndex===i&&c.kind==='hit')).toBe(r.hit);
    });
  });
  it('does not mutate host data or allow final HP to determine winner', () => {
    const before = JSON.stringify(fixture); const receipt = {...fixture.receipt,winner:'opponent'};
    expect(normalizeDuelReceipt(receipt).didWin).toBe(false); buildPlaybackCues(normalizeDuelReceipt(fixture.receipt).rounds); expect(JSON.stringify(fixture)).toBe(before);
  });
  it.each(['damage','staAfter','defenderHpAfter','syncAfter'])('fails closed for invalid %s, never falls back to didWin', key => {
    const e = envelope(); Object.assign(e.settlement.duelReceipt.rounds[0],{[key]:NaN}); const parsed=normalizeDuelReceipt(e,[{attacker:'player',damage:999}]); expect(parsed.rounds).toEqual([]);expect(parsed.didWin).toBeNull();expect(parsed.receiptError).toBeTruthy();
  });
  it.each(['winner','schemaVersion','playerFinal','rounds'])('fails closed for malformed %s', key => {
    const e=envelope();Object.assign(e.settlement.duelReceipt,{[key]:null});expect(normalizeDuelReceipt(e).receiptError).toBeTruthy();
  });
  it('rejects out-of-order and duplicate side rows, foreign fighters, and damaging waits',()=>{
    for(const patch of [{round:3},{attacker:'foreign'},{move:'wait',refusal:'insufficient_stamina'}]) {const e=envelope();Object.assign(e.settlement.duelReceipt.rounds[0],patch);expect(normalizeDuelReceipt(e).rounds).toEqual([]);}
    const e=envelope(); e.settlement.duelReceipt.rounds[1]=e.settlement.duelReceipt.rounds[0];expect(normalizeDuelReceipt(e).rounds).toEqual([]);
  });
  it('does not truncate the120-turn/240-action host contract at the old200-row client bound',()=>{
    const receipt=structuredClone(fixture.receipt);receipt.rounds=Array.from({length:240},(_,i)=>({...receipt.rounds[i%2],round:Math.floor(i/2)+1}));expect(normalizeDuelReceipt(receipt).rounds).toHaveLength(240);
  });
});

it('review: explicit null host receipt cannot use client rounds, rewards or didWin',()=>{
 const value={...envelope(),settlement:{didWin:true,holosGranted:100,duelReceipt:null}};
 const parsed=normalizeDuelReceipt(value,[{attacker:'player',damage:999}]);expect(parsed.receiptError).toBeTruthy();expect(parsed.didWin).toBeNull();expect(parsed.holosGranted).toBeNull();expect(parsed.rounds).toEqual([]);
});
it('review: every host turn needs both sides, including a knocked-out wait',()=>{
 for(const rounds of [fixture.receipt.rounds.slice(0,-1),fixture.receipt.rounds.filter(r=>r.side==='player')]) expect(normalizeDuelReceipt({...fixture.receipt,rounds}).receiptError).toBeTruthy();
});

it('keeps squad actor identity with each copied resource snapshot and queues actor selection first',()=>{
 const parsed=normalizeDuelReceipt(squadFixture.receipt),cues=buildPlaybackCues(parsed.rounds);
 expect(parsed.rounds.some(r=>r.actors?.player==='wolf')).toBe(true);expect(parsed.rounds.some(r=>r.actors?.player==='ace')).toBe(true);
 for(let i=0;i<parsed.rounds.length;i++){const row=parsed.rounds[i];expect(cues.filter(c=>c.roundIndex===i)[0]).toMatchObject({kind:'actors',actors:row.actors});}
 const ace=parsed.rounds.find(r=>r.actors?.player==='ace')!;expect(ace.observedState?.player.maxHp).toBe(squadFixture.receipt.playerFinal[1].maxHealth);
});
