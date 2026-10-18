import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import lifecycle from "../../qa/fixtures/arena-admitted-lifecycle.json";
import ledgerFixture from "../../qa/fixtures/daily-mission-ledger.json";
import identityFixture from "../../qa/fixtures/desktop-account-3-identity.json";
import { arenaCallCode, arenaIssuePayoutCapped, arenaRetryAfterMs, readArenaReply } from "../arenaMatchFlow";
import { buildDailyMissions, DAILY_MISSION_TABLE, getDailyMissionSummary, missionLedgerNote } from "../dailyMissions";
import { DAILY_MISSION_LEDGER_IDS, readDailyMissionLedger, readDashboardAccount } from "../hostDashboard";
import type { UserProfile } from "@/types/profile";

/**
 * Host #145 (codex/host-economy-hardening-2, e9091f0) shapes, read exactly where the host puts them. Both fixtures are
 * byte copies of #145's own: functions/scripts/fixtures/arena-match/admitted-lifecycle.json (blob 9bdedb40) and
 * functions/scripts/fixtures/desktop-account/daily-mission-ledger.json (blob ab42c552).
 */
const FIXTURE_SHA256 = {
  "arena-admitted-lifecycle.json": "b454b8db1b6d29c08760fb51048bfa2e260bc1e770c6693b5a2a9fc073e383d1",
  "daily-mission-ledger.json": "8689f081648bfc84ed2ac8e58757f98898c9a190c1772fbb5d52d3583ca9d4ec",
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const LEDGER_DAY = new Date("2026-10-18T12:00:00.000Z");
const pilot = (rewardSystem: Record<string, unknown>) => ({ id: "fixture-pilot", rewardSystem } as unknown as UserProfile);

describe("host #145 fixtures", () => {
  it.each(Object.entries(FIXTURE_SHA256))("%s is #145's byte copy", (name, sha) => {
    const bytes = readFileSync(path.resolve(__dirname, "../../qa/fixtures", name));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha);
  });
});

describe("LN7: payoutCapped and retryAfterMs where #145 puts them", () => {
  const issues = lifecycle.steps.filter((step) => step.request.operation === "issue");

  it("every recorded issue reply carries a top-level boolean payoutCapped; the match record never does", () => {
    expect(issues.length).toBeGreaterThan(0);
    for (const step of issues) {
      expect(typeof step.reply.payoutCapped).toBe("boolean");
      expect("payoutCapped" in (step.reply.match as object)).toBe(false);
      const reply = readArenaReply(clone(step.reply));
      expect(arenaIssuePayoutCapped(reply)).toBe(step.reply.payoutCapped);
      expect(arenaIssuePayoutCapped({ ...reply, payoutCapped: true })).toBe(true);
    }
    for (const step of lifecycle.steps.filter((s) => s.request.operation !== "issue")) expect("payoutCapped" in step.reply).toBe(false);
  });

  it("the recorded too_fast refusal carries details.retryAfterMs = floor - elapsed, read exactly", () => {
    const [refusal] = lifecycle.refusals;
    expect(refusal.request.operation).toBe("settle");
    const error = Object.assign(new Error(refusal.refusal.message), { code: `functions/${refusal.refusal.code}`, details: refusal.refusal.details });
    expect(arenaCallCode(error)).toBe("failed-precondition");
    expect(refusal.refusal.details.rejectionCode).toBe("too_fast");
    expect(arenaRetryAfterMs(error)).toBe(2976);
    // 3 s CPU floor (ARENA_MIN_SETTLE_MS_CPU): the hint is at most the floor.
    expect(refusal.refusal.details.retryAfterMs).toBeLessThanOrEqual(3000);
  });
});

