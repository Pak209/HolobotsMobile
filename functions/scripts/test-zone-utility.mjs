import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {T,CONFIG,profile,issued} from './zone-expedition-fixtures.mjs';
const require=createRequire(import.meta.url),Z=require('../lib/holozone/expedition.js'),C=require('../lib/config/zoneExpedition.js'),{expeditionRejection}=require('../lib/holozone/expeditionErrors.js');
const {default:Ajv2020}=createRequire(new URL('../../rules-tests/package.json',import.meta.url))('ajv/dist/2020');
const load=n=>JSON.parse(readFileSync(new URL(n,import.meta.url)));
const ajv=new Ajv2020({strict:false});for(const n of ['duel-intents-1','duel-receipt-1','zone-extract-1','zone-run-3','zone-run-4'])ajv.addSchema(load(`../../Schemas/${n}.json`));
const v3=ajv.getSchema('zone-run-3'),v4=ajv.getSchema('zone-run-4'),extract=ajv.getSchema('zone-extract-1');
const fixture=load('./fixtures/zone-run-4/utility.json'),CD=Z.UTILITY_COOLDOWN_MS;
function state(seed=1){const r=issued(profile(),seed);return {p:{...profile(),...r.updates},r:r.run};}
function step(s,operation,fields={},now=T){const x=Z.advanceExpedition(s.p,s.r,{operation,...fields},now);s.r=x.run;s.p={...s.p,...x.updates};return x;}
const code=(s,op,f,now=T)=>{try{step(s,op,f,now);return null;}catch(e){return e.code;}};
const util=(s,band)=>s.r.layout.sectors.find(x=>x.band===band&&x.utility);
function to(s,band,now=T){step(s,'move',{sectorId:`gate${band}`},now);const at=util(s,band);step(s,'move',{sectorId:at.id},now);return at;}
function deepTo(s,band){for(let b=1;b<band;b++){to(s,b);step(s,'fight',{playerIntents:['strike','heavy','defend']});}return to(s,band);}

