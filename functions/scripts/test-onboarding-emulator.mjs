// onboarding-host-1 (DECISIONS #72.3–#72.5) Firestore-emulator tests through the real callables / transactions:
// genesis step 0 + one Repair Kit; existing accounts skipped; the snapshot ackOnboarding intent (order, idempotency,
// skip, host-checked skip-forward); host advances on rival settle / vendor purchase / workshop heal / kit use; the
// D1 mentor issue (one tier-0 WOLF) and its loss (no HP change, no cooldown) vs win (normal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Emulator required; never run against production');
process.env.GCLOUD_PROJECT ||= 'demo-holobots-onboarding-tests';
const { default: Ajv } = require('ajv');
const validate = new Ajv({ strict: false }).compile(require('../../Schemas/onboarding-1.json'));
const fixture = require('./fixtures/desktop-account/onboarding.json');
const { db } = require('../lib/admin.js');
const { desktopAccountSnapshot } = require('../lib/desktop/desktopAccountSnapshot.js');
const { createGenesisProfile } = require('../lib/account/createGenesisProfile.js');
const { transactRivalBattle } = require('../lib/rival/rivalBattleStore.js');
const { transactDesktopItems } = require('../lib/vendors/desktopItemsHost.js');
const { transactWorkshopHeal } = require('../lib/workshop/workshopHealHost.js');
const { transactBuddyUnitPurchase } = require('../lib/vendors/vendorStore.js');
const { transactDuelHealing } = require('../lib/duels/duelHealingHost.js');
const { purchaseMarketplaceItem } = require('../lib/economy/purchaseMarketplaceItem.js');
const L = require('../lib/lib/rivalLadder.js');
const D = require('../lib/lib/duelResolver.js');

let serial = 0;
const T0 = Date.UTC(2026, 9, 18, 20);
const newUid = tag => `onb_${tag}_${Date.now()}_${serial++}`;
const user = async uid => (await db.doc(`users/${uid}`).get()).data();
const ledger = async uid => (await db.doc(`rivalBattles/${uid}`).get()).data() ?? {};
const record = async (uid, id) => (await db.doc(`rivalBattles/${uid}/battles/${id}`).get()).data();
const snap = (uid, extra = {}) => desktopAccountSnapshot.run({ auth: { uid }, data: { schemaVersion: 'desktop-account-3', ...extra } });
const ack = (uid, onboarding) => snap(uid, { operation: 'ackOnboarding', onboarding });
const code = e => e.details?.rejectionCode ?? e.message;
const rival = (uid, data, now, options = {}) => transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', ...data }, now, () => 0.4, { issueLegacy: true, allowLegacySettlement: true, ...options });
const ACE = { name: 'ACE', level: 1, experience: 0, nextLevelExp: 400, attributePoints: 0 };
const SQUAD = { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ['ace'] };
async function setup(fields = {}) {
  const uid = newUid('acct');
  await db.doc(`users/${uid}`).set({ holobots: [ACE], travelSquad: SQUAD, holosTokens: 0, buddyUnits: { light: 1, medium: 0, heavy: 0 }, ...fields });
  return uid;
}
const atStep = (step, stepAt = T0) => ({ onboarding: { step, skipped: false, stepAt } });

test('genesis: a new account starts at step 0 with one Repair Kit; a repeat sign-up changes nothing', async () => {
  const uid = newUid('genesis');
  assert.equal((await createGenesisProfile.run({ auth: { uid }, data: { starterHolobot: 'SHADOW', username: 'New Pilot' } })).created, true);
  const stored = await user(uid);
  assert.equal(stored.onboarding.step, 0); assert.equal(stored.onboarding.skipped, false); assert.ok(Number.isSafeInteger(stored.onboarding.stepAt));
  assert.deepEqual(stored.itemStocks, { repair_kit: 1 }); assert.deepEqual(stored.inventory, {}); assert.equal(stored.holosTokens, 0);
  const r = await snap(uid);
  assert.deepEqual(r.onboarding, { schemaVersion: 'onboarding-1', step: 0, stepId: 'arrive', skipped: false, stepAt: stored.onboarding.stepAt });
  assert.equal(validate(r.onboarding), true);
  const items = await transactDesktopItems(db, uid, { schemaVersion: 'desktop-items-2', operation: 'read' });
  assert.equal(items.items.find(i => i.listingId === 'item.repair_kit').owned, 1, 'the kit is in the desktop-items inventory');
  await db.doc(`users/${uid}`).update({ 'onboarding.step': 2 });
  assert.equal((await createGenesisProfile.run({ auth: { uid }, data: { starterHolobot: 'ACE', username: 'New Pilot' } })).created, false);
  const after = await user(uid);
  assert.equal(after.onboarding.step, 2); assert.deepEqual(after.itemStocks, { repair_kit: 1 }, 'no second kit');
});

