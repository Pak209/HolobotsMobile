// Offline fixture only. No Firebase account access or production calls: the pure host rulings (expedition.ts) and the
// callable refusal mapper (expeditionErrors.ts), driven along deterministic runs with the signature pilot on.
// Regenerate: npm run build, then node scripts/generate-zone-run-5-fixture.mjs. Unity mirrors the output verbatim as
// Schemas/fixtures/zone-run-5.fixture.json.
import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import {T,CONFIG,squadProfile} from './zone-signature-fixtures.mjs';
const require=createRequire(import.meta.url),Z=require('../lib/holozone/expedition.js'),{expeditionRejection}=require('../lib/holozone/expeditionErrors.js');
const runId='fixture_run',V5='zone-run-5';let n=0,s;
function begin(ids,seed,level=1){const p=squadProfile(ids,level),r=Z.issueExpedition(p,{repairKits:2,carryExtractionCharge:true},runId,seed,T,CONFIG,{signatures:true});s={p:{...p,...r.updates},r:r.run};
  return {request:{schemaVersion:V5,operation:'issue',requestId:`fixture_req_${++n}`,repairKits:2,carryExtractionCharge:true},nowMs:T,reply:{schemaVersion:V5,operation:'issue',run:Z.runView(r.run,V5),alreadyProcessed:false}};}
const request=(operation,fields={},wire=V5)=>({schemaVersion:wire,operation,requestId:`fixture_req_${++n}`,runId,...fields});
function step(operation,fields={},now=T,wire=V5){
 const c=request(operation,fields,wire);
 try{const x=Z.advanceExpedition(s.p,s.r,c,now);s.p={...s.p,...x.updates};s.r=x.run;return {request:c,nowMs:now,reply:Z.advanceReply(wire,operation,x.run,x)};}
 catch(e){const h=expeditionRejection(e);if(!h)throw e;return {request:c,nowMs:now,refusal:{code:h.code,message:h.message,details:h.details}};}
}
const at=(band,flag)=>s.r.layout.sectors.find(x=>x.band===band&&(flag==='utility'?x.utility:x[flag])).id;
const cases={},CD=Z.SIGNATURE_COOLDOWN_MS;
cases.layout={request:{schemaVersion:V5,operation:'layout'},nowMs:T,reply:{schemaVersion:V5,layout:Z.layoutView(Z.dailyLayout(T),V5),config:Z.expeditionConfig(CONFIG)}};
// Run A (squad ace / wolf / hare, band-level): forecast, slipstream on the cache side, the forfeit, the refusals.
cases.issue=begin(['ace','wolf','hare'],7);
step('move',{sectorId:'gate1'});
cases.acceptedForecast=step('signature',{signature:'forecast',holobotId:'wolf',targetSectorId:at(1,'cache')});
cases.forecastAgainNone=step('signature',{signature:'forecast',holobotId:'wolf',targetSectorId:at(1,'cache')},T+CD);
cases.refusedNotAhead=step('signature',{signature:'forecast',holobotId:'wolf',targetSectorId:'entry'},T+CD);
cases.refusedCooling=step('signature',{signature:'forecast',holobotId:'wolf',targetSectorId:at(1,'utility')},T+1000);
cases.refusedNotHere=step('signature',{signature:'slipstream',holobotId:'hare'},T+CD);
step('move',{sectorId:at(1,'cache')},T+CD);
cases.acceptedSlipstream=step('signature',{signature:'slipstream',holobotId:'hare'},T+CD);
cases.refusedFightSlipped=step('fight',{playerIntents:['strike','heavy','defend']},T+CD);
cases.refusedCacheSlipped=step('cache',{},T+CD);
cases.moveThroughSlip=step('move',{sectorId:'gate2'},T+CD);
cases.refusedNotInSquad=step('signature',{signature:'forecast',holobotId:'ace',targetSectorId:at(2,'cache')},T+2*CD);
step('move',{sectorId:at(2,'utility')},T+2*CD);
cases.refusedNoCharge=step('signature',{signature:'slipstream',holobotId:'ace'},T+2*CD);
cases.refusedUnknown=step('signature',{signature:'snare',holobotId:'ace'},T+2*CD);
// Run B (squad ace / era / shadow): the starter per-point choice at ACE's own utility point.
begin(['ace','era','shadow'],7);n=200;
step('move',{sectorId:'gate1'});step('move',{sectorId:at(1,'utility')});
cases.starterPointFirst=step('utility',{utility:'ace'});
cases.starterSignatureNone=step('signature',{signature:'slipstream',holobotId:'ace'},T+CD);
// zone-run-4 control on a signature-enabled run: same ruling, no signature fields.
cases.v4Control=step('move',{sectorId:'gate2'},T+CD,'zone-run-4');
for(const k of ['acceptedForecast','acceptedSlipstream','starterPointFirst'])if(!cases[k].reply)throw Error(k+' refused');
if(cases.acceptedForecast.reply.signatureResult.effect!=='forecast'||cases.acceptedSlipstream.reply.signatureResult.effect!=='route'||cases.starterSignatureNone.reply.signatureResult.effect!=='none'||cases.forecastAgainNone.reply.signatureResult.effect!=='none')throw Error('effects');
for(const [k,c] of [['refusedNotAhead','forecast_not_ahead'],['refusedCooling','signature_cooling'],['refusedNotHere','signature_not_here'],['refusedFightSlipped','sector_slipped'],['refusedCacheSlipped','sector_not_cleared'],['refusedNoCharge','signature_no_charge'],['refusedUnknown','signature_unknown'],['refusedNotInSquad','signature_not_in_squad']])
 if(cases[k].refusal?.details?.rejectionCode!==c)throw Error(k+' '+JSON.stringify(cases[k]));
writeFileSync(process.argv[2]??new URL('./fixtures/zone-run-5/signatures.json',import.meta.url),JSON.stringify({
 provenance:'Offline HolobotsMobile host rulings (functions/src/holozone/expedition.ts advanceExpedition/advanceReply/layoutView/forecastSector) and callable refusal mapper (expeditionErrors.ts) with the signature pilot on (HOLOCITY_ZONE_SIGNATURES=pilot-1), two deterministic runs: TEST-ONLY tuning (zone-expedition-fixtures.mjs CONFIG), privateSeed 7, day 2026-10-14, level-1 squads. Not production tuning. Refusals are callable errors (HttpsError code/message/details), not success objects.',
 schemaVersion:V5,signatureCooldownMs:CD,cases},null,2)+'\n');
console.log(Object.keys(cases).join(' '));
