// PROPOSAL contract test for arena-match-3v3-1. No host implements 3v3 yet; this pins the wire shape and lifecycle invariants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Ajv=require('ajv'); // functions-local devDependency; CI has no rules-tests deps.
const {transactArenaMatch}=require('../lib/arena/arenaMatchStore');
const load=n=>JSON.parse(readFileSync(new URL(n,import.meta.url)));
const ajv=new Ajv({strict:false});
const request=ajv.compile(load('../../Schemas/arena-match-request-3v3-1.json'));
const reply=ajv.compile(load('../../Schemas/arena-match-3v3-1.json'));
const request1=ajv.compile(load('../../Schemas/arena-match-request-1.json'));
const reply1=ajv.compile(load('../../Schemas/arena-match-1.json'));
const fixture=load('./fixtures/arena-match-3v3/lifecycle.json');
const v1=load('./fixtures/arena-match/admitted-lifecycle.json');
const steps=fixture.steps,step=n=>steps.find(s=>s.name===n),matches=steps.filter(s=>s.reply?.match).map(s=>s.reply.match);
const HTTPS={invalid_request:'invalid-argument',unknown_match:'not-found',unavailable:'unavailable'};
const DOCUMENTED=['invalid_request','invalid_state','turn_mismatch','fighter_ko','fighter_active','not_on_team','swap_limit','send_in_required','not_over','settle_required','too_fast','turn_limit','match_expired','request_conflict','activity_conflict','insufficient_funds','holobot_ko','unknown_match','unavailable'];
const ids=team=>team.map(s=>s.fighter.holobotId);
const slots=m=>[...m.team,...m.opponentTeam];
const vitalsOf=m=>slots(m).map(s=>s.vitals);
/** ONE entry charge at the host-frozen price for its method (Holos or pass). */
const assertCharge=m=>{const r=m.entryReceipt;assert.equal(r.amount,r.method==='pass'?m.rules.entryFeePasses:m.rules.entryFeeHolos);assert.equal(r.balanceBefore-r.balanceAfter,r.amount);assert.equal(r.chargedAtMs,m.issuedAtMs);};
/** Walk the lifecycle: each step with the last accepted (non-replay) match before it. */
function walk(){const out=[];let last=null;for(const s of steps){out.push({s,last});if(s.reply?.match&&!s.reply.alreadyProcessed)last=s.reply.match;}return out;}

test('3v3 fixture: every accepted request/reply validates; refusals are callable errors with documented codes',()=>{
 assert.equal(fixture.status,'PROPOSAL');assert.match(fixture.provenance,/NO host produced it/);
 for(const s of steps){
  if(s.reply){assert.ok(request(s.request),`${s.name} ${JSON.stringify(request.errors)}`);assert.ok(reply(s.reply),`${s.name} ${JSON.stringify(reply.errors)}`);assert.equal(s.refusal,undefined);continue;}
  const code=s.refusal.details.rejectionCode;assert.equal(s.knownBad,true);assert.ok(DOCUMENTED.includes(code),code);
  assert.deepEqual(s.refusal,{code:HTTPS[code]??'failed-precondition',message:code,details:{rejectionCode:code}});
  // Only the turn-less swap is structurally invalid; every other refusal is a host ruling on a well-formed request.
  assert.equal(request(s.request),s.name!=='refused-swap-without-turn',s.name);
 }
 assert.deepEqual(steps.filter(s=>s.refusal).map(s=>s.refusal.details.rejectionCode),['invalid_state','invalid_request','invalid_request','invalid_request','turn_mismatch','fighter_ko','send_in_required','not_over','invalid_state','settle_required']);
});