test('existing accounts (no field) read as skipped, nothing is written, acks are no-ops, and the mentor rule never applies', async () => {
  const uid = await setup({ rivalWins: 40 });
  for (const schemaVersion of ['desktop-account-1', 'desktop-account-2', 'desktop-account-3']) {
    const r = await desktopAccountSnapshot.run({ auth: { uid }, data: { schemaVersion } });
    assert.deepEqual(r.onboarding, fixture.returning.reply.onboarding);
  }
  assert.deepEqual((await ack(uid, { advance: 1 })).onboarding, fixture.returning.reply.onboarding);
  assert.deepEqual((await ack(uid, { skip: true })).onboarding, fixture.returning.reply.onboarding);
  assert.equal('onboarding' in (await user(uid)), false, 'the lazy default is never persisted');
  const issue = await rival(uid, { operation: 'issue' }, T0);
  assert.equal(issue.encounter.opponentSquad.length, 3, 'tier 4 fields three: no mentor');
  assert.equal((await record(uid, issue.battleId)).onboardingMentor, undefined);
});

test('ackOnboarding through the callable: one step at a time, idempotent, step 3 host-only, skip; bad intents refused', async () => {
  const uid = await setup(atStep(0));
  const r1 = await ack(uid, { advance: 1 });
  assert.equal(r1.onboarding.step, 1); assert.equal(r1.onboarding.stepId, 'companion'); assert.ok(r1.onboarding.stepAt >= T0);
  const stepAt = (await user(uid)).onboarding.stepAt;
  assert.equal((await ack(uid, { advance: 1 })).onboarding.stepAt, stepAt, 'replayed ack writes nothing');
  await assert.rejects(() => ack(uid, { advance: 3 }), e => e.code === 'failed-precondition' && code(e) === 'not_eligible');
  assert.equal((await ack(uid, { advance: 2 })).onboarding.step, 2);
  assert.equal((await ack(uid, { advance: 3 })).onboarding.step, 3);
  await assert.rejects(() => ack(uid, { advance: 4 }), e => e.code === 'failed-precondition' && code(e) === 'not_eligible');
  assert.equal((await user(uid)).onboarding.step, 3);
  for (const bad of [undefined, {}, { advance: 0 }, { advance: 9 }, { skip: false }, { advance: 4, skip: true }])
    await assert.rejects(() => ack(uid, bad), e => e.code === 'invalid-argument' && code(e) === 'invalid_request', JSON.stringify(bad));
  await assert.rejects(() => snap(uid, { operation: 'ackOnboarding', onboarding: { advance: 4 }, tournamentId: 'starter' }), e => e.code === 'invalid-argument');
  const s = await ack(uid, fixture.skipRequest.onboarding);
  assert.equal(s.onboarding.step, 7); assert.equal(s.onboarding.skipped, true); assert.equal(validate(s.onboarding), true);
  assert.deepEqual((await ack(uid, { advance: 4 })).onboarding, s.onboarding, 'a skipped account ignores later acks');
  // Malformed stored state fails closed on every read, like storyFlags.
  const bad = await setup({ onboarding: { step: 3, skipped: true, stepAt: T0 } });
  await assert.rejects(() => snap(bad), e => e.code === 'unavailable');
});