describe("Daily Missions from the City's ledger (desktop-account dailyMissionLedger)", () => {
  const ledger = readDailyMissionLedger(ledgerFixture.reply.dailyMissionLedger)!;

  it("reads #145's recorded summary on the account reply", () => {
    expect(ledger).toEqual({ day: "2026-10-18", arenaBattlesToday: 0, boosterPacksToday: 1, claimed: { daily_login: true, arena_v2_battle: false, open_booster_pack: true } });
    const account = readDashboardAccount({ ...clone(identityFixture), dailyMissionLedger: ledgerFixture.reply.dailyMissionLedger }, identityFixture.uid);
    expect(account.dailyMissionLedger).toEqual(ledger);
    // An older host's reply has no ledger: absent, never zeros.
    expect(readDashboardAccount(identityFixture, identityFixture.uid).dailyMissionLedger).toBeNull();
    expect([...DAILY_MISSION_LEDGER_IDS]).toEqual(DAILY_MISSION_TABLE.map((mission) => mission.id));
  });

  it("the forged rewardSystem mirror (99 / 99) changes nothing when the ledger is in hand", () => {
    const forged = pilot({ ...ledgerFixture.tamperedMirror, lastDailyMissionReset: "2026-10-18", missionClaims: {} });
    const missions = buildDailyMissions(forged, LEDGER_DAY, ledger);
    expect(missions.map((m) => [m.id, m.progress, m.completed, m.claimed, m.claimable])).toEqual([
      ["daily_login", 1, true, true, false],
      ["arena_v2_battle", 0, false, false, false],
      ["open_booster_pack", 1, true, true, false],
    ]);
    expect(getDailyMissionSummary(forged, LEDGER_DAY, ledger)).toEqual({ available: 3, completed: 2, unclaimed: 0 });
  });

  it("CLAIM comes only from ledger progress", () => {
    const unclaimed = { ...ledger, arenaBattlesToday: 3, claimed: { daily_login: false, arena_v2_battle: false, open_booster_pack: false } };
    expect(buildDailyMissions(pilot({}), LEDGER_DAY, unclaimed).filter((m) => m.claimable).map((m) => m.id)).toEqual(["daily_login", "arena_v2_battle", "open_booster_pack"]);
    // Without the ledger the device copy is shown, but nothing is claimable from it, however complete it looks.
    const forged = pilot({ ...ledgerFixture.tamperedMirror, lastDailyMissionReset: "2026-10-18", missionClaims: {} });
    const fallback = buildDailyMissions(forged, LEDGER_DAY, null);
    expect(fallback.map((m) => [m.id, m.progress, m.completed])).toEqual([["daily_login", 1, true], ["arena_v2_battle", 3, true], ["open_booster_pack", 1, true]]);
    expect(fallback.some((m) => m.claimable)).toBe(false);
    expect(getDailyMissionSummary(forged, LEDGER_DAY, null).unclaimed).toBe(0);
    expect(buildDailyMissions(null, LEDGER_DAY, unclaimed).some((m) => m.claimable)).toBe(false);
  });

  it("is strict: an extra, missing or mistyped field reads as absent", () => {
    const raw = ledgerFixture.reply.dailyMissionLedger;
    const bad = (mutate: (value: any) => void) => { const value = clone(raw) as any; mutate(value); return readDailyMissionLedger(value); };
    expect(bad((v) => { v.schemaVersion = "daily-mission-ledger-2"; })).toBeNull();
    expect(bad((v) => { v.extra = 1; })).toBeNull();
    expect(bad((v) => { delete v.day; })).toBeNull();
    expect(bad((v) => { v.day = "18/10/2026"; })).toBeNull();
    expect(bad((v) => { v.arenaBattlesToday = -1; })).toBeNull();
    expect(bad((v) => { v.boosterPacksToday = 1.5; })).toBeNull();
    expect(bad((v) => { v.claimed.daily_login = "yes"; })).toBeNull();
    expect(bad((v) => { delete v.claimed.open_booster_pack; })).toBeNull();
    expect(bad((v) => { v.claimed.weekly = true; })).toBeNull();
    expect(readDailyMissionLedger(null)).toBeNull();
  });

  it("says why claims are paused without the ledger (City copy, never host)", () => {
    expect(missionLedgerNote("ready", ledger)).toBeNull();
    const notes = (["idle", "loading", "ready", "unavailable"] as const).map((status) => missionLedgerNote(status, null));
    for (const note of notes) {
      expect(note).toMatch(/City/);
      expect(note).not.toMatch(/\bhost\b/i);
    }
  });
});
