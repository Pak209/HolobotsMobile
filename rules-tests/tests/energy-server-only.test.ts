import { readFileSync } from "node:fs";
import { deleteField, doc, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { authedDb, initTestEnvWithRules, readRulesText, seedUser } from "../src/helpers";
import { buildUserDoc } from "../src/fixtures";

// energy-quest-server-1 (Pak 2026-10-23: "Local midnight"). The daily energy regen moved to the host
// (refreshEnergy + the quest / training start callables; reset at the account's local midnight on the host clock).
// dailyEnergy / lastEnergyRefresh / stepEnergyDate / stepEnergyGrantedToday left clientWritableKeys(), and the host's
// regen state (energyDayKey, energyDayStartedAt, energyTimeZone, energyTimeZoneChangedAt) is server-only.
// Known-bad control: the energy tampers SUCCEED against the holobots-write-lockdown-1 (#203) rule shape, derived
// below from the checked-in rules (energy keys back on the allowlist, energy denylist entries removed). Set
// ENERGY_KNOWN_BAD_RULES=<path> to run the control against a literal rules file instead (e.g. origin/main's).

const YESTERDAY = new Date(Date.now() - 36 * 60 * 60 * 1000);
const SEEDED = buildUserDoc({
  dailyEnergy: 20,
  maxDailyEnergy: 100,
  lastEnergyRefresh: Timestamp.fromDate(new Date()),
  stepEnergyDate: "2026-10-23",
  stepEnergyGrantedToday: 40,
  energyDayKey: "2026-10-23",
  energyDayStartedAt: Timestamp.fromDate(new Date()),
  energyTimeZone: "America/Los_Angeles",
  energyTimeZoneChangedAt: Timestamp.fromDate(new Date()),
});

// What a modified client could do to its energy under #203 (all inside the maxDailyEnergy cap #203 enforced).
const LEGACY_FIELD_TAMPERS: Array<[string, Record<string, unknown>]> = [
  ["dailyEnergy: refill to max without waiting", { dailyEnergy: 100 }],
  ["dailyEnergy: any change (spend included)", { dailyEnergy: 19 }],
  ["lastEnergyRefresh: rewind a day (forces a client reset)", { lastEnergyRefresh: Timestamp.fromDate(YESTERDAY) }],
  ["lastEnergyRefresh: rewind for trickle", { lastEnergyRefresh: Timestamp.fromDate(new Date(Date.now() - 6 * 60 * 60 * 1000)) }],
  ["stepEnergyGrantedToday: re-arm today's step bonus", { stepEnergyGrantedToday: 0 }],
  ["stepEnergyDate: re-date the step ledger", { stepEnergyDate: "2026-10-24" }],
  ["the old regen tick (all four fields)", { dailyEnergy: 100, lastEnergyRefresh: Timestamp.fromDate(new Date()), stepEnergyDate: "2026-10-24", stepEnergyGrantedToday: 0 }],
  ["delete lastEnergyRefresh (missing = reset)", { lastEnergyRefresh: deleteField() }],
];

// The host's regen state: never client-writable (denied by #203 too: not on its allowlist).
const HOST_STATE_TAMPERS: Array<[string, Record<string, unknown>]> = [
  ["energyTimeZone: hop zones", { energyTimeZone: "Pacific/Kiritimati" }],
  ["energyTimeZoneChangedAt: clear the cooldown", { energyTimeZoneChangedAt: deleteField() }],
  ["energyDayKey: roll the day back", { energyDayKey: "2026-10-22" }],
  ["energyDayStartedAt: age the day", { energyDayStartedAt: Timestamp.fromDate(YESTERDAY) }],
];

/** The holobots-write-lockdown-1 shape: energy on the allowlist, not on the denylist. */
function preEnergyRules(): string {
  if (process.env.ENERGY_KNOWN_BAD_RULES) return readFileSync(process.env.ENERGY_KNOWN_BAD_RULES, "utf8");
  const rules = readRulesText();
  const weakened = rules
    .replace("      return [\n        'rewardSystem',", "      return [\n        'dailyEnergy', 'lastEnergyRefresh', 'stepEnergyDate', 'stepEnergyGrantedToday',\n        'rewardSystem',")
    .replace(/,\n\s*\/\/ energy-quest-server-1: energy balance[\s\S]*?'energyTimeZoneChangedAt'\n/, "\n");
  expect(weakened).not.toEqual(rules);
  expect(weakened).not.toContain("'energyTimeZoneChangedAt'");
  return weakened;
}

describe("energy is server-only (energy-quest-server-1)", () => {
  let env: RulesTestEnvironment;
  let legacy: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initTestEnvWithRules(readRulesText(), "demo-energy-server-only");
    legacy = await initTestEnvWithRules(preEnergyRules(), "demo-energy-server-only-legacy");
  });
  afterAll(async () => {
    await env?.cleanup();
    await legacy?.cleanup();
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await legacy.clearFirestore();
  });

  it.each([...LEGACY_FIELD_TAMPERS, ...HOST_STATE_TAMPERS])("denies the client write: %s", async (_name, write) => {
    await seedUser(env, "alice", SEEDED);
    await assertFails(updateDoc(doc(authedDb(env, "alice"), "users/alice"), write));
    await assertFails(setDoc(doc(authedDb(env, "alice"), "users/alice"), write, { merge: true }));
  });

  it("known-bad control: the #203 rule shape ALLOWED every energy-field tamper", async () => {
    for (const [name, write] of LEGACY_FIELD_TAMPERS) {
      await seedUser(legacy, "alice", SEEDED);
      await assertSucceeds(updateDoc(doc(authedDb(legacy, "alice"), "users/alice"), write)).catch((error) => {
        throw new Error(`${name}: ${String(error)}`);
      });
    }
  });

  it("a full-profile merge carrying the energy fields UNCHANGED still passes; settings still write", async () => {
    await seedUser(env, "alice", SEEDED);
    const alice = doc(authedDb(env, "alice"), "users/alice");
    await assertSucceeds(setDoc(alice, { ...SEEDED, syncDistanceUnit: "mi" }, { merge: true }));
    await assertSucceeds(updateDoc(alice, { "rewardSystem.syncBoostEnabled": true }));
    await assertSucceeds(updateDoc(alice, { presenceOptOut: true }));
  });

  it("client create may not carry any energy field", async () => {
    const bob = doc(authedDb(env, "bob"), "users/bob");
    for (const field of [{ dailyEnergy: 100 }, { lastEnergyRefresh: new Date() }, { energyTimeZone: "UTC" }]) {
      await assertFails(setDoc(bob, { fitnessSource: "mobile", isDevAccount: false, ...field }));
    }
    await assertSucceeds(setDoc(bob, { fitnessSource: "mobile", isDevAccount: false }));
  });
});