test('one match, ONE entry charge at the frozen quote, three issued bots frozen as #118 snapshots',()=>{
 const issue=step('issue');assert.deepEqual(issue.request.holobotIds,['ace','kuma','shadow']);
 for(const s of steps){
  const m=s.reply?.match;
  if(s.request.matchId!==undefined)assert.equal(s.request.matchId,fixture.matchId,s.name);
  if(!m)continue;
  assert.equal(s.reply.matchId,fixture.matchId);assert.equal(m.matchId,fixture.matchId);assert.equal(m.entryReceipt.matchId,fixture.matchId);
  if(m.settlementReceipt)assert.equal(m.settlementReceipt.matchId,fixture.matchId);
 }
 const first=matches[0];
 for(const m of matches){
  assert.deepEqual(m.entryReceipt,first.entryReceipt);assert.deepEqual(m.rules,first.rules);
  assert.deepEqual(ids(m.team),issue.request.holobotIds);
  for(const [team,base] of [[m.team,first.team],[m.opponentTeam,first.opponentTeam]])team.forEach((s,i)=>{
   assert.deepEqual(Object.keys(s.fighter).sort(),['displayName','holobotId','level','tier']);
   assert.equal(s.fighter.displayName,s.fighter.holobotId.toUpperCase());assert.deepEqual(s.fighter,base[i].fighter); // frozen at issue
   assert.equal(s.slot,i);assert.deepEqual(Object.keys(s).sort(),['fighter','slot','status','vitals']);
  });
 }
 assert.equal(first.entryReceipt.method,'tokens');assertCharge(first);
 const pass=passIssued();assert.ok(reply(pass),JSON.stringify(reply.errors));assertCharge(pass.match);assert.equal(pass.match.entryReceipt.amount,1); // the pass price is a frozen quote too
 assert.equal(JSON.stringify(fixture).match(/"entryReceipt"/g).length,matches.length); // one receipt per projection, none per fighter
 assert.deepEqual(first.battle,{turn:0,phase:'ready',activeSlot:0,opponentActiveSlot:0,voluntarySwapsUsed:0,winner:null});
 assert.deepEqual(first.team[1].vitals,{currentHealth:205,maxHealth:220}); // ledger HP, not a full-HP default
});

test('turn: +1 per accepted intent; intentIds are unique; replays echo the original intent; refusals and replays change nothing',()=>{
 const seen=new Map();
 for(const {s,last} of walk()){
  if(s.request.intentId!==undefined){
   const prior=seen.get(s.request.intentId);
   // A reused intentId is only ever a byte-identical replay; never a fresh, state-changing intent.
   if(prior){assert.deepEqual(s.request,prior,s.name);assert.equal(s.reply?.alreadyProcessed,true,s.name);}
   else seen.set(s.request.intentId,s.request);
  }
  if(s.refusal){
   if(s.name==='refused-swap-without-turn')assert.equal(Object.hasOwn(s.request,'turn'),false);
   else if(s.refusal.message==='turn_mismatch')assert.notEqual(s.request.turn,last.battle.turn);
   else if(Object.hasOwn(s.request,'turn'))assert.equal(s.request.turn,last.battle.turn);
   continue;
  }
  if(s.reply.alreadyProcessed&&last){assert.deepEqual(s.reply.match,last,s.name);continue;}
  const op=s.request.operation;
  if(op==='report'||op==='swap'){
   assert.deepEqual(s.reply.intent,{intentId:s.request.intentId,operation:op,appliedTurn:last.battle.turn});
   assert.equal(s.request.turn,last.battle.turn);assert.equal(s.reply.match.battle.turn,last.battle.turn+1);
  }else{assert.equal(s.reply.intent,null);if(last)assert.equal(s.reply.match.battle.turn,last.battle.turn);}
 }
 const replay=step('swap-1-replay');assert.deepEqual(replay.request,step('swap-1-voluntary').request);assert.deepEqual(replay.reply.intent,step('swap-1-voluntary').reply.intent);
});

