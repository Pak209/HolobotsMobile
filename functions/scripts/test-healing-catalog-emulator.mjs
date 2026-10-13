import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||'')||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Demo loopback emulator required');
const {db}=require('../lib/admin.js');const {readVendorCatalog}=require('../lib/vendors/vendorStore.js');const {transactDesktopItems}=require('../lib/vendors/desktopItemsHost.js');
test('catalog repair ladder, authoritative purchase, replay and no alternate Full grant',async()=>{
 const uid='healing_catalog_'+Date.now();await db.doc(`users/${uid}`).set({holosTokens:1000,emergencyPatches:0});
 const c=await readVendorCatalog(db,uid,{operation:'catalog',vendorId:'marketplace'});
 console.log('FIRST catalog repair listings',JSON.stringify(c.listings.filter(x=>['item.emergency_patch','item.repair_kit','item.full_restore'].includes(x.listingId))));
 for(const [itemId,price,fraction] of [['item.emergency_patch',100,'0.25'],['item.repair_kit',250,'0.5'],['item.full_restore',600,'1']]){const l=c.listings.find(x=>x.listingId===itemId);assert.ok(l,'missing '+itemId);assert.equal(l.price,price);assert.equal(l.details.healFraction,fraction);const request={schemaVersion:'desktop-items-2',operation:'buy',itemId,requestId:itemId.replaceAll('.','_')};await transactDesktopItems(db,uid,request);assert.equal((await transactDesktopItems(db,uid,request)).alreadyProcessed,true);}
 const p=(await db.doc(`users/${uid}`).get()).data();assert.equal(p.holosTokens,50);assert.equal(p.emergencyPatches,1);assert.equal(p.itemStocks.repair_kit,1);assert.equal(p.itemStocks.full_restore,1);
 const workshop=await readVendorCatalog(db,uid,{operation:'catalog',vendorId:'workshop'});assert.ok(!workshop.listings.some(x=>x.listingId==='item.full_restore'));
 await assert.rejects(()=>transactDesktopItems(db,uid,{schemaVersion:'desktop-items-2',operation:'buy',itemId:'item.full_restore',requestId:'poor'}),e=>e.code==='not_enough_holos');assert.deepEqual((await db.doc(`users/${uid}`).get()).data(),p);
});
