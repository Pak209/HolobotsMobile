import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const T = require('../lib/lib/rivalTierStats.js');
const L = require('../lib/lib/rivalLadder.js');
const Z = require('../lib/lib/holoZoneRuns.js');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
// Reviewed table, not generated from the implementation under test. Rows are tiers 0..9.
const EXPECTED = [0.482422, 0.524112, 0.565803, 0.607494, 0.649185, 0.690876, 0.732567, 0.774258, 0.815949, 0.857639];

test('CPU damage tuning pins every tier, compounds the measured cut-swing loss, and caps beyond tier 9', () => {
  assert.equal(T.RIVAL_CUT_SWING_CPU_RETENTION, 1957 / 2098);
  for (let tier = 0; tier < EXPECTED.length; tier++) {
    close(T.rivalTierDamageScale(tier), EXPECTED[tier]);
    const retained = T.rivalTierDamageScale(tier) * 1957 / 2098;
    close(retained, 0.45 + tier * (0.35 / 9));
  }
  for (const tier of [10, 25, 40, 1000]) close(T.rivalTierDamageScale(tier), EXPECTED[9]);
  for (const tier of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => T.rivalTierDamageScale(tier), RangeError);
});

test('all CPU moves use the tier multiplier in v3 snapshots; player and legacy moves retain baseline numbers', () => {
  for (let tier = 0; tier < EXPECTED.length; tier++) {
    const result = L.issueRivalBattle({ rivalWins: tier * 10, holobots: [{ name: 'ACE', level: 1 }] }, 1000, 'rb_tune', () => 0, ['ace'], T.RIVAL_LINEUP_SCALE_WOLF);
    for (const cpu of result.reply.encounter.opponentSquad) {
      for (let i = 0; i < cpu.moves.length; i++) {
        close(cpu.moves[i].damageScale / L.RIVAL_BASELINE.moves[i].damageScale, EXPECTED[tier]);
        assert.deepEqual({ ...cpu.moves[i], damageScale: L.RIVAL_BASELINE.moves[i].damageScale }, { ...L.RIVAL_BASELINE.moves[i] });
      }
    }
    assert.deepEqual(result.reply.playerCombatants[0].moves, L.RIVAL_BASELINE.moves);
    const legacy = L.issueRivalBattle({ rivalWins: tier * 10 }, 1000, 'rb_legacy', () => 0, [], 'baseline-statscale');
    for (const cpu of legacy.reply.encounter.opponentSquad) assert.deepEqual(cpu.moves, L.RIVAL_BASELINE.moves);
  }
});

test('zone cooldown is exactly 3 minutes, per zone, with the boundary eligible and expired entries pruned', () => {
  assert.equal(Z.HOLOZONE_COOLDOWN_MS, 180000);
  const ledger = { neonforest: 1000, crystalcaves: -180000 };
  assert.throws(() => Z.requireHoloZoneOffCooldown(ledger, 'neonforest', 180999), e => e.code === 'zone_cooldown' && e.retryAfterMs === 1);
  Z.requireHoloZoneOffCooldown(ledger, 'neonforest', 181000);
  Z.requireHoloZoneOffCooldown(ledger, 'anotherzone', 1000);
  assert.deepEqual(Z.holoZoneLastSettledAfterSettle(ledger, 'anotherzone', 2000), { neonforest: 1000, anotherzone: 2000 });
});

test('cooldown migration reads old first-time settles and malformed ledgers fail closed', () => {
  assert.deepEqual(Z.readHoloZoneLastSettled(undefined, []), {});
  assert.deepEqual(Z.readHoloZoneLastSettled({ zoneLastSettledAtMs: { neonforest: 1000 } }, [{ zoneId: 'neonforest', settlement: { settledAtMs: 2000 } }]), { neonforest: 2000 });
  for (const raw of [null, [], 'soon', { neonforest: NaN }, { neonforest: '1000' }, { neonforest: Infinity }]) {
    assert.throws(() => Z.readHoloZoneLastSettled({ zoneLastSettledAtMs: raw }, []), /unavailable/);
  }
  assert.throws(() => Z.readHoloZoneLastSettled(undefined, [{ zoneId: 'neonforest', settlement: {} }]), /unavailable/);
});
