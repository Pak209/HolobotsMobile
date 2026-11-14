// city-daily-2 (mission-board-1 dailyStatus / dailyClaim): one pickup per plan district per LOCAL day (phone-sent UTC offset), a
// 20 h real-time floor per district and 10 claims per rolling 20 h against time-zone hopping, Buddy pickups revealed, idempotent
// by requestId, small server-owned rewards, flag default off, ledger removed with the account, client rules deny.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fakeDb } from './lib/fake-firestore.mjs';
const require = createRequire(import.meta.url);
const D = require('../lib/lib/dailyPickups.js');
const S = require('../lib/missionBoard/dailyPickupStore.js');
const M = require('../lib/lib/missionBoard.js');
const { deleteUserData } = require('../lib/account/deleteUserAccount.js');

const H = 3600_000;
const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);
const UID = 'pilot_daily';
const ON = { HOLOCITY_DAILY_PICKUPS: '1' };
const PT = -480; // Pacific standard time
const user = (extra = {}) => ({ holosTokens: 10, buddyUnits: { light: 0, medium: 0, heavy: 0 }, ...extra });
const call = (db, data, now = T0, env = ON) => S.transactDailyPickup(db, UID, data, now, env);
const status = (db, now = T0, off) => call(db, { operation: 'dailyStatus', ...(off === undefined ? {} : { utcOffsetMinutes: off }) }, now);
const claim = (db, districtId, requestId, now = T0, off) => call(db, { operation: 'dailyClaim', districtId, requestId, ...(off === undefined ? {} : { utcOffsetMinutes: off }) }, now);
const rejects = (p, code) => assert.rejects(p, e => e instanceof M.MissionBoardError && e.code === code, code);
const IDS = ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10'];
const fresh = (extra) => { const db = fakeDb({ now: T0 }); db.put(`users/${UID}`, user(extra)); return db; };

test('reward numbers stay small: 10 x 5 + 25 = 75 Holos a day at most, under one rookie Arena / rival win (100 Holos + EXP)', () => {
  assert.equal(D.DAILY_PICKUP_HOLOS, 5); assert.equal(D.DAILY_ALL_DISTRICTS_BONUS_HOLOS, 25); assert.equal(D.DAILY_PICKUP_BUDDY_ONE_IN, 20);
  assert.deepEqual([...D.DAILY_PICKUP_DISTRICTS], IDS);
  assert.ok(D.DAILY_PICKUP_HOLOS * 10 + D.DAILY_ALL_DISTRICTS_BONUS_HOLOS < 100);
});

test('flag default off: both operations answer daily_off before any read or write', async () => {
  const db = fakeDb({ now: T0 });
  await rejects(call(db, { operation: 'dailyStatus' }, T0, {}), 'daily_off');
  await rejects(call(db, { operation: 'dailyClaim', districtId: 'D01', requestId: 'r1' }, T0, { HOLOCITY_DAILY_PICKUPS: 'true' }), 'daily_off');
});

test('validation: exact keys, plan district ids, requestId shape, UTC offset −12h…+14h in whole 15-minute steps', () => {
  const v = D.validateDailyCommand;
  for (const bad of [
    { operation: 'dailyClaim', districtId: 'D11', requestId: 'a' }, { operation: 'dailyClaim', districtId: 'd01', requestId: 'a' },
    { operation: 'dailyClaim', districtId: 'D01', requestId: 'a b' }, { operation: 'dailyClaim', districtId: 'D01', requestId: 'a', holos: 999 },
    { operation: 'dailyStatus', x: 1 }, { operation: 'dailyStatus', schemaVersion: 'mission-board-0' },
    { operation: 'dailyStatus', utcOffsetMinutes: -735 }, { operation: 'dailyStatus', utcOffsetMinutes: 855 }, { operation: 'dailyStatus', utcOffsetMinutes: 50 },
    { operation: 'dailyStatus', utcOffsetMinutes: 60.5 }, { operation: 'dailyStatus', utcOffsetMinutes: '60' },
  ]) assert.throws(() => v(bad), /invalid_request/, JSON.stringify(bad));
  assert.deepEqual(v({ operation: 'dailyStatus', schemaVersion: 'mission-board-1' }), { operation: 'dailyStatus', utcOffsetMinutes: 0 });
  for (const off of [-720, -480, 0, 330, 345, 765, 840]) assert.equal(v({ operation: 'dailyStatus', utcOffsetMinutes: off }).utcOffsetMinutes, off);
  assert.deepEqual(v({ operation: 'dailyClaim', districtId: 'D01', requestId: 'a', utcOffsetMinutes: 60 }), { operation: 'dailyClaim', districtId: 'D01', requestId: 'a', utcOffsetMinutes: 60 });
});

