// host-crawl-fixes-1 pure tests: holobot progression self-heal (RC7), tolerant story-flag display read, economy-field
// sanitizer (firestore.rules economyFieldsSane) incl. field-list parity with the rules file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { repairHolobotProgression } = require('../lib/lib/holobotRecordRepair.js');
const { calculateExperience } = require('../lib/lib/progression.js');
const { readStoryFlags, readStoryFlagsTolerant } = require('../lib/story/storyFlags.js');
const { sanitizeEconomyFields, ECONOMY_SANE_FIELDS, ECONOMY_SANE_EPOCH_FIELDS, ECONOMY_SANE_MAX } = require('../lib/lib/economyFieldSanitizer.js');
const { describeRepairValue } = require('../lib/lib/accountRepairAudit.js');

test('holobot repair: canonical records are untouched (no changes, same values)', () => {
  for (const bot of [{ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 2500, attributePoints: 1, boostedAttributes: { attack: 3 } }, { name: 'KUMA' }, { name: 'KUMA', level: 1, experience: 0 }]) {
    const r = repairHolobotProgression(bot);
    assert.equal(r.ok, true); assert.deepEqual(r.changes, []); assert.deepEqual(r.holobot, bot);
  }
});

test('holobot repair: legacy derived fields heal from level; level / experience never change; nothing is raised', () => {
  const cases = [
    [{ name: 'KUMA', level: 1, experience: 150, nextLevelExp: 100 }, { nextLevelExp: 400 }],
    [{ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 1600 }, { nextLevelExp: 2500 }],
    [{ name: 'ACE', level: 4, experience: 1700, nextLevelExp: '2500' }, { nextLevelExp: 2500 }],
    [{ name: 'ACE', level: 4, experience: 1700, nextLevelExp: null }, { nextLevelExp: 2500 }],
    [{ name: 'ACE', level: 4, experience: 1700, nextLevelExp: 99999 }, { nextLevelExp: 2500 }],
    [{ name: 'ACE', level: 4, experience: 0, attributePoints: null }, { attributePoints: 0 }],
    [{ name: 'ACE', level: 4, experience: 0, attributePoints: '3' }, { attributePoints: 3 }],
    [{ name: 'ACE', level: 4, experience: 0, attributePoints: 2.7 }, { attributePoints: 2 }],
    [{ name: 'ACE', level: 4, experience: 0, boostedAttributes: null }, { boostedAttributes: {} }],
    [{ name: 'ACE', level: 4, experience: 0, boostedAttributes: { attack: '3', speed: null, defense: 2 } }, { boostedAttributes: { attack: 3, defense: 2 } }],
  ];
  for (const [bot, healed] of cases) {
    const r = repairHolobotProgression(bot);
    assert.equal(r.ok, true, JSON.stringify(bot));
    assert.deepEqual(r.holobot, { ...bot, ...healed }, JSON.stringify(bot));
    assert.equal(r.holobot.level, bot.level); assert.equal(r.holobot.experience, bot.experience);
    assert.equal(r.changes.length, Object.keys(healed).length);
    if (typeof bot.attributePoints === 'number') assert.ok(r.holobot.attributePoints <= bot.attributePoints);
  }
});

test('holobot repair: unhealable records are refused with a reason, never guessed', () => {
  const cases = [
    [{ name: 'ACE', level: 0 }, 'level_malformed'], [{ name: 'ACE', level: '4' }, 'level_malformed'], [{ name: 'ACE', level: Infinity }, 'level_malformed'],
    [{ name: 'ACE', level: 4, experience: -1 }, 'experience_malformed'], [{ name: 'ACE', level: 4, experience: '1e309' }, 'experience_malformed'],
    [{ name: 'ACE', level: 4, experience: 2500 }, 'experience_over_level'], [{ name: 'ACE', level: 1, experience: calculateExperience(2) }, 'experience_over_level'],
    [{ name: 'ACE', level: 4, experience: 0, attributePoints: -1 }, 'attribute_points_malformed'], [{ name: 'ACE', level: 4, experience: 0, attributePoints: Infinity }, 'attribute_points_malformed'],
    [{ name: 'ACE', level: 4, experience: 0, attributePoints: 'lots' }, 'attribute_points_malformed'],
    [{ name: 'ACE', level: 4, experience: 0, boostedAttributes: [1] }, 'boosted_attributes_malformed'], [{ name: 'ACE', level: 4, experience: 0, boostedAttributes: { attack: -1 } }, 'boosted_attributes_malformed'],
    [{ name: 'ACE', level: 4, experience: 0, boostedAttributes: { attack: 1.5 } }, 'boosted_attributes_malformed'],
  ];
  for (const [bot, reason] of cases) assert.deepEqual(repairHolobotProgression(bot), { ok: false, reason }, JSON.stringify(bot));
});

test('story flags: tolerant read equals the strict read whenever the strict read accepts', () => {
  for (const raw of [undefined, {}, { arenaGatheringSeen: true }, { tournamentsWon: 3, arenaArcBuilt: true, holoZonesArcBuilt: true, arenaGatheringSeen: true }]) {
    assert.deepEqual(readStoryFlagsTolerant(raw), { flags: readStoryFlags(raw), exact: true });
  }
});

