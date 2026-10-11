// M1 town presence (design 2026-10-10 §1 + §4 "rules: clients read the doc, no client write — every
// write denied"). presenceScenes/{scene} is written ONLY by presenceHost (Admin SDK, bypasses rules).
// Every client write path (create, overwrite, update, merge, delete, WriteBatch, transaction, and a
// field-path write of a single pilots.<uid> row) is denied on the live scene, on another scene and
// on a nested path, for the pilot whose row is in the doc, another pilot, a holoServer-claim token
// and an unauthenticated client. Reads: signed-in point get of HoloCity_Main only.
// Controls: KNOWN-BAD, the same attempts against a weakened copy of firestore.rules (the
// presenceScenes block's `allow list, write: if false;` -> `allow write: if isSignedIn();`) must let
// signed-in writes through, so this suite detects that weakening; POSITIVE, with rules disabled every
// attempt succeeds, so each denial is the rules' verdict and not a malformed request.
import {
  collection, collectionGroup, deleteDoc, deleteField, doc, documentId, FieldPath, getDoc, getDocs,
  increment, query, runTransaction, setDoc, updateDoc, where, writeBatch,
} from 'firebase/firestore';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initTestEnv, initTestEnvWithRules, readRulesText } from '../src/helpers';

const MAIN = 'presenceScenes/HoloCity_Main';
const OTHER_SCENE = 'presenceScenes/NeonForest';
const NESTED = 'presenceScenes/HoloCity_Main/x/y';
const ROW = {
  username: 'alice', pilot: { schemaVersion: 'wardrobe-3' }, squad: [{ holobotId: 'ace', level: 4, rank: 'Starter' }],
  deployed: ['ace'], pos: [1, 0, 1], yaw: 90, updatedAtMs: 1_791_700_000_000, expiresAtMs: 1_791_700_090_000,
};
const FORGED = { ...ROW, username: 'FORGED', squad: [{ holobotId: 'ace', level: 999, rank: 'Legendary' }], expiresAtMs: 9_999_999_999_999 };
const SCENE_DOC = { schemaVersion: 'presence-1', pilots: { alice: ROW } };

// The SDK's Firestore type, whichever context it came from.
type Db = ReturnType<ReturnType<RulesTestEnvironment['unauthenticatedContext']>['firestore']>;
type Principal = { name: string; uid: string | null; claims?: Record<string, unknown>; fieldUids: string[] };
type Attempt = { label: string; nested: boolean; seeded: boolean; run: (db: Db) => Promise<unknown> };
type Outcome = 'denied' | 'allowed' | `error:${string}`;

const PRINCIPALS: Principal[] = [
  { name: 'alice (her row is in the doc)', uid: 'alice', fieldUids: ['alice'] },
  { name: 'mallory (another signed-in pilot)', uid: 'mallory', fieldUids: ['mallory', 'alice'] },
  { name: 'srv_dev (holoServer claim)', uid: 'srv_dev', claims: { holoServer: true }, fieldUids: ['srv_dev'] },
  { name: 'unauthenticated', uid: null, fieldUids: ['alice'] },
];

function docAttempts(path: string): Attempt[] {
  const forged = { schemaVersion: 'presence-1', pilots: { alice: FORGED } };
  const nested = path === NESTED;
  const at = (label: string, seeded: boolean, run: Attempt['run']): Attempt => ({ label: `${label} ${path}`, nested, seeded, run });
  return [
    at('create (setDoc, fresh doc)', false, db => setDoc(doc(db, path), forged)),
    at('set overwrite', true, db => setDoc(doc(db, path), forged)),
    at('update', true, db => updateDoc(doc(db, path), { pilots: forged.pilots })),
    at('set merge', true, db => setDoc(doc(db, path), forged, { merge: true })),
    at('delete', true, db => deleteDoc(doc(db, path))),
    at('WriteBatch set (create)', false, db => writeBatch(db).set(doc(db, path), forged).commit()),
    at('WriteBatch update', true, db => writeBatch(db).update(doc(db, path), { pilots: forged.pilots }).commit()),
    at('WriteBatch delete', true, db => writeBatch(db).delete(doc(db, path)).commit()),
    at('runTransaction set', true, db => runTransaction(db, async tx => { tx.set(doc(db, path), forged); })),
    at('runTransaction update', true, db => runTransaction(db, async tx => { tx.update(doc(db, path), { pilots: forged.pilots }); })),
    at('runTransaction delete', true, db => runTransaction(db, async tx => { tx.delete(doc(db, path)); })),
  ];
}

