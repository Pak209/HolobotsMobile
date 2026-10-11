// Zell compat gate (DECISIONS #54-1, PR #65). Every ordinary rival request - rival-battle-1 (absent or explicit),
// rival-battle-2 and rival-battle-3 status / issue / settle, with and without healthSchema "rival-health-1", wins and
// losses with and without fielded and health rows, duplicate replays through every version, and rejections - must
// give the same reply BYTES (JSON.stringify, key order included) and the same stored documents through this build's
// rivalBattleStore, with the Zell flag off and on, as through a build of the pre-Zell base, for the same profile,
// nowMs, battleId and random draws. Every roster rival is served at every tier in every wire version.
// ZELL_COMPAT_BASELINE_LIB = absolute path of a compiled pre-Zell functions/lib (e.g. 881e352); without it the
// cross-build test is skipped. The known-bad controls always run. Transactions use the off-editor memory model.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { memoryFirestore } from './zell-memory-firestore.mjs';
const require = createRequire(import.meta.url);
const L = require('../lib/lib/rivalLadder.js');
const candidate = require('../lib/rival/rivalBattleStore.js').transactRivalBattle;
const baseline = (() => {
  const dir = process.env.ZELL_COMPAT_BASELINE_LIB;
  if (!dir) return null;
  if (!path.isAbsolute(dir) || !existsSync(path.join(dir, 'rival', 'rivalBattleStore.js'))) throw new Error('ZELL_COMPAT_BASELINE_LIB must be the absolute path of a compiled functions/lib');
  if (realpathSync(dir) === realpathSync(new URL('../lib', import.meta.url)) || existsSync(path.join(dir, 'lib', 'zellStory.js'))) throw new Error('ZELL_COMPAT_BASELINE_LIB must be a pre-Zell build, not this one');
  return require(path.join(dir, 'rival', 'rivalBattleStore.js')).transactRivalBattle;
})();

// transactRivalBattle names battles rb_<randomBytes(12)>; pin those bytes per (chain, step) so both builds use one id.
const nodeCrypto = require('node:crypto'), realRandomBytes = nodeCrypto.randomBytes;
let pinned = null;
nodeCrypto.randomBytes = function (size, ...rest) { return pinned && size === 12 && !rest.length ? Buffer.from(pinned) : realRandomBytes.call(this, size, ...rest); };
after(() => { nodeCrypto.randomBytes = realRandomBytes; });
const draws = seed => { let j = 0; return () => { const v = (seed + 0.5) / 12 + 0.381966 * j++; return v - Math.floor(v); }; };