test('host vitals from host-resolved bout steps: no bench regen, HP never rises, KO is final, KO forces a send-in, CPU send-in is host-picked; impossible reports hit the defensive shape check',()=>{
 const everActive=new Set(['ace']);let reports=0,swaps=0;
 for(const {s,last} of walk()){
  if(!last)continue;
  const b=last.battle;
  if(s.refusal){
   if(s.refusal.message==='fighter_ko')assert.equal(last.team.find(x=>x.fighter.holobotId===s.request.holobotId).status,'ko');
   if(s.refusal.message==='invalid_state')assert.ok(['ready','over'].includes(b.phase),s.name);
   if(s.refusal.message==='send_in_required')assert.equal(b.phase,'send_in');
   if(s.refusal.message==='not_over')assert.notEqual(b.phase,'over');
   if(s.refusal.message==='settle_required')assert.deepEqual([s.request.operation,b.phase],['cancel','over']);
   if(s.request.operation==='report'&&s.refusal.message==='invalid_request'){
    // Defensive shape check, NOT the authority: an impossible report (above the stored HP, or both at 0) is refused (1v1 parity).
    const mine=last.team[b.activeSlot].vitals.currentHealth,theirs=last.opponentTeam[b.opponentActiveSlot].vitals.currentHealth;
    assert.ok(s.request.activeHealth>mine||s.request.opponentHealth>theirs||(s.request.activeHealth===0&&s.request.opponentHealth===0),s.name);
    assert.equal(request(s.request),true,'structurally valid: the host refuses it on the stored vitals');
   }
   continue;
  }
  if(s.reply.alreadyProcessed)continue;
  const m=s.reply.match,n=m.battle,op=s.request.operation;
  vitalsOf(m).forEach((v,i)=>{const was=vitalsOf(last)[i];assert.ok(v.currentHealth<=was.currentHealth,`${s.name} HP rose`);assert.equal(v.maxHealth,was.maxHealth);});
  slots(last).forEach((x,i)=>{
   const now=slots(m)[i];
   if(x.status==='ko')assert.equal(now.status,'ko');
   if(x.status==='bench'&&now.status==='bench')assert.deepEqual(now.vitals,x.vitals,`${s.name}: benched HP is frozen (benchRegen none)`);
  });
  if(op!=='report')assert.deepEqual(vitalsOf(m),vitalsOf(last),`${s.name}: only a report moves HP`);
  if(n.phase!=='over')for(const [team,at] of [[m.team,n.activeSlot],[m.opponentTeam,n.opponentActiveSlot]]){
   assert.equal(team.filter(x=>x.status==='active').length,n.phase==='send_in'&&team===m.team?0:1,s.name);
   if(!(n.phase==='send_in'&&team===m.team))assert.equal(team[at].status,'active');
  }
  if(b.phase==='send_in')assert.equal(op,'swap',`${s.name}: in send_in a swap is the only legal intent`);
  if(op==='swap'){
   swaps++;
   const to=last.team.findIndex(x=>x.fighter.holobotId===s.request.holobotId);
   assert.equal(last.team[to].status,'bench');assert.ok(['command','send_in'].includes(b.phase));
   assert.equal(n.activeSlot,to);assert.equal(n.phase,'command');everActive.add(s.request.holobotId);
   assert.equal(n.voluntarySwapsUsed,b.voluntarySwapsUsed+(b.phase==='command'?1:0));assert.ok(n.voluntarySwapsUsed<=m.rules.voluntarySwapLimit);
   if(b.phase==='command')assert.equal(m.team[b.activeSlot].status,'bench');
   assert.deepEqual(m.opponentTeam,last.opponentTeam,'a swap never touches the CPU team');assert.equal(n.opponentActiveSlot,b.opponentActiveSlot);
  }
  if(op==='report'){
   reports++;
   assert.equal(b.phase,'command',`${s.name}: report is legal only in command`);
   // Bout steps are hand-authored stand-ins for host-resolved bouts (default decision: no client-asserted HP).
   // Every KO and winner below is read from the host projection, never from the request values.
   const me=m.team[b.activeSlot],them=m.opponentTeam[b.opponentActiveSlot],meKo=me.vitals.currentHealth===0,themKo=them.vitals.currentHealth===0;
   assert.ok(!(meKo&&themKo),'a bout step never KOs both active fighters');
   assert.equal(n.activeSlot,b.activeSlot,'a bout step never moves the player\'s active slot');
   m.team.forEach((x,i)=>{if(i!==b.activeSlot)assert.deepEqual(x,last.team[i],'a report touches only the active player slot');});
   m.opponentTeam.forEach((x,i)=>{if(i!==b.opponentActiveSlot&&!(themKo&&i===n.opponentActiveSlot))assert.deepEqual(x,last.opponentTeam[i]);});
   slots(m).forEach((x,i)=>{if(i!==b.activeSlot&&i!==3+b.opponentActiveSlot)assert.deepEqual(x.vitals,slots(last)[i].vitals,`${s.name}: only the two active slots move HP`);});
   if(!themKo)assert.equal(n.opponentActiveSlot,b.opponentActiveSlot,'the CPU switches only on a KO');
   if(meKo){
    if(last.team.some(x=>x.status==='bench'))assert.equal(n.phase,'send_in');
    else assert.deepEqual([n.phase,n.winner],['over','opponent']);
   }
   if(themKo){const next=last.opponentTeam.findIndex(x=>x.status==='bench');
    if(next>=0)assert.equal(n.opponentActiveSlot,next);else assert.deepEqual([n.phase,n.winner],['over','player']);}
  }
 }
 assert.deepEqual([reports,swaps],[5,3]);
 assert.deepEqual([...everActive].sort(),['ace','kuma','shadow']);
 assert.deepEqual(step('swap-3-forced-send-in').reply.match.team[0].vitals,step('report-1-opponent-ko').reply.match.team[0].vitals); // ACE back at its benched 120
});

