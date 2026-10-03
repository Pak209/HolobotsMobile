import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { authedDb, initTestEnv, seedUser } from '../src/helpers';
import { buildUserDoc } from '../src/fixtures';

// DECISIONS #46 / #47: intro quest state and Buddy Unit purchase receipts are written only by the functions (Admin SDK).
describe('server-only intro quests and vendor receipts', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => { env = await initTestEnv(); });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); });

  const quest = { schemaVersion: 'intro-quest-1', currentIndex: 7, claims: {}, stepStartedAtMs: 0, rivalWinsAtStepStart: 0 };
  const receipt = { tierId: 'buddy_heavy', reply: { holosTokens: 999999 } };

  it('denies every client read and write of introQuests/{uid}, own or foreign, including delete', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'introQuests/alice'), { ...quest, currentIndex: 2 }); });
    const alice = authedDb(env, 'alice');
    await assertFails(getDoc(doc(alice, 'introQuests/alice')));
    await assertFails(setDoc(doc(alice, 'introQuests/alice'), quest));
    await assertFails(updateDoc(doc(alice, 'introQuests/alice'), { currentIndex: 7 }));
    await assertFails(deleteDoc(doc(alice, 'introQuests/alice')));
    await assertFails(setDoc(doc(alice, 'introQuests/bob'), quest));
    await assertFails(getDocs(collection(alice, 'introQuests')));
    await assertFails(setDoc(doc(authedDb(env, 'bob'), 'introQuests/alice'), quest));
    // A client can't create a fresh doc for itself either (no self-reset).
    await assertFails(setDoc(doc(authedDb(env, 'carol'), 'introQuests/carol'), { ...quest, currentIndex: 0 }));
  });

  it('denies every client read and write of vendorPurchases/{uid}/receipts (no forged or pre-seeded receipts)', async () => {
    const alice = authedDb(env, 'alice');
    await assertFails(setDoc(doc(alice, 'vendorPurchases/alice/receipts/r1'), receipt));
    await assertFails(setDoc(doc(alice, 'vendorPurchases/alice'), { x: 1 }));
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'vendorPurchases/alice/receipts/r2'), receipt); });
    await assertFails(getDoc(doc(alice, 'vendorPurchases/alice/receipts/r2')));
    await assertFails(updateDoc(doc(alice, 'vendorPurchases/alice/receipts/r2'), { tierId: 'buddy_medium' }));
    await assertFails(deleteDoc(doc(alice, 'vendorPurchases/alice/receipts/r2')));
    await assertFails(getDocs(collection(alice, 'vendorPurchases/alice/receipts')));
  });

  it('the reward / price fields the quests and vendors write stay client-immutable on users/{uid}', async () => {
    await seedUser(env, 'alice', { ...buildUserDoc(), holosTokens: 600, gachaTickets: 3, buddyUnits: { light: 1, medium: 1, heavy: 1 } });
    const ref = doc(authedDb(env, 'alice'), 'users/alice');
    await assertFails(updateDoc(ref, { holosTokens: 99999 }));
    await assertFails(updateDoc(ref, { gachaTickets: 50 }));
    for (const t of ['light', 'medium', 'heavy']) await assertFails(updateDoc(ref, { [`buddyUnits.${t}`]: 9 }));
    await assertSucceeds(updateDoc(ref, { dailyEnergy: 10 }));
  });
});