test('effects table: ace=route, shadow=cache, kuma=clear; layout places ace/shadow/kuma on bands 1/2/3',()=>{
 assert.deepEqual({...C.ZONE_EXPEDITION_RULES.utility.effects},{ace:'route',shadow:'cache',kuma:'clear'});assert.ok(Object.isFrozen(C.ZONE_EXPEDITION_RULES.utility));
 for(let d=0;d<30;d++){const l=Z.dailyLayout(T+d*86400000);assert.deepEqual(l.sectors.filter(s=>s.utility).map(s=>[s.band,s.utility]),[[1,'ace'],[2,'shadow'],[3,'kuma']]);
  for(const at of l.sectors.filter(s=>s.utility))assert.equal(Z.utilityRoute(l,at),at.band<3?`gate${at.band+1}`:null);}
});
test('ACE route opens gate{n+1} without sector_not_cleared; only from the spent utility sector',()=>{
 const s=state(),at=to(s,1);assert.equal(code(s,'move',{sectorId:'gate2'}),'sector_not_cleared');
 const x=step(s,'utility',{utility:'ace'});assert.deepEqual(x.utilityResult,{sectorId:at.id,utility:'ace',effect:'route',opensSectorId:'gate2',haul:[],spent:true,cooldownMs:CD});
 assert.deepEqual(s.r.utilityUsed,[at.id]);assert.equal(s.r.cleared.includes(at.id),false);assert.equal(s.r.haul.length,0);
 const energy=s.r.energy;step(s,'move',{sectorId:'gate2'});assert.equal(s.r.sectorId,'gate2');assert.equal(s.r.energy,energy-CONFIG.sectorEnergyCost); // energy rule unchanged
 const other=state();step(other,'move',{sectorId:'gate1'});step(other,'move',{sectorId:other.r.layout.sectors.find(x=>x.band===1&&x.cache).id});assert.equal(code(other,'move',{sectorId:'gate2'}),'sector_not_cleared');
});
test('SHADOW cache: deterministic per private seed, unbanked haul until extraction, then banked once',()=>{
 const a=state(5),b=state(5),c=state(6);for(const s of [a,b,c])deepTo(s,2);
 const now=T+CD,x=step(a,'utility',{utility:'shadow'},now),y=step(b,'utility',{utility:'shadow'},now);step(c,'utility',{utility:'shadow'},now);
 assert.deepEqual(x.utilityResult,y.utilityResult);assert.equal(x.utilityResult.effect,'cache');assert.equal(x.utilityResult.haul.length,1);
 assert.deepEqual(a.r.haul.at(-1),x.utilityResult.haul[0]);assert.equal(x.utilityResult.haul[0].id,`${util(a,2).id}_utility`);
 assert.equal(a.p.itemStocks.blueprint_fragment,10);assert.equal(a.p.expeditionBank,undefined);
 const kind=Z.seed32(`5:utility:${util(a,2).id}`)%10000<CONFIG.rareBlueprintChanceBasisPoints?'rare_blueprint_fragment':'blueprint_fragment';assert.equal(x.utilityResult.haul[0].kind,kind);
 step(a,'fight',{playerIntents:['strike','heavy','defend']},now);step(a,'move',{sectorId:'gate2'},now);step(a,'extract',{},now);
 assert.ok(a.r.receipt.banked.some(h=>h.id===x.utilityResult.haul[0].id));assert.equal(a.p.itemStocks.blueprint_fragment,11);assert.equal(a.p.expeditionBank.rareBlueprints,kind==='rare_blueprint_fragment'?1:0);
 const lowRare={...state(5)};lowRare.r.config={...lowRare.r.config,rareBlueprintChanceBasisPoints:0};deepTo(lowRare,2);assert.equal(step(lowRare,'utility',{utility:'shadow'},now).utilityResult.haul[0].kind,'blueprint_fragment');
});
test('KUMA clear: the barrier sector is cleared with no loot, no guardian credit; emergency extraction then allowed',()=>{
 const s=state(),at=deepTo(s,3);assert.equal(code(s,'emergency_start',{}),'encounter_pending');
 const haul=structuredClone(s.r.haul),x=step(s,'utility',{utility:'kuma'},T+CD);
 assert.deepEqual(x.utilityResult,{sectorId:at.id,utility:'kuma',effect:'clear',opensSectorId:null,haul:[],spent:true,cooldownMs:CD});
 assert.ok(s.r.cleared.includes(at.id));assert.deepEqual(s.r.haul,haul);assert.equal(s.r.guardianDefeated,false);assert.equal(code(s,'fight',{playerIntents:['strike']},T+CD),'already_cleared');
 step(s,'emergency_start',{},T+CD);assert.equal(s.r.charge,0);
});
test('one-shot: utility_spent on reuse; utility_cooling across sectors with exact retryAfterMs; refusals change nothing',()=>{
 const s=state();to(s,1);step(s,'utility',{utility:'ace'});const before=structuredClone(s.r);
 assert.equal(code(s,'utility',{utility:'ace'},T+10*CD),'utility_spent');assert.deepEqual(s.r,before);
 step(s,'move',{sectorId:'gate2'});const at=util(s,2);step(s,'move',{sectorId:at.id});const mid=structuredClone(s.r);
 assert.throws(()=>step(s,'utility',{utility:'shadow'},T+CD-1),e=>e.code==='utility_cooling'&&e.details.retryAfterMs===1);assert.deepEqual(s.r,mid);
 assert.equal(step(s,'utility',{utility:'shadow'},T+CD).utilityResult.effect,'cache');
 const h=expeditionRejection(new Z.ExpeditionError('utility_cooling',{retryAfterMs:7}));assert.equal(h.code,'failed-precondition');assert.deepEqual(h.details,{rejectionCode:'utility_cooling',retryAfterMs:7});
 assert.equal(expeditionRejection(new Z.ExpeditionError('utility_spent')).code,'failed-precondition');
});
test('effect none (nothing to do): not spent, no cooldown, retry allowed later; existing refusals keep precedence',()=>{
 const s=state(),at=to(s,1);step(s,'fight',{playerIntents:['strike','heavy','defend']});
 const x=step(s,'utility',{utility:'ace'});assert.deepEqual(x.utilityResult,{sectorId:at.id,utility:'ace',effect:'none',opensSectorId:null,haul:[],spent:false,cooldownMs:null});
 assert.deepEqual(s.r.utilityUsed,[]);assert.equal(s.r.utilityAtMs,null);assert.equal(step(s,'utility',{utility:'ace'}).utilityResult.effect,'none');
 const full=state();deepTo(full,2);full.r.haul=Array.from({length:9},(_,i)=>({id:`h${i}`,kind:'bulky_salvage',amount:1,protected:false}));assert.equal(step(full,'utility',{utility:'shadow'}).utilityResult.effect,'none');assert.equal(full.r.haul.length,9);
 const k=state();to(k,1);rejectsSet(k);
});
function rejectsSet(s){
 assert.equal(code(s,'utility',{utility:'shadow'}),'no_utility');s.r.squad.find(b=>b.holobotId==='ace').currentHealth=0;assert.equal(code(s,'utility',{utility:'ace'}),'companion_required');
 s.r.utilityUsed=[s.r.sectorId];s.r.utilityAtMs=T;assert.equal(code(s,'utility',{utility:'ace'}),'companion_required'); // companion check before spent
}
test('storage: pre-zone-run-4 documents read as utilityUsed [] / no cooldown; malformed bookkeeping fails closed',()=>{
 const s=state(),{utilityUsed:_u,utilityAtMs:_a,...legacy}=s.r;const r=Z.readExpedition(legacy);assert.deepEqual(r.utilityUsed,[]);assert.equal(r.utilityAtMs,null);
 for(const patch of [{utilityUsed:['entry'],utilityAtMs:T},{utilityUsed:['nowhere'],utilityAtMs:T},{utilityUsed:['b1a','b1a'],utilityAtMs:T},{utilityUsed:[],utilityAtMs:T},{utilityUsed:[util(s,1).id],utilityAtMs:null},{utilityUsed:'b1a'},{utilityAtMs:-1}])
  assert.throws(()=>Z.readExpedition({...s.r,...patch}),/unavailable/);
 assert.equal(Z.readExpedition({...s.r,utilityUsed:[util(s,1).id],utilityAtMs:T}).utilityUsed.length,1);
});
test('wire: zone-run-4 accepted for every zone-run op; zone-extract-1 unchanged; unknown versions refused',()=>{
 for(const op of ['status','layout'])assert.equal(Z.validateExpeditionCommand({schemaVersion:'zone-run-4',operation:op}).schemaVersion,'zone-run-4');
 assert.equal(Z.validateExpeditionCommand({schemaVersion:'zone-run-4',operation:'utility',requestId:'r',runId:'x',utility:'ace'}).operation,'utility');
 for(const bad of [{schemaVersion:'zone-run-5',operation:'status'},{schemaVersion:'zone-run-4',operation:'extract',requestId:'r',runId:'x',mode:'normal'},{schemaVersion:'zone-run-4',operation:'utility',requestId:'r',runId:'x',utility:'ace',effect:'cache'}])
  assert.throws(()=>Z.validateExpeditionCommand(bad),/invalid_request/);
});
test('views: zone-run-3 strips utility bookkeeping and preview copy; zone-run-4 adds utilityUsed, glimpse, dangerLabel; cooldown anchor never leaves',()=>{
 const s=state();to(s,1);step(s,'utility',{utility:'ace'});const a=Z.runView(s.r,'zone-run-3'),b=Z.runView(s.r,'zone-run-4');
 assert.equal(a.schemaVersion,'zone-run-3');assert.ok(!('utilityUsed' in a)&&!('utilityAtMs' in a)&&!('privateSeed' in a));assert.ok(a.layout.sectors.every(x=>!('glimpse' in x)&&!('dangerLabel' in x)));
 assert.deepEqual(Object.keys(a),Object.keys(Z.runView(s.r)));assert.equal(JSON.stringify(a),JSON.stringify(Z.runView(s.r)));
 assert.equal(b.schemaVersion,'zone-run-4');assert.deepEqual(b.utilityUsed,[util(s,1).id]);assert.ok(!('utilityAtMs' in b)&&!('privateSeed' in b));
 for(const x of b.layout.sectors){assert.equal(typeof x.glimpse,'string');assert.equal(x.dangerLabel,x.band?C.ZONE_EXPEDITION_RULES.layoutCopy.dangerLabels[x.band-1]:undefined);}
 assert.deepEqual(b.layout.sectors.filter(x=>x.utility).map(x=>x.glimpse),['ace','shadow','kuma'].map(u=>C.ZONE_EXPEDITION_RULES.layoutCopy.glimpse[u]));
 assert.deepEqual(s.r.layout,Z.dailyLayout(T)); // the pinned layout itself is untouched: copy is view-only
 assert.ok(v3({schemaVersion:'zone-run-3',operation:'utility',run:a,receipt:null,alreadyProcessed:false}),JSON.stringify(v3.errors));
 assert.ok(v4({schemaVersion:'zone-run-4',operation:'utility',run:b,receipt:null,utilityResult:{sectorId:'b1a',utility:'ace',effect:'route',opensSectorId:'gate2',haul:[],spent:true,cooldownMs:CD},alreadyProcessed:false}),JSON.stringify(v4.errors));
});
test('replies: zone-run-3 utility reply never carries utilityResult; closing replies stay zone-extract-1 with the zone-run-3 run',()=>{
 const s=state();to(s,1);const x=step(s,'utility',{utility:'ace'});
 const r3=Z.advanceReply('zone-run-3','utility',x.run,x),r4=Z.advanceReply('zone-run-4','utility',x.run,x);
 assert.deepEqual(Object.keys(r3),['schemaVersion','operation','run','receipt','alreadyProcessed']);assert.deepEqual(Object.keys(r4),['schemaVersion','operation','run','receipt','utilityResult','alreadyProcessed']);
 assert.ok(v3(r3));assert.ok(v4(r4),JSON.stringify(v4.errors));assert.equal(v3(r4),false);assert.equal(v4(r3),false); // known-bad both ways
 step(s,'move',{sectorId:'gate1'});const w=step(s,'wipe'),closing=Z.advanceReply('zone-run-4','fight',w.run,w);assert.equal(closing.schemaVersion,'zone-extract-1');assert.ok(!('utilityUsed' in closing.run));assert.ok(extract(closing),JSON.stringify(extract.errors));
});
test('frozen fixture: every reply validates against zone-run-4 (control against zone-run-3), refusals carry the documented codes',()=>{
 const {cases}=fixture;assert.equal(fixture.utilityCooldownMs,CD);
 for(const k of ['layout','acceptedRoute','acceptedCache','acceptedClear']){assert.ok(v4(cases[k].request),k+JSON.stringify(v4.errors));assert.ok(v4(cases[k].reply),k+JSON.stringify(v4.errors));assert.equal(v3(cases[k].reply),false);}
 assert.deepEqual(['acceptedRoute','acceptedCache','acceptedClear'].map(k=>cases[k].reply.utilityResult.effect),['route','cache','clear']);
 assert.equal(cases.acceptedRoute.reply.utilityResult.opensSectorId,'gate2');assert.equal(cases.acceptedCache.reply.utilityResult.haul.length,1);
 assert.ok(cases.acceptedCache.reply.run.haul.some(h=>h.id===cases.acceptedCache.reply.utilityResult.haul[0].id));
 assert.deepEqual(cases.refusedSpent.refusal.details,{rejectionCode:'utility_spent'});assert.deepEqual(cases.refusedCooling.refusal.details,{rejectionCode:'utility_cooling',retryAfterMs:CD-1000});
 for(const k of ['refusedSpent','refusedCooling'])assert.ok(v4(cases[k].request));
 assert.ok(v3(cases.v3Control.request)&&v3(cases.v3Control.reply),JSON.stringify(v3.errors));assert.ok(!('utilityResult' in cases.v3Control.reply));
 const tampered=structuredClone(cases.acceptedRoute.reply);tampered.utilityResult.effect='none';assert.equal(v4(tampered),false);
 const extra=structuredClone(cases.acceptedClear.reply);extra.utilityResult.bonus=1;assert.equal(v4(extra),false);
});
test('fixture is reproducible from the host code (regenerate on any ruling change)',async()=>{
 const {execFileSync}=await import('node:child_process'),{mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'zone-run-4-')),out=join(dir,'utility.json');
 try{execFileSync(process.execPath,[new URL('./generate-zone-run-4-fixture.mjs',import.meta.url).pathname,out],{stdio:'ignore'});
  assert.equal(readFileSync(out,'utf8'),readFileSync(new URL('./fixtures/zone-run-4/utility.json',import.meta.url),'utf8'));}finally{rmSync(dir,{recursive:true,force:true});}
});
