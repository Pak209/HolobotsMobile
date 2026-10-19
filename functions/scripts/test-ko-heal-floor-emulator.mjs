// ko-heal-floor-1 (HolobotsUnity DECISIONS #72.1, Pak 2026-10-18 "floor + item"): a heal on a knocked-out Holobot (HP 0, or
// below the 40 % fallback of DECISIONS #57) starts FROM that floor: result = min(max, floor + item). Before this, Emergency
// Patch on a KO'd bot healed from 0 (25 %), so the next rival duel started BELOW the unhealed 40 % fallback
// (Documentation/QA/2026-10-18-healing-items-playtest-1 item b2). Driven through the deployed onCall wrappers.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Demo loopback emulator required');
const {db}=require('../lib/admin.js');
const {duelHealingHost}=require('../lib/duels/duelHealingHost.js');const {desktopItemsHost}=require('../lib/vendors/desktopItemsHost.js');
const {rivalBattleHost}=require('../lib/rival/rivalBattleHost.js');const {workshopHealHost}=require('../lib/workshop/workshopHealHost.js');
let serial=0;
const BOTS=[{name:'SHADOW',level:1},{name:'ACE',level:1},{name:'KUMA',level:1}];
const setup=async()=>{const uid='kofloor_'+Date.now()+'_'+serial++;await db.doc(`users/${uid}`).set({storyFlags:{arenaGatheringSeen:false,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:true},holobots:BOTS,travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['shadow','ace','kuma']},emergencyPatches:3,itemStocks:{repair_kit:3,full_restore:3}});return uid;};
const get=async uid=>(await db.doc(`users/${uid}`).get()).data();
const code=e=>e.details?.rejectionCode??e.code;
const duel=(uid,data)=>duelHealingHost.run({auth:{uid},data:{schemaVersion:'duel-healing-1',...data}});
const item=(uid,itemId,holobotId,requestId)=>desktopItemsHost.run({auth:{uid},data:{schemaVersion:'desktop-items-2',operation:'use',itemId,holobotId,requestId}});
const rival=(uid,data)=>rivalBattleHost.run({auth:{uid},data:{schemaVersion:'rival-battle-3',...data}});
const rearm=uid=>db.doc(`rivalBattles/${uid}`).set({rivalLastSettledAtMs:{}},{merge:true});
const ITEMS=[['item.emergency_patch','Emergency Patch',.25],['item.repair_kit','Repair Kit',.5],['item.full_restore','Full Restore',1]];
/** A real rival issue seeds the ledger; a loss settle leaves ace at hpOf(max) (others untouched). */
async function aceAt(hpOf){const uid=await setup();const first=await rival(uid,{operation:'issue',healthSchema:'rival-health-1'});
 const max=first.playerCombatants.find(p=>p.holobotId==='ace').maxHealth,hp=hpOf(max);
 await rival(uid,{operation:'settle',battleId:first.battleId,didWin:false,healthSchema:'rival-health-1',health:first.playerCombatants.map(p=>({holobotId:p.holobotId,currentHealth:p.holobotId==='ace'?hp:p.currentHealth}))});
 await rearm(uid);assert.equal((await get(uid)).holobotVitals.ace.currentHealth,hp);return {uid,max,hp};}
const issueAce=async uid=>(await rival(uid,{operation:'issue',healthSchema:'rival-health-1'})).playerCombatants.find(p=>p.holobotId==='ace').currentHealth;
/** The rule (DECISIONS #72.1): start from the 40 % floor when below it; never above max. */
const expected=(hp,max,f)=>Math.min(max,Math.round((Math.max(hp,max*.4)+max*f)*1e6)/1e6);

test('known-bad (b2): KO ace -> Emergency Patch -> next rival issue is NOT below the 40 % fallback',async()=>{
 const {uid,max}=await aceAt(()=>0);
 const r=await item(uid,'item.emergency_patch','ace','patch');
 assert.equal(r.result.kind,'repair');
 assert.ok(r.result.currentHealth>=max*.4,`Patch on a KO'd bot left ${r.result.currentHealth}/${max}, below the unhealed 40 % fallback ${max*.4}`);
 assert.equal(r.result.currentHealth,expected(0,max,.25));
 assert.equal(await issueAce(uid),r.result.currentHealth,'rival issue presents the healed value');
});

test('control: an UNHEALED KO bot still enters its next rival duel at the 40 % fallback (#57 unchanged)',async()=>{
 const {uid,max}=await aceAt(()=>0);assert.equal(await issueAce(uid),max*.4);
});