test('local day and next local midnight from server time + offset', () => {
  const t = Date.UTC(2026, 10, 14, 2, 0); // 02:00 UTC = 18:00 PT the day before
  assert.equal(D.localDayOf(t, 0), '2026-11-14'); assert.equal(D.localDayOf(t, PT), '2026-11-13'); assert.equal(D.localDayOf(t, 840), '2026-11-14');
  assert.equal(D.nextLocalResetAtMs(t, 0), Date.UTC(2026, 10, 15));
  assert.equal(D.nextLocalResetAtMs(t, PT), Date.UTC(2026, 10, 14, 8, 0), 'PT midnight is 08:00 UTC');
  assert.equal(D.nextLocalResetAtMs(t, 330), Date.UTC(2026, 10, 14, 18, 30));
});

test('status without a ledger: 10 ready districts, nextResetAtMs at local midnight, Buddy pickups revealed, writes nothing', async () => {
  const db = fresh();
  const st = await status(db, T0, PT);
  assert.equal(st.schemaVersion, 'mission-board-1'); assert.equal(st.source, 'daily');
  assert.equal(st.daily.day, '2026-11-13'); assert.equal(st.daily.total, 10); assert.equal(st.daily.claimedCount, 0);
  assert.equal(st.daily.nextResetAtMs, Date.UTC(2026, 10, 14, 8, 0));
  assert.deepEqual(st.daily.districts.map(d => d.districtId), IDS);
  for (const d of st.daily.districts) {
    assert.equal(d.ready, true); assert.equal(d.readyAtMs, null); assert.equal(d.claimed, false);
    assert.equal(d.buddy, D.dailyBuddyRoll(UID, '2026-11-13', d.districtId), 'the reveal is the claim roll');
  }
  assert.equal(db.read(`cityDailyPickups/${UID}`), undefined);
});

test('claim pays once per district per local day; replay is idempotent; the reveal matches what the claim pays', async () => {
  const db = fresh();
  const r = await claim(db, 'D02', 'req_a', T0, PT);
  assert.equal(r.alreadyProcessed, false); assert.equal(r.granted.holos, 5); assert.equal(r.granted.allDistrictsBonus, false);
  assert.deepEqual(r.granted.items, D.dailyBuddyRoll(UID, '2026-11-13', 'D02') ? [{ itemId: 'buddy_light', quantity: 1 }] : []);
  const d2 = r.daily.districts.find(d => d.districtId === 'D02');
  assert.equal(d2.claimed, true); assert.equal(d2.ready, false); assert.equal(d2.buddy, false);
  assert.equal(d2.readyAtMs, Date.UTC(2026, 10, 14, 8, 0), 'PT midnight (later than the 20 h floor here)');
  assert.equal(db.read(`users/${UID}`).holosTokens, 15);
  const again = await claim(db, 'D02', 'req_a', T0 + 1000, PT);
  assert.equal(again.alreadyProcessed, true); assert.deepEqual(again.granted, r.granted); assert.equal(db.read(`users/${UID}`).holosTokens, 15);
  await assert.rejects(claim(db, 'D02', 'req_b', T0 + 2000, PT), e => e.code === 'already_claimed' && e.detail.readyAtMs === Date.UTC(2026, 10, 14, 8, 0));
  await rejects(claim(db, 'D03', 'req_a', T0 + 2000, PT), 'invalid_request');
  const later = Date.UTC(2026, 10, 14, 8, 0);
  assert.equal((await status(db, later, PT)).daily.districts[1].ready, true);
  assert.equal((await claim(db, 'D02', 'req_c', later, PT)).granted.holos, 5);
  assert.equal((await claim(db, 'D02', 'req_a', later + 5, PT)).alreadyProcessed, true, 'an old requestId still replays');
});

test('time-zone hopping: a new local day under another offset still waits out the 20 h real gap', async () => {
  const db = fresh();
  const late = Date.UTC(2026, 10, 13, 23, 0);
  await claim(db, 'D05', 'h1', late, 0);
  await rejects(claim(db, 'D05', 'h2', late + 10 * 60_000, 840), 'already_claimed');
  const st = await status(db, late + 10 * 60_000, 840);
  const d5 = st.daily.districts.find(d => d.districtId === 'D05');
  assert.equal(d5.claimed, false, 'not claimed on this local day…'); assert.equal(d5.ready, false, '…but not ready either'); assert.equal(d5.readyAtMs, late + 20 * H);
  assert.equal((await claim(db, 'D05', 'h3', late + 20 * H, 840)).granted.holos, 5, 'after 20 h it pays');
});

test('rolling cap: at most 10 claims in any 20 h, whatever offsets are sent', async () => {
  const db = fresh({ holosTokens: 0 });
  for (const [i, id] of IDS.entries()) await claim(db, id, `r_${i}`, T0 + i * 60_000, i % 2 ? 840 : -720);
  const t = T0 + 12 * H;
  await rejects(claim(db, 'D01', 'r_x', t, 840), 'already_claimed');
  const st = await status(db, t, 840);
  assert.ok(st.daily.districts.every(d => !d.ready), 'nothing is drawn while capped');
  // Pretend D01's last claim was 21 h ago (its own gap is over) while 10 claims still sit inside the window: the rolling cap refuses.
  const doc = db.read(`cityDailyPickups/${UID}`);
  doc.last.D01 = { day: '2026-11-12', atMs: t - 21 * H };
  doc.requests.push({ ...doc.requests[0], requestId: 'pad', claimedAtMs: t - 1 });
  db.put(`cityDailyPickups/${UID}`, doc);
  await assert.rejects(claim(db, 'D01', 'r_y', t, 0), e => e.code === 'daily_limit' && typeof e.detail.readyAtMs === 'number' && e.detail.readyAtMs > t);
});

