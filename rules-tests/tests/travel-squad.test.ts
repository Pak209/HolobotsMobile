import { doc, setDoc, updateDoc, deleteField, getDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { authedDb, initTestEnv, seedUser } from '../src/helpers';
import { buildUserDoc } from '../src/fixtures';
describe('server-owned travel squad',()=>{
 let env: RulesTestEnvironment;
 beforeAll(async()=>{env=await initTestEnv();});afterAll(async()=>{await env.cleanup();});beforeEach(async()=>{await env.clearFirestore();});
 const squad={schemaVersion:'travel-squad-1',revision:1,holobotIds:['hare']};
 it('denies client squad creation, including empty squad',async()=>{
  for(const value of [squad,{...squad,holobotIds:[]}])await assertFails(setDoc(doc(authedDb(env,'alice'),'users/alice'),{...buildUserDoc(),travelSquad:value}));
 });
 it('denies client addition, mutation and deletion; allows unchanged value',async()=>{
  await seedUser(env,'alice',buildUserDoc());const ref=doc(authedDb(env,'alice'),'users/alice');
  await assertFails(updateDoc(ref,{travelSquad:squad}));
  await env.withSecurityRulesDisabled(async context=>{await updateDoc(doc(context.firestore(),'users/alice'),{travelSquad:squad});});
  await assertFails(updateDoc(ref,{'travelSquad.holobotIds':['wolf']}));
  await assertFails(updateDoc(ref,{'travelSquad.revision':2}));
  await assertFails(updateDoc(ref,{travelSquad:deleteField()}));
  await assertSucceeds(updateDoc(ref,{travelSquad:squad,dailyEnergy:42}));
  await assertSucceeds(getDoc(ref));
 });
 it('denies client direct session or receipt writes',async()=>{
  const db=authedDb(env,'alice');await assertFails(setDoc(doc(db,'wildEncounterSessions/alice'),{enabled:true}));await assertFails(setDoc(doc(db,'wildEncounterSessions/alice/receipts/r'),{reply:{}}));
 });
});
