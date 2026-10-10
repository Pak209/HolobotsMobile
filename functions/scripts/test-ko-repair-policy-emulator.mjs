import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||!(process.env.GCLOUD_PROJECT??'').startsWith('demo-'))throw Error('Loopback demo emulator required; never production');
const {db}=require('../lib/admin.js');
const {transactRivalBattle}=require('../lib/rival/rivalBattleStore.js');
const {transactHoloZoneRun}=require('../lib/holozone/holoZoneStore.js');
const {transactDesktopItems,desktopItemsHost}=require('../lib/vendors/desktopItemsHost.js');
const H={schemaVersion:'rival-battle-3',healthSchema:'rival-health-1'};
const Z={schemaVersion:'holozone-run-2',healthSchema:'rival-health-1'};
const T=Date.UTC(2026,9,10,16);let serial=0;
const seed=async(hp,stock=2)=>{const uid='ko_'+Date.now()+'_'+serial++;const p={buddyUnits:{light:0,medium:0,heavy:0},holosTokens:0,holobots:[{name:'ACE',level:1,experience:0,nextLevelExp:400,attributePoints:0}],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']},emergencyPatches:stock};if(hp!==undefined)p.holobotVitals={ace:{currentHealth:hp,maxHealth:160}};await db.doc('users/'+uid).set(p);return uid;};
const user=async uid=>(await db.doc('users/'+uid).get()).data();
const repair=(id='repair_1')=>({schemaVersion:'desktop-items-2',operation:'use',itemId:'item.emergency_patch',requestId:id,holobotId:'ace'});
const rival=(uid,data,now=T)=>transactRivalBattle(db,uid,{...H,...data},now);
const zone=(uid,data,now=T)=>transactHoloZoneRun(db,uid,{...Z,...data},now);

test('known-bad: rival loss at zero stays zero on reconnect and the next rival and zone issue',async()=>{
 const uid=await seed();const i=await rival(uid,{operation:'issue'});const max=i.playerCombatants[0].maxHealth;
 await rival(uid,{operation:'settle',battleId:i.battleId,didWin:false,fielded:['ace'],health:[{holobotId:'ace',currentHealth:0}]},T+30000);
 assert.equal((await user(uid)).holobotVitals.ace.currentHealth,0);
 const j=await rival(uid,{operation:'issue'},T+31000);assert.equal(j.playerCombatants[0].currentHealth,0);assert.equal(j.playerCombatants[0].maxHealth,max);
 await rival(uid,{operation:'settle',battleId:j.battleId,didWin:false,fielded:['ace'],health:[{holobotId:'ace',currentHealth:0}]},T+62000);
 const z=await zone(uid,{operation:'issue',zoneId:'neonforest'},T+63000);assert.equal(z.playerCombatants[0].currentHealth,0);assert.equal((await user(uid)).holobotVitals.ace.currentHealth,0);
});
test('known-bad: zone issue cannot heal zero; open zone refuses repair, closed zone permits accepted repair',async()=>{
 const uid=await seed(0);const z=await zone(uid,{operation:'issue',zoneId:'neonforest'});assert.equal(z.playerCombatants[0].currentHealth,0);
 const before=await user(uid);await assert.rejects(()=>transactDesktopItems(db,uid,repair(),T+1000),/between_battles_only/);assert.deepEqual(await user(uid),before);
 assert.equal((await db.doc('itemInventories/'+uid+'/receipts/repair_1').get()).exists,false);
 await zone(uid,{operation:'settle',runId:z.runId,kills:0,bossDefeated:false,fielded:[],health:[{holobotId:'ace',currentHealth:0}]},T+30000);
 const r=await transactDesktopItems(db,uid,repair(),T+31000);assert.equal(r.result.kind,'repair');assert.equal(r.result.currentHealth,z.playerCombatants[0].maxHealth*.25);
 const next=await rival(uid,{operation:'issue'},T+32000);assert.equal(next.playerCombatants[0].currentHealth,r.result.currentHealth);
});
test('duplicate repair retries spend once; changing the target under the same id refuses',async()=>{
 const uid=await seed(0);const rs=await Promise.all(Array.from({length:4},()=>transactDesktopItems(db,uid,repair(),T)));
 assert.equal(rs.filter(r=>!r.alreadyProcessed).length,1);assert.ok(rs.every(r=>r.result.currentHealth===40));const p=await user(uid);assert.equal(p.emergencyPatches,1);assert.equal(p.holobotVitals.ace.currentHealth,40);
 await assert.rejects(()=>transactDesktopItems(db,uid,{...repair(),holobotId:'ken'},T+1),/sequence_conflict/);assert.deepEqual(await user(uid),p);
});
test('independent concurrent repairs cannot spend one patch twice',async()=>{
 const uid=await seed(0,1);const rs=await Promise.allSettled([1,2].map(n=>transactDesktopItems(db,uid,repair('unique_'+n),T)));
 assert.equal(rs.filter(r=>r.status==='fulfilled').length,1);assert.equal(rs.find(r=>r.status==='rejected').reason.code,'no_item');const p=await user(uid);assert.equal(p.emergencyPatches,0);assert.equal(p.holobotVitals.ace.currentHealth,40);
});
test('open rival refuses repair without stock, ledger or receipt changes',async()=>{
 const uid=await seed(0);await rival(uid,{operation:'issue'});const before=await user(uid);await assert.rejects(()=>transactDesktopItems(db,uid,repair(),T+1),/between_battles_only/);assert.deepEqual(await user(uid),before);assert.equal((await db.doc('itemInventories/'+uid+'/receipts/repair_1').get()).exists,false);
});
test('callable requires authentication and refuses spoofed health/amount before writes',async()=>{
 await assert.rejects(()=>desktopItemsHost.run({data:repair()}),e=>e.code==='unauthenticated');const uid=await seed(0);const before=await user(uid);
 for(const extra of [{currentHealth:160},{amount:9},{uid:'other'}])await assert.rejects(()=>desktopItemsHost.run({auth:{uid},data:{...repair(),...extra}}),e=>e.details?.rejectionCode==='invalid_request');assert.deepEqual(await user(uid),before);
});
test('old clients without health opt-in leave an existing zero ledger untouched',async()=>{
 const uid=await seed(0);const before=await user(uid);const r=await transactRivalBattle(db,uid,{schemaVersion:'rival-battle-3',operation:'issue'},T);assert.equal('currentHealth' in r.playerCombatants[0],false);assert.deepEqual((await user(uid)).holobotVitals,before.holobotVitals);
});