test('host-checked skip-forward: step 4 only when Holos < the cheapest kit; step 5 only when no squad bot is hurt', async () => {
  const rich = await setup({ ...atStep(4), holosTokens: 250 });
  await assert.rejects(() => ack(rich, { advance: 5 }), e => code(e) === 'not_eligible');
  const poor = await setup({ ...atStep(4), holosTokens: 25 });
  assert.equal((await ack(poor, { advance: 5 })).onboarding.step, 5);
  await db.doc(`users/${poor}`).update({ holobotVitals: { ace: { currentHealth: 40, maxHealth: 160 } } });
  await assert.rejects(() => ack(poor, { advance: 6 }), e => code(e) === 'not_eligible');
  await db.doc(`users/${poor}`).update({ holobotVitals: { ace: { currentHealth: 160, maxHealth: 160 } } });
  assert.equal((await ack(poor, { advance: 6 })).onboarding.step, 6);
  assert.equal((await ack(poor, { advance: 7 })).onboarding.stepId, 'done');
});

test('mentor issue (D1): one WOLF on tier-0 stats for the ordinary (Kaz) issue at steps 0–3, legacy and resolver modes', async () => {
  for (const step of [0, 3]) {
    const uid = await setup({ ...atStep(step), rivalWins: 40 });
    const issue = await rival(uid, { operation: 'issue', healthSchema: 'rival-health-1' }, T0);
    assert.equal(issue.encounter.opponentSquad.length, 1);
    const [wolf] = issue.encounter.opponentSquad;
    assert.equal(wolf.holobotId, 'wolf'); assert.equal(wolf.level, 1);
    const tier0 = L.rivalScaledCombatant('wolf', 0);
    assert.deepEqual({ maxHealth: wolf.maxHealth, attack: wolf.attack, defense: wolf.defense, moves: wolf.moves }, { maxHealth: tier0.maxHealth, attack: tier0.attack, defense: tier0.defense, moves: tier0.moves });
    const b = await record(uid, issue.battleId);
    assert.equal(b.onboardingMentor, true); assert.equal(b.lineup.opponentSquad.length, 1); assert.equal(b.tier, 4, 'the ladder tier is unchanged (XP table)');
  }
  // rival-battle-1 wire: the #43 tier-0 baseline row.
  const v1 = await setup(atStep(1));
  const i1 = await transactRivalBattle(db, v1, { operation: 'issue' }, T0, () => 0.4, { issueLegacy: true });
  assert.equal(i1.schemaVersion, 'rival-battle-1'); assert.equal(i1.encounter.opponentSquad.length, 1);
  assert.deepEqual(i1.encounter.opponentSquad[0], L.rivalCombatant('wolf', L.getRivalTierRow(0)));
  // Resolver mode: the pinned opponent fighter is the tier-0 WOLF.
  const res = await setup({ ...atStep(2), rivalWins: 40 });
  const ri = await rival(res, { operation: 'issue' }, T0, { issueLegacy: false, allowLegacySettlement: false });
  assert.equal(ri.duel.mode, 'resolver'); assert.equal(ri.duel.opponent.length, 1);
  assert.equal(ri.duel.opponent[0].holobotId, 'wolf'); assert.equal(ri.duel.opponent[0].tier, 0); assert.equal(ri.duel.opponent[0].level, 1);
  // Not the gathering citizens or Zell: only the ordinary issue is the mentor (gathering issue is refused before arenaGatheringSeen anyway).
  const later = await setup({ ...atStep(4), rivalWins: 40 });
  assert.equal((await rival(later, { operation: 'issue' }, T0)).encounter.opponentSquad.length, 3, 'step 4: normal rules');
});

