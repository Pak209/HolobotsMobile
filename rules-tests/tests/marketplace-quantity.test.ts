import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { authedDb, initTestEnv } from '../src/helpers';

// market-quantity-host-1 (marketplace-item-purchase-1): the one ledger entry per quantity purchase lives at
// vendorPurchases/{uid}/marketplaceItems/{requestId}, written only by purchaseMarketplaceItem (Admin SDK). A client
// that could pre-seed it could replay a forged reply or block its own requestId; the existing vendorPurchases deny covers it.
describe('server-only marketplace quantity ledger', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => { env = await initTestEnv(); });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); });

  const entry = {
    schemaVersion: 'marketplace-item-purchase-1', itemName: 'Rank Skip', quantity: 99, createdAtMs: 0,
    reply: { schemaVersion: 'marketplace-item-purchase-1', requestId: 'r1', itemName: 'Rank Skip', quantity: 99, unitPrice: 0, price: 0, holosTokens: 999999, owned: 99, alreadyProcessed: false },
  };

  it('denies every client read and write of vendorPurchases/{uid}/marketplaceItems, own or foreign', async () => {
    const alice = authedDb(env, 'alice');
    await assertFails(setDoc(doc(alice, 'vendorPurchases/alice/marketplaceItems/r1'), entry));
    await assertFails(setDoc(doc(authedDb(env, 'bob'), 'vendorPurchases/alice/marketplaceItems/r1'), entry));
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'vendorPurchases/alice/marketplaceItems/r2'), entry); });
    await assertFails(getDoc(doc(alice, 'vendorPurchases/alice/marketplaceItems/r2')));
    await assertFails(updateDoc(doc(alice, 'vendorPurchases/alice/marketplaceItems/r2'), { quantity: 1 }));
    await assertFails(deleteDoc(doc(alice, 'vendorPurchases/alice/marketplaceItems/r2')));
    await assertFails(getDocs(collection(alice, 'vendorPurchases/alice/marketplaceItems')));
    await assertFails(getDoc(doc(authedDb(env, 'bob'), 'vendorPurchases/alice/marketplaceItems/r2')));
  });
});