const T = Date.UTC(2026, 9, 10, 15, 0, 0), UID = 'compat_pilot';
const V = { absent: {}, v1: { schemaVersion: 'rival-battle-1' }, v2: { schemaVersion: 'rival-battle-2' }, v3: { schemaVersion: 'rival-battle-3' } };
const HEALTH = { healthSchema: 'rival-health-1' };
const SQUAD = ['ace', 'kuma', 'wolf'];
const ROWS = [{ holobotId: 'ace', currentHealth: 0 }, { holobotId: 'kuma', currentHealth: 1 }, { holobotId: 'wolf', currentHealth: 10 }];
const HOLOBOTS = [
  { name: 'ACE', level: 12, experience: 340, nextLevelExp: 600, attributePoints: 2, boostedAttributes: { attack: 1, defense: 0, speed: 2, special: 0, health: 1 } },
  { name: 'KUMA', level: 4, experience: 10, nextLevelExp: 120 },
  { name: 'WOLF', level: 30, rank: 'Elite' },
];
const PROFILES = [
  ...[0, 10, 25, 35, 40, 55, 60, 75, 85, 99, 100, 150, 1000].map((wins, n) => ({ name: `ladder-${wins}`, profile: { holobots: HOLOBOTS, travelSquad: { schemaVersion: 'travel-squad-1', revision: 3, holobotIds: SQUAD }, buddyUnits: { light: 1, medium: 2, heavy: 3 }, rivalWins: wins, rivalRewardDay: n % 2 ? '2026-10-10' : '2026-10-09', holobotVitals: { ace: { currentHealth: 0, maxHealth: 500 }, kuma: { currentHealth: 40, maxHealth: 500 } }, holosTokens: 7 } })),
  ...[0, 25, 99].map(wins => ({ name: `legacy-${wins}`, profile: { holobots: [{ name: 'ACE', level: 3 }], buddyUnits: 4, rivalWins: wins } })),
  { name: 'fresh', profile: { holobots: [] } },
];
const ISSUES = Object.entries(V).flatMap(([v, version]) => [false, true].map(health => ({ name: `${v}${health ? '+health' : ''}`, version, health, req: { operation: 'issue', ...version, ...(health ? HEALTH : {}) } })));
const SETTLES = [
  { name: 'win', didWin: true, at: 20000 }, { name: 'win+fielded', didWin: true, at: 20000, fielded: true },
  { name: 'loss', didWin: false, at: 5000 }, { name: 'early-loss+fielded', didWin: false, at: 5000, fielded: true }, { name: 'loss+fielded', didWin: false, at: 30000, fielded: true },
];
const first = ids => ids[0] ?? 'rb_missing';
const v3Issue = { req: { operation: 'issue', ...V.v3 } };
const v3Settle = (extra, at = 20000) => ({ req: ids => ({ operation: 'settle', ...V.v3, battleId: first(ids), didWin: true, ...extra }), at });
const REJECTIONS = {
  'unknown-battle': [{ req: { operation: 'settle', battleId: 'rb_unknown', didWin: true } }],
  'too-fast': [v3Issue, v3Settle({}, 19999)],
  expired: [{ req: { operation: 'issue', ...V.v2 } }, { req: ids => ({ operation: 'settle', ...V.v2, battleId: first(ids), didWin: true }), at: L.RIVAL_BATTLE_TTL_MS + 1 }],
  'fourth-open': [1, 2, 3, 4].map(at => ({ req: { operation: 'issue' }, at })),
  'health-issue-while-open': [v3Issue, { req: { operation: 'issue', ...V.v3, ...HEALTH }, at: 1 }],
  'rows-on-unflagged-battle': [v3Issue, v3Settle({ ...HEALTH, health: ROWS })],
  'inflated-rows': [{ req: { operation: 'issue', ...V.v3, ...HEALTH } }, v3Settle({ ...HEALTH, health: [{ holobotId: 'wolf', currentHealth: 1e9 }] })],
  'fielded-outside-squad': [v3Issue, v3Settle({ fielded: ['tora'] })],
  'bad-version': [{ req: { operation: 'status', schemaVersion: 'rival-battle-4' } }],
  'bad-operation': [{ req: { operation: 'grant' } }],
  'bad-battle-id': [{ req: { operation: 'settle', battleId: '../x', didWin: true } }],
  'bad-health-schema': [{ req: { operation: 'settle', battleId: 'rb_x', didWin: true, healthSchema: 'rival-health-9' } }],
  'no-request': [{ req: null }],
};