// A transaction that legitimately reads the live scene (signed-in get is allowed) and then writes it.
const READ_THEN_WRITE: Attempt = {
  label: `runTransaction get-then-set ${MAIN}`, nested: false, seeded: true,
  run: db => runTransaction(db, async tx => {
    const snap = await tx.get(doc(db, MAIN));
    tx.set(doc(db, MAIN), { ...snap.data(), pilots: { alice: FORGED } });
  }),
};

// A write that touches ONLY one pilots.<uid> row of the live scene.
function fieldPathAttempts(uid: string): Attempt[] {
  const field = `pilots.${uid}`;
  const at = (label: string, run: Attempt['run']): Attempt => ({ label: `${label} on ${MAIN}`, nested: false, seeded: true, run });
  return [
    at(`update '${field}'`, db => updateDoc(doc(db, MAIN), field, FORGED)),
    at(`update FieldPath('pilots', '${uid}')`, db => updateDoc(doc(db, MAIN), new FieldPath('pilots', uid), FORGED)),
    at(`set mergeFields ['${field}']`, db => setDoc(doc(db, MAIN), { pilots: { [uid]: FORGED } }, { mergeFields: [field] })),
    at(`set merge { pilots: { ${uid} } }`, db => setDoc(doc(db, MAIN), { pilots: { [uid]: FORGED } }, { merge: true })),
    at(`WriteBatch update '${field}'`, db => writeBatch(db).update(doc(db, MAIN), field, FORGED).commit()),
    at(`runTransaction update '${field}'`, db => runTransaction(db, async tx => { tx.update(doc(db, MAIN), field, FORGED); })),
    at(`update '${field}' = deleteField()`, db => updateDoc(doc(db, MAIN), { [field]: deleteField() })),
    at(`update '${field}.expiresAtMs' = increment(1 day)`, db => updateDoc(doc(db, MAIN), { [`${field}.expiresAtMs`]: increment(86_400_000) })),
  ];
}

const PLAN = PRINCIPALS.flatMap(principal =>
  [...[MAIN, OTHER_SCENE, NESTED].flatMap(docAttempts), READ_THEN_WRITE, ...principal.fieldUids.flatMap(fieldPathAttempts)]
    .map(attempt => ({ principal, attempt })));

async function outcomeOf(run: () => Promise<unknown>): Promise<Outcome> {
  try {
    await run();
    return 'allowed';
  } catch (e) {
    const code = String((e as { code?: unknown })?.code ?? e);
    return code === 'permission-denied' ? 'denied' : `error:${code}`;
  }
}

async function seedAll(adminDb: Db): Promise<void> {
  const batch = writeBatch(adminDb);
  batch.set(doc(adminDb, MAIN), SCENE_DOC);
  batch.set(doc(adminDb, OTHER_SCENE), SCENE_DOC);
  batch.set(doc(adminDb, NESTED), { owner: 'alice' });
  await batch.commit();
}

function clientDbs(env: RulesTestEnvironment): Map<string, Db> {
  return new Map(PRINCIPALS.map(p => [p.name,
    p.uid === null ? env.unauthenticatedContext().firestore() : env.authenticatedContext(p.uid, p.claims).firestore()]));
}

// Each attempt starts from a cleared emulator (seeded when the write needs an existing doc), so one
// attempt's success under a weakened rule set can never change what the next attempt sees.
async function runPlan(env: RulesTestEnvironment, dbs: Map<string, Db>) {
  const results: { who: Principal; what: Attempt; outcome: Outcome }[] = [];
  await env.withSecurityRulesDisabled(async admin => {
    const adminDb = admin.firestore();
    for (const { principal, attempt } of PLAN) {
      await env.clearFirestore();
      if (attempt.seeded) await seedAll(adminDb);
      results.push({ who: principal, what: attempt, outcome: await outcomeOf(() => attempt.run(dbs.get(principal.name)!)) });
    }
  });
  return results;
}
const line = (r: { who: Principal; what: Attempt; outcome: Outcome }) => `${r.who.name} | ${r.what.label} -> ${r.outcome}`;

