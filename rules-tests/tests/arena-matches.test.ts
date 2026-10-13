import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { readRulesText, initTestEnvWithRules } from '../src/helpers';

describe('Arena leases and immutable receipts remain callable-only', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => {
    if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Local emulator required');
    env = await initTestEnvWithRules(readRulesText(), 'demo-holobots-r4-rules');
  });
  afterAll(async () => { await env?.cleanup(); });
  for (const actor of ['alice','bob',null]) {
    it(`denies parent/record/request reads and mutation for ${actor ?? 'anonymous'}`, async () => {
      const paths = ['arenaMatches/alice','arenaMatches/alice/matches/am_test','arenaMatches/alice/requests/request_test'];
      for (const p of paths) {
        await env.withSecurityRulesDisabled(async ctx => setDoc(doc(ctx.firestore(),p),{open:true}));
        const db = actor ? env.authenticatedContext(actor).firestore() : env.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db,p)));
        await assertFails(setDoc(doc(db,p),{open:false}));
        await assertFails(updateDoc(doc(db,p),{open:false}));
        await assertFails(deleteDoc(doc(db,p)));
        await assertFails(setDoc(doc(db,`${p}/nested/forged`),{paid:true}));
      }
      const db = actor ? env.authenticatedContext(actor).firestore() : env.unauthenticatedContext().firestore();
      await assertFails(getDocs(collection(db,'arenaMatches/alice/matches')));
      await assertFails(setDoc(doc(db,'arenaMatches/alice/requests/new_unpaid'),{matchId:'forged'}));
    });
  }
});
