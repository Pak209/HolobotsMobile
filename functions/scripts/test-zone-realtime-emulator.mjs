import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {T,CONFIG,profile} from './zone-expedition-fixtures.mjs';
import {recordFightLog,smartPlayer,scriptedPlayer} from './lib/fight-replay-helpers.mjs';
const require=createRequire(import.meta.url);
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('demo emulator required');
const {db}=require('../lib/admin.js'),{transactExpedition}=require('../lib/holozone/expeditionStore.js');
process.env.HOLOZONE_EXPEDITION_REALTIME='1';process.env.HOLOCITY_FIGHT_REPLAY='1';
let n=0;const uid=()=>`s1_${Date.now()}_${n++}`,req=()=>`r${n++}`;
const c=(operation,runId,extra={})=>({schemaVersion:'zone-run-6',operation,...(operation==='status'||operation==='layout'?{}:{requestId:req()}),...(runId?{runId}:{}),...extra});
const call=(who,cmd,now=T,seed=1)=>transactExpedition(db,who,cmd,now,{config:CONFIG,seed:()=>seed,newId:()=>`run_${who}`});
async function start(seed=1){const who=uid();await db.doc(`users/${who}`).set(profile({holobots:['ACE','KUMA','SHADOW'].map(name=>({name,level:10}))}));
 const issue=await call(who,c('issue',null,{repairKits:1,carryExtractionCharge:false,duelInputs:'duel-inputs-2'}),T,seed);const runId=issue.run.runId;
 await call(who,c('move',runId,{sectorId:'gate1'}));const at=issue.run.layout.sectors.find(x=>x.band===1&&!x.safe&&x.cache);
 await call(who,c('move',runId,{sectorId:at.id}));return {who,runId,at};}
test('flag off refuses v6 issue; flag on requires capable client',async()=>{
 const who=uid();await db.doc(`users/${who}`).set(profile());
 process.env.HOLOZONE_EXPEDITION_REALTIME='0';
 await assert.rejects(()=>call(who,c('issue',null,{repairKits:0,carryExtractionCharge:false,duelInputs:'duel-inputs-2'})),/expedition_unavailable/);
 process.env.HOLOZONE_EXPEDITION_REALTIME='1';
 await assert.rejects(()=>call(who,{schemaVersion:'zone-run-3',operation:'issue',requestId:req(),repairKits:0,carryExtractionCharge:false}),/client_update_required/);
});
test('issue → engage → verified settle is durable, exactly once, without client outcome',async()=>{
 const {who,runId,at}=await start();const issue=await call(who,c('engage',runId,{duelInputs:'duel-inputs-2'}));
 assert.equal(issue.run.pendingFight.sectorId,at.id);assert.equal(issue.fightIssue.encounter.kind,'expedition');
 const status=await call(who,c('status'));assert.equal(status.fightIssue.rulesHash,issue.fightIssue.rulesHash);
 await assert.rejects(()=>call(who,c('move',runId,{sectorId:'gate1'})),/fight_pending/);
 const client=recordFightLog(issue.fightIssue,smartPlayer(issue.fightIssue));
 const settle=c('fight_settle',runId,{fightId:issue.run.pendingFight.fightId,inputLog:client.wire});
 const first=await call(who,settle,T+120000);assert.equal(first.fightReceipt.verified,true);
 const replay=await call(who,settle,T+120001);assert.equal(replay.alreadyProcessed,true);assert.deepEqual(replay.fightReceipt,first.fightReceipt);
 const saved=(await db.doc(`holoZoneRuns/${who}/expeditions/${runId}`).get()).data();assert.equal(saved.lastFight.receipt.inputsHash,first.fightReceipt.inputsHash);
 assert.deepEqual(first.encounterResult.carry.map(x=>x.staminaPm),saved.squad.map(x=>x.staminaPm));
 assert.equal((await db.doc(`users/${who}`).get()).data().expeditionSupplies.energy,80);
});
test('tampered log is refused without consuming the pending fight or second energy',async()=>{
 const {who,runId}=await start(3);const issue=await call(who,c('engage',runId,{duelInputs:'duel-inputs-2'}));
 const client=recordFightLog(issue.fightIssue,smartPlayer(issue.fightIssue));client.wire.seed='0'.repeat(64);
 await assert.rejects(()=>call(who,c('fight_settle',runId,{fightId:issue.run.pendingFight.fightId,inputLog:client.wire}),T+120000),/replay_mismatch/);
 const status=await call(who,c('status'));assert.equal(status.run.energy,80);assert.equal(status.run.pendingFight.fightId,issue.run.pendingFight.fightId);
});
test('a verified loss wipes once and banks only the protected haul row',async()=>{
 const {who,runId}=await start(1),ref=db.doc(`holoZoneRuns/${who}/expeditions/${runId}`);
 await ref.update({haul:[{id:'safe_row',kind:'blueprint_fragment',amount:1,protected:true},{id:'bulky_row',kind:'bulky_salvage',amount:1,protected:false}]});
 const issue=await call(who,c('engage',runId,{duelInputs:'duel-inputs-2'}));
 const client=recordFightLog(issue.fightIssue,scriptedPlayer([]));assert.equal(client.winner,1);
 const reply=await call(who,c('fight_settle',runId,{fightId:issue.run.pendingFight.fightId,inputLog:client.wire}),T+180000);
 assert.equal(reply.schemaVersion,'zone-run-6');assert.equal(reply.encounterResult.outcome,'wipe');
 assert.deepEqual(reply.receipt.banked.map(x=>x.id),['safe_row']);assert.deepEqual(reply.receipt.lost.map(x=>x.id),['bulky_row']);
 assert.ok(reply.run.squad.every(x=>x.currentHealth===0));assert.equal((await ref.get()).data().state,'closed');
});
