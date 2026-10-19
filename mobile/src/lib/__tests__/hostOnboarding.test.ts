import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import identityFixture from "../../qa/fixtures/desktop-account-3-identity.json";
import onboardingFixture from "../../qa/fixtures/onboarding.json";
import { buildDesktopAccountReply } from "../../../test-fixtures/host-pin/src/desktop/desktopAccountReply";
import { readDashboardAccount, readDashboardOnboarding } from "../hostDashboard";

/**
 * Host 9315624 (#162 onboarding-host-1): every desktop-account reply carries a top-level `onboarding`
 * (Schemas/onboarding-1.json). Lite tolerates it and presents nothing. The fixture is a byte copy of main 9315624's
 * functions/scripts/fixtures/desktop-account/onboarding.json (blob 7d799d32).
 */
const FIXTURE_SHA256 = "98b9ea364932ed6f38c9a5468366398fa61cef73c84c6171edbe696973d08a65";
const UID = identityFixture.uid;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const withOnboarding = (onboarding: unknown) => ({ ...clone(identityFixture), onboarding });

describe("host onboarding fixture", () => {
  it("is main 9315624's byte copy", () => {
    const bytes = readFileSync(path.resolve(__dirname, "../../qa/fixtures/onboarding.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(FIXTURE_SHA256);
  });
});

describe("readDashboardAccount: onboarding is optional and lenient", () => {
  it("absent: an older host's reply parses, with no onboarding key", () => {
    const account = readDashboardAccount(identityFixture, UID);
    expect("onboarding" in account).toBe(false);
    expect(readDashboardOnboarding(undefined)).toBeUndefined();
  });

  it.each(["returning", "genesis", "skipped"] as const)("well-formed: reads the recorded %s reply, frozen", (name) => {
    const { schemaVersion: _schema, ...expected } = onboardingFixture[name].reply.onboarding;
    const account = readDashboardAccount(withOnboarding(clone(onboardingFixture[name].reply.onboarding)), UID);
    expect(account.onboarding).toEqual(expected);
    expect(Object.isFrozen(account.onboarding)).toBe(true);
  });

  it.each(["desktop-account-1", "desktop-account-2", "desktop-account-3"] as const)("well-formed: the pinned host's real %s reply at every step", (version) => {
    const returning = readDashboardAccount(buildDesktopAccountReply({}, UID, version, { light: 0, medium: 0, heavy: 0 }), UID);
    expect(returning.onboarding).toEqual({ step: 7, stepId: "done", skipped: true, stepAt: null });
    for (const step of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const raw = buildDesktopAccountReply({ onboarding: { step, skipped: false, stepAt: 5 } }, UID, version, { light: 0, medium: 0, heavy: 0 });
      expect(readDashboardAccount(raw, UID).onboarding).toMatchObject({ step, skipped: false, stepAt: 5 });
    }
  });

  it.each([
    null, [], "x", 7, {},
    { schemaVersion: "onboarding-2", step: 0, stepId: "arrive", skipped: false, stepAt: 1 },
    { schemaVersion: "onboarding-1", step: 0, stepId: "done", skipped: false, stepAt: 1 },
    { schemaVersion: "onboarding-1", step: 1.5, stepId: "companion", skipped: false, stepAt: 1 },
    { schemaVersion: "onboarding-1", step: 0, stepId: "arrive", skipped: "no", stepAt: 1 },
    { schemaVersion: "onboarding-1", step: 0, stepId: "arrive", skipped: false, stepAt: -1 },
    { schemaVersion: "onboarding-1", step: 0, stepId: "arrive", skipped: false },
    ...onboardingFixture.knownBad.slice(0, 3),
  ])("malformed: %j reads as undefined and never fails the account read", (value) => {
    expect(readDashboardOnboarding(value)).toBeUndefined();
    const account = readDashboardAccount(withOnboarding(value), UID);
    expect("onboarding" in account).toBe(false);
    expect(account.username).toBe(readDashboardAccount(identityFixture, UID).username);
  });

  it("an extra key is tolerated, as main's readHostOnboarding does (the fixture's 4th knownBad is a host-schema reject)", () => {
    const [extra] = onboardingFixture.knownBad.slice(3);
    expect(readDashboardOnboarding(extra)).toEqual({ step: 1, stepId: "companion", skipped: false, stepAt: 1 });
  });
});