test('all ten in a local day: the tenth adds the 25 Holos bonus; Buddy Units exactly where the status said', async () => {
  const db = fresh({ holosTokens: 0 });
  const shown = (await status(db, T0, PT)).daily.districts.filter(d => d.buddy).map(d => d.districtId);
  let total = 0; const paid = [];
  for (const [i, id] of IDS.entries()) {
    const r = await claim(db, id, `all_${i}`, T0 + i, PT);
    assert.equal(r.granted.allDistrictsBonus, i === 9); assert.equal(r.granted.holos, i === 9 ? 30 : 5);
    if (r.granted.items.length) paid.push(id);
    total += r.granted.holos;
  }
  assert.deepEqual(paid, shown);
  assert.equal(total, 75); assert.equal(db.read(`users/${UID}`).holosTokens, 75); assert.equal(db.read(`users/${UID}`).buddyUnits.light, shown.length);
  assert.equal((await status(db, T0 + 100, PT)).daily.claimedCount, 10);
});

test('buddy roll: pure and about 1 in 20 across many days', () => {
  assert.equal(D.dailyBuddyRoll('u', '2026-11-13', 'D01'), D.dailyBuddyRoll('u', '2026-11-13', 'D01'));
  let hits = 0, n = 0;
  for (let d = 0; d < 400; d++) for (const id of IDS) { n++; if (D.dailyBuddyRoll('u', new Date(T0 + d * 864e5).toISOString().slice(0, 10), id)) hits++; }
  assert.ok(hits / n > 0.03 && hits / n < 0.07, `rate ${hits / n}`);
});

test('a city-daily-1 ledger (UTC day) is read and upgraded on the next claim', async () => {
  const db = fresh();
  db.put(`cityDailyPickups/${UID}`, { schemaVersion: 'city-daily-1', day: '2026-11-13', claimed: { D01: T0 - H }, requests: [{ requestId: 'old', day: '2026-11-13', districtId: 'D01', claimedAtMs: T0 - H, granted: { holos: 5, items: [], allDistrictsBonus: false } }] });
  const st = await status(db, T0, 0);
  assert.equal(st.daily.districts[0].claimed, true); assert.equal(st.daily.districts[0].ready, false);
  await claim(db, 'D02', 'new1', T0, 0);
  const doc = db.read(`cityDailyPickups/${UID}`);
  assert.equal(doc.schemaVersion, 'city-daily-2'); assert.deepEqual(doc.last.D01, { day: '2026-11-13', atMs: T0 - H }); assert.equal(doc.requests.length, 2);
});

test('fails closed: no profile, malformed ledger, malformed balance', async () => {
  const db = fakeDb({ now: T0 });
  await rejects(status(db), 'unavailable');
  db.put(`users/${UID}`, user());
  db.put(`cityDailyPickups/${UID}`, { schemaVersion: 'city-daily-2', last: { D01: { day: 'today', atMs: 1 } }, requests: [] });
  await rejects(status(db), 'unavailable');
  db.put(`cityDailyPickups/${UID}`, { schemaVersion: 'city-daily-2', last: { D99: { day: '2026-11-13', atMs: 1 } }, requests: [] });
  await rejects(claim(db, 'D01', 'x1'), 'unavailable');
  const db2 = fresh({ holosTokens: -5 });
  await rejects(claim(db2, 'D01', 'x2'), 'unavailable');
  assert.equal(db2.read(`cityDailyPickups/${UID}`), undefined);
});

test('the request ledger is bounded', async () => {
  const db = fresh();
  for (let day = 0; day < 6; day++) for (const [i, id] of IDS.entries()) await claim(db, id, `b_${day}_${i}`, T0 + day * 24 * H + i, PT);
  assert.equal(db.read(`cityDailyPickups/${UID}`).requests.length, D.DAILY_PICKUP_MAX_REQUESTS);
});

test('account deletion removes cityDailyPickups/{uid}; rules deny every client read and write', async () => {
  const deleted = [];
  const stub = { recursiveDelete: async ref => { deleted.push(ref.path); }, doc: path => ({ path }),
    collection: () => ({ where: () => ({ get: async () => ({ docs: [] }) }) }),
    runTransaction: async fn => fn({ get: async () => ({ exists: false }), set: () => {} }) };
  await deleteUserData(stub, 'u1');
  assert.ok(deleted.includes('cityDailyPickups/u1'));
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  assert.match(rules, /match \/cityDailyPickups\/\{uid\}\/\{document=\*\*\} \{\s*allow read, write: if false;/);
});