describe('presenceScenes: every client write path denied (live firestore.rules)', () => {
  let env: RulesTestEnvironment;
  let dbs: Map<string, Db>;
  beforeAll(async () => { env = await initTestEnv(); dbs = clientDbs(env); });
  afterAll(async () => { await env.cleanup(); });

  it(`denies all ${PLAN.length} write attempts: 3 paths x 11 write kinds + get-then-set + pilots.<uid> field paths, x 4 principals`, async () => {
    const results = await runPlan(env, dbs);
    console.info(`[presence-write-paths] live rules: ${results.filter(r => r.outcome === 'denied').length}/${results.length} denied`);
    expect(results.length).toBe(PLAN.length);
    expect(results.filter(r => r.outcome !== 'denied').map(line)).toEqual([]);
  }, 180_000);

  it('POSITIVE control: with rules disabled every distinct attempt is a well-formed write that succeeds', async () => {
    const distinct = [...new Map(PLAN.map(({ attempt }) => [attempt.label, attempt])).values()];
    const failures: string[] = [];
    await env.withSecurityRulesDisabled(async admin => {
      const adminDb = admin.firestore();
      for (const attempt of distinct) {
        await env.clearFirestore();
        if (attempt.seeded) await seedAll(adminDb);
        const outcome = await outcomeOf(() => attempt.run(adminDb));
        if (outcome !== 'allowed') failures.push(`${attempt.label} -> ${outcome}`);
      }
    });
    console.info(`[presence-write-paths] rules disabled: ${distinct.length - failures.length}/${distinct.length} distinct attempts succeed`);
    expect(failures).toEqual([]);
  }, 120_000);

  it('reads: signed-in get of HoloCity_Main allowed; unauthenticated get, list, query, collection group, other scene and nested get denied', async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async admin => { await seedAll(admin.firestore()); });
    for (const p of PRINCIPALS) {
      const db = dbs.get(p.name)!;
      if (p.uid !== null) {
        const snap = await assertSucceeds(getDoc(doc(db, MAIN)));
        expect(snap.data()?.pilots?.alice?.username).toBe('alice');
      } else {
        await assertFails(getDoc(doc(db, MAIN)));
      }
      await assertFails(getDocs(collection(db, 'presenceScenes')));
      await assertFails(getDocs(query(collection(db, 'presenceScenes'), where(documentId(), '==', 'HoloCity_Main'))));
      await assertFails(getDocs(collectionGroup(db, 'presenceScenes')));
      await assertFails(getDoc(doc(db, OTHER_SCENE)));
      await assertFails(getDoc(doc(db, NESTED)));
    }
  }, 60_000);
});

describe('KNOWN-BAD control: the same attempts against a weakened copy of firestore.rules', () => {
  const BLOCK = /match \/presenceScenes\/\{scene\} \{[^}]*\}/;
  const LIVE = 'allow list, write: if false;';
  const WEAK = 'allow write: if isSignedIn();';
  const real = readRulesText();
  const weakened = real.replace(BLOCK, block => block.replace(LIVE, WEAK));
  let env: RulesTestEnvironment;
  let dbs: Map<string, Db>;
  beforeAll(async () => { env = await initTestEnvWithRules(weakened, 'demo-presence-rules-weakened'); dbs = clientDbs(env); });
  afterAll(async () => { await env.cleanup(); });

  it('the weakening is exactly one edit, inside the presenceScenes block', () => {
    expect(real.match(BLOCK)?.[0]).toContain(LIVE);
    expect(weakened).not.toBe(real);
    expect(weakened.match(BLOCK)?.[0]).toContain(WEAK);
    expect(weakened.replace(WEAK, LIVE)).toBe(real);
  });

  it('lets signed-in writes through, so the live-rules suite above would fail on this weakening', async () => {
    const results = await runPlan(env, dbs);
    const allowed = results.filter(r => r.outcome === 'allowed');
    console.info(`[presence-write-paths] weakened rules: ${allowed.length}/${results.length} allowed (live rules: 0 allowed)`);
    expect(allowed.length).toBeGreaterThan(0);
    // Precisely the signed-in writes on presenceScenes/{scene}: unauthenticated and nested writes stay denied.
    const expected = results.map(r => line({ ...r, outcome: r.who.uid !== null && !r.what.nested ? 'allowed' : 'denied' }));
    expect(results.map(line)).toEqual(expected);
  }, 180_000);
});