test('settle: outcome from the host winner, one reward quote, all three bots written to the ledger',()=>{
 const before=step('report-5-match-over').reply.match,s=step('settle'),m=s.reply.match,rec=m.settlementReceipt;
 assert.deepEqual(Object.keys(s.request).sort(),['combosCompleted','matchId','operation','perfectDefenses','schemaVersion']);
 assert.deepEqual([before.battle.phase,before.battle.winner],['over','player']);assert.equal(m.state,'settled');assert.equal(rec.outcome,'win');
 assert.deepEqual(rec.finalVitals,Object.fromEntries(m.team.map(x=>[x.fighter.holobotId,x.vitals])));
 assert.deepEqual(m.team,before.team);
 assert.deepEqual(rec.finalVitals,{ace:{currentHealth:64,maxHealth:172},kuma:{currentHealth:0,maxHealth:220},shadow:{currentHealth:0,maxHealth:150}});
 assert.deepEqual(rec.report,{combosCompleted:s.request.combosCompleted,perfectDefenses:s.request.perfectDefenses});
 const r=m.rules,bonus=1+r.comboBonus*s.request.combosCompleted+r.perfectDefenseBonus*s.request.perfectDefenses;
 assert.deepEqual(rec.settlement,{exp:Math.floor(r.exp*bonus),awardedExp:Math.floor(r.exp*bonus),holos:r.holos,syncPoints:Math.floor(r.syncPoints*bonus),
  blueprints:{holobotKey:'hare',amount:r.blueprints},experience:['ace','kuma','shadow'].map(holobotId=>({holobotId,awardedExp:Math.floor(r.exp*bonus)}))});
 assert.equal(rec.refunded,false);assert.equal(rec.refund,undefined);assert.deepEqual(m.entryReceipt,matches[0].entryReceipt);
 assert.deepEqual(step('settle-replay').reply,{...s.reply,alreadyProcessed:true});assert.deepEqual(step('resume-terminal').reply.match,m);
});

/** Synthetic projections built from fixture steps, for paths the hand-authored lifecycle does not walk. */
function lossOver(){
 const r=structuredClone(step('swap-3-forced-send-in').reply),m=r.match;
 Object.assign(m.team[0],{status:'ko',vitals:{...m.team[0].vitals,currentHealth:0}});
 m.opponentTeam[2].vitals.currentHealth=30;
 Object.assign(m.battle,{turn:8,phase:'over',winner:'opponent'});r.intent={intentId:'lite3v3_intent_l1',operation:'report',appliedTurn:7};return r;
}
/** A match decided before expiry is still settled after expiresAtMs (state settled, no forfeit). The control reports
 * {0,0}: the proposal zeroes asserted counts on a late settle (pending Pak call 8). */
