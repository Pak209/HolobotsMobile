import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { accrueWorkoutReadiness, applyReadinessGain, fadedReadinessMilli, readinessAccrualEnabled, readinessView } = require("../lib/lib/syncReadiness.js");
const { buildDesktopAccountReply, DESKTOP_ACCOUNT_V1 } = require("../lib/desktop/desktopAccountReply.js");

const day = 86_400_000;
const nowMs = 1_782_259_200_000;
const profile = { holobots: [{ name: "ACE" }, { name: "KUMA" }] };
const enabled = { HOLOCITY_READINESS_ACCRUE: "1" };

test("one full tagged session fills just that bot; partial phone/watch time is proportional", () => {
  const full = accrueWorkoutReadiness(profile, { activityId: "phone1", counted: true, holobotName: "KUMA", elapsedSeconds: 300, nowMs }, enabled);
  assert.equal(full.award.after, 100);
  assert.deepEqual(Object.keys(full.update), ["KUMA"]);
  const partial = accrueWorkoutReadiness(profile, { activityId: "watch1", counted: true, holobotName: "ACE", elapsedSeconds: 75, nowMs }, enabled);
  assert.equal(partial.award.after, 25);
  assert.equal(partial.update.ACE.milli, 25_000);
});

test("unknown tag never falls back to first bot; cap, replay, missing id and flag-off never accrue", () => {
  assert.equal(readinessAccrualEnabled({}), false);
  assert.equal(readinessAccrualEnabled({ HOLOCITY_READINESS_ACCRUE: "true" }), false);
  assert.equal(readinessAccrualEnabled(enabled), true);
  assert.deepEqual(applyReadinessGain(profile, "WOLF", 300, nowMs), { update: null, award: null });
  assert.equal(accrueWorkoutReadiness(profile, { activityId: "a", counted: false, holobotName: "ACE", elapsedSeconds: 300, nowMs }, enabled), null);
  assert.equal(accrueWorkoutReadiness(profile, { activityId: "", counted: true, holobotName: "ACE", elapsedSeconds: 300, nowMs }, enabled), null);
  assert.equal(accrueWorkoutReadiness(profile, { activityId: "a", counted: true, holobotName: "ACE", elapsedSeconds: 300, nowMs }, {}), null);
});

test("fade is 20 percent of remaining each day, lazy and monotonic; view remains display-only", () => {
  const entry = { milli: 100_000, atMs: nowMs };
  assert.equal(fadedReadinessMilli(entry, nowMs + day), 80_000);
  assert.equal(fadedReadinessMilli(entry, nowMs + 2 * day), 64_000);
  assert.equal(fadedReadinessMilli(entry, nowMs - day), 100_000);
  const view = readinessView({ ...profile, syncReadiness: { ACE: entry } }, nowMs + 2 * day);
  assert.equal(view.ACE.value, 64);
  assert.equal(view.KUMA.value, 0);
});

test("gain applies after fade, saturates at 100, and never writes into holobots", () => {
  const result = applyReadinessGain({ ...profile, syncReadiness: { ACE: { milli: 100_000, atMs: nowMs } } }, "ACE", 150, nowMs + day);
  assert.equal(result.award.before, 80);
  assert.equal(result.award.gained, 20);
  assert.equal(result.award.after, 100);
  assert.equal(result.update.ACE.milli, 100_000);
  assert.equal("holobots" in result.update, false);
});

test("desktop reply stays byte-compatible by default; flag adds a read-only per-bot view", () => {
  const old = process.env.HOLOCITY_READINESS_ACCRUE;
  const data = { ...profile, syncReadiness: { ACE: { milli: 100_000, atMs: nowMs } } };
  try {
    delete process.env.HOLOCITY_READINESS_ACCRUE;
    const off = buildDesktopAccountReply(data, "pilot", DESKTOP_ACCOUNT_V1, { light: 0, medium: 0, heavy: 0 }, nowMs + day);
    assert.equal("syncReadiness" in off, false);
    process.env.HOLOCITY_READINESS_ACCRUE = "1";
    const on = buildDesktopAccountReply(data, "pilot", DESKTOP_ACCOUNT_V1, { light: 0, medium: 0, heavy: 0 }, nowMs + day);
    assert.equal(on.syncReadiness.ACE.value, 80);
    assert.equal(on.syncReadiness.KUMA.value, 0);
    assert.equal(on.syncReadiness.ACE.fadePerDay, 20);
  } finally {
    if (old === undefined) delete process.env.HOLOCITY_READINESS_ACCRUE;
    else process.env.HOLOCITY_READINESS_ACCRUE = old;
  }
});
