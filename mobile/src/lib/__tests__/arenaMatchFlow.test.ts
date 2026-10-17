import {describe,it,expect,vi} from 'vitest';
import {ArenaMatchFlow,readArenaReply,arenaReceiptResult,type ArenaIssue} from '../arenaMatchFlow';
import fixture from '../../qa/fixtures/arena-admitted-lifecycle.json';
const issued=fixture.steps.find(s=>s.request.operation==='issue')!.reply;
const started=fixture.steps.find(s=>s.request.operation==='start')!.reply;
const settled=fixture.steps.find(s=>s.request.operation==='settle')!.reply;
const input=fixture.steps.find(s=>s.request.operation==='issue')!.request as ArenaIssue;
const issue: ArenaIssue={requestId:input.requestId,tierId:input.tierId,paymentMethod:input.paymentMethod,holobotId:input.holobotId,opponentName:input.opponentName};
function setup(call:(r:Record<string,unknown>)=>Promise<unknown>){let pending:ArenaIssue|null=null;let active=true;const flow=new ArenaMatchFlow(call,{get:async()=>pending,set:async v=>{pending=v;}},()=>active);return {flow,pending:()=>pending,signout:()=>{active=false;flow.close();}};}
describe('durable Arena match controller',()=>{
 it('constructs without charging and discovery only resumes',async()=>{const call=vi.fn(async()=>issued);const {flow}=setup(call);expect(call).not.toHaveBeenCalled();await flow.resume();expect(call).toHaveBeenCalledWith({schemaVersion:'arena-match-1',operation:'resume'});});
 it('retains uncertain issue request and retries same identity after lost reply',async()=>{const call=vi.fn().mockRejectedValueOnce(Error('timeout')).mockResolvedValue(issued);const {flow,pending}=setup(call);await expect(flow.issue(issue)).rejects.toThrow('timeout');expect(pending()).toEqual(issue);await flow.retryIssue();expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);expect(pending()).toBeNull();});
 it('blocks a second issue while one is pending and rejects foreign admission',async()=>{const {flow}=setup(async()=>{throw Error('timeout');});await expect(flow.issue(issue)).rejects.toThrow();await expect(flow.issue({...issue,requestId:'different_request'})).rejects.toThrow('arena_issue_pending');const foreign=structuredClone(issued);foreign.match!.requestId='foreign';const a=setup(async()=>foreign);await expect(a.flow.issue(issue)).rejects.toThrow('arena_issue_mismatch');expect(a.flow.reply).toBeNull();});
 it('single-flight and sign-out prevent stale mutation',async()=>{let done!:(v:unknown)=>void;const {flow,signout}=setup(()=>new Promise(resolve=>{done=resolve;}));const pending=flow.resume();await Promise.resolve();await expect(flow.resume()).rejects.toThrow('arena_busy');signout();done(issued);await expect(pending).rejects.toThrow('arena_session_changed');expect(flow.reply).toBeNull();});
 it('start settle and terminal replay preserve match id, snapshots and host receipt',async()=>{const call=vi.fn().mockResolvedValueOnce(issued).mockResolvedValueOnce(started).mockResolvedValue(settled);const {flow}=setup(call);await flow.resume();await flow.start();const report={playerFinalHealth:30,opponentFinalHealth:0,combosCompleted:0,perfectDefenses:0};const a=await flow.settle(report),b=await flow.settle(report);expect(a).toEqual(b);expect(a.match?.settlementReceipt).toEqual(settled.match?.settlementReceipt);expect(call.mock.calls.slice(1).every(([r])=>r.matchId===issued.matchId)).toBe(true);});
 it('rejects foreign reply ID and changed frozen fighter on reconnect',async()=>{const changed=structuredClone(started);changed.match!.opponent.attack++;const {flow}=setup(vi.fn().mockResolvedValueOnce(issued).mockResolvedValueOnce(changed));await flow.resume();await expect(flow.start()).rejects.toThrow('arena_snapshot_changed');expect(()=>readArenaReply(issued,'am_'+'f'.repeat(32))).toThrow('arena_reply_invalid');});
 it('pins resume to the known admission instead of discovering a different match',async()=>{const call=vi.fn(async(_r:Record<string,unknown>)=>issued);const {flow}=setup(call);await flow.resume();await flow.resume();expect(call.mock.calls[1][0]).toEqual({schemaVersion:'arena-match-1',operation:'resume',matchId:issued.matchId});});
 it('uses only terminal host payout and does not infer a local result',()=>{
  expect(()=>arenaReceiptResult(readArenaReply(issued))).toThrow('arena_result_unavailable');
  expect(arenaReceiptResult(readArenaReply(settled))).toMatchObject({didWin:true,rewards:{holos:100}});
 });
 it('accepts Firestore field order changes but binds tier and payment',async()=>{
  const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;
  const {flow}=setup(vi.fn().mockResolvedValueOnce(issued).mockResolvedValueOnce(reorder(started)));await flow.resume();await expect(flow.start()).resolves.toMatchObject({matchId:issued.matchId});
  for(const kind of ['tier','payment']){const bad=structuredClone(issued) as any;if(kind==='tier')bad.match.tierId='elite';else bad.match.entryReceipt.method='pass';await expect(setup(async()=>bad).flow.issue(issue)).rejects.toThrow('arena_issue_mismatch');}
  expect(()=>readArenaReply({schemaVersion:'arena-match-1',matchId:null,match:null,alreadyProcessed:false})).toThrow();
 });
 it('rejects malformed snapshot and terminal receipt instead of local fallback',()=>{for(const field of ['level','moves','commandRules','displayName']){const copy=structuredClone(issued) as any;delete copy.match.opponent[field];expect(()=>readArenaReply(copy)).toThrow();}const copy=structuredClone(settled) as any;copy.match.settlementReceipt.matchId='foreign';expect(()=>readArenaReply(copy)).toThrow();});
});
