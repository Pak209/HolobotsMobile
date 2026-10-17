import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:18089'||process.env.GCLOUD_PROJECT!=='demo-holobots-citizen-rival')throw Error('Dedicated loopback demo emulator only');
const {db}=require('../lib/admin'),{transactRivalBattle}=require('../lib/rival/rivalBattleStore');
let serial=0;const now=Date.UTC(2026,9,17);
async function setup(){const uid=`movement_throwaway_${Date.now()}_${serial++}`;await db.doc(`users/${uid}`).set({holobots:[{name:'WOLF',level:1,boostedAttributes:{speed:1}}],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['wolf']},rivalWins:0});return uid;}
after(()=>db.terminate());
test('real issue publishes host source speed and final mapped speeds after Zell binding',async()=>{
 const uid=await setup();const r=await transactRivalBattle(db,uid,{operation:'issue',schemaVersion:'rival-battle-3',storySchema:'zell-story-1',rivalId:'zell'},now,()=>0.5,{zellEnabled:true,issueLegacy:true});
 assert.equal(r.battlefieldMovement.schemaVersion,'battlefield-movement-1');assert.equal(r.battlefieldMovement.player[0].sourceSpeedStat,51);assert.equal(r.battlefieldMovement.player[0].runMmPerSecond,3060);
 assert.equal(r.battlefieldMovement.opponent[0].holobotId,'jusan');assert.equal(r.battlefieldMovement.opponent[0].runMmPerSecond,2400);assert.equal(r.duel.mode,'legacy');
 const stored=(await db.doc(`rivalBattles/${uid}/battles/${r.battleId}`).get()).data();assert.equal(stored.duel.mode,'legacy');assert.equal('movement' in stored.duel,false);
});
test('legacy v1/v2 issues publish no movement block',async()=>{
 for(const schemaVersion of ['rival-battle-1','rival-battle-2']){const uid=await setup();const r=await transactRivalBattle(db,uid,{operation:'issue',schemaVersion},now,()=>0.5,{issueLegacy:true});assert.equal('battlefieldMovement' in r,false);}
});