function chains() {
  const out = [];
  for (const { name: p, profile } of PROFILES) {
    for (const [v, version] of Object.entries(V)) out.push({ key: `${p}/status/${v}`, profile, steps: [{ req: { operation: 'status', ...version } }] });
    out.push({ key: `${p}/status/v3+health`, profile, steps: [{ req: { operation: 'status', ...V.v3, ...HEALTH } }] });
    for (const issue of ISSUES) {
      for (let k = 0; k < 12; k++) out.push({ key: `${p}/issue/${issue.name}/draw${k}`, profile, seed: k, lineup: `${p}|${issue.name}`, steps: [{ req: issue.req }] });
      for (const s of SETTLES) for (const h of issue.health ? ['none', 'schema', 'rows'] : ['none', 'schema']) {
        const settle = ids => ({ operation: 'settle', ...issue.version, battleId: first(ids), didWin: s.didWin, ...(s.fielded ? { fielded: SQUAD } : {}), ...(h === 'schema' ? HEALTH : h === 'rows' ? { ...HEALTH, health: ROWS } : {}) });
        const replays = Object.values(V).map(version => ({ req: ids => ({ operation: 'settle', ...version, battleId: first(ids), didWin: !s.didWin }), at: 40000 }));
        out.push({ key: `${p}/settle/${issue.name}/${s.name}/${h}`, profile, seed: out.length % 12, steps: [{ req: issue.req }, { req: settle, at: s.at }, ...replays] });
      }
    }
    for (const [name, steps] of Object.entries(REJECTIONS)) out.push({ key: `${p}/reject/${name}`, profile, steps });
  }
  out.push({ key: 'no-user', profile: undefined, steps: [{ req: { operation: 'status' } }, v3Issue] });
  out.push({ key: 'malformed-wins', profile: { holobots: [], rivalWins: -1 }, steps: [{ req: { operation: 'status', ...V.v2 } }, v3Issue] });
  return out;
}

async function runChain(store, options, chain) {
  const db = memoryFirestore(), replies = [], ids = [];
  if (chain.profile !== undefined) await db.doc(`users/${UID}`).set(chain.profile);
  for (const [n, step] of chain.steps.entries()) {
    const req = typeof step.req === 'function' ? step.req(ids) : step.req;
    pinned = createHash('sha256').update(`${chain.key}#${n}`).digest().subarray(0, 12);
    try {
      const reply = await store(db, UID, req, T + (step.at ?? 0), draws(chain.seed ?? 0), options);
      if (req?.operation === 'issue') ids.push(reply.battleId);
      replies.push(JSON.stringify(reply));
    } catch (e) {
      replies.push(JSON.stringify({ rejection: e instanceof Error && typeof e.code === 'string' ? e.code : String(e) }));
    } finally { pinned = null; }
  }
  const read = async p => (await db.doc(p).get()).data() ?? null;
  const state = JSON.stringify({ user: await read(`users/${UID}`), ledger: await read(`rivalBattles/${UID}`), battles: await Promise.all(ids.map(id => read(`rivalBattles/${UID}/battles/${id}`))), story: await read(`storyProgress/${UID}`) });
  return { replies, state };
}

/** The gate's one comparison: reply strings must be equal byte for byte; stored documents likewise. */
async function compare(reference, candidates, list, { keepPairs = false, onReference } = {}) {
  const r = { chains: 0, cases: 0, comparisons: 0, stateComparisons: 0, replyMismatches: [], stateMismatches: [], pairs: [] };
  for (const chain of list) {
    const ref = await runChain(reference, undefined, chain);
    r.chains++; r.cases += ref.replies.length; onReference?.(chain, ref.replies);
    for (const c of candidates) {
      const got = await runChain(c.fn, c.options, chain);
      ref.replies.forEach((expected, n) => {
        r.comparisons++;
        if (keepPairs) r.pairs.push([expected, got.replies[n]]);
        if (got.replies[n] !== expected) r.replyMismatches.push({ chain: chain.key, step: n, candidate: c.name, expected, actual: got.replies[n] });
      });
      r.stateComparisons++;
      if (got.state !== ref.state) r.stateMismatches.push({ chain: chain.key, candidate: c.name, expected: ref.state, actual: got.state });
    }
  }
  return r;
}

// Controls use only successful replies (status, every issue variant and draw, one settle chain with replays) so
// every perturbed reply must be flagged. Reference: the base build when given, else this build unperturbed.
const controlChains = () => chains().filter(c => (c.key.startsWith('ladder-35/') && (c.key.includes('/status/') || c.key.includes('/issue/'))) || c.key === 'ladder-35/settle/v3+health/win+fielded/rows');
const perturbed = f => async (...args) => f(await candidate(...args));
const reference = baseline ?? candidate;

