import { doc, setDoc, updateDoc, deleteField, getDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { authedDb, initTestEnv, seedUser } from '../src/helpers';
import { buildUserDoc } from '../src/fixtures';

// DECISIONS #43: buddyUnits, rivalWins and rivalRewardDay are written only by the functions (Admin SDK).
describe('server-owned Buddy Units and rival ladder', () => {
  let env: RulesTestEnvironment;
  beforeAll(async () => { env = await initTestEnv(); });
  afterAll(async () => { await env.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); });
  const fields: Record<string, unknown> = { buddyUnits: 1, rivalWins: 3, rivalRewardDay: '2026-09-30' };

  it('denies a client create that carries any of the fields (even zero / starter values)', async () => {
    for (const [k, v] of Object.entries({ ...fields, buddyUnits: 1 })) await assertFails(setDoc(doc(authedDb(env, 'alice'), 'users/alice'), { ...buildUserDoc(), [k]: v }));
    await assertFails(setDoc(doc(authedDb(env, 'alice'), 'users/alice'), { ...buildUserDoc(), buddyUnits: 0 }));
    await assertSucceeds(setDoc(doc(authedDb(env, 'alice'), 'users/alice'), buildUserDoc()));
  });

  it('denies client add, change and delete; allows unchanged full-profile merges and owner reads', async () => {
    await seedUser(env, 'alice', buildUserDoc());
    const ref = doc(authedDb(env, 'alice'), 'users/alice');
    for (const [k, v] of Object.entries(fields)) await assertFails(updateDoc(ref, { [k]: v }));
    await env.withSecurityRulesDisabled(async (ctx) => { await updateDoc(doc(ctx.firestore(), 'users/alice'), fields); });
    await assertFails(updateDoc(ref, { buddyUnits: 99 }));
    await assertFails(updateDoc(ref, { rivalWins: 100 }));
    await assertFails(updateDoc(ref, { rivalRewardDay: '1999-01-01' }));
    for (const k of Object.keys(fields)) await assertFails(updateDoc(ref, { [k]: deleteField() }));
    await assertSucceeds(updateDoc(ref, { ...fields, dailyEnergy: 42 }));
    await assertSucceeds(getDoc(ref));
    await assertFails(getDoc(doc(authedDb(env, 'bob'), 'users/alice')));
  });

  it('denies client reads and writes of issued rival battles', async () => {
    const db = authedDb(env, 'alice');
    await assertFails(setDoc(doc(db, 'rivalBattles/alice/battles/rb_x'), { settlement: null }));
    await assertFails(getDoc(doc(db, 'rivalBattles/alice/battles/rb_x')));
  });
});
