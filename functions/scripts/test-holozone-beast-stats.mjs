// DECISIONS #56: per-beast level / stats / stamina / rank tier on the holozone-run-2 population, behind
// HOLOZONE_BEAST_STATS_ENABLED (off in this PR = byte-identical replies).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const P = require('../lib/lib/holoZonePopulation.js');
const S = require('../lib/lib/holoZoneBeastStats.js');

// Today's served holozone-run-2 population for neonforest tier 0 (key order included).
const PINNED = '{"zoneId":"neonforest","tier":0,"beasts":[{"beastId":"scrapling","count":3,"respawn":{"kind":"timer","delaySeconds":8,"maxRespawns":22}}],"boss":{"bossId":"root_nexus","count":1,"respawn":{"kind":"none"}},"spawnCount":3,"maxKillsCredited":25}';

test('flag off (this PR): the served population is byte-identical to today', () => {
  assert.equal(S.HOLOZONE_BEAST_STATS_ENABLED, false);
  assert.equal(JSON.stringify(P.holoZonePopulation('neonforest', 0)), PINNED);
});

test('flag on: every neonforest entry carries well-formed stats with a Holobot rank tier', () => {
  const p = P.withBeastStats(P.holoZonePopulation('neonforest', 0), true);
  const s = p.beasts[0].stats;
  assert.ok(s && S.validBeastStats(s));
  assert.deepEqual(s, { level: 3, maxHealth: 120, attack: 18, defense: 8, speed: 12, maxStamina: 60, staminaRegen: 10, rank: 'Starter' });
  assert.ok(p.boss.stats && S.validBeastStats(p.boss.stats));
  assert.equal(p.boss.stats.rank, 'Champion');
  // control: the rest of the reply is unchanged apart from the added blocks
  const stripped = JSON.parse(JSON.stringify(p)); delete stripped.beasts[0].stats; delete stripped.boss.stats;
  assert.equal(JSON.stringify(stripped), PINNED);
});

test('unknown zone / tier / beast serves no stats (never a guessed row)', () => {
  assert.equal(S.holoZoneBeastStats('nowhere', 0, 'scrapling'), null);
  assert.equal(S.holoZoneBeastStats('neonforest', 9, 'scrapling'), null);
  assert.equal(S.holoZoneBeastStats('neonforest', 0, 'wyrm'), null);
});

test('control: validBeastStats rejects a malformed row', () => {
  assert.equal(S.validBeastStats({ level: 0, maxHealth: 1, attack: 0, defense: 0, speed: 0, maxStamina: 1, staminaRegen: 0, rank: 'Rookie' }), false);
  assert.equal(S.validBeastStats({ level: 1, maxHealth: 1, attack: 0, defense: 0, speed: 0, maxStamina: 0, staminaRegen: 0, rank: 'Rookie' }), false);
});
