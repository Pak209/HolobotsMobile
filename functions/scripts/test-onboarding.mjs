// onboarding-host-1 (DECISIONS #72.3–#72.5) domain tests: the host-owned onboarding step (lib/onboarding.ts), the D1
// mentor lineup (rival/onboardingMentor.ts), the D3 genesis Repair Kit (lib/genesisSignup.ts) and the reply field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../lib/lib/onboarding.js');
const M = require('../lib/rival/onboardingMentor.js');
const L = require('../lib/lib/rivalLadder.js');
const G = require('../lib/lib/genesisSignup.js');
const R = require('../lib/lib/repairItems.js');
const S = require('../lib/desktop/desktopAccountReply.js');
const { default: Ajv } = require('ajv');
const validate = new Ajv({ strict: false }).compile(require('../../Schemas/onboarding-1.json'));
const fixture = require('./fixtures/desktop-account/onboarding.json');
const T = 1792368000000;
const at = (step, extra = {}) => ({ onboarding: { step, skipped: false, stepAt: T }, ...extra });
const squad = ids => ({ holobots: ids.map(id => ({ name: id.toUpperCase() })), travelSquad: { schemaVersion: 'travel-squad-1', revision: 1, holobotIds: ids } });

test('read: missing = returning (step 7, skipped, stepAt null); genesis starts at 0; malformed fails closed', () => {
  assert.deepEqual(O.readOnboarding(undefined), { step: 7, skipped: true, stepAt: null });
  assert.deepEqual(O.genesisOnboarding(T), { step: 0, skipped: false, stepAt: T });
  assert.deepEqual(O.readOnboarding({ step: 4, skipped: false, stepAt: T }), { step: 4, skipped: false, stepAt: T });
  for (const bad of [null, [], 'x', 3, {}, { step: 0, skipped: false }, { step: 0, skipped: false, stepAt: T, extra: 1 },
    { step: -1, skipped: false, stepAt: T }, { step: 8, skipped: false, stepAt: T }, { step: 1.5, skipped: false, stepAt: T },
    { step: '1', skipped: false, stepAt: T }, { step: 3, skipped: true, stepAt: T }, { step: 0, skipped: 'no', stepAt: T },
    { step: 0, skipped: false, stepAt: -1 }, { step: 0, skipped: false, stepAt: 'now' }])
    assert.throws(() => O.readOnboarding(bad), e => e instanceof O.OnboardingError && e.code === 'unavailable', JSON.stringify(bad));
  assert.deepEqual([...O.ONBOARDING_STEP_IDS], ['arrive', 'companion', 'first_walk', 'mentor_duel', 'market', 'repair', 'goal', 'done']);
});

test('intent validation: exactly {advance: 1..7} or {skip: true}', () => {
  assert.deepEqual(O.validateOnboardingIntent({ advance: 1 }), { advance: 1 });
  assert.deepEqual(O.validateOnboardingIntent({ skip: true }), { skip: true });
  for (const bad of [undefined, null, [], {}, { advance: 0 }, { advance: 8 }, { advance: 1.5 }, { advance: '1' }, { skip: false }, { skip: 'yes' }, { advance: 1, skip: true }, { advance: 1, step: 1 }])
    assert.throws(() => O.validateOnboardingIntent(bad), e => e.code === 'invalid_request', JSON.stringify(bad));
});

test('step order: acks walk 0→1→2→3 one at a time; step 3 never advances on a client ack; replays are no-ops', () => {
  let p = at(0);
  for (const n of [1, 2, 3]) {
    assert.throws(() => O.acknowledgeOnboarding(p, { advance: n + 1 }, T + n), e => e.code === 'not_eligible', `no jump to ${n + 1}`);
    const next = O.acknowledgeOnboarding(p, { advance: n }, T + n);
    assert.deepEqual(next, { step: n, skipped: false, stepAt: T + n });
    p = { onboarding: next };
    assert.deepEqual(O.acknowledgeOnboarding(p, { advance: n }, T + 99), next, 'retry of the same ack is idempotent (stepAt kept)');
    assert.deepEqual(O.acknowledgeOnboarding(p, { advance: 1 }, T + 99), next, 'an older ack never moves it back');
  }
  assert.throws(() => O.acknowledgeOnboarding(p, { advance: 4 }, T), e => e.code === 'not_eligible', 'the mentor duel completes only on the host settle');
  // goal → done is a presentation ack.
  assert.deepEqual(O.acknowledgeOnboarding(at(6), { advance: 7 }, T + 7), { step: 7, skipped: false, stepAt: T + 7 });
  // Retired / skipped / returning accounts ignore every ack.
  for (const p2 of [at(7), { onboarding: { step: 7, skipped: true, stepAt: T } }, {}])
    for (const intent of [{ advance: 7 }, { advance: 1 }, { skip: true }])
      assert.deepEqual(O.acknowledgeOnboarding(p2, intent, T + 5), O.readOnboarding(p2.onboarding));
});

