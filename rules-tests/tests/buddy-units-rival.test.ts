import { doc, setDoc, updateDoc, deleteField, deleteDoc, getDoc } from 'firebase/firestore';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { authedDb, initTestEnv, seedUser } from '../src/helpers';
import { buildUserDoc } from '../src/fixtures';

// DECISIONS #43/#44: buddyUnits (#44: {light, medium, heavy}), rivalWins and rivalRewardDay are written only by the functions (Admin SDK).
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

  it('starter Unit cannot be re-claimed: the owner cannot delete the profile or overwrite it without the server fields', async () => {
    // Cloud review 2026-10-01 #1: delete + recreate used to reset buddyUnits to "missing",
    // and the next wild / desktop / rival call re-granted STARTING_BUDDY_UNITS.
    const spent = { ...buildUserDoc(), holobots: [{ name: 'ACE' }], buddyUnits: 0, rivalWins: 5, rivalRewardDay: '2026-10-01' };
    await seedUser(env, 'alice', spent);
    const ref = doc(authedDb(env, 'alice'), 'users/alice');
    await assertFails(deleteDoc(ref));
    // A non-merge set over the existing doc is an update that drops the fields: denied too.
    await assertFails(setDoc(ref, { ...buildUserDoc(), holobots: [{ name: 'ACE' }] }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = (await getDoc(doc(ctx.firestore(), 'users/alice'))).data()!;
      if (d.buddyUnits !== 0 || d.rivalWins !== 5 || d.rivalRewardDay !== '2026-10-01') throw new Error('server-owned fields changed');
    });
    await assertFails(deleteDoc(doc(authedDb(env, 'bob'), 'users/alice')));
  });

  it('#44 tier map: denies client create, add, per-tier change, replace and delete for every tier; unchanged merges stay legal', async () => {
    const tiers = { light: 1, medium: 0, heavy: 0 };
    const alice = doc(authedDb(env, 'alice'), 'users/alice');
    for (const t of ['light', 'medium', 'heavy']) {
      await assertFails(setDoc(alice, { ...buildUserDoc(), buddyUnits: { light: 0, medium: 0, heavy: 0, [t]: 1 } }));
    }
    await assertFails(setDoc(alice, { ...buildUserDoc(), buddyUnits: { light: 0, medium: 0, heavy: 0 } }));
    await seedUser(env, 'alice', { ...buildUserDoc(), buddyUnits: tiers });
    for (const t of ['light', 'medium', 'heavy']) {
      await assertFails(updateDoc(alice, { [`buddyUnits.${t}`]: 99 }));
      await assertFails(updateDoc(alice, { [`buddyUnits.${t}`]: deleteField() }));
      await assertFails(updateDoc(alice, { buddyUnits: { ...tiers, [t]: tiers[t as keyof typeof tiers] + 1 } }));
    }
    await assertFails(updateDoc(alice, { 'buddyUnits.bonus': 5 }));
    await assertFails(updateDoc(alice, { buddyUnits: 1 }));
    await assertFails(updateDoc(alice, { buddyUnits: deleteField() }));
    await assertFails(setDoc(alice, { ...buildUserDoc() }));
    await assertFails(deleteDoc(alice));
    await assertSucceeds(updateDoc(alice, { buddyUnits: tiers, dailyEnergy: 41 }));
    await assertSucceeds(setDoc(alice, { buddyUnits: tiers, dailyEnergy: 40 }, { merge: true }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      const d = (await getDoc(doc(ctx.firestore(), 'users/alice'))).data()!;
      if (JSON.stringify(d.buddyUnits) !== JSON.stringify(tiers)) throw new Error(`tiers changed: ${JSON.stringify(d.buddyUnits)}`);
    });
    await assertFails(updateDoc(doc(authedDb(env, 'bob'), 'users/alice'), { 'buddyUnits.heavy': 1 }));
  });

  it('denies client reads and writes of issued rival battles', async () => {
    const db = authedDb(env, 'alice');
    await assertFails(setDoc(doc(db, 'rivalBattles/alice/battles/rb_x'), { settlement: null }));
    await assertFails(getDoc(doc(db, 'rivalBattles/alice/battles/rb_x')));
    // The open-battle ledger (parent doc) is server-only as well.
    await assertFails(setDoc(doc(db, 'rivalBattles/alice'), { openBattles: {} }));
    await assertFails(getDoc(doc(db, 'rivalBattles/alice')));
  });
});
