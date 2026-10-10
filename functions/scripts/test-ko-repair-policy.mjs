import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const H=require('../lib/lib/rivalHealth.js');
const R=require('../lib/lib/repairItems.js');
const profile=(hp=0,stock=1)=>({travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']},emergencyPatches:stock,holobotVitals:{ace:{currentHealth:hp,maxHealth:100}}});
test('known-bad: issuing again cannot heal a knocked-out bot',()=>{
 const p=profile(); const a=H.issueVitals(p,[{holobotId:'ace',maxHealth:120}]);
 assert.equal(a.ace.currentHealth,0); assert.equal(a.ace.maxHealth,120); assert.deepEqual(p,profile());
 assert.equal(H.issueVitals({...p,holobotVitals:a},[{holobotId:'ace',maxHealth:120}]).ace.currentHealth,0);
});
test('an accepted repair is the existing health increase, and its value carries on issue',()=>{
 const p=profile(),r=R.repairUse(p,'ace'); assert.equal(r.result.currentHealth,25); assert.equal(r.updates.emergencyPatches,0);
 assert.equal(H.issueVitals({...p,...r.updates},[{holobotId:'ace',maxHealth:120}]).ace.currentHealth,25);
 assert.equal(H.issueVitals(profile(90),[{holobotId:'ace',maxHealth:80}]).ace.currentHealth,80);
});
test('no stock, full health, foreign bot and unknown health refuse without mutating input',()=>{
 for(const [p,id,code] of [[profile(0,0),'ace','no_item'],[profile(100),'ace','already_full'],[profile(),'ken','not_in_squad'],[{...profile(),holobotVitals:{}},'ace','health_unavailable']]){
 const old=structuredClone(p);assert.throws(()=>R.repairUse(p,id),new RegExp(code));assert.deepEqual(p,old);
 }
});
test('fresh host bot starts full, survivors carry, health reports cannot manufacture a heal',()=>{
 assert.equal(H.issueVitals({},[{holobotId:'ace',maxHealth:120}]).ace.currentHealth,120);
 assert.equal(H.issueVitals(profile(30),[{holobotId:'ace',maxHealth:120}]).ace.currentHealth,30);
 assert.throws(()=>H.settleVitals(profile(),{ace:{currentHealth:0,maxHealth:100}},[{holobotId:'ace',currentHealth:1}]),/invalid_request/);
});
