/** Run only against an explicitly supplied local demo Firestore emulator. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(process.env.ZELL_RULES_PACKAGE + '/package.json');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, updateDoc, deleteDoc } = require('firebase/firestore');
const raw = process.env.FIRESTORE_EMULATOR_HOST ?? '';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(raw)) throw new Error('Loopback emulator required');
const [host, portText] = raw.split(':'), port = Number(portText);
const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const state = { schemaVersion: 'zell-story-1', phase: 'ally', metAtMs: 0, allyAtMs: 1, victoryBattleId: 'rb_fake' };
const weakened = rules.replace('match /storyProgress/{uid}/{document=**} {\n      allow read, write: if false;', 'match /storyProgress/{uid}/{document=**} {\n      allow read, write: if true;');
assert.notEqual(weakened, rules, 'control must change the target rule');
const bad = await initializeTestEnvironment({ projectId: 'demo-holobots-zell-control', firestore: { host, port, rules: weakened } });
try { await assertSucceeds(setDoc(doc(bad.authenticatedContext('alice').firestore(), 'storyProgress/alice'), state)); console.log('KNOWN-BAD: weakened story rule permits the forged ally flag'); } finally { await bad.cleanup(); }
const env = await initializeTestEnvironment({ projectId: 'demo-holobots-zell-rules', firestore: { host, port, rules } });
let assertions = 0;
try {
  await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'storyProgress/alice'), state); await setDoc(doc(ctx.firestore(), 'storyProgress/alice/receipts/test'), { forged: true }); });
  for (const identity of ['alice', 'bob', null]) {
    const db = (identity ? env.authenticatedContext(identity) : env.unauthenticatedContext()).firestore();
    for (const path of ['storyProgress/alice', 'storyProgress/alice/receipts/test']) {
      await assertFails(getDoc(doc(db, path))); assertions++;
      await assertFails(setDoc(doc(db, path), state)); assertions++;
      await assertFails(updateDoc(doc(db, path), { phase: 'ally' })); assertions++;
      await assertFails(deleteDoc(doc(db, path))); assertions++;
    }
  }
  console.log(`PASS: ${assertions} owner, foreign and anonymous reads/writes refused`);
} finally { await env.cleanup(); }
