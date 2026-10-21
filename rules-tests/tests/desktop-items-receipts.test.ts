import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { authedDb, initTestEnv } from '../src/helpers';

// desktop-items-quantity-1 (DECISIONS #72.32): a desktopItemsHost quantity buy's one ledger entry is the existing receipt
// itemInventories/{uid}/receipts/{requestId}, written only by the host (Admin SDK). A client that could pre-seed it could
// replay a forged reply ("bought 99, spent 0") or block its own requestId; the catch-all deny covers the path, unchanged.
describe('server-only desktop items inventory and receipts', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => { env = await initTestEnv(); });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); });

  const forged = {
    identity: '{"schemaVersion":"desktop-items-2","operation":"buy","itemId":"item.full_restore","requestId":"r1","quantity":99}',
    reply: { schemaVersion: 'desktop-items-2', holosTokens: 999999, items: [], result: { kind: 'buy', itemId: 'item.full_restore', quantity: 99, unitPrice: 0, price: 0, owned: 99 } },
    createdAtMs: 0,
  };

  it('denies every client read and write of itemInventories/{uid} and its receipts, own or foreign', async () => {
    const alice = authedDb(env, 'alice'), bob = authedDb(env, 'bob');
    await assertFails(setDoc(doc(alice, 'itemInventories/alice/receipts/r1'), forged));
    await assertFails(setDoc(doc(bob, 'itemInventories/alice/receipts/r1'), forged));
    await assertFails(setDoc(doc(alice, 'itemInventories/alice'), { schemaVersion: 'desktop-items-2', favoriteId: 'item.full_restore' }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'itemInventories/alice'), { schemaVersion: 'desktop-items-2', favoriteId: null });
      await setDoc(doc(ctx.firestore(), 'itemInventories/alice/receipts/r2'), forged);
    });
    await assertFails(getDoc(doc(alice, 'itemInventories/alice/receipts/r2')));
    await assertFails(updateDoc(doc(alice, 'itemInventories/alice/receipts/r2'), { createdAtMs: 1 }));
    await assertFails(deleteDoc(doc(alice, 'itemInventories/alice/receipts/r2')));
    await assertFails(getDocs(collection(alice, 'itemInventories/alice/receipts')));
    await assertFails(getDoc(doc(alice, 'itemInventories/alice')));
    await assertFails(getDoc(doc(bob, 'itemInventories/alice/receipts/r2')));
  });
});
