import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { authedDb, initTestEnv } from '../src/helpers';

// mission-board-1: missionBoards/{uid} (postings, claims ledger, refill clock) is written only by missionBoardHost.
describe('server-only mission board', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => { env = await initTestEnv(); });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); });

  const board = { schemaVersion: 'mission-board-1', seed: '00112233445566778899aabbccddeeff', nextSerial: 3, slots: [], claims: [], seenThroughMs: 0 };

  it('denies every client read and write of missionBoards/{uid}, own or foreign, at any depth', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'missionBoards/alice'), board); });
    const alice = authedDb(env, 'alice');
    await assertFails(getDoc(doc(alice, 'missionBoards/alice')));
    await assertFails(setDoc(doc(alice, 'missionBoards/alice'), board));
    await assertFails(updateDoc(doc(alice, 'missionBoards/alice'), { claims: [] }));
    await assertFails(deleteDoc(doc(alice, 'missionBoards/alice')));
    await assertFails(getDocs(collection(alice, 'missionBoards')));
    await assertFails(setDoc(doc(authedDb(env, 'bob'), 'missionBoards/alice'), board));
    await assertFails(setDoc(doc(authedDb(env, 'carol'), 'missionBoards/carol'), board));
    await assertFails(setDoc(doc(alice, 'missionBoards/alice/claims/r1'), { x: 1 }));
  });
});
