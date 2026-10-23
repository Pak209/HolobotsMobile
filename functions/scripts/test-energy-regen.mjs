// energy-quest-server-1: the host daily energy regen (lib/energyRegen.ts). Daily reset at the ACCOUNT's local
// midnight on the HOST clock; the zone is stored server-side and a change is rate-limited and never grants a reset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('../lib/lib/energyRegen.js');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (iso) => new Date(iso).getTime();
const LA = 'America/Los_Angeles';
// 2026-10-23 is PDT (UTC-7): local midnight of 10-24 is 2026-10-24T07:00Z.
const LA_MIDNIGHT = at('2026-10-24T07:00:00Z');
const laAccount = (extra = {}) => ({
  dailyEnergy: 20, maxDailyEnergy: 100, energyTimeZone: LA, energyDayKey: '2026-10-23',
  energyDayStartedAt: at('2026-10-23T07:00:00Z'), lastEnergyRefresh: at('2026-10-23T20:00:00Z'),
  stepEnergyDate: '2026-10-23', stepEnergyGrantedToday: 0, ...extra,
});

test('zone validation: IANA names only, canonicalised', () => {
  assert.equal(R.normalizeTimeZone('America/Los_Angeles'), 'America/Los_Angeles');
  assert.equal(R.normalizeTimeZone('UTC'), 'UTC');
  for (const bad of ['Mars/Olympus', '', 'x'.repeat(65), 'America/Los Angeles', 7, null, undefined, '../etc']) {
    assert.equal(R.normalizeTimeZone(bad), null, String(bad));
  }
});

test('request shape: {} or {timeZone}; a client-supplied clock is not a field', () => {
  assert.deepEqual(R.readRefreshEnergyRequest(undefined), {});
  assert.deepEqual(R.readRefreshEnergyRequest({}), {});
  assert.deepEqual(R.readRefreshEnergyRequest({ timeZone: LA }), { timeZone: LA });
  for (const bad of [{ now: Date.now() }, { timeZone: LA, dayKey: '2030-01-01' }, { timeZone: 5 }, [], 'x']) {
    assert.equal(R.readRefreshEnergyRequest(bad), null, JSON.stringify(bad));
  }
});

test('daily reset fires exactly at the account\'s local midnight, host clock', () => {
  const before = R.computeHostEnergyRegen(laAccount({ lastEnergyRefresh: LA_MIDNIGHT - 1000 }), LA_MIDNIGHT - 1000, 0);
  assert.equal(before.reply.dailyEnergy, 20, 'one second before local midnight: no reset');
  const after = R.computeHostEnergyRegen(laAccount({ lastEnergyRefresh: LA_MIDNIGHT - 1000 }), LA_MIDNIGHT, 0);
  assert.equal(after.reply.dailyEnergy, 100);
  assert.equal(after.updates.energyDayKey, '2026-10-24');
  assert.equal(after.updates.energyDayStartedAtMs, LA_MIDNIGHT);
  assert.equal(after.updates.lastEnergyRefreshMs, LA_MIDNIGHT);
  assert.equal(after.reply.nextResetAt, '2026-10-25T07:00:00.000Z');
  // The same instant is NOT a new day for a Tokyo account whose day already began (10-24 09:00 JST... 16:00 JST).
  const tokyo = R.computeHostEnergyRegen(laAccount({ energyTimeZone: 'Asia/Tokyo', energyDayKey: '2026-10-24', lastEnergyRefresh: LA_MIDNIGHT - 1000 }), LA_MIDNIGHT, 0);
  assert.equal(tokyo.reply.dailyEnergy, 20);
  assert.equal(tokyo.reply.nextResetAt, '2026-10-24T15:00:00.000Z');
});

test('trickle: +1 per whole 15 min, the clock advances only by consumed intervals, capped at max', () => {
  const now = at('2026-10-23T20:50:00Z');
  const r = R.computeHostEnergyRegen(laAccount(), now, 0);
  assert.equal(r.reply.dailyEnergy, 23);
  assert.equal(r.updates.lastEnergyRefreshMs, at('2026-10-23T20:45:00Z'));
  const full = R.computeHostEnergyRegen(laAccount({ dailyEnergy: 99 }), now, 0);
  assert.equal(full.reply.dailyEnergy, 100);
  assert.equal(full.updates.lastEnergyRefreshMs, at('2026-10-23T20:15:00Z'));
});

test('idempotent: a second pass at the same host time writes nothing', () => {
  const now = at('2026-10-23T20:50:00Z');
  const first = R.computeHostEnergyRegen(laAccount(), now, 0);
  const stored = { ...laAccount(), ...first.updates, lastEnergyRefresh: first.updates.lastEnergyRefreshMs, energyDayStartedAt: first.updates.energyDayStartedAtMs };
  const second = R.computeHostEnergyRegen(stored, now, 0);
  assert.equal(second.changed, false);
  assert.equal(second.updates, null);
  assert.equal(second.reply.dailyEnergy, 23);
});