function lateSettle(){
 const r=structuredClone(step('settle').reply),m=r.match,closed=m.expiresAtMs+60000,q=m.rules;
 Object.assign(m.settlementReceipt,{closedAtMs:closed,report:{combosCompleted:0,perfectDefenses:0},settlement:{exp:q.exp,awardedExp:q.exp,holos:q.holos,syncPoints:q.syncPoints,
  blueprints:{holobotKey:'hare',amount:q.blueprints},experience:m.team.map(x=>({holobotId:x.fighter.holobotId,awardedExp:q.exp}))}});
 m.closedAtMs=closed;return r;
}
function passIssued(){
 const r=structuredClone(step('issue').reply),e=r.match.entryReceipt;
 Object.assign(e,{method:'pass',amount:r.match.rules.entryFeePasses,balanceBefore:3,balanceAfter:3-r.match.rules.entryFeePasses});return r;
}
function settledLoss(){
 const r=lossOver(),m=r.match,closed=m.issuedAtMs+30000;
 Object.assign(m,{state:'settled',closedAtMs:closed,settlementReceipt:{matchId:m.matchId,outcome:'loss',refunded:false,
  settlement:{exp:28,awardedExp:28,holos:0,syncPoints:7,blueprints:null,experience:[{holobotId:'ace',awardedExp:28}]},
  report:{combosCompleted:0,perfectDefenses:0},finalVitals:Object.fromEntries(m.team.map(x=>[x.fighter.holobotId,x.vitals])),closedAtMs:closed}});
 r.intent=null;r.alreadyProcessed=false;return r;
}
function forfeit(){
 const r=structuredClone(step('report-2-active-ko').reply),m=r.match,closed=m.issuedAtMs+9500;
 Object.assign(m,{state:'cancelled',closedAtMs:closed,settlementReceipt:{matchId:m.matchId,outcome:'forfeit',refunded:false,settlement:null,report:null,
  finalVitals:Object.fromEntries(m.team.map(x=>[x.fighter.holobotId,x.vitals])),closedAtMs:closed}});
 r.intent=null;return r;
}
function cancelledBeforeStart(){
 const r=structuredClone(step('issue').reply),c=r.match,e=c.entryReceipt;
 Object.assign(c,{state:'cancelled',closedAtMs:c.issuedAtMs+500,settlementReceipt:{matchId:c.matchId,outcome:'cancelled_before_start',refunded:true,
  refund:{method:e.method,amount:e.amount,balanceBefore:e.balanceAfter,balanceAfter:e.balanceBefore},settlement:null,report:null,finalVitals:null,closedAtMs:c.issuedAtMs+500}});
 return r;
}

