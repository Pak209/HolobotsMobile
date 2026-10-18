// PROPOSAL contract test for arena-match-3v3-1. No host implements 3v3 yet; this pins the wire shape and lifecycle invariants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
const DOCUMENTED=['invalid_request','invalid_state','turn_mismatch','fighter_ko','fighter_active','not_on_team','swap_limit','send_in_required','not_over','match_expired','request_conflict','activity_conflict','insufficient_funds','holobot_ko','unknown_match','unavailable'];
const ids=team=>team.map(s=>s.fighter.holobotId);
const vitalsOf=m=>[...m.team,...m.opponentTeam].map(s=>s.vitals);
/** Walk the lifecycle: each step with the last accepted match before it. */
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
 assert.deepEqual(steps.filter(s=>s.refusal).map(s=>s.refusal.details.rejectionCode),['invalid_state','invalid_request','turn_mismatch','fighter_ko','send_in_required','not_over']);
});

test('one match, ONE entry charge, three issued bots frozen as #118 snapshots',()=>{
 const issue=step('issue');assert.deepEqual(issue.request.holobotIds,['ace','kuma','shadow']);
 assert.equal(new Set(steps.map(s=>s.reply?.matchId).filter(Boolean)).size,1);
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
 const r=first.entryReceipt;assert.equal(r.method,'tokens');assert.equal(r.amount,first.rules.entryFeeHolos);assert.equal(r.balanceBefore-r.balanceAfter,r.amount);assert.equal(r.chargedAtMs,first.issuedAtMs);
 assert.equal(JSON.stringify(fixture).match(/"entryReceipt"/g).length,matches.length); // one receipt per projection, none per fighter
 assert.deepEqual(first.battle,{turn:0,phase:'ready',activeSlot:0,opponentActiveSlot:0,voluntarySwapsUsed:0,winner:null});
 assert.deepEqual(first.team[1].vitals,{currentHealth:205,maxHealth:220}); // ledger HP, not a full-HP default
});

