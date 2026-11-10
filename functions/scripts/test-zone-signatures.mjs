// zone-run-5 signature pilot (FORECAST + SLIPSTREAM): pure host rulings. Holocity DECISIONS #72.75; design
// HANDOFFS/2026-10-23-holozones-signatures.md sections 2, 3.1, 3.2 and 4.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {T,CONFIG,squadProfile,signatureState as state,step,code,utilityAt,cacheAt} from './zone-signature-fixtures.mjs';
const require=createRequire(import.meta.url),Z=require('../lib/holozone/expedition.js'),C=require('../lib/config/zoneExpedition.js'),R=require('../lib/lib/duelResolver.js'),{expeditionRejection}=require('../lib/holozone/expeditionErrors.js');
const {default:Ajv2020}=require('ajv/dist/2020');
const load=n=>JSON.parse(readFileSync(new URL(n,import.meta.url)));
const ajv=new Ajv2020({strict:false});for(const n of ['duel-intents-1','duel-receipt-1','zone-extract-1','zone-run-3','zone-run-4','zone-run-5'])ajv.addSchema(load(`../../Schemas/${n}.json`));
const v4=ajv.getSchema('zone-run-4'),v5=ajv.getSchema('zone-run-5');
const fixture=load('./fixtures/zone-run-5/signatures.json'),CD=Z.SIGNATURE_COOLDOWN_MS,RULES=C.ZONE_EXPEDITION_RULES.signatures;
const sig=(s,signature,holobotId,targetSectorId,now=T)=>step(s,'signature',{signature,holobotId,...(targetSectorId?{targetSectorId}:{})},now).signatureResult;
const sigCode=(s,signature,holobotId,targetSectorId,now=T)=>code(s,'signature',{signature,holobotId,...(targetSectorId?{targetSectorId}:{})},now);
const fightIntents=['strike','heavy','defend'];