test('schema refuses wrong team size, duplicate bots, client HP/STA, per-fighter charges and incoherent states',()=>{
 const issue=step('issue').request,swap=step('swap-1-voluntary').request,settle=step('settle').request;
 for(const holobotIds of [['ace','kuma'],['ace','kuma','kuma'],['ace','kuma','shadow','wolf'],['ace','kuma','SHADOW']])assert.equal(request({...issue,holobotIds}),false,String(holobotIds));
 assert.equal(request({...issue,opponentNames:['HARE','WAKE','GAMA']}),false,'the host picks the CPU team');
 assert.equal(request({...issue,levels:[4,3,2]}),false);
 const {holobotId,...bare}=swap;
 assert.equal(request({...bare,benchIndex:1}),false,'swap targets a holobotId, never a shifting bench index');
 for(const extra of [{currentHealth:205},{stamina:7},{level:3}])assert.equal(request({...swap,...extra}),false,JSON.stringify(extra));
 for(const extra of [{playerFinalHealth:64},{didWin:true},{opponentFinalHealth:0}])assert.equal(request({...settle,...extra}),false,JSON.stringify(extra));
 assert.equal(request({schemaVersion:'arena-match-3v3-1',operation:'cancel',matchId:swap.matchId,playerFinalHealth:1}),false);
 assert.equal(request({...swap,matchId:'am_'+'0'.repeat(32)}),false,'3v3 ids never collide with arena-match-1 am_ ids');
 // Positive controls for paths the lifecycle does not walk: a player wipe, a settled loss, a mid-match forfeit, a refund before start.
 for(const [name,r] of [['loss over',lossOver()],['settled loss',settledLoss()],['forfeit',forfeit()],['cancelled before start',cancelledBeforeStart()],['late settle after expiry',lateSettle()],['pass-paid issue',passIssued()]])assert.ok(reply(r),`${name} ${JSON.stringify(reply.errors)}`);
 const bad=(base,edit)=>{const r=typeof base==='string'?structuredClone(step(base).reply):base;edit(r.match,r);assert.equal(reply(r),false,edit.toString());};
 bad('start',m=>{m.team.pop();});
 bad('start',m=>{m.team[1].vitals.stamina=110;});
 bad('start',m=>{m.team[1].combat={stamina:110,maxStamina:110};}); // no open combat bag can smuggle STA
 bad('start',m=>{m.team[1].fighter.currentHealth=205;});
 bad('start',m=>{m.team[1].entryReceipt=m.entryReceipt;});
 bad('start',m=>{m.entryReceipts=[m.entryReceipt,m.entryReceipt,m.entryReceipt];});
 bad('start',m=>{[m.team[0],m.team[1]]=[m.team[1],m.team[0]];});
 bad('start',m=>{m.team[1].vitals.currentHealth=0;});
 bad('start',m=>{delete m.rules.entryFeePasses;});
 bad('report-2-active-ko',m=>{m.team[1].vitals.currentHealth=5;});
 bad('report-5-match-over',m=>{m.battle.winner=null;});
 bad('start',m=>{m.battle.winner='player';});
 bad('issue',m=>{m.battle.phase='command';});
 bad('start',m=>{m.rules.benchRegen='per_second';});
 bad('settle',m=>{m.settlementReceipt.outcome='forfeit';});
 bad('settle',m=>{delete m.settlementReceipt.finalVitals.shadow;});
 bad('settle',(m,r)=>{r.intent={intentId:'lite3v3_intent_99',operation:'settle',appliedTurn:8};});
 // Active slot, status and winner are coupled (CON6).
 bad('swap-1-voluntary',m=>{m.battle.activeSlot=0;});                                 // activeSlot on a benched fighter
 bad('start',m=>{m.team[1].status='active';});                                       // two actives in command
 bad('start',m=>{m.team[0].status='bench';});                                        // no active in command
 bad('report-2-active-ko',m=>{m.battle.phase='command';});                           // active slot is KO'd in command
 bad('swap-2-forced-send-in',m=>{m.battle.phase='send_in';});                        // send_in while the active fighter lives
 bad('report-4-active-ko',m=>{m.team[0].status='ko';m.team[0].vitals.currentHealth=0;}); // send_in with no living bench
 bad('report-1-opponent-ko',m=>{m.battle.opponentActiveSlot=0;});                    // CPU active slot on a KO'd fighter
 bad('report-5-match-over',m=>{m.opponentTeam[2]={...m.opponentTeam[2],status:'bench',vitals:{...m.opponentTeam[2].vitals,currentHealth:40}};}); // player wins with a CPU alive
 bad(lossOver(),m=>{m.battle.winner='player';});                                     // wipe recorded as a player win
 bad('report-5-match-over',m=>{m.team[0]={...m.team[0],status:'ko',vitals:{...m.team[0].vitals,currentHealth:0}};}); // double wipe recorded as a player win
 bad(lossOver(),m=>{m.opponentTeam[2]={...m.opponentTeam[2],status:'ko',vitals:{...m.opponentTeam[2].vitals,currentHealth:0}};}); // double wipe recorded as a CPU win
 bad(lateSettle(),m=>{m.state='expired';m.settlementReceipt.outcome='forfeit';m.settlementReceipt.settlement=null;}); // a decided result never expires into a forfeit
 // Terminal state, outcome, winner and start are coupled (CON3, CON4, CON5).
 bad('settle',m=>{m.state='cancelled';});                                            // cancelled match paying a win
 bad(settledLoss(),m=>{m.settlementReceipt.outcome='win';});                         // win paid against the host's opponent winner
 bad(settledLoss(),m=>{m.settlementReceipt.settlement.holos=100;});                  // a loss paying win-only Holos
 bad(settledLoss(),m=>{m.settlementReceipt.settlement.blueprints={holobotKey:'hare',amount:5};});
 bad(cancelledBeforeStart(),m=>{m.startedAtMs=m.issuedAtMs+60;m.battle.phase='command';}); // refund after start
 bad(forfeit(),m=>{m.startedAtMs=null;Object.assign(m.battle,{phase:'ready',turn:0,activeSlot:0});m.team[0].status='active';}); // forfeit before start keeps the charge
 bad(forfeit(),m=>{Object.assign(m,structuredClone(lossOver().match),{state:'cancelled',closedAtMs:m.closedAtMs,settlementReceipt:m.settlementReceipt});}); // forfeit over a decided result
 const noRefund=cancelledBeforeStart();delete noRefund.match.settlementReceipt.refund;assert.equal(reply(noRefund),false);
 // Receipt else-branch and envelope rules (each targets one clause).
 const refundOf=m=>({method:m.entryReceipt.method,amount:m.entryReceipt.amount,balanceBefore:m.entryReceipt.balanceAfter,balanceAfter:m.entryReceipt.balanceBefore});
 bad(forfeit(),m=>{Object.assign(m.settlementReceipt,{refunded:true,refund:refundOf(m)});});  // a forfeit that also refunds
 bad('settle',m=>{Object.assign(m.settlementReceipt,{refunded:true,refund:refundOf(m)});});    // a win that also refunds
 bad(forfeit(),m=>{m.settlementReceipt.refund=refundOf(m);});                                 // a refund object on a forfeit
 bad('settle',m=>{m.settlementReceipt.refunded=true;});                                       // a win marked refunded
 bad(forfeit(),m=>{m.settlementReceipt.finalVitals=null;});                                   // a forfeit that writes no vitals
 bad(forfeit(),m=>{m.settlementReceipt.report={combosCompleted:0,perfectDefenses:0};});       // a forfeit carries no counts
 bad('settle',m=>{m.startedAtMs=null;});                                                      // settled but never started
 bad('start',(m,r)=>{r.matchId=null;});                                                       // a match without its envelope id
 bad('resume-empty',(m,r)=>{r.intent={intentId:'lite3v3_intent_02',operation:'swap',appliedTurn:1};}); // an empty reply with an intent echo
 bad('resume-empty',(m,r)=>{r.matchId=fixture.matchId;});                                      // an empty reply with a match id
 // One probe per remaining clause (a clause-level mutation sweep found these otherwise unpinned).
 const forfeitFromStart=()=>{const r=structuredClone(step('start').reply),m=r.match,closed=m.issuedAtMs+900;
  Object.assign(m,{state:'cancelled',closedAtMs:closed,settlementReceipt:{matchId:m.matchId,outcome:'forfeit',refunded:false,settlement:null,report:null,
   finalVitals:Object.fromEntries(m.team.map(x=>[x.fighter.holobotId,x.vitals])),closedAtMs:closed}});r.intent=null;return r;};
 assert.ok(reply(forfeitFromStart()),JSON.stringify(reply.errors));
 const cbsReceipt=m=>({matchId:m.matchId,outcome:'cancelled_before_start',refunded:true,refund:refundOf(m),settlement:null,report:null,finalVitals:null,closedAtMs:m.issuedAtMs+500});
 bad(cancelledBeforeStart(),m=>{m.settlementReceipt.report={combosCompleted:0,perfectDefenses:0};}); // a refund carries no counts
 bad(cancelledBeforeStart(),m=>{m.settlementReceipt.finalVitals=Object.fromEntries(m.team.map(x=>[x.fighter.holobotId,x.vitals]));}); // a refund writes no vitals
 bad(cancelledBeforeStart(),m=>{m.startedAtMs=m.issuedAtMs+60;});                             // a refund after start (phase still ready)
 bad(cancelledBeforeStart(),m=>{m.battle.phase='command';});                                  // a refund in command (never started)
 bad(cancelledBeforeStart(),m=>{m.battle.turn=3;});                                           // a refund after turns
 bad('issue',m=>{m.startedAtMs=m.issuedAtMs+60;});                                            // issued but started
 bad('issue',m=>{m.closedAtMs=m.issuedAtMs+60;});                                             // issued but closed
 bad('issue',m=>{m.settlementReceipt=cbsReceipt(m);});                                        // issued with a receipt
 bad('start',m=>{m.startedAtMs=null;});                                                       // active but never started
 bad('start',m=>{m.closedAtMs=m.startedAtMs+1;});                                             // active but closed
 bad('start',m=>{m.settlementReceipt=forfeitFromStart().match.settlementReceipt;});           // active with a receipt
 bad(forfeit(),m=>{m.startedAtMs=null;});                                                     // a forfeit that never started (phase send_in)
 bad(forfeitFromStart(),m=>{m.battle.phase='ready';});                                        // a forfeit in ready
 bad('settle',m=>{m.settlementReceipt.outcome='loss';Object.assign(m.settlementReceipt.settlement,{holos:0,blueprints:null});}); // loss recorded against a player win
 bad(lossOver(),m=>{m.team[0]={...m.team[0],status:'bench',vitals:{...m.team[0].vitals,currentHealth:10}};}); // opponent wins while a player fighter lives
 bad('start',m=>{m.battle.phase='ready';});                                         // active state never returns to ready
 bad('issue',m=>{m.battle.turn=4;});                                                 // issued means turn 0
 bad(forfeit(),m=>{m.settlementReceipt=null;});                                     // a cancelled match carries a receipt
 bad(cancelledBeforeStart(),m=>{m.settlementReceipt.refunded=false;});               // a refund is marked refunded
 bad('settle',m=>{m.settlementReceipt.report=null;});                                // a win carries its report
 bad('settle',m=>{m.closedAtMs=null;});                                             // terminal without a close time
 bad('settle',m=>{Object.assign(m.battle,{phase:'command',winner:null});m.opponentTeam[2]={...m.opponentTeam[2],status:'active',vitals:{...m.opponentTeam[2].vitals,currentHealth:40}};}); // settled before the match is over
 bad('settle',m=>{m.settlementReceipt.settlement=null;});                            // a win with no settlement
 bad(forfeit(),m=>{m.settlementReceipt.settlement={exp:1,awardedExp:1,holos:0,syncPoints:0,blueprints:null,experience:[{holobotId:'ace',awardedExp:1}]};}); // a forfeit that pays
 // One targeted violation per slot index for each slot-coupled rule (only that rule can refuse it).
 const roster=(team,statusOf)=>team.map((x,i)=>{const st=statusOf(i);return {...x,status:st,vitals:{...x.vitals,currentHealth:st==='ko'?0:x.vitals.maxHealth}};});
 for(const k of [0,1,2]){
  bad('start',m=>{m.battle.activeSlot=k;m.team=roster(m.team,i=>i===(k+1)%3?'active':'bench');});              // command: team[activeSlot] is not the active one
  bad('report-2-active-ko',m=>{m.battle.activeSlot=k;m.team=roster(m.team,i=>i===(k+1)%3?'ko':'bench');});     // send_in: team[activeSlot] is not KO'd
  bad('start',m=>{m.battle.opponentActiveSlot=k;m.opponentTeam=roster(m.opponentTeam,i=>i===(k+1)%3?'active':'bench');}); // CPU active slot mismatch
 }
});

