import { describe, expect, it } from 'vitest';
import { BattlePaceQueue, fightTiming, PresentationCursor } from '../bots/battlePace';
import timing from '../bots/fightClipTiming.json';

const cue = (id: string) => ({ id, timing: fightTiming('light', { duration: 2, contact: 1, speed: 3 }, true) });
describe('authored fight presentation clock', () => {
  it('uses every bot DamageFrame and controller speed, with Unity’s bounded warp', () => {
    for (const bot of Object.values(timing.clips)) for (const [name, kind] of [['FightLight','light'],['FightHeavy','heavy'],['FightSpecial','special']] as const) {
      const source = bot[name], result = fightTiming(kind, source, true);
      const warp = source.contact! / (result.windupMs / 1000) / source.speed;
      expect(warp).toBeGreaterThanOrEqual(.5 - 1e-8); expect(warp).toBeLessThanOrEqual(2 + 1e-8);
      expect(result.contactSeconds).toBe(source.contact);
    }
  });
  it('lands WOLF’s light at one third of a second and clamps a longer special', () => {
    expect(fightTiming('light', timing.clips.wolf.FightLight, true).windupMs).toBeCloseTo(1000 / 3);
    expect(fightTiming('special', timing.clips.wolf.FightSpecial, true).windupMs).toBeGreaterThan(500);
  });
  it('uses 33/67/100 ms stops only for resolved hits', () => {
    expect(['light','heavy','special'].map(k => fightTiming(k as 'light', timing.clips.wolf.FightLight, true).stopMs)).toEqual([33,67,100]);
    expect(fightTiming('light', timing.clips.wolf.FightLight, false).stopMs).toBe(0);
  });
  it('dedupes an action without changing the accepted object', () => {
    const queue = new BattlePaceQueue(), input = Object.freeze(cue('one'));
    expect(queue.enqueue(input)).toBe(true); expect(queue.enqueue(input)).toBe(false);
    expect(queue.advance(0)).toEqual([{ type:'start', cue:input }]);
    expect(input).toEqual(cue('one'));
  });
  it('holds the exact contact pose on the first slow frame, then recovers and snaps back', () => {
    const queue = new BattlePaceQueue(); queue.enqueue(cue('one')); queue.advance(0);
    expect(queue.advance(390).map(e=>e.type)).toEqual(['contact']);
    expect(queue.sample()).toMatchObject({ phase:'contact', clipSeconds:1, lungeM:.15 });
    queue.advance(30); expect(queue.sample()?.phase).toBe('contact');
    queue.advance(30); expect(queue.sample()?.phase).toBe('recover');
    expect(queue.sample()!.lungeM).toBeLessThan(.15);
    expect(queue.advance(300).map(e=>e.type)).toEqual(['finish']); expect(queue.sample()).toBeNull();
  });
  it('freezes during pause/background: no elapsed clock input means no stale impact', () => {
    const queue = new BattlePaceQueue(); queue.enqueue(cue('one')); queue.advance(0); queue.advance(100);
    const before = queue.sample(); for(let i=0;i<100;i++)queue.advance(0);
    expect(queue.sample()).toEqual(before); expect(queue.clockMs).toBe(100);
  });
  it('retains all rapid actions in supplied order, with one impact each', () => {
    const queue = new BattlePaceQueue(); ['a','b','c'].forEach(id=>queue.enqueue(cue(id)));
    const contacts:string[]=[];
    for(let i=0;i<60;i++)for(const event of queue.advance(50))if(event.type==='contact')contacts.push(event.cue.id);
    expect(contacts).toEqual(['a','b','c']);
  });
  it('explicitly refuses overflow without dropping accepted cues', () => {
    const queue = new BattlePaceQueue(); for(let i=0;i<32;i++)expect(queue.enqueue(cue(String(i)))).toBe(true);
    expect(queue.enqueue(cue('overflow'))).toBe(false);
    const contacts:string[]=[];for(let i=0;i<400;i++)for(const e of queue.advance(100))if(e.type==='contact')contacts.push(e.cue.id);
    expect(contacts).toEqual(Array.from({length:32},(_,i)=>String(i)));
  });
  it('reset on scene disposal removes pending work and permits reused IDs in a new battle', () => {
    const queue = new BattlePaceQueue(); queue.enqueue(cue('one')); queue.advance(100); queue.reset();
    expect(queue.advance(1000)).toEqual([]); expect(queue.sample()).toBeNull(); expect(queue.enqueue(cue('one'))).toBe(true);
  });
  it('bounded dedupe still protects the 32 pending IDs', () => {
    const queue = new BattlePaceQueue();
    for(let i=0;i<300;i++){queue.enqueue(cue(String(i)));queue.advance(0);queue.advance(400);queue.advance(400);}
    expect(queue.enqueue(cue('299'))).toBe(false); expect(queue.enqueue(cue('new'))).toBe(true);
  });
});

