import { describe, expect, it } from 'vitest';
import { KoPresentationGate, KO_RESULT_HOLD_MS, shouldHoldResult } from '../bots/koPresentation';
import { BattlePaceQueue, fightTiming } from '../bots/battlePace';

describe('terminal battle presentation', () => {
  it('3v3 intermediate KO and send-in never consume the final hold for the same battle id', () => {
    const id='team-room'; let completed: string | null=null;
    // Both active and awaiting_send_in phases retain overall status active, even with an active fighter at zero HP.
    for (const phase of ['first fighter KO', 'awaiting_send_in', 'new fighter active']) {
      expect(shouldHoldResult('active', id, id, completed), phase).toBe(false);
    }
    expect(shouldHoldResult('completed', id, id, completed)).toBe(true);
    const gate=new KoPresentationGate();
    gate.advance(id, 100, true);
    if (gate.advance(id, 2100, true)) completed=id;
    expect(shouldHoldResult('completed', id, id, completed)).toBe(false);
    expect(shouldHoldResult('completed', 'unseen-receipt', id, completed)).toBe(false);
    expect(shouldHoldResult('abandoned', id, id, null)).toBe(false);
  });
  it('waits for all cues and the KO endpoint, then holds that rendered pose for two seconds', () => {
    const gate = new KoPresentationGate();
    expect(gate.advance('match', 0, false)).toBe(false);
    expect(gate.advance('match', 4000, false)).toBe(false);
    expect(gate.advance('match', 4100, true)).toBe(false);
    expect(gate.advance('match', 6099, true)).toBe(false);
    expect(gate.advance('match', 4100 + KO_RESULT_HOLD_MS, true)).toBe(true);
    expect(gate.advance('match', 9000, true)).toBe(false);
  });
  it('a foreground clock pause cannot fast-forward the KO hold', () => {
    const gate = new KoPresentationGate();
    gate.advance('match', 500, true);
    for (let i = 0; i < 20; i++) expect(gate.advance('match', 500, true)).toBe(false);
    expect(gate.advance('match', 2499, true)).toBe(false);
    expect(gate.advance('match', 2500, true)).toBe(true);
  });
  it('re-arms if another queued action arrives and does not cross match generations', () => {
    const gate = new KoPresentationGate();
    gate.advance('one', 0, true);
    gate.advance('one', 1999, false);
    expect(gate.advance('one', 2000, true)).toBe(false);
    expect(gate.advance('one', 4000, true)).toBe(true);
    expect(gate.advance('two', 4001, true)).toBe(false);
    expect(gate.advance('two', 6001, true)).toBe(true);
    gate.reset();
    expect(gate.advance('two', 6002, true)).toBe(false);
    expect(gate.advance(null, 10000, true)).toBe(false);
  });
  it('queue stays non-idle through final recovery, and cancellation drains without contact', () => {
    const q = new BattlePaceQueue<{id: string; timing: ReturnType<typeof fightTiming>}>();
    const cue={id:'fatal',timing:fightTiming('light',{duration:1,contact:.4,speed:1},true)};
    q.enqueue(cue);expect(q.idle).toBe(false);
    q.advance(0);q.advance(334);expect(q.idle).toBe(false);
    q.advance(299);expect(q.idle).toBe(false);
    q.advance(1);expect(q.idle).toBe(true);
    q.enqueue({...cue,id:'after-ko'});
    expect(q.advance(0,()=>false).map(e=>e.type)).toEqual(['cancel']);
    expect(q.idle).toBe(true);
  });
});