test('turn: +1 per accepted intent; replays echo the original intent; refusals and replays change nothing',()=>{
 for(const {s,last} of walk()){
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

test('host vitals: no bench regen, HP never rises, KO is final, KO forces a send-in, CPU send-in is host-picked',()=>{
 const everActive=new Set(['ace']);
 for(const {s,last} of walk()){
  if(!last)continue;
  const b=last.battle;
  if(s.refusal){
   if(s.refusal.message==='fighter_ko')assert.equal(last.team.find(x=>x.fighter.holobotId===s.request.holobotId).status,'ko');
   if(s.refusal.message==='invalid_state')assert.equal(b.phase,'ready');
   if(s.refusal.message==='send_in_required')assert.equal(b.phase,'send_in');
   if(s.refusal.message==='not_over')assert.notEqual(b.phase,'over');
   continue;
  }
  if(s.reply.alreadyProcessed)continue;
  const m=s.reply.match,n=m.battle;
  vitalsOf(m).forEach((v,i)=>{const was=vitalsOf(last)[i];assert.ok(v.currentHealth<=was.currentHealth,`${s.name} HP rose`);assert.equal(v.maxHealth,was.maxHealth);});
  [...last.team,...last.opponentTeam].forEach((x,i)=>{if(x.status==='ko')assert.equal([...m.team,...m.opponentTeam][i].status,'ko');});
  if(n.phase!=='over')for(const [team,at] of [[m.team,n.activeSlot],[m.opponentTeam,n.opponentActiveSlot]]){
   assert.equal(team.filter(x=>x.status==='active').length,n.phase==='send_in'&&team===m.team?0:1,s.name);
   if(!(n.phase==='send_in'&&team===m.team))assert.equal(team[at].status,'active');
  }
  if(s.request.operation==='swap'){
   const to=last.team.findIndex(x=>x.fighter.holobotId===s.request.holobotId);
   assert.equal(last.team[to].status,'bench');assert.ok(['command','send_in'].includes(b.phase));
   assert.deepEqual(vitalsOf(m),vitalsOf(last),'a swap never changes any HP');
   assert.equal(n.activeSlot,to);assert.equal(n.phase,'command');everActive.add(s.request.holobotId);
   assert.equal(n.voluntarySwapsUsed,b.voluntarySwapsUsed+(b.phase==='command'?1:0));assert.ok(n.voluntarySwapsUsed<=m.rules.voluntarySwapLimit);
   if(b.phase==='command')assert.equal(m.team[b.activeSlot].status,'bench');
  }
  if(s.request.operation==='report'){
   const me=m.team[b.activeSlot],them=m.opponentTeam[b.opponentActiveSlot];
   assert.equal(me.vitals.currentHealth,s.request.activeHealth);assert.equal(them.vitals.currentHealth,s.request.opponentHealth);
   last.team.forEach((x,i)=>{if(i!==b.activeSlot)assert.deepEqual(m.team[i].vitals,x.vitals,'bench HP is frozen');});
   if(s.request.activeHealth===0)assert.equal(n.phase,last.team.some(x=>x.status==='bench')?'send_in':'over');
   if(s.request.opponentHealth===0){const next=last.opponentTeam.findIndex(x=>x.status==='bench');
    if(next>=0)assert.equal(n.opponentActiveSlot,next);else assert.deepEqual([n.phase,n.winner],['over','player']);}
  }
 }
 assert.deepEqual([...everActive].sort(),['ace','kuma','shadow']);
 assert.deepEqual(step('swap-3-forced-send-in').reply.match.team[0].vitals,step('report-1-opponent-ko').reply.match.team[0].vitals); // ACE back at its benched 120
});

test('settle: host-derived outcome, one reward quote, all three bots written to the ledger',()=>{
 const before=step('report-5-match-over').reply.match,s=step('settle'),m=s.reply.match,rec=m.settlementReceipt;
 assert.deepEqual(Object.keys(s.request).sort(),['combosCompleted','matchId','operation','perfectDefenses','schemaVersion']);
 assert.deepEqual([before.battle.phase,before.battle.winner],['over','player']);assert.equal(m.state,'settled');assert.equal(rec.outcome,'win');
 assert.deepEqual(rec.finalVitals,Object.fromEntries(before.team.map(x=>[x.fighter.holobotId,x.vitals])));
 assert.deepEqual(rec.finalVitals,{ace:{currentHealth:64,maxHealth:172},kuma:{currentHealth:0,maxHealth:220},shadow:{currentHealth:0,maxHealth:150}});
 const r=m.rules,bonus=1+r.comboBonus*s.request.combosCompleted+r.perfectDefenseBonus*s.request.perfectDefenses;
 assert.deepEqual(rec.settlement,{exp:Math.floor(r.exp*bonus),awardedExp:Math.floor(r.exp*bonus),holos:r.holos,syncPoints:Math.floor(r.syncPoints*bonus),
  blueprints:{holobotKey:'hare',amount:r.blueprints},experience:['ace','kuma','shadow'].map(holobotId=>({holobotId,awardedExp:Math.floor(r.exp*bonus)}))});
 assert.equal(rec.refunded,false);assert.equal(rec.refund,undefined);assert.deepEqual(m.entryReceipt,matches[0].entryReceipt);
 assert.deepEqual(step('settle-replay').reply,{...s.reply,alreadyProcessed:true});assert.deepEqual(step('resume-terminal').reply.match,m);
});

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
 const bad=(name,edit)=>{const r=structuredClone(step(name).reply);edit(r.match,r);assert.equal(reply(r),false,edit.toString());};
 bad('start',m=>{m.team.pop();});
 bad('start',m=>{m.team[1].vitals.stamina=110;});
 bad('start',m=>{m.team[1].fighter.currentHealth=205;});
 bad('start',m=>{m.team[1].entryReceipt=m.entryReceipt;});
 bad('start',m=>{m.entryReceipts=[m.entryReceipt,m.entryReceipt,m.entryReceipt];});
 bad('start',m=>{[m.team[0],m.team[1]]=[m.team[1],m.team[0]];});
 bad('start',m=>{m.team[1].vitals.currentHealth=0;});
 bad('report-2-active-ko',m=>{m.team[1].vitals.currentHealth=5;});
 bad('report-5-match-over',m=>{m.battle.winner=null;});
 bad('start',m=>{m.battle.winner='player';});
 bad('issue',m=>{m.battle.phase='command';});
 bad('start',m=>{m.rules.benchRegen='per_second';});
 bad('settle',m=>{m.settlementReceipt.outcome='forfeit';});
 bad('settle',m=>{delete m.settlementReceipt.finalVitals.shadow;});
 bad('settle',(m,r)=>{r.intent={intentId:'lite3v3_intent_99',operation:'settle',appliedTurn:8};});
 // A cancel-before-start receipt (one refund of the one charge) is expressible; without the refund it is not.
 const cancelled=structuredClone(step('issue').reply),c=cancelled.match,e=c.entryReceipt;
 Object.assign(c,{state:'cancelled',closedAtMs:c.issuedAtMs+500,settlementReceipt:{matchId:c.matchId,outcome:'cancelled_before_start',refunded:true,
  refund:{method:e.method,amount:e.amount,balanceBefore:e.balanceAfter,balanceAfter:e.balanceBefore},settlement:null,report:null,finalVitals:null,closedAtMs:c.issuedAtMs+500}});
 assert.ok(reply(cancelled),JSON.stringify(reply.errors));delete c.settlementReceipt.refund;assert.equal(reply(cancelled),false);
});

test('arena-match-1 is untouched; the versions never cross; the deployed host refuses 3v3 today',async()=>{
 for(const s of v1.steps){assert.ok(request1(s.request));assert.ok(reply1(s.reply));assert.equal(request(s.request),false);assert.equal(reply(s.reply),false);}
 for(const s of steps){assert.equal(request1(s.request),false,s.name);if(s.reply)assert.equal(reply1(s.reply),false,s.name);}
 // The runtime checks schemaVersion before touching Firestore, so a 3v3 request is refused as invalid_request (HELD, honest).
 for(const s of steps.filter(x=>x.reply&&x.request.operation!=='resume').concat(step('refused-swap-to-ko')))
  await assert.rejects(transactArenaMatch(null,'uid_fixture',s.request,1792300000000),e=>e.code==='invalid_request',s.name);
});