for(const [label,hpOf] of [['KO (0 HP)',()=>0],['wounded below the floor (20 %)',m=>Math.round(m*.2)],['healthy (60 %)',m=>Math.round(m*.6)]]){
 for(const [itemId,name,f] of ITEMS){
  test(`${name} on a ${label} bot: reply result = final HP; ledger + next rival issue match`,async t=>{
   const {uid,max,hp}=await aceAt(hpOf);const r=await item(uid,itemId,'ace','use_'+itemId.replace(/\W/g,'_'));
   const want=expected(hp,max,f);t.diagnostic(`TABLE ${name} | ${label} | before=${hp}/${max} | old=${Math.min(max,hp+max*f)} | new=${r.result.currentHealth}`);
   assert.deepEqual(Object.keys(r.result).sort(),['currentHealth','holobotId','itemId','kind','maxHealth'],'wire shape unchanged');
   assert.equal(r.result.kind,'repair');assert.equal(r.result.maxHealth,max);assert.equal(r.result.currentHealth,want);
   assert.ok(r.result.currentHealth>=max*.4,'never below the fallback after any heal');
   assert.equal((await get(uid)).holobotVitals.ace.currentHealth,want);
   assert.equal(await issueAce(uid),want,'rival issue presents the floored value');
  });
 }
}

test('duel_repair: a KO bench bot healed mid rival duel starts from the floor; settles onto the ledger; next issue matches',async()=>{
 const {uid,max}=await aceAt(()=>0);const issue=await rival(uid,{operation:'issue',healthSchema:'rival-health-1'});
 const run=await duel(uid,{operation:'issue',fielded:['shadow']});
 // The duel run carries the issued (fallback) vitals; the bench bot then drops to 0 in-duel via observe.
 const rows=['shadow','ace','kuma'].map(id=>({holobotId:id,currentHealth:id==='ace'?0:run.vitals[id].currentHealth}));
 await duel(uid,{operation:'observe',runId:run.runId,health:rows});
 const r=await item(uid,'item.emergency_patch','ace','bench');
 assert.equal(r.result.kind,'duel_repair');assert.equal(r.result.currentHealth,expected(0,max,.25));
 const ev=(await db.doc(`duelHealingRuns/${uid}`).get()).data().heals.at(-1);assert.equal(ev.before,0);assert.equal(ev.after,r.result.currentHealth);
 const settleRows=rows.map(x=>x.holobotId==='ace'?{...x,currentHealth:r.result.currentHealth}:x);
 await duel(uid,{operation:'settle',runId:run.runId,health:settleRows});
 await rival(uid,{operation:'settle',battleId:issue.battleId,didWin:false,healthSchema:'rival-health-1',health:settleRows});
 assert.equal((await get(uid)).holobotVitals.ace.currentHealth,r.result.currentHealth);await rearm(uid);
 assert.equal(await issueAce(uid),r.result.currentHealth);
});

test('a non-multiple-of-five max (192) gets a clean host number: no float noise in the {hp}/{max} the client prints',async t=>{
 // 192*.4 + 192*.25 is 124.80000000000001 in doubles; Unity HealingItems.UsedLine prints result.currentHealth verbatim.
 const uid=await setup();await db.doc(`users/${uid}`).update({holobotVitals:{ace:{currentHealth:0,maxHealth:192}}});
 const r=await item(uid,'item.emergency_patch','ace','p192');t.diagnostic(`KO + Patch at max 192 = ${r.result.currentHealth}/${r.result.maxHealth}`);
 assert.equal(r.result.currentHealth,124.8);assert.equal((await get(uid)).holobotVitals.ace.currentHealth,124.8);
});

test('Workshop unaffected: a KO bot heals to full (cost 0)',async()=>{
 const {uid,max}=await aceAt(()=>0);
 const w=await workshopHealHost.run({auth:{uid},data:{schemaVersion:'healing-workshop-1',operation:'heal',requestId:'ws'}});
 assert.equal(w.vitals.ace.currentHealth,max);assert.equal(w.cost,0);assert.equal(await issueAce(uid),max);
});

test('guards unchanged: full bot already_full; Arena arena_no_heal; nothing written on refusal',async()=>{
 const {uid}=await aceAt(m=>m);await assert.rejects(()=>item(uid,'item.emergency_patch','ace','full'),e=>code(e)==='already_full');
 const k=await aceAt(()=>0);await db.doc(`arenaMatches/${k.uid}`).set({schemaVersion:'arena-healing-1',matchId:'m',open:true});const before=await get(k.uid);
 await assert.rejects(()=>item(k.uid,'item.emergency_patch','ace','ar'),e=>code(e)==='arena_no_heal');assert.deepEqual(await get(k.uid),before);
});