test('skip: from any live step sets step 7 + skipped; skip-forward from 4 / 5 is host-checked', () => {
  for (const step of [0, 1, 2, 3, 4, 5, 6]) assert.deepEqual(O.acknowledgeOnboarding(at(step), { skip: true }, T + 1), { step: 7, skipped: true, stepAt: T + 1 });
  // Step 4 (market): only when nothing at the kit stall is affordable.
  assert.equal(O.ONBOARDING_MARKET_MIN_PRICE, 100);
  assert.deepEqual(O.acknowledgeOnboarding(at(4, { holosTokens: 25 }), { advance: 5 }, T + 1), { step: 5, skipped: false, stepAt: T + 1 });
  assert.deepEqual(O.acknowledgeOnboarding(at(4), { advance: 5 }, T + 1).step, 5, 'no Holos field = 0');
  assert.throws(() => O.acknowledgeOnboarding(at(4, { holosTokens: 100 }), { advance: 5 }, T), e => e.code === 'not_eligible');
  assert.throws(() => O.acknowledgeOnboarding(at(4, { holosTokens: 'x' }), { advance: 5 }, T), e => e.code === 'unavailable');
  // Step 5 (repair): only when no travel-squad bot is below max on the host ledger.
  const hurt = { ...squad(['ace']), holobotVitals: { ace: { currentHealth: 99, maxHealth: 331 } } };
  const full = { ...squad(['ace']), holobotVitals: { ace: { currentHealth: 331, maxHealth: 331 }, kuma: { currentHealth: 1, maxHealth: 200 } } };
  assert.throws(() => O.acknowledgeOnboarding(at(5, hurt), { advance: 6 }, T), e => e.code === 'not_eligible');
  assert.equal(O.acknowledgeOnboarding(at(5, full), { advance: 6 }, T).step, 6, 'a hurt bot outside the squad does not block');
  assert.equal(O.acknowledgeOnboarding(at(5, squad(['ace'])), { advance: 6 }, T).step, 6, 'no ledger row = fresh');
});

test('host events: settle 0–3 → 4; purchase only at 4 → 5; repair only at 5 → 6; never blocks on a bad pointer', () => {
  for (const step of [0, 1, 2, 3]) assert.deepEqual(O.onboardingAfterEvent(at(step), 'rival_settle', T + 1), { onboarding: { step: 4, skipped: false, stepAt: T + 1 } });
  for (const step of [4, 5, 6, 7]) assert.deepEqual(O.onboardingAfterEvent(at(step), 'rival_settle', T), {});
  assert.deepEqual(O.onboardingAfterEvent(at(4), 'vendor_purchase', T + 2), { onboarding: { step: 5, skipped: false, stepAt: T + 2 } });
  for (const step of [0, 1, 2, 3, 5, 6, 7]) assert.deepEqual(O.onboardingAfterEvent(at(step), 'vendor_purchase', T), {}, `purchase at ${step} (a buy before the mentor duel never skips it)`);
  assert.deepEqual(O.onboardingAfterEvent(at(5), 'repair', T + 3), { onboarding: { step: 6, skipped: false, stepAt: T + 3 } });
  for (const step of [0, 1, 2, 3, 4, 6, 7]) assert.deepEqual(O.onboardingAfterEvent(at(step), 'repair', T), {}, `repair at ${step}`);
  for (const p of [{}, { onboarding: { step: 7, skipped: true, stepAt: T } }, { onboarding: 'broken' }, { onboarding: { step: 2 } }])
    for (const ev of ['rival_settle', 'vendor_purchase', 'repair']) assert.deepEqual(O.onboardingAfterEvent(p, ev, T), {}, `${ev} ${JSON.stringify(p)}`);
});

test('mentor rule gate: step <= 3 and not skipped; existing (missing field), skipped, later and malformed accounts never', () => {
  for (const step of [0, 1, 2, 3]) assert.equal(O.onboardingMentorActive(at(step)), true);
  for (const p of [at(4), at(7), {}, { onboarding: { step: 7, skipped: true, stepAt: T } }, { onboarding: null }, { onboarding: { step: 1 } }])
    assert.equal(O.onboardingMentorActive(p), false, JSON.stringify(p));
});

