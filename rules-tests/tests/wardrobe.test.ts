import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { authedDb, initTestEnv, seedDoc, seedUser, unauthedDb } from '../src/helpers';
import { buildUserDoc } from '../src/fixtures';

// DECISIONS #48: wardrobes/{uid} (entitlements + saved recipe) and its receipts are written only by wardrobeHost (Admin SDK).
describe('server-only pilot wardrobe', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => { env = await initTestEnv(); });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); });
  const state = { schemaVersion: 'wardrobe-2', entitlements: ['ph.hat.helmet_01'], recipe: null };

  it('denies every client write to wardrobes/{uid}: create, self-grant, recipe edit, delete — own or foreign', async () => {
    const alice = authedDb(env, 'alice');
    await assertFails(setDoc(doc(alice, 'wardrobes/alice'), state));
    await seedDoc(env, 'wardrobes/alice', state);
    await assertFails(updateDoc(doc(alice, 'wardrobes/alice'), { entitlements: ['ph.hat.helmet_01', 'ph.backAccessory.wings_01'] }));
    await assertFails(updateDoc(doc(alice, 'wardrobes/alice'), { recipe: { schemaVersion: 'wardrobe-2' } }));
    await assertFails(setDoc(doc(alice, 'wardrobes/alice'), { ...state, entitlements: [] }));
    await assertFails(deleteDoc(doc(alice, 'wardrobes/alice')));
    await assertFails(setDoc(doc(authedDb(env, 'bob'), 'wardrobes/alice'), state));
    await assertFails(setDoc(doc(unauthedDb(env), 'wardrobes/alice'), state));
  });

  it('denies every client write to receipts (no forged or pre-seeded receipt) and every client read of the tree', async () => {
    const alice = authedDb(env, 'alice');
    await assertFails(setDoc(doc(alice, 'wardrobes/alice/receipts/fake'), { fingerprint: 'x', reply: { entitlements: ['ph.backAccessory.wings_01'] } }));
    await seedDoc(env, 'wardrobes/alice', state);
    await seedDoc(env, 'wardrobes/alice/receipts/r1', { fingerprint: 'x', reply: {} });
    await assertFails(updateDoc(doc(alice, 'wardrobes/alice/receipts/r1'), { fingerprint: 'y' }));
    await assertFails(deleteDoc(doc(alice, 'wardrobes/alice/receipts/r1')));
    for (const db of [alice, authedDb(env, 'bob'), unauthedDb(env)]) {
      await assertFails(getDoc(doc(db, 'wardrobes/alice')));
      await assertFails(getDoc(doc(db, 'wardrobes/alice/receipts/r1')));
      await assertFails(getDocs(collection(db, 'wardrobes/alice/receipts')));
    }
  });

  it('the Holos a purchase spends stay client-immutable on users/{uid}', async () => {
    await seedUser(env, 'alice', { ...buildUserDoc(), holosTokens: 1500 });
    await assertFails(updateDoc(doc(authedDb(env, 'alice'), 'users/alice'), { holosTokens: 99999 }));
    await assertSucceeds(updateDoc(doc(authedDb(env, 'alice'), 'users/alice'), { dailyEnergy: 9 }));
  });
});