test('zone change is rate-limited: inside the cooldown the stored zone keeps computing', () => {
  const changedAt = at('2026-10-20T00:00:00Z');
  const r = R.computeHostEnergyRegen(laAccount({ energyTimeZoneChangedAt: changedAt }), at('2026-10-23T20:00:00Z'), 0, 'Pacific/Kiritimati');
  assert.equal(r.reply.timeZoneStatus, 'cooldown');
  assert.equal(r.reply.timeZone, LA);
  assert.equal(r.reply.timeZoneChangeAvailableAt, new Date(changedAt + R.TIME_ZONE_CHANGE_COOLDOWN_MS).toISOString());
  assert.equal(r.reply.dailyEnergy, 20, 'Kiritimati is already 10-24, but no reset');
  assert.equal(r.updates?.energyTimeZone, undefined);
});

test('KNOWN-BAD class: jumping the zone east never yields a second reset within 24 h of the last one', () => {
  // Last reset at LA midnight; 3 h later the device claims Kiritimati (UTC+14), where it is already 10-24 → 10-25.
  const p = laAccount({ energyDayKey: '2026-10-24', energyDayStartedAt: LA_MIDNIGHT, lastEnergyRefresh: LA_MIDNIGHT, dailyEnergy: 0 });
  const r = R.computeHostEnergyRegen(p, LA_MIDNIGHT + 11 * HOUR, 0, 'Pacific/Kiritimati');
  assert.equal(r.reply.timeZoneStatus, 'changed');
  assert.equal(r.updates.energyTimeZone, 'Pacific/Kiritimati');
  assert.equal(r.updates.energyTimeZoneChangedAtMs, LA_MIDNIGHT + 11 * HOUR);
  assert.equal(r.updates.energyDayKey, '2026-10-25', 'the new zone\'s today counts as already reset');
  assert.equal(r.reply.dailyEnergy, 44, 'only the trickle (11 h = 44 intervals)');
  // The reference: the client-side regen this replaces granted a full reset for the same move (device-local day).
});

test('a zone change more than 24 h after the last reset resets normally; moving west never resets', () => {
  const p = laAccount({ energyTimeZoneChangedAt: at('2026-09-01T00:00:00Z'), energyDayStartedAt: at('2026-10-22T07:00:00Z'), energyDayKey: '2026-10-22', lastEnergyRefresh: at('2026-10-22T23:00:00Z') });
  const r = R.computeHostEnergyRegen(p, at('2026-10-23T20:00:00Z'), 0, 'Asia/Tokyo');
  assert.equal(r.reply.dailyEnergy, 100);
  assert.equal(r.updates.energyDayKey, '2026-10-24');
  const west = laAccount({ energyTimeZone: 'Asia/Tokyo', energyDayKey: '2026-10-24', energyTimeZoneChangedAt: at('2026-09-01T00:00:00Z'), lastEnergyRefresh: at('2026-10-23T20:00:00Z') });
  const w = R.computeHostEnergyRegen(west, at('2026-10-23T20:00:00Z'), 0, 'Pacific/Honolulu');
  assert.equal(w.reply.timeZoneStatus, 'changed');
  assert.equal(w.reply.dailyEnergy, 20, 'Honolulu is still 10-23: strictly-later rule, no reset');
  assert.equal(w.updates.energyDayKey, '2026-10-24', 'the day already used is kept');
});

test('first zone: the first valid proposal is stored; none or an invalid one computes in UTC without storing', () => {
  const legacy = { dailyEnergy: 30, maxDailyEnergy: 100, lastEnergyRefresh: at('2026-10-23T06:00:00Z') };
  // Legacy day = lastEnergyRefresh's day in the proposed zone (what the device-local reset used): LA 10-22 23:00.
  const set = R.computeHostEnergyRegen(legacy, at('2026-10-23T08:00:00Z'), 0, LA);
  assert.equal(set.reply.timeZoneStatus, 'set');
  assert.equal(set.updates.energyTimeZone, LA);
  assert.equal(set.updates.energyTimeZoneChangedAtMs, undefined, 'the first set starts no cooldown');
  assert.equal(set.reply.dailyEnergy, 100, 'LA crossed midnight since: reset');
  const none = R.computeHostEnergyRegen(legacy, at('2026-10-23T08:00:00Z'), 0);
  assert.equal(none.reply.timeZone, 'UTC');
  assert.equal(none.reply.timeZoneStatus, 'default');
  assert.equal(none.updates.energyTimeZone, undefined);
  assert.equal(none.reply.dailyEnergy, 38, 'UTC: same day 10-23, trickle only');
  const invalid = R.computeHostEnergyRegen(legacy, at('2026-10-23T08:00:00Z'), 0, 'Mars/Olympus');
  assert.equal(invalid.reply.timeZoneStatus, 'invalid');
  assert.equal(invalid.reply.timeZone, 'UTC');
});