test('story flags: tolerant read never throws or returns empty; fallback is locked-side and keeps the arc invariant', () => {
  const keys = ['arenaGatheringSeen', 'tournamentsWon', 'arenaArcBuilt', 'holoZonesArcBuilt'];
  for (const raw of [null, [], 'yes', 7, { tournamentsWon: 4 }, { tournamentsWon: -1 }, { tournamentsWon: 1.5 }, { tournamentsWon: '2' },
    { arenaArcBuilt: true }, { tournamentsWon: 3, arenaArcBuilt: false }, { arenaGatheringSeen: 'yes' }, { holoZonesArcBuilt: null }]) {
    assert.throws(() => readStoryFlags(raw), undefined, 'strict reader still refuses');
    const { flags, exact } = readStoryFlagsTolerant(raw);
    assert.equal(exact, false);
    assert.deepEqual(Object.keys(flags).sort(), [...keys].sort(), JSON.stringify(raw));
    assert.ok(Number.isInteger(flags.tournamentsWon) && flags.tournamentsWon >= 0 && flags.tournamentsWon <= 3);
    assert.equal(flags.arenaArcBuilt, flags.arenaArcBuilt && flags.tournamentsWon === 3);
    for (const k of ['arenaGatheringSeen', 'arenaArcBuilt', 'holoZonesArcBuilt']) assert.equal(typeof flags[k], 'boolean');
  }
  assert.deepEqual(readStoryFlagsTolerant({ arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: true, holoZonesArcBuilt: true }).flags,
    { arenaGatheringSeen: true, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: true });
});

test('economy sanitizer: field list matches firestore.rules economyFieldsSane exactly', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  const body = rules.slice(rules.indexOf('function economyFieldsSane(data)'), rules.indexOf('function presenceOptOutSane'));
  const numeric = [...body.matchAll(/saneOptional\(data, '([A-Za-z]+)'\)/g)].map(m => m[1]);
  const epoch = [...body.matchAll(/saneEpochMsOptional\(data, '([A-Za-z]+)'\)/g)].map(m => m[1]);
  assert.deepEqual([...ECONOMY_SANE_FIELDS], numeric);
  assert.deepEqual([...ECONOMY_SANE_EPOCH_FIELDS], epoch);
  assert.match(rules, /n is number && n >= 0 && n <= 100000000;/);
  assert.equal(ECONOMY_SANE_MAX, 100000000);
});

test('economy sanitizer: sane profiles are untouched; malformed values clamp and never rise above a stored number', () => {
  const NOW = Date.UTC(2026, 9, 24);
  assert.deepEqual(sanitizeEconomyFields({ holosTokens: 5, wins: 0, lastWildcardPackAt: NOW - 1, dailyEnergy: 1e8, syncPoints: 0.5 }, NOW), { updates: {}, changes: [] });
  assert.deepEqual(sanitizeEconomyFields({}, NOW), { updates: {}, changes: [] });
  const r = sanitizeEconomyFields({ holosTokens: 250_000_000, wins: '12', losses: 'many', dailyEnergy: -5, syncPoints: NaN, gachaTickets: Infinity,
    arenaPassses: null, expBoosters: true, rankSkips: { n: 1 }, todaySteps: '3e9', lastWildcardPackAt: '2026-10-20T12:00:00.000Z' }, NOW);
  assert.deepEqual(r.updates, { holosTokens: 1e8, wins: 12, losses: 0, dailyEnergy: 0, syncPoints: 0, gachaTickets: 0, arenaPassses: 0, expBoosters: 0, rankSkips: 0, todaySteps: 1e8, lastWildcardPackAt: Date.parse('2026-10-20T12:00:00.000Z') });
  assert.equal(r.changes.length, Object.keys(r.updates).length);
  // Idempotent: the sanitized profile needs nothing.
  assert.deepEqual(sanitizeEconomyFields(r.updates, NOW).updates, {});
  // Cooldown: a Timestamp-like keeps its time; junk / out-of-range restarts at now (never opens a pack early).
  assert.deepEqual(sanitizeEconomyFields({ lastWildcardPackAt: { toMillis: () => NOW - 5 } }, NOW).updates, { lastWildcardPackAt: NOW - 5 });
  for (const v of ['garbage', -1, 1e15, null, NaN]) assert.deepEqual(sanitizeEconomyFields({ lastWildcardPackAt: v }, NOW).updates, { lastWildcardPackAt: NOW }, String(v));
});

test('repair audit values are bounded, Firestore-safe strings', () => {
  assert.equal(describeRepairValue(undefined), 'undefined');
  assert.equal(describeRepairValue(NaN), 'number:NaN');
  assert.equal(describeRepairValue('x'), 'string:"x"');
  assert.equal(describeRepairValue(null), 'null:null');
  assert.ok(describeRepairValue('y'.repeat(1000)).length <= 200);
});