test('mentor LOSS: no HP change, no cooldown, loss Holos paid, step → 4; the next Kaz issue is normal and immediately legal', async () => {
  const uid = await setup({ ...atStep(3), rivalWins: 40, holobotVitals: { ace: { currentHealth: 120, maxHealth: 160 } } });
  const issue = await rival(uid, { operation: 'issue', healthSchema: 'rival-health-1' }, T0);
  const issuedHp = issue.playerCombatants[0].currentHealth;
  const before = (await user(uid)).holobotVitals;
  const settled = await rival(uid, { operation: 'settle', battleId: issue.battleId, didWin: false, healthSchema: 'rival-health-1', health: [{ holobotId: 'ace', currentHealth: 0 }], fielded: ['ace'] }, T0 + L.RIVAL_MIN_XP_MS + 1);
  assert.equal(settled.didWin, false); assert.equal(settled.holosGranted, L.BATTLE_LOSS_HOLOS);
  const after = await user(uid);
  assert.deepEqual(after.holobotVitals, before, 'no HP change'); assert.equal(after.holobotVitals.ace.currentHealth, issuedHp);
  assert.equal(after.holosTokens, 25); assert.equal(after.onboarding.step, 4); assert.equal(after.onboarding.stepAt, T0 + L.RIVAL_MIN_XP_MS + 1);
  const pilotId = (await record(uid, issue.battleId)).lineup.opponentPilot.pilotId;
  assert.equal((await ledger(uid)).rivalLastSettledAtMs?.[pilotId], undefined, 'no cooldown');
  const next = await rival(uid, { operation: 'issue', healthSchema: 'rival-health-1' }, T0 + L.RIVAL_MIN_XP_MS + 2);
  assert.equal(next.encounter.opponentSquad.length, 3, 'step 4: the mentor rule is over');
  assert.equal((await record(uid, next.battleId)).onboardingMentor, undefined);
  // Replay of the mentor settle writes nothing new.
  const replay = await rival(uid, { operation: 'settle', battleId: issue.battleId, didWin: false }, T0 + L.RIVAL_MIN_XP_MS + 3);
  assert.equal(replay.alreadyProcessed, true); assert.equal((await user(uid)).onboarding.stepAt, T0 + L.RIVAL_MIN_XP_MS + 1);
});

test('control: a NON-mentor loss writes the HP and starts the cooldown (the mentor test is pointed at the rule)', async () => {
  const uid = await setup({ rivalWins: 0, holobotVitals: { ace: { currentHealth: 120, maxHealth: 160 } } });
  const issue = await rival(uid, { operation: 'issue', healthSchema: 'rival-health-1' }, T0);
  await rival(uid, { operation: 'settle', battleId: issue.battleId, didWin: false, healthSchema: 'rival-health-1', health: [{ holobotId: 'ace', currentHealth: 10 }] }, T0 + 1000);
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 10);
  const pilotId = (await record(uid, issue.battleId)).lineup.opponentPilot.pilotId;
  assert.equal((await ledger(uid)).rivalLastSettledAtMs[pilotId], T0 + 1000);
  await assert.rejects(() => rival(uid, { operation: 'issue', healthSchema: 'rival-health-1' }, T0 + 2000), e => e.code === 'rival_cooldown');
});

test('mentor LOSS after a duel-healing settle (Unity order: duel-healing settle, then rival settle): the ledger is back at issue HP', async () => {
  const uid = await setup({ ...atStep(3), holobotVitals: { ace: { currentHealth: 150, maxHealth: 160 } } });
  const issue = await rival(uid, { operation: 'issue', healthSchema: 'rival-health-1' }, T0);
  const run = await transactDuelHealing(db, uid, { schemaVersion: 'duel-healing-1', operation: 'issue', fielded: ['ace'] }, T0 + 10);
  assert.equal(run.open, true);
  await transactDuelHealing(db, uid, { schemaVersion: 'duel-healing-1', operation: 'settle', runId: run.runId, health: [{ holobotId: 'ace', currentHealth: 3 }] }, T0 + 20);
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 3, 'control: the run wrote the duel HP');
  await rival(uid, { operation: 'settle', battleId: issue.battleId, didWin: false, healthSchema: 'rival-health-1', health: [{ holobotId: 'ace', currentHealth: 3 }] }, T0 + 30);
  assert.equal((await user(uid)).holobotVitals.ace.currentHealth, 150, 'mentor loss: no HP cost');
});

