// duel-healing-host-fix-1 (Holocity healing-items-playtest-1 c1/c2/c3, DECISIONS #57): the bench heal inside a REAL town
// rival duel, driven through the deployed onCall wrappers in the order Unity sends (DuelHealingRun.cs / RivalBattleFlow.cs):
// rivalBattleHost issue (healthSchema rival-health-1) -> duelHealingHost issue (engage) -> desktopItemsHost use (bench) ->
// duelHealingHost settle (AnyBattleClosed, PilotBattleDirector L605) -> rivalBattleHost settle (BattleEnded, L612).
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Demo loopback emulator required');
const {db}=require('../lib/admin.js');
const {duelHealingHost}=require('../lib/duels/duelHealingHost.js');const {desktopItemsHost}=require('../lib/vendors/desktopItemsHost.js');
const {rivalBattleHost}=require('../lib/rival/rivalBattleHost.js');const {workshopHealHost}=require('../lib/workshop/workshopHealHost.js');
let serial=0;
const BOTS=[{name:'SHADOW',level:1},{name:'ACE',level:1},{name:'KUMA',level:1}];
const setup=async(extra={})=>{const uid='duelheal_'+Date.now()+'_'+serial++;await db.doc(`users/${uid}`).set({storyFlags:{arenaGatheringSeen:false,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:true},holobots:BOTS,travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['shadow','ace','kuma']},emergencyPatches:2,itemStocks:{repair_kit:3,full_restore:1},...extra});return uid;};
const get=async uid=>(await db.doc(`users/${uid}`).get()).data();
const code=e=>e.details?.rejectionCode??e.code;
const duel=(uid,data)=>duelHealingHost.run({auth:{uid},data:{schemaVersion:'duel-healing-1',...data}});
const item=(uid,itemId,holobotId,requestId)=>desktopItemsHost.run({auth:{uid},data:{schemaVersion:'desktop-items-2',operation:'use',itemId,holobotId,requestId}});
const rival=(uid,data)=>rivalBattleHost.run({auth:{uid},data:{schemaVersion:'rival-battle-3',...data}});
const workshop=uid=>workshopHealHost.run({auth:{uid},data:{schemaVersion:'healing-workshop-1',operation:'heal',requestId:'ws'}});
// Hurt ledger (Pak's build-14 shape: SHADOW fielded and hurt; ACE benched and hurt).
async function hurtSquad(){const uid=await setup();
 // A first rival issue seeds the ledger at max for every squad bot (missing rows = fresh), then the test hurts it.
 const first=await rival(uid,{operation:'issue',healthSchema:'rival-health-1'});
 await rival(uid,{operation:'settle',battleId:first.battleId,didWin:false,healthSchema:'rival-health-1',health:first.playerCombatants.map(p=>({holobotId:p.holobotId,currentHealth:Math.floor(p.currentHealth*.4)}))});
 // Re-arm the same-rival cooldown so the next issue is legal (test clock only; no rule changed).
 await db.doc(`rivalBattles/${uid}`).set({rivalLastSettledAtMs:{}},{merge:true});
 return uid;}

test('c1: duel-healing issue opens INSIDE the pilot duel whose rival battle is open (Unity order)',async()=>{
 const uid=await hurtSquad();
 const issue=await rival(uid,{operation:'issue',healthSchema:'rival-health-1'});
 const run=await duel(uid,{operation:'issue',fielded:['shadow']});
 assert.equal(run.open,true);assert.deepEqual(run.squad,['shadow','ace','kuma']);assert.deepEqual(run.fielded,['shadow']);
 for(const p of issue.playerCombatants)assert.equal(run.vitals[p.holobotId].currentHealth,p.currentHealth);
 assert.equal(Object.hasOwn(run,'rivalBattleId'),false,'no new wire field on the issue reply');
 assert.equal((await db.doc(`duelHealingRuns/${uid}`).get()).data().rivalBattleId,issue.battleId,'run bound to the duel\'s own rival battle');
 await assert.rejects(()=>duel(uid,{operation:'issue',fielded:['shadow']}),e=>code(e)==='battle_open');
 // Unchanged: the reverse order still refuses (an open run holds the lease).
 await assert.rejects(()=>rival(uid,{operation:'issue',healthSchema:'rival-health-1'}),e=>code(e)==='too_many_open');
});

