import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {T, CONFIG, profile} from './zone-expedition-fixtures.mjs';
import {recordFightLog, smartPlayer} from './lib/fight-replay-helpers.mjs';
const require=createRequire(import.meta.url);
const Z=require('../lib/holozone/expedition.js');
const {verifyFightReplay}=require('../lib/sim/fight/replay.js');
const pilot=()=>profile({holobots:['ACE','KUMA','SHADOW'].map(name=>({name,level:10}))});
function state(seed=1){const p=pilot(),i=Z.issueExpedition(p,{schemaVersion:'zone-run-6',repairKits:2,carryExtractionCharge:true},'test_run',seed,T,CONFIG);return {p:{...p,...i.updates},r:i.run};}
function step(s,op,extra={},at=T+1000,receipt){const x=Z.advanceRealtimeExpedition(s.p,s.r,{schemaVersion:'zone-run-6',operation:op,...extra},at,receipt);s.p={...s.p,...x.updates};s.r=x.run;return x;}
function enter(s){step(s,'move',{sectorId:'gate1'});const sector=s.r.layout.sectors.find(x=>x.band===1&&!x.safe&&x.cache);step(s,'move',{sectorId:sector.id});return sector;}
test('known bad: legacy fight accepts resolver intents; zone-run-6 rejects it and requires duel-inputs-2',()=>{
 const s=state();enter(s);
 assert.equal(Z.validateExpeditionCommand({schemaVersion:'zone-run-3',operation:'fight',runId:'test_run',requestId:'r',playerIntents:['strike']}).operation,'fight');
 assert.throws(()=>Z.validateExpeditionCommand({schemaVersion:'zone-run-6',operation:'engage',runId:'test_run',requestId:'r'}),/client_update_required/);
 assert.throws(()=>step(s,'fight',{playerIntents:['strike']}),/client_update_required/);
});
test('engage pins WOLF CPU, relative band levels, stamina, host seed and one pending fight',()=>{
 const s=state();const at=enter(s);s.r.squad[0].staminaPm=420;
 const x=step(s,'engage',{duelInputs:'duel-inputs-2'});
 assert.equal(x.fightIssue.encounter.sectorId,at.id);assert.equal(x.fightIssue.cpu.roster[0].holobotId,'wolf');
 assert.equal(Z.threat(s.r,at).level,8);assert.equal(x.fightIssue.rules.fighters[0].startStaminaPm,420);
 assert.equal(x.fightIssue.rules.rules.hpScaleLights,19);assert.equal(s.r.energy,80);
 assert.equal(Z.runView(s.r,'zone-run-6').pendingFight.fightId,`ef_test_run_${at.id}`);
 assert.throws(()=>step(s,'move',{sectorId:'gate1'}),/fight_pending/);
 assert.throws(()=>step(s,'heal',{holobotId:'ace'}),/fight_pending/);
 assert.throws(()=>step(s,'flee',{fightId:'wrong'}),/no_pending_fight/);
});
test('zero energy after sector entry never disables a live encounter',()=>{
 const s=state();enter(s);s.r.energy=0;const x=step(s,'engage',{duelInputs:'duel-inputs-2'});
 assert.equal(s.r.energy,0);assert.equal(x.fightIssue.mode,'input-log');
});
test('verified receipt alone carries HP/STA; loss wipes; replay idempotent',()=>{
 const s=state();enter(s);const x=step(s,'engage',{duelInputs:'duel-inputs-2'});
 const client=recordFightLog(x.fightIssue,smartPlayer(x.fightIssue));
 const receipt=verifyFightReplay(x.fightIssue,client.wire,{battleId:s.r.pendingFight.fightId}).receipt;
 const settle=step(s,'fight_settle',{fightId:receipt.battleId,inputLog:client.wire},T+120000,receipt);
 assert.equal(settle.fightReceipt.verified,true);
 assert.deepEqual(settle.encounterResult.carry.map(c=>c.staminaPm),s.r.squad.map(b=>b.staminaPm));
 if(receipt.winner==='player')assert.ok(s.r.cleared.includes(s.r.sectorId));else {assert.equal(s.r.state,'closed');assert.equal(s.r.receipt.outcome,'wipe');}
 const before=s.r.revision;
 if(s.r.state==='open'){const again=step(s,'fight_settle',{fightId:receipt.battleId,inputLog:client.wire},T+120100);assert.equal(again.fightReceipt.battleId,receipt.battleId);assert.equal(s.r.revision,before);}
});
test('flee and reconnect use one seeded free attempt; failure resumes same issue without another charge',()=>{
 for(let seed=1;seed<=8;seed++){
  const s=state(seed);enter(s);const x=step(s,'engage',{duelInputs:'duel-inputs-2'});const energy=s.r.energy;
  const a=step(s,'resume',{fightId:s.r.pendingFight.fightId},T+2000);
  assert.equal(s.r.energy,energy);
  if(a.fightIssue){assert.deepEqual(a.fightIssue,x.fightIssue);assert.equal(Z.runView(s.r,'zone-run-6').pendingFight.fleeAttempted,true);assert.throws(()=>step(s,'flee',{fightId:`ef_test_run_${s.r.sectorId}`},T+3000),/flee_already_attempted/);
   const b=step(s,'resume',{fightId:`ef_test_run_${s.r.sectorId}`},T+3000);assert.deepEqual(b.fightIssue,x.fightIssue);}
  else assert.equal(a.encounterResult.outcome,'fled');
 }
});
test('safe room restores STA, field travel recovers 250, old run shape unchanged',()=>{
 const s=state();s.r.squad[0].staminaPm=100;step(s,'move',{sectorId:'gate1'});assert.equal(s.r.squad[0].staminaPm,1000);
 const at=s.r.layout.sectors.find(x=>x.band===1&&!x.safe);step(s,'move',{sectorId:at.id});s.r.squad[0].staminaPm=100;step(s,'move',{sectorId:'gate1'});assert.equal(s.r.squad[0].staminaPm,1000);
 const legacy=Z.issueExpedition(pilot(),{repairKits:0,carryExtractionCharge:false},'legacy',1,T,CONFIG).run;
 assert.equal('pendingFight' in Z.runView(legacy),false);assert.equal('staminaPm' in Z.runView(legacy).squad[0],false);
});
test('too-fast verified win and expired settle refuse without consuming the run',()=>{
 const s=state();enter(s);const x=step(s,'engage',{duelInputs:'duel-inputs-2'});
 const client=recordFightLog(x.fightIssue,smartPlayer(x.fightIssue));
 const receipt=verifyFightReplay(x.fightIssue,client.wire,{battleId:s.r.pendingFight.fightId}).receipt;
 assert.equal(receipt.winner,'player');
 assert.throws(()=>step(s,'fight_settle',{fightId:receipt.battleId,inputLog:client.wire},T+1001,receipt),/too_fast/);
 assert.throws(()=>step(s,'fight_settle',{fightId:receipt.battleId,inputLog:client.wire},T+300000,receipt),/fight_expired/);
 assert.ok(s.r.pendingFight);assert.equal(s.r.cleared.length,0);
});
test('a host-computed loss wipes unprotected haul and all bot HP',()=>{
 const s=state();enter(s);s.r.haul=[{id:'protected',kind:'blueprint_fragment',amount:1,protected:true},{id:'bulky',kind:'bulky_salvage',amount:1,protected:false}];
 const x=step(s,'engage',{duelInputs:'duel-inputs-2'});
 // Pure transition test only: the callable obtains this value exclusively from verifyFightReplay.
 const loss={battleId:s.r.pendingFight.fightId,rulesHash:x.fightIssue.rulesHash,seed:x.fightIssue.seed,winner:'opponent',endTick:300,
  playerFinal:s.r.squad.map(b=>({holobotId:b.holobotId,currentHealth:0,staminaPm:0,fielded:true}))};
 const settled=step(s,'fight_settle',{fightId:loss.battleId,inputLog:{}},T+30000,loss);
 assert.equal(s.r.state,'closed');assert.equal(s.r.receipt.outcome,'wipe');assert.deepEqual(s.r.receipt.banked.map(x=>x.id),['protected']);
 assert.deepEqual(settled.encounterResult.carry.map(x=>x.currentHealth),[0,0,0]);
});