test('known-bad control: a one-value change in a candidate reply is flagged', async t => {
  const r = await compare(reference, [{ name: 'one-value', fn: perturbed(x => ({ ...x, status: { ...x.status, winsToNextTier: x.status.winsToNextTier + 1 } })), options: {} }], controlChains());
  assert.ok(r.comparisons >= 100, `only ${r.comparisons} control comparisons`);
  assert.equal(r.replyMismatches.length, r.comparisons, 'every one-value change must be flagged');
  t.diagnostic(`one-value control: ${r.replyMismatches.length}/${r.comparisons} flagged (reference: ${baseline ? 'base build' : 'this build'})`);
});

test('known-bad control: a key-order change is flagged although the values deep-equal', async t => {
  const r = await compare(reference, [{ name: 'key-order', fn: perturbed(x => ({ ...x, status: Object.fromEntries(Object.entries(x.status).reverse()) })), options: {} }], controlChains(), { keepPairs: true });
  assert.ok(r.comparisons >= 100, `only ${r.comparisons} control comparisons`);
  assert.equal(r.replyMismatches.length, r.comparisons, 'every key-order change must be flagged');
  for (const [expected, actual] of r.pairs) assert.deepStrictEqual(JSON.parse(actual), JSON.parse(expected), 'a deep-equal gate would pass this pair');
  t.diagnostic(`key-order control: ${r.replyMismatches.length}/${r.comparisons} flagged; ${r.pairs.length} pairs deep-equal`);
});

test('known-bad control: ordinary requests that picked up the story projection are flagged', async t => {
  const leaky = (db, uid, req, ...rest) => candidate(db, uid, { ...req, storySchema: 'zell-story-1' }, ...rest);
  const r = await compare(reference, [{ name: 'story-leak', fn: leaky, options: { zellEnabled: true } }], controlChains());
  assert.equal(r.replyMismatches.length, r.comparisons, 'every story-carrying reply must be flagged');
  t.diagnostic(`story-leak control: ${r.replyMismatches.length}/${r.comparisons} flagged`);
});

test('ordinary rival replies and stored documents are byte-identical to the pre-Zell base, Zell flag off and on', { skip: baseline ? false : 'set ZELL_COMPAT_BASELINE_LIB to the absolute path of a compiled pre-Zell functions/lib (e.g. 881e352)' }, async t => {
  const seen = new Map();
  const r = await compare(baseline, [{ name: 'zell-off', fn: candidate, options: {} }, { name: 'zell-on', fn: candidate, options: { zellEnabled: true } }], chains(), {
    onReference: (chain, replies) => { if (!chain.lineup) return; const squad = JSON.parse(replies[0]).encounter?.opponentSquad ?? []; const ids = seen.get(chain.lineup) ?? new Set(); for (const c of squad) ids.add(c.holobotId); seen.set(chain.lineup, ids); },
  });
  const bad = r.replyMismatches[0] ?? r.stateMismatches[0];
  assert.equal(r.replyMismatches.length + r.stateMismatches.length, 0, bad && `${r.replyMismatches.length} reply / ${r.stateMismatches.length} state mismatches; first: ${bad.candidate} ${bad.chain}#${bad.step ?? 'state'}\nexpected ${bad.expected}\nactual   ${bad.actual}`);
  assert.equal(seen.size, PROFILES.length * ISSUES.length);
  for (const [lineup, ids] of seen) assert.deepEqual([...ids].sort(), [...L.RIVAL_ROSTER_IDS].sort(), `every roster rival served for ${lineup}`);
  assert.ok(r.cases > 12000, `only ${r.cases} cases`);
  t.diagnostic(`${r.cases} ordinary request cases in ${r.chains} chains: ${r.comparisons} reply comparisons + ${r.stateComparisons} stored-state comparisons (flag off and on), 0 differ; all ${L.RIVAL_ROSTER_IDS.length} roster rivals in ${seen.size} profile x issue-shape lineups`);
});
