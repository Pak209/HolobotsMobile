import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { assertFails, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { authedDb, initTestEnv } from '../src/helpers';

// DECISIONS #53 amendment 1: HoloZone runs (server-issued run ids + once-per-run XP rulings) are written only by holoZoneHost (Admin SDK).
describe('server-only HoloZone runs', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => { env = await initTestEnv(); });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); });

  const run = { runId: '0b9f3c1e-1d2a-4c3b-9a8f-1234567890ab', zoneId: 'neonforest', tier: 0, squad: ['ace'], issuedAtMs: 0, expiresAtMs: 9e15, closedAtMs: null, settlement: null, progression: null };
  const runsDoc = { schemaVersion: 'holozone-runs-1', runs: [run] };

  it('denies every client read and write of holoZoneRuns/{uid}, own or foreign, including delete and self-create', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'holoZoneRuns/alice'), runsDoc); });
    const alice = authedDb(env, 'alice');
    await assertFails(getDoc(doc(alice, 'holoZoneRuns/alice')));
    await assertFails(setDoc(doc(alice, 'holoZoneRuns/alice'), runsDoc));
    await assertFails(updateDoc(doc(alice, 'holoZoneRuns/alice'), { runs: [{ ...run, settlement: null }] }));
    await assertFails(deleteDoc(doc(alice, 'holoZoneRuns/alice')));
    await assertFails(getDocs(collection(alice, 'holoZoneRuns')));
    await assertFails(setDoc(doc(alice, 'holoZoneRuns/bob'), runsDoc));
    await assertFails(setDoc(doc(alice, 'holoZoneRuns/alice/extra/x'), { a: 1 }));
    await assertFails(setDoc(doc(authedDb(env, 'carol'), 'holoZoneRuns/carol'), runsDoc));
  });
});
