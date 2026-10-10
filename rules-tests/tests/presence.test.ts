import { doc,getDoc,getDocs,collection,setDoc,updateDoc,deleteDoc } from 'firebase/firestore';
import {assertFails,assertSucceeds,type RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {beforeAll,afterAll,beforeEach,describe,it} from 'vitest';
import {authedDb,unauthedDb,initTestEnv,seedDoc,seedUser} from '../src/helpers';import {buildUserDoc} from '../src/fixtures';
describe('host-only town presence',()=>{let env:RulesTestEnvironment;beforeAll(async()=>{env=await initTestEnv()});afterAll(async()=>env.cleanup());beforeEach(async()=>env.clearFirestore());
 it('KNOWN-BAD first: forged writes, deletes, unauthenticated reads and collection lists denied',async()=>{
 const own=doc(authedDb(env,'alice'),'presenceScenes/HoloCity_Main');await assertFails(setDoc(own,{schemaVersion:'presence-1',pilots:{alice:{level:999}}}));
 await seedDoc(env,'presenceScenes/HoloCity_Main',{schemaVersion:'presence-1',pilots:{}});await assertFails(updateDoc(own,{pilots:{}}));await assertFails(deleteDoc(own));await assertFails(getDoc(doc(unauthedDb(env),'presenceScenes/HoloCity_Main')));await assertFails(getDocs(collection(authedDb(env,'alice'),'presenceScenes')));await assertFails(getDoc(doc(authedDb(env,'alice'),'presenceScenes/NeonForest')));
 });
 it('signed-in point reads allowed; opt-out is own bool setting, foreign or malformed denied',async()=>{
 await seedDoc(env,'presenceScenes/HoloCity_Main',{schemaVersion:'presence-1',pilots:{}});await assertSucceeds(getDoc(doc(authedDb(env,'bob'),'presenceScenes/HoloCity_Main')));await seedUser(env,'alice',buildUserDoc());const user=doc(authedDb(env,'alice'),'users/alice');await assertSucceeds(updateDoc(user,{presenceOptOut:true}));await assertSucceeds(updateDoc(user,{presenceOptOut:false}));await assertFails(updateDoc(user,{presenceOptOut:'no'}));await assertFails(updateDoc(doc(authedDb(env,'bob'),'users/alice'),{presenceOptOut:true}));
 });
});