test('guards kept: zone run, arena, ambiguous open rival battles still refuse the issue',async()=>{
 const a=await hurtSquad();await db.doc(`arenaMatches/${a}`).set({schemaVersion:'arena-healing-1',matchId:'m',open:true});
 await assert.rejects(()=>duel(a,{operation:'issue',fielded:['shadow']}),e=>code(e)==='arena_no_heal');
 const z=await hurtSquad();const now=Date.now();await db.doc(`holoZoneRuns/${z}`).set({schemaVersion:'holozone-runs-1',runs:[{runId:'zone',zoneId:'neonforest',tier:0,squad:['shadow'],issuedAtMs:now,expiresAtMs:now+600000,closedAtMs:null,settlement:null,progression:null}]});
 await assert.rejects(()=>duel(z,{operation:'issue',fielded:['shadow']}),e=>code(e)==='battle_open');
 // Ambiguous: more than one open rival battle (legacy no-health issues allow up to 3) -> no binding, battle_open.
 const m=await hurtSquad();await rival(m,{operation:'issue'});await db.doc(`rivalBattles/${m}`).set({rivalLastSettledAtMs:{}},{merge:true});await rival(m,{operation:'issue'});
 await assert.rejects(()=>duel(m,{operation:'issue',fielded:['shadow']}),e=>code(e)==='battle_open');
});

// The run doc exactly as duelHealingHost issue writes it (plus the binding), so c2 is reproducible on a host where c1 still refuses.
const seedRun=async(uid,rivalBattleId)=>{const p=await get(uid);const squad=['shadow','ace','kuma'];const vitals=Object.fromEntries(squad.map(id=>[id,{...p.holobotVitals[id]}]));
 const rec={schemaVersion:'duel-healing-1',runId:'seeded_'+uid,open:true,squad,fielded:['shadow'],vitals,heals:[],switchLockedUntilMs:0,issuedAtMs:Date.now(),rivalBattleId};await db.doc(`duelHealingRuns/${uid}`).set(rec);return rec;};
test('c2 isolated: run open + its rival battle open, benched ace -> duel_repair (not between_battles_only)',async()=>{
 const uid=await hurtSquad();const issue=await rival(uid,{operation:'issue',healthSchema:'rival-health-1'});const run=await seedRun(uid,issue.battleId);
 const r=await item(uid,'item.repair_kit','ace','iso');assert.equal(r.result.kind,'duel_repair');assert.equal(r.result.runId,run.runId);
 await assert.rejects(()=>item(uid,'item.repair_kit','shadow','iso2'),e=>code(e)==='bench_only');
});

test('c4 isolated: after a settled bench heal, the rival settle (presented HP above its issue) still lands and keeps the heal',async()=>{
 const uid=await hurtSquad();const issue=await rival(uid,{operation:'issue',healthSchema:'rival-health-1'});const run=await seedRun(uid,issue.battleId);
 const ace=run.vitals.ace,healed=Math.min(ace.maxHealth,ace.currentHealth+ace.maxHealth*.5);
 await db.doc(`duelHealingRuns/${uid}`).update({'vitals.ace.currentHealth':healed,heals:[{requestId:'h',itemId:'item.repair_kit',holobotId:'ace',before:ace.currentHealth,after:healed,usedAtMs:Date.now()}]});
 const rows=['shadow','ace','kuma'].map(id=>({holobotId:id,currentHealth:id==='ace'?healed:run.vitals[id].currentHealth}));
 await duel(uid,{operation:'settle',runId:run.runId,health:rows});assert.equal((await get(uid)).holobotVitals.ace.currentHealth,healed);
 const settled=await rival(uid,{operation:'settle',battleId:issue.battleId,didWin:false,healthSchema:'rival-health-1',health:rows});assert.equal(settled.battleId,issue.battleId);
 assert.equal((await get(uid)).holobotVitals.ace.currentHealth,healed,'the rival settle does not undo the duel-settled heal');
});

