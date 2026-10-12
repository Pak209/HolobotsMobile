// Real host transaction/callable proof. Demo emulator only; never production.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'') || !process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw new Error('Loopback demo Firestore emulator required');
const {db}=require('../lib/admin.js');
const {holoZoneHost}=require('../lib/holozone/holoZoneHost.js');
const {transactDesktopItems}=require('../lib/vendors/desktopItemsHost.js');
const {transactRivalBattle}=require('../lib/rival/rivalBattleStore.js');
const FLAG='rival-health-1';let serial=0;
async function setup(extra={}) {
 const uid=`zone_ko_${Date.now()}_${serial++}`;
 await db.doc(`users/${uid}`).set({holobots:[{name:'ACE',level:4,experience:1700,nextLevelExp:2500,rank:'Starter',attributePoints:1,boostedAttributes:{attack:3,health:20}},{name:'KUMA',level:1,experience:350,nextLevelExp:400,attributePoints:0}],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']},emergencyPatches:1,holobotVitals:{ace:{currentHealth:0,maxHealth:192}},...extra});return uid;
}
const user=async uid=>(await db.doc(`users/${uid}`).get()).data();
const runs=async uid=>(await db.doc(`holoZoneRuns/${uid}`).get()).data();
const issue=(uid,extra={})=>holoZoneHost.run({auth:{uid},data:{operation:'issue',zoneId:'neonforest',...extra}});

test('KO refusal: zero ledger HP cannot issue a zone run (all versions, health flag cannot bypass)',async()=>{
 for(const schemaVersion of [undefined,'holozone-run-1','holozone-run-2'])for(const healthSchema of [undefined,FLAG]) {
  const uid=await setup();const before=[await user(uid),await runs(uid)];
  const request={...(schemaVersion?{schemaVersion}:{}),...(healthSchema?{healthSchema}:{})};
  await assert.rejects(async()=>{const reply=await issue(uid,request);console.log('KNOWN-BAD accepted zero-HP zone run',JSON.stringify({request,runId:reply.runId,currentHealth:reply.playerCombatants?.[0]?.currentHealth}));},e=>e.code==='failed-precondition' && e.details?.rejectionCode==='holobot_ko');
  assert.deepEqual([await user(uid),await runs(uid)],before,'refusal writes neither health nor run');
 }
});

test('existing emergency patch repairs 25 percent and the zone then accepts the bot',async()=>{
 const uid=await setup();await assert.rejects(()=>issue(uid,{healthSchema:FLAG}),e=>e.details?.rejectionCode==='holobot_ko');
 await transactDesktopItems(db,uid,{schemaVersion:'desktop-items-2',operation:'use',itemId:'item.emergency_patch',requestId:'zone_ko_patch_1',holobotId:'ace'});
 const repaired=await user(uid);assert.equal(repaired.holobotVitals.ace.currentHealth,48);assert.equal(repaired.emergencyPatches,0);
 const reply=await issue(uid,{schemaVersion:'holozone-run-2',healthSchema:FLAG});assert.equal(reply.playerCombatants[0].currentHealth,48);assert.equal(reply.playerCombatants[0].maxHealth,192);assert.ok(reply.runId);
});

test('city rival issue retains 40 percent recovery, unaffected by zone policy',async()=>{
 const uid=await setup();const reply=await transactRivalBattle(db,uid,{schemaVersion:'rival-battle-3',operation:'issue',healthSchema:FLAG});
 assert.equal(reply.playerCombatants[0].currentHealth,192*.4);assert.equal((await user(uid)).holobotVitals.ace.currentHealth,192*.4);
});

test('positive HP, missing ledger and an unselected KO bot keep accepted reply shapes',async()=>{
 for(const extra of [{holobotVitals:{ace:{currentHealth:1,maxHealth:192},kuma:{currentHealth:0,maxHealth:200}}},{holobotVitals:{}}]) {
  const uid=await setup(extra);const before=await user(uid);const plain=await issue(uid,{schemaVersion:'holozone-run-1'});assert.equal('playerCombatants' in plain,false);assert.deepEqual((await user(uid)).holobotVitals,before.holobotVitals);
  const flagged=await issue(uid,{healthSchema:FLAG});assert.equal(flagged.playerCombatants[0].currentHealth,extra.holobotVitals.ace?.currentHealth??192);
 }
});

test('refused reissue never closes an existing run; malformed ledger fails closed even without flag',async()=>{
 const uid=await setup({holobotVitals:{ace:{currentHealth:1,maxHealth:192}}});await issue(uid,{healthSchema:FLAG});
 await db.doc(`users/${uid}`).update({'holobotVitals.ace.currentHealth':0});const before=[await user(uid),await runs(uid)];
 await assert.rejects(()=>issue(uid),e=>e.details?.rejectionCode==='holobot_ko');assert.deepEqual([await user(uid),await runs(uid)],before);
 const malformed=await setup({holobotVitals:{ace:{currentHealth:-1,maxHealth:192}}});await assert.rejects(()=>issue(malformed),e=>e.details?.rejectionCode==='unavailable');assert.equal(await runs(malformed),undefined);
});
