import test from 'node:test';
import assert from 'node:assert/strict';
import {pinFlags,withFlags} from './lib/flag-env.mjs';
// Pre-existing tests pin the flag-OFF (pre-#72.78) speed table; the ON counterpart follows the JUSAN test.
pinFlags({HOLOCITY_FIGHT_ATTRS:undefined});
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const M=require('../lib/lib/battlefieldMovement'),D=require('../lib/desktop/desktopAccountReply'),L=require('../lib/lib/rivalLadder');
const Z=require('../lib/lib/zellStory'),G=require('../lib/story/gatheringRival'),A=require('../lib/story/arenaGathering');
const speeds={ace:3200,wolf:3000,hare:3200,shadow:3000,ken:2600,tsuin:2600,wake:2400,jusan:2400,kurai:2400,era:2200,gama:2000,kuma:1600,tora:1600};
test('known-bad control: raw host speed alone reverses the producer WOLF/TORA grouping',()=>{
 assert.ok(M.movementReference('tora','player').referenceSpeedStat>M.movementReference('wolf','player').referenceSpeedStat);
 assert.ok(speeds.tora<speeds.wolf);
});
test('all 13 bots preserve the producer L1 calibration on player and rival source curves',()=>{
 assert.equal(M.FLEET_IDS.length,13);const c=M.battlefieldMovementCatalog();assert.equal(c.fleet.length,13);
 for(const [id,mm] of Object.entries(speeds))for(const source of ['player','rival']){
  const ref=M.movementReference(id,source),v=M.battlefieldMovement(id,ref.referenceSpeedStat,source);
  assert.equal(v.runMmPerSecond,mm);assert.equal(v.runMetersPerSecond,mm/1000);assert.equal(v.sourceSpeedStat,ref.referenceSpeedStat);
 }
});
test('host speed changes map monotonically with integer floor and explicit clamps',()=>{
 const wolf=s=>M.battlefieldMovement('wolf',s,'player').runMmPerSecond;
 assert.equal(wolf(0),1600);assert.equal(wolf(49),2940);assert.equal(wolf(50),3000);assert.equal(wolf(51),3060);assert.equal(wolf(1000),3200);
 for(let n=0;n<200;n++)assert.ok(wolf(n)<=wolf(n+1));
 for(const bad of [-1,-0,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>wolf(bad));
 assert.throws(()=>M.battlefieldMovement('fake',50,'player'));assert.throws(()=>M.battlefieldMovement('wolf',50,'client'));
});
test('JUSAN fallback identity and calibration provenance are explicit without new progression stats',()=>{
 assert.deepEqual(M.movementReference('jusan','player'),{referenceSpeedStat:70,referenceSourceHolobotId:'ace',provisional:true});
 assert.deepEqual(M.movementReference('jusan','rival'),{referenceSpeedStat:50,referenceSourceHolobotId:'wolf',provisional:true});
});
test('JUSAN fallback under production FIGHT_ATTRS=1: the ACE reference follows the rules-5 speed (60); rival reference unchanged',()=>{
 withFlags({HOLOCITY_FIGHT_ATTRS:'1'},()=>{
  assert.deepEqual(M.movementReference('jusan','player'),{referenceSpeedStat:60,referenceSourceHolobotId:'ace',provisional:true});
  assert.deepEqual(M.movementReference('jusan','rival'),{referenceSpeedStat:50,referenceSourceHolobotId:'wolf',provisional:true});
 });
});
test('desktop v3 publishes fleet and owned resolved speeds; v1/v2 remain unchanged',()=>{
 const profile={holobots:[{name:'WOLF',level:1,boostedAttributes:{speed:1}},{name:'JUSAN',level:1}]},units={light:0,medium:0,heavy:0};
 const r=D.buildDesktopAccountReply(profile,'throwaway','desktop-account-3',units);
 assert.equal(r.battlefieldMovement.schemaVersion,'battlefield-movement-1');assert.equal(r.holobots[0].battlefieldMovement.runMmPerSecond,3060);
 assert.equal(r.holobots[1].battlefieldMovement.runMmPerSecond,2400);
 for(const v of ['desktop-account-1','desktop-account-2'])assert.equal('battlefieldMovement' in D.buildDesktopAccountReply(profile,'throwaway',v,units),false);
 assert.equal('battlefieldMovement' in D.desktopHolobotV3({name:'future_bot',level:1,battlefieldMovement:{runMmPerSecond:99999}}),false);
});
test('issue publication uses the final Zell and citizen lineup identity and issued stats',()=>{
 const profile={holobots:[{name:'ACE',level:1}],rivalWins:0};
 const z=L.issueRivalBattle(profile,1000,'rb_movement_zell',()=>0.5,['ace']);Z.bindZellLineup(z);
 const m=M.battlefieldIssueMovement(z.reply);assert.equal(m.opponent[0].holobotId,'jusan');assert.equal(m.opponent[0].runMmPerSecond,2400);assert.equal(m.player[0].runMmPerSecond,3200);
 const row=A.gatheringRoster('throwaway_movement')[0],g=L.issueRivalBattle(profile,1000,'rb_movement_citizen',()=>0.5,['ace']);
 G.bindGatheringRival('throwaway_movement',{...profile,storyFlags:{arenaGatheringSeen:true,tournamentsWon:0,arenaArcBuilt:false,holoZonesArcBuilt:false}},row.citizenId,g);
 const c=M.battlefieldIssueMovement(g.reply);assert.equal(c.opponent[0].holobotId,row.holobotId);assert.equal(c.opponent[0].sourceSpeedStat,g.reply.encounter.opponentSquad[0].speed);
});