test('mentor WIN pays and records normally: HP written, cooldown started, win Holos, Repair patch, step → 4', async () => {
  const uid = await setup({ ...atStep(2), holobotVitals: { ace: { currentHealth: 160, maxHealth: 160 } } });
  const issue = await rival(uid, { operation: 'issue', healthSchema: 'rival-health-1' }, T0);
  const at = T0 + L.RIVAL_MIN_WIN_MS + 1;
  const r = await rival(uid, { operation: 'settle', battleId: issue.battleId, didWin: true, healthSchema: 'rival-health-1', health: [{ holobotId: 'ace', currentHealth: 70 }], fielded: ['ace'] }, at);
  assert.equal(r.didWin, true); assert.equal(r.holosGranted, L.BATTLE_WIN_HOLOS);
  const after = await user(uid);
  assert.equal(after.holobotVitals.ace.currentHealth, 70); assert.equal(after.holosTokens, 100); assert.equal(after.rivalWins, 1);
  assert.equal(after.onboarding.step, 4);
  const pilotId = (await record(uid, issue.battleId)).lineup.opponentPilot.pilotId;
  assert.equal((await ledger(uid)).rivalLastSettledAtMs[pilotId], at);
});

test('mentor in resolver mode: the host receipt decides; a loss keeps HP, a win writes the receipt HP', async () => {
  const uid = await setup({ ...atStep(3), holobotVitals: { ace: { currentHealth: 160, maxHealth: 160 } } });
  const opts = { issueLegacy: false, allowLegacySettlement: false };
  const issue = await rival(uid, { operation: 'issue' }, T0, opts);
  const b = await record(uid, issue.battleId);
  let intents = null, winner = null;
  for (const candidate of [['defend'], ['defend', 'defend'], ['strike'], ['strike', 'strike', 'strike']]) {
    const rr = D.resolveDuel({ ...b.duel.input, playerIntents: candidate });
    if (intents === null || rr.winner !== 'player') { intents = candidate; winner = rr.winner; }
    if (winner !== 'player') break;
  }
  const s = await rival(uid, { operation: 'settle', battleId: issue.battleId, playerIntents: intents }, T0 + L.RIVAL_MIN_WIN_MS + 1, opts);
  const after = await user(uid);
  assert.equal(after.onboarding.step, 4);
  if (s.didWin) assert.equal(after.holobotVitals.ace.currentHealth, s.duelReceipt.playerFinal[0].currentHealth);
  else assert.deepEqual(after.holobotVitals.ace, b.issuedVitals.ace, 'resolver loss: the ledger stays at the issue-time HP');
  console.log(`# resolver mentor outcome with ${JSON.stringify(intents)}: ${s.didWin ? 'win' : 'loss'}`);
});

test('vendor purchase advances 4 → 5 (items host, marketplace item, Buddy Unit); a purchase before the mentor duel does not', async () => {
  const early = await setup({ ...atStep(3), holosTokens: 1000 });
  await transactDesktopItems(db, early, { schemaVersion: 'desktop-items-2', operation: 'buy', itemId: 'item.emergency_patch', requestId: 'buy1' });
  assert.equal((await user(early)).onboarding.step, 3, 'still owed the mentor duel');
  const a = await setup({ ...atStep(4), holosTokens: 1000 });
  await transactDesktopItems(db, a, { schemaVersion: 'desktop-items-2', operation: 'buy', itemId: 'item.emergency_patch', requestId: 'buy1' });
  assert.equal((await user(a)).onboarding.step, 5);
  const b = await setup({ ...atStep(4), holosTokens: 5000 });
  await transactBuddyUnitPurchase(db, b, { tierId: 'buddy_medium', requestId: 'bu1' });
  assert.equal((await user(b)).onboarding.step, 5);
  const c = await setup({ ...atStep(4), holosTokens: 5000 });
  await purchaseMarketplaceItem.run({ auth: { uid: c }, data: { itemName: 'Energy Refill' } });
  assert.equal((await user(c)).onboarding.step, 5);
  const refused = await setup({ ...atStep(4), holosTokens: 0 });
  await assert.rejects(() => transactDesktopItems(db, refused, { schemaVersion: 'desktop-items-2', operation: 'buy', itemId: 'item.repair_kit', requestId: 'buy1' }));
  assert.equal((await user(refused)).onboarding.step, 4, 'a refused purchase advances nothing');
});