describe('history and lifecycle boundaries', () => {
  it('never replays old entries after more than 256 actions', () => {
    const cursor = new PresentationCursor<{id:string}>(), rows:{id:string}[] = [], shown:string[]=[];
    cursor.consume('a',[],false,()=>true);
    for(let i=0;i<350;i++){rows.push({id:String(i)});cursor.consume('a',rows,true,row=>{shown.push(row.id);return true;});}
    expect(shown).toEqual(rows.map(row=>row.id)); expect(cursor.consume('a',rows,true,()=>true)).toBe(0);
  });
  it('retries a full queue tail on drain without any new host history', () => {
    const cursor = new PresentationCursor<ReturnType<typeof cue>>(), queue = new BattlePaceQueue();
    cursor.consume('a',[],false,()=>true);const rows=Array.from({length:40},(_,i)=>cue(String(i)));
    expect(cursor.consume('a',rows,true,row=>queue.enqueue(row))).toBe(32);
    const contacts:string[]=[];
    for(let i=0;i<400;i++)for(const e of queue.advance(100)){
      if(e.type==='contact')contacts.push(e.cue.id);
      if(e.type==='finish')cursor.consume('a',rows,true,row=>queue.enqueue(row));
    }
    expect(contacts).toEqual(rows.map(row=>row.id));
  });
  it('skips stale history when a new scene still has the previous ready callback', () => {
    const cursor = new PresentationCursor<{id:string}>();cursor.consume('old',[],false,()=>true);
    expect(cursor.consume('new',[{id:'old-ko'}],true,()=>{throw Error('stale scene');})).toBe(0);
    expect(cursor.consume('new',[{id:'old-ko'},{id:'new-hit'}],true,()=>true)).toBe(1);
  });
  it('cancels an already-KO attacker at execution without contact or effects, then continues FIFO', () => {
    const queue = new BattlePaceQueue(); queue.enqueue(cue('dead'));queue.enqueue(cue('living'));
    expect(queue.advance(0,c=>c.id!=='dead').map(e=>[e.type,e.cue.id])).toEqual([['cancel','dead'],['start','living']]);
    expect(queue.advance(400).map(e=>[e.type,e.cue.id])).toEqual([['contact','living']]);
  });
  it('guard ends at the bounded 400ms hold instead of the source clip length', () => {
    const queue=new BattlePaceQueue();queue.enqueue({id:'guard',timing:fightTiming('guard',{duration:2.97,contact:null,speed:1},false)});
    queue.advance(0);const pose=queue.sample();queue.advance(399);expect(queue.sample()?.clipSeconds).toBe(pose?.clipSeconds);
    expect(queue.advance(1).map(e=>e.type)).toEqual(['finish']);
  });
});

it('a permanent skipped cue cannot block a later accepted history row',()=>{const cursor=new PresentationCursor<{id:string}>();cursor.consume('a',[],false,()=>true);const rows=[{id:'missing'},{id:'valid'}];expect(cursor.consume('a',rows,true,row=>row.id==='missing'?'skipped':'accepted')).toBe(2);expect(cursor.consume('a',rows,true,()=>true)).toBe(0);});