test('arena-match-1 schemas are byte-pinned and untouched; the versions never cross; the deployed host refuses every 3v3 request today',async()=>{
 const sha=n=>createHash('sha256').update(readFileSync(new URL(`../../Schemas/${n}.json`,import.meta.url))).digest('hex');
 assert.equal(sha('arena-match-1'),'54f43d39f486950fe2757430d80d1e26a2fbf266a712c5eb25276686faaa40ba'); // F10 arena-match-schema-f10: fighters require name, rank, stats, commandRules and moves (the host already sent them)
 assert.equal(sha('arena-match-request-1'),'26a90ffcd880c3026632ee95d32a6f7d2842a767ed50ab291bd38c17eaea0ac6');
 for(const s of v1.steps){assert.ok(request1(s.request));assert.ok(reply1(s.reply));assert.equal(request(s.request),false);assert.equal(reply(s.reply),false);}
 for(const s of steps){assert.equal(request1(s.request),false,s.name);if(s.reply)assert.equal(reply1(s.reply),false,s.name);}
 // The runtime checks schemaVersion before touching Firestore, so every 3v3 request (resume and refusals included) is invalid_request (HELD, honest).
 for(const s of steps)await assert.rejects(transactArenaMatch(null,'uid_fixture',s.request,1792300000000),e=>e.code==='invalid_request',s.name);
});