test('repair advances 5 → 6: the genesis Repair Kit used from desktopItemsHost, or the workshop heal', async () => {
  // DECISIONS #72.1 "floor + item" (Mobile #160, merged three minutes before this suite): a heal starts FROM the 40 % KO
  // fallback when the bot is below it. ACE 40/160 is 25 %, under the 64 floor, so the Repair Kit (50 % = 80) lands at
  // 64 + 80 = 144, not the pre-#72.1 40 + 80 = 120.
  const kit = await setup({ ...atStep(5), itemStocks: { repair_kit: 1 }, holobotVitals: { ace: { currentHealth: 40, maxHealth: 160 } } });
  const used = await transactDesktopItems(db, kit, { schemaVersion: 'desktop-items-2', operation: 'use', itemId: 'item.repair_kit', holobotId: 'ace', requestId: 'use1' });
  assert.equal(used.result.kind, 'repair');
  const k = await user(kit);
  assert.equal(k.onboarding.step, 6); assert.deepEqual(k.itemStocks, { repair_kit: 0 }); assert.equal(k.holobotVitals.ace.currentHealth, 144);
  // Pins the floor itself on the literal knocked-out case: 0/160 + Kit = max(0, 64) + 80 = 144 (it was 0 + 80 = 80 before #72.1).
  const ko = await setup({ ...atStep(5), itemStocks: { repair_kit: 1 }, holobotVitals: { ace: { currentHealth: 0, maxHealth: 160 } } });
  await transactDesktopItems(db, ko, { schemaVersion: 'desktop-items-2', operation: 'use', itemId: 'item.repair_kit', holobotId: 'ace', requestId: 'use1' });
  const koAfter = await user(ko);
  assert.equal(koAfter.holobotVitals.ace.currentHealth, 64 + 80, 'a KO heal starts from the 40 % floor (64), then adds the Kit (80)');
  assert.equal(koAfter.onboarding.step, 6);
  const ws = await setup({ ...atStep(5), holobotVitals: { ace: { currentHealth: 40, maxHealth: 160 } } });
  await transactWorkshopHeal(db, ws, { schemaVersion: 'healing-workshop-1', operation: 'heal', requestId: 'ws1' });
  assert.equal((await user(ws)).onboarding.step, 6);
  const early = await setup({ ...atStep(4), itemStocks: { repair_kit: 1 }, holobotVitals: { ace: { currentHealth: 40, maxHealth: 160 } } });
  await transactDesktopItems(db, early, { schemaVersion: 'desktop-items-2', operation: 'use', itemId: 'item.repair_kit', holobotId: 'ace', requestId: 'use1' });
  assert.equal((await user(early)).onboarding.step, 4, 'a kit used at the market beat leaves the market beat');
});

test('full genesis spine: sign-up → acks → mentor loss → can\'t afford skip-forward → full HP skip-forward → goal ack → done', async () => {
  const uid = newUid('spine');
  await createGenesisProfile.run({ auth: { uid }, data: { starterHolobot: 'KUMA', username: 'Spine Pilot' } });
  for (const n of [1, 2, 3]) assert.equal((await ack(uid, { advance: n })).onboarding.step, n);
  const issue = await transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', operation: 'issue', healthSchema: 'rival-health-1' }, Date.now(), () => 0.4, { issueLegacy: true });
  assert.equal(issue.encounter.opponentSquad.length, 1); assert.equal(issue.encounter.opponentSquad[0].holobotId, 'wolf');
  await transactRivalBattle(db, uid, { schemaVersion: 'rival-battle-3', operation: 'settle', battleId: issue.battleId, didWin: false, healthSchema: 'rival-health-1', health: [{ holobotId: 'kuma', currentHealth: 0 }] }, Date.now() + L.RIVAL_MIN_XP_MS + 1, () => 0.4, { allowLegacySettlement: true });
  const mid = await snap(uid);
  assert.equal(mid.onboarding.stepId, 'market');
  assert.equal(mid.holobots.length, 1);
  assert.equal((await ack(uid, { advance: 5 })).onboarding.stepId, 'repair', '25 Holos: nothing affordable');
  assert.equal((await ack(uid, { advance: 6 })).onboarding.stepId, 'goal', 'full HP after the mentor loss');
  const done = await ack(uid, { advance: 7 });
  assert.equal(done.onboarding.stepId, 'done'); assert.equal(done.onboarding.skipped, false); assert.equal(validate(done.onboarding), true);
  assert.deepEqual((await user(uid)).itemStocks, { repair_kit: 1 }, 'the genesis kit is still there for the [V] lesson');
});
