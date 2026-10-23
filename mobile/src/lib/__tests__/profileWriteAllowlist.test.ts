import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const firestore = vi.hoisted(() => ({ updateDoc: vi.fn(async (..._args: unknown[]) => undefined), getDoc: vi.fn() }));
vi.mock("@/config/firebase", () => ({ db: {}, doc: (_db: unknown, ...p: string[]) => p.join("/"), getDoc: firestore.getDoc, onSnapshot: vi.fn(), updateDoc: firestore.updateDoc }));

import { updateUserProfile } from "../profile";

/**
 * holobots-write-lockdown-1: firestore.rules clientWritableKeys() is the whole client write surface of users/{uid}.
 * Every key the app's one profile writer can emit must be in it (else the write is PERMISSION_DENIED on device), and
 * none of the locked economy fields may be emitted at all.
 */
const rules = readFileSync(path.resolve(__dirname, "../../../../firestore.rules"), "utf8");
const allowlistBody = /function clientWritableKeys\(\) \{\s*return \[([\s\S]*?)\];/.exec(rules)?.[1] ?? "";
const allowlist = [...allowlistBody.matchAll(/'([A-Za-z_]+)'/g)].map((m) => m[1]);

const LOCKED = ["holobots", "equippedParts", "battle_cards", "arena_deck_template_ids", "starter_deck_claimed", "inventory",
  "leaderboardScore", "prestigeCount", "asyncBattleTickets", "maxDailyEnergy", "holosTokens", "syncPoints", "parts", "blueprints"];

afterEach(() => firestore.updateDoc.mockClear());

describe("profile writes stay inside the rules allowlist", () => {
  it("parses the rules allowlist", () => {
    expect(allowlist).toEqual(expect.arrayContaining(["dailyEnergy", "rewardSystem", "syncDistanceUnit", "referralCode"]));
    for (const key of LOCKED) expect(allowlist).not.toContain(key);
  });

  it("updateUserProfile emits only allowlisted keys, even when handed locked fields", async () => {
    await updateUserProfile("uid-1", {
      dailyEnergy: 40, lastEnergyRefresh: "2026-10-23T00:00:00Z", stepEnergyDate: "2026-10-23", stepEnergyGrantedToday: 2,
      rewardSystem: {}, syncDistanceUnit: "mi", referralCode: "ABC123",
      ...Object.fromEntries(LOCKED.map((key) => [key, 1])),
    } as never);
    expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
    const payload = firestore.updateDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["dailyEnergy", "lastEnergyRefresh", "referralCode", "rewardSystem", "stepEnergyDate", "stepEnergyGrantedToday", "syncDistanceUnit"],
    );
    for (const key of Object.keys(payload)) expect(allowlist).toContain(key);
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });
});
