import { afterEach, describe, expect, it, vi } from "vitest";

const firestore = vi.hoisted(() => ({ updateDoc: vi.fn(async () => undefined), getDoc: vi.fn() }));
vi.mock("@/config/firebase", () => ({ db: {}, doc: (_db: unknown, ...path: string[]) => path.join("/"), getDoc: firestore.getDoc, onSnapshot: vi.fn(), updateDoc: firestore.updateDoc }));

import { mapFirestoreToUserProfile, updateUserProfile } from "../profile";
import { readHostVitals } from "../../lite/lib/arenaVitals";

/**
 * lite-main-shared-1: `holobotVitals` is the City's HP ledger, display only. The shared profile mapping adds it only in
 * lite builds (EXPO_PUBLIC_HOLOCITY_LITE=1), with the lite reader's exact rules, and mobile never writes it.
 */
const ledger = { "ace": { currentHealth: 0, maxHealth: 120 }, "kuma": { currentHealth: 80, maxHealth: 140 } };
const doc = { username: "pilot", holobots: [], holobotVitals: ledger };

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); firestore.updateDoc.mockClear(); });

describe("shared profile holobotVitals (additive, lite-only, read only)", () => {
  it.each([undefined, "0", "true"])("flag %s: the original app's profile is unchanged (no holobotVitals key)", (flag) => {
    if (flag === undefined) expect(process.env.EXPO_PUBLIC_HOLOCITY_LITE).toBeUndefined();
    else vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", flag);
    // The mapper defaults lastEnergyRefresh / lastAsyncTicketRefresh to "now": freeze it so both reads compare.
    vi.useFakeTimers({ now: new Date("2026-10-18T12:00:00Z") });
    const mapped = mapFirestoreToUserProfile("uid-1", doc as never);
    expect(Object.keys(mapped)).not.toContain("holobotVitals");
    const { holobotVitals: _ignored, ...withoutField } = doc;
    expect(mapped).toEqual(mapFirestoreToUserProfile("uid-1", withoutField as never));
  });

  it("lite build: maps the host ledger with the lite reader's rules", () => {
    vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", "1");
    expect(mapFirestoreToUserProfile("uid-1", doc as never).holobotVitals).toEqual(ledger);
    expect(mapFirestoreToUserProfile("uid-1", { username: "pilot" } as never).holobotVitals).toBeNull();
  });

  it.each<[string, unknown]>([
    ["valid", ledger], ["empty", {}], ["absent", undefined], ["null", null], ["array", [ledger.ace]], ["string", "ace"],
    ["NaN HP", { ace: { currentHealth: Number.NaN, maxHealth: 120 } }], ["over max", { ace: { currentHealth: 121, maxHealth: 120 } }],
    ["zero max", { ace: { currentHealth: 0, maxHealth: 0 } }], ["negative", { ace: { currentHealth: -1, maxHealth: 120 } }],
    ["string HP", { ace: { currentHealth: "0", maxHealth: 120 } }], ["one bad entry", { ...ledger, bad: null }],
  ])("lite build: %s agrees with src/lite/lib/arenaVitals.ts readHostVitals", (_name, raw) => {
    vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", "1");
    expect(mapFirestoreToUserProfile("uid-1", { username: "pilot", holobotVitals: raw } as never).holobotVitals).toEqual(readHostVitals(raw));
  });

  it("is never written by the client", async () => {
    vi.stubEnv("EXPO_PUBLIC_HOLOCITY_LITE", "1");
    // holobots-write-lockdown-1: server-only keys (holobotVitals, holosTokens, ...) are dropped;
    // only the rules allowlist is ever sent, and a write with nothing allowed is skipped.
    await updateUserProfile("uid-1", { holobotVitals: ledger, holosTokens: 5 } as never);
    expect(firestore.updateDoc).not.toHaveBeenCalled();
    await updateUserProfile("uid-1", { holobotVitals: ledger, holosTokens: 5, syncDistanceUnit: "mi" } as never);
    expect(firestore.updateDoc).toHaveBeenCalledTimes(1);
    expect(firestore.updateDoc).toHaveBeenCalledWith("users/uid-1", { syncDistanceUnit: "mi" });
  });
});