test('rules: catalog, pilot kinds, charges 2/1, 30 s cooldown, forecast reference plan; frozen and host-only',()=>{
 assert.ok(Object.isFrozen(RULES)&&Object.isFrozen(RULES.catalog));
 assert.deepEqual([...RULES.enabled],['forecast','slipstream']);
 for(const id of ['wolf','era','tsuin'])assert.equal(RULES.catalog[id],'forecast');for(const id of ['ace','hare','shadow'])assert.equal(RULES.catalog[id],'slipstream');
 assert.equal(RULES.catalog.kuma,'aegis');assert.equal(RULES.charges.forecast,2);assert.equal(RULES.charges.slipstream,1);assert.equal(CD,30000);
 assert.deepEqual([...RULES.forecast.referencePlan],['strike','strike','defend']);assert.equal(RULES.forecast.openingIntents,3);
 assert.equal(C.zoneSignaturesEnabled(),false,'default off');
});
test('pool: one entry per kind present; duplicate holders are insurance, never extra charges; KUMA has no pilot signature',()=>{
 assert.deepEqual(Z.signaturePool([{holobotId:'ace'},{holobotId:'hare'},{holobotId:'wolf'}]),{forecast:{charges:2,max:2,holders:['wolf']},slipstream:{charges:1,max:1,holders:['ace','hare']}});
 assert.deepEqual(Z.signaturePool([{holobotId:'wolf'},{holobotId:'era'},{holobotId:'tsuin'}]),{forecast:{charges:2,max:2,holders:['wolf','era','tsuin']}});
 assert.deepEqual(Z.signaturePool([{holobotId:'kuma'},{holobotId:'ken'},{holobotId:'kurai'}]),{});
 const s=state(['ace','kuma','shadow']);assert.deepEqual(s.r.signaturePool,{slipstream:{charges:1,max:1,holders:['ace','shadow']}});
 assert.deepEqual([s.r.signatureArmed,s.r.forecasts,s.r.slipOpened,s.r.protectedSlots,s.r.signatureAtMs],[null,[],[],1,null]);
});
test('level-independent: pool and Slipstream result are identical at level 1 and level 99',()=>{
 const lo=state(['ace','wolf','hare'],{level:1}),hi=state(['ace','wolf','hare'],{level:99});assert.deepEqual(lo.r.signaturePool,hi.r.signaturePool);
 for(const s of [lo,hi]){step(s,'move',{sectorId:'gate1'});step(s,'move',{sectorId:cacheAt(s,1).id});}
 assert.deepEqual(sig(lo,'slipstream','hare'),sig(hi,'slipstream','hare'));
});
test('flag off: no signature fields stored; zone-run-5 and the signature op are invalid_request',()=>{
 const off=state(['ace','wolf','hare'],{signatures:false});for(const k of ['signaturePool','signatureArmed','forecasts','slipOpened','protectedSlots','signatureAtMs'])assert.ok(!(k in off.r),k);
 assert.throws(()=>Z.validateExpeditionCommand({schemaVersion:'zone-run-5',operation:'status'}),/invalid_request/);
 assert.throws(()=>Z.validateExpeditionCommand({schemaVersion:'zone-run-5',operation:'signature',requestId:'r',runId:'x',signature:'slipstream',holobotId:'ace'}),/invalid_request/);
 assert.equal(Z.validateExpeditionCommand({schemaVersion:'zone-run-5',operation:'status'},{signatures:true}).schemaVersion,'zone-run-5');
 assert.throws(()=>Z.validateExpeditionCommand({schemaVersion:'zone-run-4',operation:'signature',requestId:'r',runId:'x',signature:'slipstream',holobotId:'ace'},{signatures:true}),/invalid_request/);
 // A flag-off run read through zone-run-5 shows an empty pool and every signature refuses as not in squad.
 step(off,'move',{sectorId:'gate1'});step(off,'move',{sectorId:cacheAt(off,1).id});assert.equal(sigCode(off,'slipstream','hare'),'signature_not_in_squad');
 assert.deepEqual(Z.runView(off.r,'zone-run-5').signaturePool,{});
});
test('request shape: forecast requires targetSectorId, the other kinds forbid it; ids only',()=>{
 const base={schemaVersion:'zone-run-5',operation:'signature',requestId:'r',runId:'x'},ok=x=>Z.validateExpeditionCommand({...base,...x},{signatures:true});
 assert.equal(ok({signature:'forecast',holobotId:'wolf',targetSectorId:'b1a'}).targetSectorId,'b1a');assert.equal(ok({signature:'slipstream',holobotId:'ace'}).signature,'slipstream');
 for(const bad of [{signature:'forecast',holobotId:'wolf'},{signature:'slipstream',holobotId:'ace',targetSectorId:'b1a'},{signature:'slipstream'},{signature:'slip stream',holobotId:'ace'},{signature:'slipstream',holobotId:'ace',extra:1}])
  assert.throws(()=>ok(bad),/invalid_request/,JSON.stringify(bad));
});
test('SLIPSTREAM: opens the deeper gate without a clear; the encounter and its cache are forfeit; 1 charge',()=>{
 const s=state();step(s,'move',{sectorId:'gate1'});const at=cacheAt(s,1);step(s,'move',{sectorId:at.id});
 assert.equal(code(s,'move',{sectorId:'gate2'}),'sector_not_cleared');const before=structuredClone(s.r);
 const x=sig(s,'slipstream','hare');
 assert.deepEqual(x,{signature:'slipstream',holobotId:'hare',sectorId:at.id,effect:'route',spent:true,chargesLeft:0,cooldownMs:CD,opensSectorId:'gate2',forecast:null,protectedSlots:null});
 assert.deepEqual(s.r.slipOpened,[at.id]);assert.equal(s.r.cleared.includes(at.id),false);assert.equal(s.r.energy,before.energy,'no energy cost');assert.deepEqual(s.r.squad,before.squad,'no healing / damage');
 assert.equal(s.r.signatureAtMs,T);assert.deepEqual(s.r.haul,[]);
 assert.equal(code(s,'fight',{playerIntents:fightIntents}),'sector_slipped');assert.equal(code(s,'cache'),'sector_not_cleared');
 step(s,'move',{sectorId:'gate2'});assert.equal(s.r.sectorId,'gate2');assert.equal(s.r.energy,before.energy-CONFIG.sectorEnergyCost,'normal sectorEnergyCost on the move');
 // Walking back in does not re-open the fight or the cache.
 step(s,'move',{sectorId:at.id});assert.equal(code(s,'fight',{playerIntents:fightIntents}),'sector_slipped');assert.equal(code(s,'cache'),'sector_not_cleared');
 step(s,'move',{sectorId:'gate2'});step(s,'move',{sectorId:cacheAt(s,2).id});assert.equal(sigCode(s,'slipstream','ace',undefined,T+CD),'signature_no_charge');
});
test('SLIPSTREAM refusals: safe room, band 3 and the guardian, a cleared sector; refusals change nothing',()=>{
 const s=state();step(s,'move',{sectorId:'gate1'});assert.equal(sigCode(s,'slipstream','ace'),'signature_not_here');
 const at=cacheAt(s,1);step(s,'move',{sectorId:at.id});step(s,'fight',{playerIntents:fightIntents});const before=structuredClone(s.r);
 assert.equal(sigCode(s,'slipstream','ace'),'signature_not_here');assert.deepEqual(s.r,before);
 for(const side of ['utility','cache']){
  const d=state(['ace','wolf','hare'],{level:30});for(let b=1;b<=2;b++){step(d,'move',{sectorId:`gate${b}`});step(d,'move',{sectorId:cacheAt(d,b).id});step(d,'fight',{playerIntents:fightIntents});}
  step(d,'move',{sectorId:'gate3'});const deep=side==='utility'?utilityAt(d,3):cacheAt(d,3);step(d,'move',{sectorId:deep.id});
  assert.equal(deep.guardian,side==='cache');assert.equal(sigCode(d,'slipstream','ace'),'signature_not_here',side);
 }
});
test('holder rules: living holder of that kind required; a KO\'d holder is locked but a second holder keeps the kind usable',()=>{
 const s=state();step(s,'move',{sectorId:'gate1'});step(s,'move',{sectorId:cacheAt(s,1).id});
 assert.equal(sigCode(s,'slipstream','wolf'),'signature_not_in_squad');assert.equal(sigCode(s,'slipstream','kuma'),'signature_not_in_squad');
 assert.equal(sigCode(s,'snare','ace'),'signature_unknown');assert.equal(sigCode(s,'lockbox','ace'),'signature_unknown');assert.equal(sigCode(s,'overclock','ace'),'signature_unknown');
 s.r.squad.find(b=>b.holobotId==='hare').currentHealth=0;assert.equal(sigCode(s,'slipstream','hare'),'signature_not_in_squad');
 assert.equal(sig(s,'slipstream','ace').effect,'route');
});
test('starter per-point choice (DECISIONS #72.75 (2)): at a utility point the point and Slipstream are alternatives',()=>{
 // Point first: ACE route at its own point; Slipstream there is nothing to do (not spent, no cooldown).
 const a=state(['ace','era','shadow']);step(a,'move',{sectorId:'gate1'});const p1=utilityAt(a,1);step(a,'move',{sectorId:p1.id});
 assert.equal(step(a,'utility',{utility:'ace'}).utilityResult.effect,'route');
 const none=sig(a,'slipstream','ace',undefined,T+CD);assert.equal(none.effect,'none');assert.equal(none.spent,false);assert.equal(none.chargesLeft,1);assert.equal(a.r.signatureAtMs,null);
 // ...and the starter still has its signature for a later sector (both sets in one run, one per use).
 step(a,'move',{sectorId:'gate2'});step(a,'move',{sectorId:cacheAt(a,2).id});assert.equal(sig(a,'slipstream','shadow',undefined,T+CD).effect,'route');
 // Signature first: Slipstream at ACE's point; the point then answers effect none (not spent).
 const b=state(['ace','era','shadow']);step(b,'move',{sectorId:'gate1'});step(b,'move',{sectorId:utilityAt(b,1).id});
 assert.equal(sig(b,'slipstream','ace').effect,'route');const u=step(b,'utility',{utility:'ace'},T+CD).utilityResult;
 assert.equal(u.effect,'none');assert.equal(u.spent,false);assert.deepEqual(b.r.utilityUsed,[]);step(b,'move',{sectorId:'gate2'});
 // SHADOW's cache point: taking the row is the choice there; Slipstream at that sector is then nothing to do.
 const c=state(['ace','era','shadow']);step(c,'move',{sectorId:'gate1'});step(c,'move',{sectorId:cacheAt(c,1).id});step(c,'fight',{playerIntents:fightIntents});
 step(c,'move',{sectorId:'gate2'});step(c,'move',{sectorId:utilityAt(c,2).id});assert.equal(step(c,'utility',{utility:'shadow'}).utilityResult.effect,'cache');
 assert.equal(sig(c,'slipstream','shadow',undefined,T+CD).effect,'none');assert.equal(code(c,'move',{sectorId:'gate3'},T+CD),'sector_not_cleared');
});
test('FORECAST: openingIntents are the threat\'s first 3 actions in the real fight that follows, whatever the player sends',()=>{
 for(const seed of [1,2,3,4,5,6,7,8]){
  const s=state(['wolf','era','tsuin'],{seed});step(s,'move',{sectorId:'gate1'});const target=cacheAt(s,1);
  const r=sig(s,'forecast','wolf',target.id);assert.equal(r.effect,'forecast');assert.equal(r.sectorId,target.id);
  step(s,'move',{sectorId:target.id});const fight=step(s,'fight',{playerIntents:['heavy','defend','strike','finisher']}).duelReceipt;
  const real=fight.rounds.filter(x=>x.side==='opponent').map(x=>x.requested);
  assert.ok(real.length>=3,`seed ${seed} fight too short to compare`);assert.deepEqual(r.forecast.openingIntents,real.slice(0,3),`seed ${seed}`);
 }
});
test('FORECAST projection = the reference plan replayed on THE fight (same seed, current HP), bucketed by the rule table',()=>{
 const s=state(['wolf','era','tsuin'],{seed:3});step(s,'move',{sectorId:'gate1'});const target=cacheAt(s,1);
 s.r.squad[0].currentHealth=Math.floor(s.r.squad[0].maxHealth/3); // bruised squad: the read uses HP NOW
 const squad=s.r.squad.map(b=>({...b,currentHealth:Math.floor(b.currentHealth)})),replay=R.resolveDuel({seed:Z.seed32(`${s.r.privateSeed}:fight:${target.id}`),player:squad,opponent:[Z.threat(s.r,target)],playerIntents:[...RULES.forecast.referencePlan]});
 const left=replay.playerFinal.reduce((n,b)=>n+b.currentHealth,0)/squad.reduce((n,b)=>n+b.currentHealth,0);
 const expected=replay.winner!=='player'?'wipe_risk':left>=0.85?'clean':left>=0.6?'bruised':'heavy';
 const before=structuredClone(s.r),r=sig(s,'forecast','era',target.id);assert.equal(r.forecast.projection,expected);
 assert.deepEqual(s.r.squad,before.squad);assert.equal(s.r.energy,before.energy);assert.deepEqual(s.r.cleared,before.cleared);assert.deepEqual(s.r.opponents,before.opponents);
 assert.deepEqual(s.r.forecasts,[r.forecast]);assert.equal(s.r.signaturePool.forecast.charges,1);
 const all=new Set();for(let seed=1;seed<=40;seed++){const x=state(['ace','wolf','hare'],{seed,level:1});step(x,'move',{sectorId:'gate1'});all.add(sig(x,'forecast','wolf',cacheAt(x,1).id).forecast.projection);}
 for(const p of all)assert.ok(['clean','bruised','heavy','wipe_risk'].includes(p));
});
test('FORECAST targets: ahead neighbours only (unsafe); guardian allowed; already forecast / cleared = none, not spent; 2 charges',()=>{
 const s=state(['wolf','ace','hare'],{level:30});step(s,'move',{sectorId:'gate1'});
 for(const t of ['entry','gate1','gate2','b2a','nowhere'])assert.equal(sigCode(s,'forecast','wolf',t),'forecast_not_ahead',t);
 const a=sig(s,'forecast','wolf',cacheAt(s,1).id),again=sig(s,'forecast','wolf',cacheAt(s,1).id,T+CD);
 assert.equal(again.effect,'none');assert.equal(again.spent,false);assert.deepEqual(again.forecast,a.forecast);assert.equal(again.cooldownMs,null);
 // From inside an unsafe sector nothing is ahead-and-unsafe on today's layout shape.
 step(s,'move',{sectorId:utilityAt(s,1).id});step(s,'fight',{playerIntents:fightIntents});for(const t of ['gate2',cacheAt(s,1).id])assert.equal(sigCode(s,'forecast','wolf',t,T+CD),'forecast_not_ahead');
 step(s,'move',{sectorId:'gate1'});const cleared=sig(s,'forecast','wolf',utilityAt(s,1).id,T+CD);assert.equal(cleared.effect,'none');assert.equal(cleared.forecast,null);
 step(s,'move',{sectorId:utilityAt(s,1).id});step(s,'move',{sectorId:'gate2'});step(s,'move',{sectorId:cacheAt(s,2).id});step(s,'fight',{playerIntents:fightIntents});step(s,'move',{sectorId:'gate3'});
 const g=s.r.layout.sectors.find(x=>x.guardian);const read=sig(s,'forecast','wolf',g.id,T+CD);assert.equal(read.effect,'forecast');assert.equal(read.chargesLeft,0);
 assert.equal(sigCode(s,'forecast','wolf',utilityAt(s,3).id,T+3*CD),'signature_no_charge');
});
test('cooldown: signature_cooling with exact retryAfterMs; own anchor (a utility use never blocks a signature); refusals change nothing',()=>{
 const s=state(['ace','wolf','hare']);step(s,'move',{sectorId:'gate1'});sig(s,'forecast','wolf',cacheAt(s,1).id);const mid=structuredClone(s.r);
 assert.throws(()=>step(s,'signature',{signature:'forecast',holobotId:'wolf',targetSectorId:utilityAt(s,1).id},T+CD-1),e=>e.code==='signature_cooling'&&e.details.retryAfterMs===1);assert.deepEqual(s.r,mid);
 step(s,'move',{sectorId:utilityAt(s,1).id},T+1);assert.equal(step(s,'utility',{utility:'ace'},T+1).utilityResult.effect,'route');
 const u=state(['ace','wolf','hare']);step(u,'move',{sectorId:'gate1'});step(u,'move',{sectorId:utilityAt(u,1).id});step(u,'utility',{utility:'ace'});step(u,'move',{sectorId:'gate1'});
 assert.equal(sig(u,'forecast','wolf',cacheAt(u,1).id,T+1).effect,'forecast');
 const h=expeditionRejection(new Z.ExpeditionError('signature_cooling',{retryAfterMs:7}));assert.equal(h.code,'failed-precondition');assert.deepEqual(h.details,{rejectionCode:'signature_cooling',retryAfterMs:7});
 for(const c of ['signature_unknown','signature_not_in_squad','signature_no_charge','signature_already_armed','signature_not_here','forecast_not_ahead','nothing_to_protect','sector_slipped'])
  assert.equal(expeditionRejection(new Z.ExpeditionError(c)).code,'failed-precondition',c);
});
test('extraction running: the signature op is refused extraction_in_progress (no spend)',()=>{
 const s=state();step(s,'move',{sectorId:'gate1'});step(s,'emergency_start');const before=structuredClone(s.r);
 assert.equal(sigCode(s,'forecast','wolf',cacheAt(s,1).id),'extraction_in_progress');assert.deepEqual(s.r,before);
});
test('storage: flag-off documents read unchanged; signature bookkeeping is all-or-nothing and fails closed when malformed',()=>{
 const off=state(['ace','wolf','hare'],{signatures:false});assert.deepEqual(Object.keys(Z.readExpedition(off.r)),Object.keys(off.r));
 const s=state();assert.deepEqual(Z.readExpedition(s.r),s.r);
 for(const patch of [{signaturePool:{forecast:{charges:3,max:2,holders:['wolf']}}},{signaturePool:{forecast:{charges:1,max:2,holders:['nobody']}}},{signaturePool:{overclock:{charges:1,max:1,holders:['ace']}}},
  {forecasts:[{sectorId:'b1a',openingIntents:[],projection:'clean'}]},{forecasts:[{sectorId:'b1a',openingIntents:['strike'],projection:'great'}]},{slipOpened:['nowhere']},{protectedSlots:3},
  {signatureArmed:{kind:'forecast',holobotId:'ace'}},{signatureAtMs:T},{signaturePool:{slipstream:{charges:0,max:1,holders:['ace','hare']}}}])
  assert.throws(()=>Z.readExpedition({...s.r,...patch}),/unavailable/,JSON.stringify(patch));
 const {forecasts:_f,...partial}=s.r;assert.throws(()=>Z.readExpedition(partial),/unavailable/);
});
test('views: zone-run-3/4 views of a signature run are byte-identical to the same run without signatures; zone-run-5 adds exactly five run fields',()=>{
 const on=state(['ace','wolf','hare'],{signatures:true}),off=state(['ace','wolf','hare'],{signatures:false});
 for(const s of [on,off]){step(s,'move',{sectorId:'gate1'});step(s,'move',{sectorId:utilityAt(s,1).id});step(s,'utility',{utility:'ace'});}
 for(const w of ['zone-run-3','zone-run-4']){assert.equal(JSON.stringify(Z.runView(on.r,w)),JSON.stringify(Z.runView(off.r,w)),w);assert.equal(JSON.stringify(Z.layoutView(on.r.layout,w)),JSON.stringify(Z.layoutView(off.r.layout,w)),w);}
 const a=Z.runView(on.r,'zone-run-4'),b=Z.runView(on.r,'zone-run-5');
 assert.deepEqual(Object.keys(b).filter(k=>!(k in a)),['signaturePool','signatureArmed','forecasts','slipOpened','protectedSlots']);
 assert.ok(!('signatureAtMs' in b)&&!('privateSeed' in b)&&!('utilityAtMs' in b));assert.equal(b.schemaVersion,'zone-run-5');
 const blocked=Object.fromEntries(b.layout.sectors.map(x=>[x.id,x.signatureBlocked]));
 for(const x of on.r.layout.sectors)assert.deepEqual(blocked[x.id],x.safe?['forecast','slipstream']:x.band>=3?['slipstream']:[],x.id);
 assert.deepEqual(on.r.layout,Z.dailyLayout(T));
});
test('replies: the signature reply carries signatureResult only on zone-run-5; schemas accept v5, reject v5 shapes as v4 (known-bad both ways)',()=>{
 const s=state();step(s,'move',{sectorId:'gate1'});const x=step(s,'signature',{signature:'forecast',holobotId:'wolf',targetSectorId:cacheAt(s,1).id});
 const r5=Z.advanceReply('zone-run-5','signature',x.run,x);assert.deepEqual(Object.keys(r5),['schemaVersion','operation','run','receipt','signatureResult','alreadyProcessed']);
 assert.ok(v5(r5),JSON.stringify(v5.errors));assert.equal(v4(r5),false);
 const m=step(s,'move',{sectorId:cacheAt(s,1).id}),m4=Z.advanceReply('zone-run-4','move',m.run,m),m5=Z.advanceReply('zone-run-5','move',m.run,m);
 assert.ok(v4(m4));assert.ok(v5(m5),JSON.stringify(v5.errors));assert.equal(v5(m4),false);assert.equal(v4(m5),false);
 const tampered=structuredClone(r5);tampered.signatureResult.effect='route';assert.equal(v5(tampered),false);
 const spentNone=structuredClone(r5);spentNone.signatureResult.effect='none';assert.equal(v5(spentNone),false,'none must be unspent');
 const bonus=structuredClone(r5);bonus.signatureResult.bonus=1;assert.equal(v5(bonus),false);
});
test('frozen fixture: every reply validates against zone-run-5 (control against zone-run-4), refusals carry the documented codes',()=>{
 const {cases}=fixture;assert.equal(fixture.signatureCooldownMs,CD);
 for(const [k,c] of Object.entries(cases)){
  const schema=c.request.schemaVersion==='zone-run-4'?v4:v5;assert.ok(schema(c.request),k+' request '+JSON.stringify(schema.errors));
  if(c.reply){assert.ok(schema(c.reply),k+' reply '+JSON.stringify(schema.errors));if(schema===v5)assert.equal(v4(c.reply),false,k);}
 }
 const codes=Object.fromEntries(Object.entries(cases).filter(([,c])=>c.refusal).map(([k,c])=>[k,c.refusal.details.rejectionCode]));
 assert.deepEqual(codes,{refusedNotAhead:'forecast_not_ahead',refusedCooling:'signature_cooling',refusedNotHere:'signature_not_here',refusedFightSlipped:'sector_slipped',refusedCacheSlipped:'sector_not_cleared',
  refusedNotInSquad:'signature_not_in_squad',refusedNoCharge:'signature_no_charge',refusedUnknown:'signature_unknown'});
 assert.deepEqual(cases.refusedCooling.refusal.details,{rejectionCode:'signature_cooling',retryAfterMs:CD-1000});
 assert.equal(cases.acceptedSlipstream.reply.signatureResult.opensSectorId,'gate2');assert.equal(cases.moveThroughSlip.reply.run.sectorId,'gate2');
 assert.equal(cases.starterPointFirst.reply.utilityResult.effect,'route');assert.equal(cases.starterSignatureNone.reply.signatureResult.effect,'none');
 assert.ok(!('signaturePool' in cases.v4Control.reply.run));
});
test('fixture is reproducible from the host code (regenerate on any ruling change)',async()=>{
 const {execFileSync}=await import('node:child_process'),{mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const dir=mkdtempSync(join(tmpdir(),'zone-run-5-')),out=join(dir,'signatures.json');
 try{execFileSync(process.execPath,[new URL('./generate-zone-run-5-fixture.mjs',import.meta.url).pathname,out],{stdio:'ignore'});
  assert.equal(readFileSync(out,'utf8'),readFileSync(new URL('./fixtures/zone-run-5/signatures.json',import.meta.url),'utf8'));}finally{rmSync(dir,{recursive:true,force:true});}
});
test('profile helper sanity: squads use existing catalog bots only',()=>{assert.equal(squadProfile(['ace']).holobots[0].name,'ACE');});
