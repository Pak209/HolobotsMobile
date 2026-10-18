// Offline fixture only. No Firebase account access or production calls: the pure host rulings (expedition.ts) and the
// callable refusal mapper (expeditionErrors.ts), driven along one deterministic run. Regenerate: npm run build, then
// node scripts/generate-zone-run-4-fixture.mjs. Unity mirrors the output as Schemas/fixtures/zone-run-4.fixture.json.
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {T,CONFIG,profile} from './zone-expedition-fixtures.mjs';
const require=createRequire(import.meta.url),Z=require('../lib/holozone/expedition.js'),{expeditionRejection}=require('../lib/holozone/expeditionErrors.js');
const runId='fixture_run',V4='zone-run-4';let n=0;
const issued=Z.issueExpedition(profile(),{repairKits:2,carryExtractionCharge:true},runId,7,T,CONFIG);
const s={p:{...profile(),...issued.updates},r:issued.run};
const request=(operation,fields={},wire=V4)=>({schemaVersion:wire,operation,requestId:`fixture_req_${++n}`,runId,...fields});
function step(operation,fields={},now=T,wire=V4){
 const c=request(operation,fields,wire);
 try{const x=Z.advanceExpedition(s.p,s.r,c,now);s.p={...s.p,...x.updates};s.r=x.run;return {request:c,nowMs:now,reply:Z.advanceReply(wire,operation,x.run,x)};}
 catch(e){const h=expeditionRejection(e);if(!h)throw e;return {request:c,nowMs:now,refusal:{code:h.code,message:h.message,details:h.details}};}
}
const utilitySector=band=>s.r.layout.sectors.find(x=>x.band===band&&x.utility).id;
const cases={};
cases.layout={request:{schemaVersion:V4,operation:'layout'},nowMs:T,reply:{schemaVersion:V4,layout:Z.layoutView(Z.dailyLayout(T),V4),config:Z.expeditionConfig(CONFIG)}};
step('move',{sectorId:'gate1'});step('move',{sectorId:utilitySector(1)});
cases.acceptedRoute=step('utility',{utility:'ace'},T);
step('move',{sectorId:'gate2'},T+1000);step('move',{sectorId:utilitySector(2)},T+1000);
cases.refusedCooling=step('utility',{utility:'shadow'},T+1000);
cases.acceptedCache=step('utility',{utility:'shadow'},T+Z.UTILITY_COOLDOWN_MS);
cases.refusedSpent=step('utility',{utility:'shadow'},T+Z.UTILITY_COOLDOWN_MS+1);
step('fight',{playerIntents:['strike','heavy','defend']},T+Z.UTILITY_COOLDOWN_MS+1);
step('move',{sectorId:'gate3'},T+Z.UTILITY_COOLDOWN_MS+1);step('move',{sectorId:utilitySector(3)},T+Z.UTILITY_COOLDOWN_MS+1);
cases.acceptedClear=step('utility',{utility:'kuma'},T+2*Z.UTILITY_COOLDOWN_MS);
for(const k of ['acceptedRoute','acceptedCache','acceptedClear'])if(!cases[k].reply||cases[k].reply.utilityResult.effect==='none')throw Error(k+' did not resolve');
for(const [k,code] of [['refusedCooling','utility_cooling'],['refusedSpent','utility_spent']])if(cases[k].refusal?.details?.rejectionCode!==code)throw Error(k);
// zone-run-3 control: the same accepted ACE use sent as zone-run-3 (fresh run, same seed) has no zone-run-4 field.
{const r=Z.issueExpedition(profile(),{repairKits:2,carryExtractionCharge:true},runId,7,T,CONFIG);s.p={...profile(),...r.updates};s.r=r.run;n=100;
 step('move',{sectorId:'gate1'},T,'zone-run-3');step('move',{sectorId:utilitySector(1)},T,'zone-run-3');cases.v3Control=step('utility',{utility:'ace'},T,'zone-run-3');}
writeFileSync(process.argv[2]??new URL('./fixtures/zone-run-4/utility.json',import.meta.url),JSON.stringify({
 provenance:'Offline HolobotsMobile host rulings (functions/src/holozone/expedition.ts advanceExpedition/advanceReply/layoutView) and callable refusal mapper (expeditionErrors.ts) along one deterministic run: TEST-ONLY tuning (zone-expedition-fixtures.mjs CONFIG, rareBlueprintChanceBasisPoints 10000), privateSeed 7, day 2026-10-14. Not production tuning. Refusals are callable errors (HttpsError code/message/details), not success objects.',
 schemaVersion:V4,utilityCooldownMs:Z.UTILITY_COOLDOWN_MS,cases},null,2)+'\n');
console.log(Object.keys(cases).join(' '));
