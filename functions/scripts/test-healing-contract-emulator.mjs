import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Demo loopback emulator required');
const {db}=require('../lib/admin.js');
test('published healing parity keys agree with real catalog and Workshop/craft transactions',async()=>{
 const contract=JSON.parse(readFileSync(new URL('../../docs/contracts/healing-items-1.json',import.meta.url),'utf8'));assert.equal(contract.parityKeys.length,6);
 const uid='healing_contract_'+Date.now();await db.doc(`users/${uid}`).set({holobots:[{name:'ACE',level:1}],travelSquad:{schemaVersion:'travel-squad-1',revision:1,holobotIds:['ace']},holosTokens:1000,emergencyPatches:1,itemStocks:{blueprint_fragment:8},holobotVitals:{ace:{currentHealth:0,maxHealth:150}}});
 const catalog=await require('../lib/vendors/vendorStore.js').readVendorCatalog(db,uid,{operation:'catalog',vendorId:'marketplace'});assert.deepEqual(catalog.listings.filter(l=>l.details.healFraction).map(l=>({itemId:l.listingId,price:l.price,fraction:Number(l.details.healFraction)})),contract.items);
 const heal=await require('../lib/workshop/workshopHealHost.js').transactWorkshopHeal(db,uid,{schemaVersion:'healing-workshop-1',operation:'heal',requestId:'full'});assert.equal(heal.cost,contract.workshop.cost);assert.equal(heal.vitals.ace.currentHealth,150*contract.workshop.fraction);
 for(const recipe of contract.recipes){const r=await require('../lib/workshop/workshopCraftHost.js').transactWorkshopCraft(db,uid,{schemaVersion:'healing-workshop-1',operation:'craft',itemId:recipe.output,requestId:recipe.output.replaceAll('.','_')});assert.equal(r.fragmentsSpent,recipe.fragments);assert.equal(r.lowerItemSpent,recipe.lower);assert.equal(r.quantity,1);}
 const profile=(await db.doc(`users/${uid}`).get()).data();assert.equal(profile.holosTokens,1000);assert.equal(profile.itemStocks.full_restore,1);
 const text=readFileSync(new URL('../../docs/HOLOCITY_PROGRESSION.md',import.meta.url),'utf8');for(const key of contract.parityKeys)assert.ok(text.includes(key));
});