test('missing or future lastEnergyRefresh: a missing one resets once; a future one settles on now with no grant', () => {
  const missing = R.computeHostEnergyRegen({ dailyEnergy: 5 }, at('2026-10-23T08:00:00Z'), 0);
  assert.equal(missing.reply.dailyEnergy, 100);
  const future = R.computeHostEnergyRegen(laAccount({ lastEnergyRefresh: at('2030-01-01T00:00:00Z') }), at('2026-10-23T20:00:00Z'), 0);
  assert.equal(future.reply.dailyEnergy, 20);
  assert.equal(future.updates.lastEnergyRefreshMs, at('2026-10-23T20:00:00Z'));
});

test('step bonus: +1 per 250 of today\'s host-recorded steps, max 40 a day, up to max; eligibility carries while full', () => {
  const now = at('2026-10-23T20:00:00Z');
  const r = R.computeHostEnergyRegen(laAccount(), now, 2600);
  assert.equal(r.reply.dailyEnergy, 30);
  assert.equal(r.updates.stepEnergyGrantedToday, 10);
  const capped = R.computeHostEnergyRegen(laAccount({ dailyEnergy: 0 }), now, 1_000_000);
  assert.equal(capped.reply.dailyEnergy, 40);
  const atMax = R.computeHostEnergyRegen(laAccount({ dailyEnergy: 100 }), now, 2600);
  assert.equal(atMax.updates?.stepEnergyGrantedToday ?? 0, 0);
  const spent = R.computeHostEnergyRegen(laAccount({ dailyEnergy: 50 }), now, 2600);
  assert.equal(spent.reply.dailyEnergy, 60);
  const again = R.computeHostEnergyRegen(laAccount({ dailyEnergy: 50, stepEnergyGrantedToday: 10 }), now, 2600);
  assert.equal(again.reply.dailyEnergy, 50, 'already granted today');
  const nextDay = R.computeHostEnergyRegen(laAccount({ dailyEnergy: 100, stepEnergyGrantedToday: 40 }), LA_MIDNIGHT + HOUR, 0);
  assert.equal(nextDay.updates.stepEnergyDate, '2026-10-24');
  assert.equal(nextDay.updates.stepEnergyGrantedToday, 0);
  const noSteps = R.computeHostEnergyRegen(laAccount({ dailyEnergy: 50 }), now, undefined);
  assert.equal(noSteps.reply.dailyEnergy, 50, 'no step read: no step grant');
});

test('a host top-up above max (refill item) is neither trickled nor clipped by the reset', () => {
  const r = R.computeHostEnergyRegen(laAccount({ dailyEnergy: 150 }), at('2026-10-23T23:00:00Z'), 0);
  assert.equal(r.reply.dailyEnergy, 150);
  const reset = R.computeHostEnergyRegen(laAccount({ dailyEnergy: 150 }), LA_MIDNIGHT, 0);
  assert.equal(reset.reply.dailyEnergy, 150);
});

test('DST: the fall-back day still resets at local midnight (2026-11-02 00:00 PST = 08:00Z)', () => {
  const p = laAccount({ energyDayKey: '2026-11-01', energyDayStartedAt: at('2026-11-01T07:00:00Z'), lastEnergyRefresh: at('2026-11-02T07:30:00Z') });
  assert.equal(R.computeHostEnergyRegen(p, at('2026-11-02T07:59:59Z'), 0).reply.dailyEnergy, 21, '29 min of trickle, no reset at 07:00Z (that was PDT)');
  assert.equal(R.computeHostEnergyRegen(p, at('2026-11-02T08:00:00Z'), 0).reply.dailyEnergy, 100);
  assert.equal(R.nextResetAtMs(at('2026-11-01T12:00:00Z'), LA, '2026-11-01'), at('2026-11-02T08:00:00Z'));
});

test('Firestore-shaped stored times are read (Timestamp-like toMillis, Date, ISO string)', () => {
  const ms = at('2026-10-23T20:00:00Z');
  assert.equal(R.readTimeMs({ toMillis: () => ms }), ms);
  assert.equal(R.readTimeMs(new Date(ms)), ms);
  assert.equal(R.readTimeMs('2026-10-23T20:00:00Z'), ms);
  assert.equal(R.readTimeMs('garbage'), null);
});