test('mentor lineup: exactly one WOLF on the softest tier stats (v3 = WOLF L1 + tier-0 damage scale; v1/v2 = #43 tier-0 row); seed and id unchanged', () => {
  const profile = { ...squad(['ace']), rivalWins: 47 }; // tier 4 = three rivals normally
  for (const version of ['rival-battle-1', 'rival-battle-2', 'rival-battle-3']) {
    const scale = L.rivalLineupScaleFor(version);
    let i = 0; const draws = [0.9, 0.1, 0.5, 0.7, 0.3, 0.2, 0.8, 0.4];
    const r = L.issueRivalBattle(profile, T, 'rb_mentor', () => draws[i++ % 8], ['ace'], scale);
    assert.equal(r.battle.lineup.opponentSquad.length, 3, 'control: tier 4 fields three');
    const { seed, battleId } = r.battle;
    M.applyOnboardingMentor(r, scale);
    assert.equal(r.battle.onboardingMentor, true); assert.equal(M.isOnboardingMentorBattle(r.battle), true);
    assert.equal(r.battle.seed, seed); assert.equal(r.battle.battleId, battleId);
    assert.equal(r.battle.lineup.opponentSquad.length, 1); assert.equal(r.reply.encounter.opponentSquad.length, 1);
    const wolf = r.battle.lineup.opponentSquad[0], row = r.reply.encounter.opponentSquad[0];
    assert.equal(wolf.holobotId, 'wolf'); assert.equal(row.holobotId, 'wolf');
    if (version === 'rival-battle-3') {
      assert.deepEqual(wolf, L.rivalScaledCombatant('wolf', 0));
      assert.equal(wolf.level, 1);
      assert.deepEqual({ speed: row.speed, intelligence: row.intelligence }, L.rivalScaledCombatantStats(0));
      assert.ok(row.commandRules);
      const v3 = L.rivalReplyForVersion(r.reply, version);
      assert.equal(v3.encounter.opponentSquad.length, 1);
    } else {
      assert.deepEqual(wolf, L.rivalCombatant('wolf', L.getRivalTierRow(0)));
      assert.equal('speed' in row, false);
      assert.equal(L.rivalReplyForVersion(r.reply, version).encounter.opponentSquad[0].holobotId, 'wolf');
    }
    // Softer than every non-mentor tier-0 row and far softer than the account's real tier.
    const tier4 = L.rivalScaledCombatant('wolf', 4);
    assert.ok(wolf.maxHealth <= tier4.maxHealth && wolf.attack <= tier4.attack, 'softest tier');
  }
  assert.equal(M.isOnboardingMentorBattle({ onboardingMentor: 'true' }), false);
  assert.equal(M.isOnboardingMentorBattle(undefined), false);
});

test('genesis Repair Kit (D3): one item.repair_kit in the desktopItems inventory shape; the mobile-parity doc is unchanged', () => {
  const grants = G.buildGenesisHostGrants();
  assert.deepEqual(grants, { itemStocks: { repair_kit: 1 } });
  assert.equal(R.healingStock(grants, 'item.repair_kit'), 1);
  assert.equal(R.healingStock(grants, 'item.emergency_patch'), 0);
  const doc = G.buildGenesisSignupUserDoc('ACE', 'Pilot', 'TS');
  assert.equal('itemStocks' in doc, false, 'mobile parity: a phone sign-up cannot write itemStocks (rules freeze it on create)');
  assert.equal('onboarding' in doc, false);
  assert.deepEqual(doc.inventory, {});
});

test('reply: every desktop-account version carries onboarding; the view validates against Schemas/onboarding-1.json; fixtures are the builder output', () => {
  for (const version of ['desktop-account-1', 'desktop-account-2', 'desktop-account-3']) {
    for (const step of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const r = S.buildDesktopAccountReply(at(step), 'u', version, { light: 0, medium: 0, heavy: 0 });
      assert.deepEqual(r.onboarding, { schemaVersion: 'onboarding-1', step, stepId: O.ONBOARDING_STEP_IDS[step], skipped: false, stepAt: T });
      assert.equal(validate(r.onboarding), true, JSON.stringify(validate.errors));
    }
    const ret = S.buildDesktopAccountReply({}, 'u', version, { light: 0, medium: 0, heavy: 0 });
    assert.equal(validate(ret.onboarding), true);
    assert.throws(() => S.buildDesktopAccountReply({ onboarding: { step: 9 } }, 'u', version, { light: 0, medium: 0, heavy: 0 }), /unavailable/);
  }
  for (const key of ['returning', 'genesis', 'skipped']) {
    const c = fixture[key];
    const profile = c.storedOnboarding === null ? {} : { onboarding: c.storedOnboarding };
    assert.deepEqual(S.buildDesktopAccountReply(profile, 'u', 'desktop-account-3', { light: 0, medium: 0, heavy: 0 }).onboarding, c.reply.onboarding, key);
    assert.equal(validate(c.reply.onboarding), true, key);
  }
  for (const bad of fixture.knownBad) assert.equal(validate(bad), false, JSON.stringify(bad));
});