test('c2: bench heal mid rival duel answers duel_repair; fielded bench_only; Workshop battle_open; settles with the duel',async()=>{
 const uid=await hurtSquad();const issue=await rival(uid,{operation:'issue',healthSchema:'rival-health-1'});const run=await duel(uid,{operation:'issue',fielded:['shadow']});
 const before=await get(uid);const aceStart=run.vitals.ace.currentHealth,aceMax=run.vitals.ace.maxHealth;
 await assert.rejects(()=>item(uid,'item.repair_kit','shadow','fielded'),e=>code(e)==='bench_only');
 await assert.rejects(()=>workshop(uid),e=>code(e)==='battle_open');
 const r=await item(uid,'item.repair_kit','ace','bench');
 assert.equal(r.result.kind,'duel_repair');assert.equal(r.result.runId,run.runId);assert.equal(r.result.holobotId,'ace');
 assert.equal(r.result.currentHealth,Math.min(aceMax,aceStart+aceMax*.5));
 let p=await get(uid);assert.equal(p.itemStocks.repair_kit,before.itemStocks.repair_kit-1);assert.deepEqual(p.holobotVitals,before.holobotVitals,'no ledger HP until the duel settles');
 await assert.rejects(()=>item(uid,'item.repair_kit','kuma','lock'),e=>code(e)==='switch_lockout');
 const healed=r.result.currentHealth,shadowEnd=Math.floor(run.vitals.shadow.currentHealth/2);
 // Unity order: duel settle at AnyBattleClosed, then the rival settle (rows = presented HP, the healed bench bot ABOVE its rival issue).
 const rows=[{holobotId:'shadow',currentHealth:shadowEnd},{holobotId:'ace',currentHealth:healed},{holobotId:'kuma',currentHealth:run.vitals.kuma.currentHealth}];
 const s=await duel(uid,{operation:'settle',runId:run.runId,health:rows});assert.equal(s.vitals.ace.currentHealth,healed);assert.equal(s.heals.length,1);
 const settle=await rival(uid,{operation:'settle',battleId:issue.battleId,didWin:false,healthSchema:'rival-health-1',health:rows});assert.equal(settle.battleId,issue.battleId);
 p=await get(uid);assert.equal(p.holobotVitals.ace.currentHealth,healed,'heal settled with the duel');assert.equal(p.holobotVitals.shadow.currentHealth,shadowEnd);
 await rival(uid,{operation:'settle',battleId:issue.battleId,didWin:false,healthSchema:'rival-health-1',health:rows});
 assert.deepEqual((await get(uid)).holobotVitals,p.holobotVitals,'rival replay writes nothing');
});

test('c2 reverse settle order: rival settle first, then the duel settle; the heal still lands',async()=>{
 const uid=await hurtSquad();const issue=await rival(uid,{operation:'issue',healthSchema:'rival-health-1'});const run=await duel(uid,{operation:'issue',fielded:['shadow']});
 const r=await item(uid,'item.full_restore','kuma','bench');assert.equal(r.result.kind,'duel_repair');
 const rows=[{holobotId:'shadow',currentHealth:0},{holobotId:'ace',currentHealth:run.vitals.ace.currentHealth},{holobotId:'kuma',currentHealth:r.result.currentHealth}];
 await rival(uid,{operation:'settle',battleId:issue.battleId,didWin:false,healthSchema:'rival-health-1',health:rows});
 await duel(uid,{operation:'settle',runId:run.runId,health:rows});
 const p=await get(uid);assert.equal(p.holobotVitals.kuma.currentHealth,r.result.maxHealth);assert.equal(p.holobotVitals.shadow.currentHealth,0);
});

test('c2 controls: no run + open rival battle stays between_battles_only; Arena stays arena_no_heal',async()=>{
 const uid=await hurtSquad();await rival(uid,{operation:'issue',healthSchema:'rival-health-1'});const before=await get(uid);
 await assert.rejects(()=>item(uid,'item.repair_kit','ace','nr'),e=>code(e)==='between_battles_only');assert.deepEqual(await get(uid),before);
 // A run bound to a DIFFERENT battle than the open one does not unlock heals.
 const o=await hurtSquad();await rival(o,{operation:'issue',healthSchema:'rival-health-1'});await seedRun(o,'rb_000000000000000000000000');
 await assert.rejects(()=>item(o,'item.repair_kit','ace','other'),e=>code(e)==='between_battles_only');
 const a=await hurtSquad();const ai=await rival(a,{operation:'issue',healthSchema:'rival-health-1'});await seedRun(a,ai.battleId);
 await db.doc(`arenaMatches/${a}`).set({schemaVersion:'arena-healing-1',matchId:'m',open:true});
 await assert.rejects(()=>item(a,'item.repair_kit','ace','ar'),e=>code(e)==='arena_no_heal');
});

test('c3: an account with no health rows opens a run at full vitals (rows seeded at max)',async()=>{
 const uid=await setup();assert.equal((await get(uid)).holobotVitals,undefined);
 const run=await duel(uid,{operation:'issue',fielded:['ace']});
 for(const id of ['shadow','ace','kuma']){assert.ok(run.vitals[id].maxHealth>0);assert.equal(run.vitals[id].currentHealth,run.vitals[id].maxHealth);}
 assert.deepEqual((await get(uid)).holobotVitals,run.vitals,'ledger rows seeded at max (settle needs them)');
 const s=await duel(uid,{operation:'settle',runId:run.runId,health:['shadow','ace','kuma'].map(id=>({holobotId:id,currentHealth:id==='ace'?1:run.vitals[id].currentHealth}))});
 assert.equal(s.vitals.ace.currentHealth,1);assert.equal((await get(uid)).holobotVitals.ace.currentHealth,1);
 // Malformed existing rows still fail closed.
 const bad=await setup({holobotVitals:{ace:{currentHealth:-1,maxHealth:150}}});
 await assert.rejects(()=>duel(bad,{operation:'issue',fielded:['ace']}),e=>code(e)==='health_unavailable');
});
