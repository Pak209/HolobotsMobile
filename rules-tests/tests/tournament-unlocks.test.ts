import {doc,setDoc,updateDoc,deleteField} from 'firebase/firestore';
import {assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {afterAll,beforeAll,it} from 'vitest';
import {readRulesText,initTestEnvWithRules} from '../src/helpers';
let env:RulesTestEnvironment;
beforeAll(async()=>{
 if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw new Error('Local emulator required');
 env=await initTestEnvWithRules(readRulesText(),'demo-w68-rules');
});
afterAll(async()=>env?.cleanup());
for(const field of ['tournamentUnlocks','tournamentUnlockAcknowledged'])it(`${field}: deny create/add/change/delete by owner, other and anonymous`,async()=>{
 for(const actor of ['owner','other',null]){
  const db=actor?env.authenticatedContext(actor).firestore():env.unauthenticatedContext().firestore();
  const path=`users/${field}_owner`;
  const uid=`${field}_owner`;
  const client=actor==='owner'?env.authenticatedContext(uid).firestore():db;
  await assertFails(setDoc(doc(client,path),{[field]:[]}));
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),{username:'test'}));
  await assertFails(updateDoc(doc(client,path),{[field]:[]}));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),path),{[field]:['starter']}));
  await assertFails(updateDoc(doc(client,path),{[field]:[]}));
  await assertFails(updateDoc(doc(client,path),{[field]:deleteField()}));
 }
});
it('owner may keep unchanged host fields on an otherwise permitted write',async()=>{
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'users/unchanged'),{username:'old',tournamentUnlocks:[],tournamentUnlockAcknowledged:['starter']}));
 await assertSucceeds(updateDoc(doc(env.authenticatedContext('unchanged').firestore(),'users/unchanged'),{syncDistanceUnit:'mi',tournamentUnlocks:[],tournamentUnlockAcknowledged:['starter']}));
});
