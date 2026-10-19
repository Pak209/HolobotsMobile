import {doc,setDoc,updateDoc,deleteField} from 'firebase/firestore';
import {assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {afterAll,beforeAll,it} from 'vitest';
import {readRulesText,initTestEnvWithRules} from '../src/helpers';
// onboarding-host-1 (DECISIONS #72.3–#72.5): users/{uid}.onboarding is host-owned; no client may create, change or delete it.
let env:RulesTestEnvironment;
beforeAll(async()=>{
 if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw new Error('Local emulator required');
 env=await initTestEnvWithRules(readRulesText(),'demo-onboarding-rules');
});
afterAll(async()=>env?.cleanup());
const genesis={step:0,skipped:false,stepAt:1};
it('onboarding: deny create/add/change/delete by owner, other and anonymous',async()=>{
 for(const actor of ['owner','other',null]){
  const uid=`onboarding_${actor??'anon'}`,path=`users/${uid}`;
  const client=actor==='owner'?env.authenticatedContext(uid).firestore():actor?env.authenticatedContext(actor).firestore():env.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(client,path),{username:'pilot',onboarding:genesis}));
  await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),{username:'test'}));
  await assertFails(updateDoc(doc(client,path),{onboarding:{step:7,skipped:true,stepAt:2}}));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),path),{onboarding:genesis}));
  await assertFails(updateDoc(doc(client,path),{onboarding:{step:3,skipped:false,stepAt:2}}),'no client advance to the mentor duel');
  await assertFails(updateDoc(doc(client,path),{'onboarding.step':4}),'no nested write');
  await assertFails(updateDoc(doc(client,path),{onboarding:deleteField()}));
 }
});
it('owner may keep the unchanged host onboarding field on an otherwise permitted write',async()=>{
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'users/onboarding_unchanged'),{username:'old',onboarding:genesis}));
 await assertSucceeds(updateDoc(doc(env.authenticatedContext('onboarding_unchanged').firestore(),'users/onboarding_unchanged'),{username:'new',onboarding:genesis}));
 // Control: the same permitted write succeeds without the field, so the denials above are the field, not the write.
 await assertSucceeds(updateDoc(doc(env.authenticatedContext('onboarding_unchanged').firestore(),'users/onboarding_unchanged'),{username:'newer'}));
});