test('zone-run-6 schema validates issue, engage, settle and carries the same JSON bytes into Unity mirror',async()=>{
 const {readFileSync}=require('node:fs');const {ajv2020}=await import('./lib/ajv2020.mjs');
 const ajv=ajv2020();
 for(const n of ['duel-intents-1','duel-receipt-1','duel-receipt-2','zone-extract-1','zone-run-3','zone-run-6'])ajv.addSchema(JSON.parse(readFileSync(new URL(`../../Schemas/${n}.json`,import.meta.url))));
 const schema=ajv.getSchema('zone-run-6');
 const s=state();enter(s);const x=step(s,'engage',{duelInputs:'duel-inputs-2'});
 const request={schemaVersion:'zone-run-6',operation:'engage',requestId:'req1',runId:s.r.runId,duelInputs:'duel-inputs-2'};
 assert.equal(schema(request),true,JSON.stringify(schema.errors));
 const reply=Z.advanceReply('zone-run-6','engage',s.r,x,T+1000);
 assert.equal(schema(reply),true,JSON.stringify(schema.errors));
 const client=recordFightLog(x.fightIssue,smartPlayer(x.fightIssue));
 const receipt=verifyFightReplay(x.fightIssue,client.wire,{battleId:s.r.pendingFight.fightId}).receipt;
 const settled=step(s,'fight_settle',{fightId:receipt.battleId,inputLog:client.wire},T+120000,receipt);
 assert.equal(schema(Z.advanceReply('zone-run-6','fight_settle',s.r,settled,T+120000)),true,JSON.stringify(schema.errors));
 const wiped=state();enter(wiped);const issued=step(wiped,'engage',{duelInputs:'duel-inputs-2'});
 const verified=verifyFightReplay(issued.fightIssue,recordFightLog(issued.fightIssue,smartPlayer(issued.fightIssue)).wire,{battleId:wiped.r.pendingFight.fightId}).receipt;
 const loss={...verified,winner:'opponent'}; // contract shape only; callable never accepts a client-selected winner
 const closed=step(wiped,'fight_settle',{fightId:loss.battleId,inputLog:{}},T+120000,loss);
 const closedReply=Z.advanceReply('zone-run-6','fight_settle',wiped.r,closed,T+120000);
 assert.equal(closedReply.schemaVersion,'zone-run-6');
 assert.equal(schema(closedReply),true,JSON.stringify(schema.errors));
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/zone-run-6/realtime.json',import.meta.url)));
 for(const [i,row] of fixture.rows.entries())for(const side of ['request','reply'])
  assert.equal(schema(row[side]),true,`fixture ${i} ${side}: ${JSON.stringify(schema.errors)}`);
});
