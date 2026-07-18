import { describe, expect, it } from "vitest";

import {
  ENTITLEMENT_BATTLE_PASS,
  ENTITLEMENT_GENESIS_SQUAD,
  GENESIS_IAP_PRODUCT_IDS,
  IAP_PRODUCT_BATTLE_PASS_MONTHLY,
  IAP_PRODUCT_GENESIS_SQUAD,
  IAP_PRODUCT_GENESIS_SQUAD_EARLY,
} from "@/lib/monetization";

import * as serverMonetization from "../../../../functions/src/lib/monetization";
import * as serverReferrals from "../../../../functions/src/lib/referrals";

function battlePassEvent(overrides: Partial<serverMonetization.RevenueCatEvent> = {}) {
  return {
    type: "INITIAL_PURCHASE",
    appUserId: "uid123",
    productId: serverMonetization.IAP_PRODUCT_BATTLE_PASS_MONTHLY,
    expirationAtMs: 1_800_000_000_000,
    ...overrides,
  };
}

describe("monetization client/server parity", () => {
  it("product and entitlement constants match", () => {
    expect(serverMonetization.IAP_PRODUCT_GENESIS_SQUAD).toBe(IAP_PRODUCT_GENESIS_SQUAD);
    expect(serverMonetization.IAP_PRODUCT_GENESIS_SQUAD_EARLY).toBe(IAP_PRODUCT_GENESIS_SQUAD_EARLY);
    expect(serverMonetization.IAP_PRODUCT_BATTLE_PASS_MONTHLY).toBe(IAP_PRODUCT_BATTLE_PASS_MONTHLY);
    expect([...serverMonetization.GENESIS_IAP_PRODUCT_IDS]).toEqual([...GENESIS_IAP_PRODUCT_IDS]);
    expect(serverMonetization.ENTITLEMENT_GENESIS_SQUAD).toBe(ENTITLEMENT_GENESIS_SQUAD);
    expect(serverMonetization.ENTITLEMENT_BATTLE_PASS).toBe(ENTITLEMENT_BATTLE_PASS);
  });

  it("isGenesisIapProduct covers exactly the two genesis price points", () => {
    expect(serverMonetization.isGenesisIapProduct(IAP_PRODUCT_GENESIS_SQUAD)).toBe(true);
    expect(serverMonetization.isGenesisIapProduct(IAP_PRODUCT_GENESIS_SQUAD_EARLY)).toBe(true);
    expect(serverMonetization.isGenesisIapProduct(IAP_PRODUCT_BATTLE_PASS_MONTHLY)).toBe(false);
    expect(serverMonetization.isGenesisIapProduct("")).toBe(false);
  });
});

describe("parseRevenueCatEvent", () => {
  it("parses a well-formed webhook body", () => {
    const event = serverMonetization.parseRevenueCatEvent({
      api_version: "1.0",
      event: {
        type: "INITIAL_PURCHASE",
        app_user_id: "  uid123  ",
        product_id: "battle_pass_monthly",
        expiration_at_ms: 1_800_000_000_000,
        id: "evt_1",
      },
    });

    expect(event).toEqual({
      type: "INITIAL_PURCHASE",
      appUserId: "uid123",
      productId: "battle_pass_monthly",
      expirationAtMs: 1_800_000_000_000,
    });
  });

  it("treats a missing or non-numeric expiration as null", () => {
    const base = {
      type: "NON_RENEWING_PURCHASE",
      app_user_id: "uid123",
      product_id: "genesis_squad_499",
    };

    expect(serverMonetization.parseRevenueCatEvent({ event: base })!.expirationAtMs).toBeNull();
    expect(
      serverMonetization.parseRevenueCatEvent({ event: { ...base, expiration_at_ms: null } })!
        .expirationAtMs,
    ).toBeNull();
    expect(
      serverMonetization.parseRevenueCatEvent({ event: { ...base, expiration_at_ms: "soon" } })!
        .expirationAtMs,
    ).toBeNull();
  });

  it("rejects bodies that can never be fulfilled", () => {
    expect(serverMonetization.parseRevenueCatEvent(null)).toBeNull();
    expect(serverMonetization.parseRevenueCatEvent("INITIAL_PURCHASE")).toBeNull();
    expect(serverMonetization.parseRevenueCatEvent({})).toBeNull();
    expect(serverMonetization.parseRevenueCatEvent({ event: null })).toBeNull();
    expect(
      serverMonetization.parseRevenueCatEvent({
        event: { type: "INITIAL_PURCHASE", product_id: "battle_pass_monthly" },
      }),
    ).toBeNull();
    expect(
      serverMonetization.parseRevenueCatEvent({
        event: { type: "INITIAL_PURCHASE", app_user_id: "uid123" },
      }),
    ).toBeNull();
    expect(
      serverMonetization.parseRevenueCatEvent({
        event: { type: "", app_user_id: "uid123", product_id: "battle_pass_monthly" },
      }),
    ).toBeNull();
    // A slash would escape the users/{uid} doc path — permanently bad.
    expect(
      serverMonetization.parseRevenueCatEvent({
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid123/economy",
          product_id: "battle_pass_monthly",
        },
      }),
    ).toBeNull();
  });
});

describe("buildBattlePassUpdate", () => {
  it("activates the pass on every activation event type", () => {
    for (const type of serverMonetization.BATTLE_PASS_ACTIVATION_EVENT_TYPES) {
      const update = serverMonetization.buildBattlePassUpdate({}, battlePassEvent({ type }));
      expect(update).toEqual({ battlePassActiveUntil: 1_800_000_000_000 });
    }
  });

  it("a renewal pushes the lapse time forward", () => {
    const update = serverMonetization.buildBattlePassUpdate(
      { battlePassActiveUntil: 1_800_000_000_000 },
      battlePassEvent({ type: "RENEWAL", expirationAtMs: 1_802_600_000_000 }),
    );

    expect(update).toEqual({ battlePassActiveUntil: 1_802_600_000_000 });
  });

  it("is idempotent: replayed or stale events produce no write", () => {
    const state = { battlePassActiveUntil: 1_800_000_000_000 };

    expect(serverMonetization.buildBattlePassUpdate(state, battlePassEvent())).toBeNull();
    expect(
      serverMonetization.buildBattlePassUpdate(
        state,
        battlePassEvent({ expirationAtMs: 1_799_999_999_999 }),
      ),
    ).toBeNull();
  });

  it("ignores expiration/cancellation (the pass lapses by timestamp)", () => {
    for (const type of ["EXPIRATION", "CANCELLATION"]) {
      expect(
        serverMonetization.buildBattlePassUpdate({}, battlePassEvent({ type })),
      ).toBeNull();
    }
  });

  it("ignores other products and events without an expiration", () => {
    expect(
      serverMonetization.buildBattlePassUpdate(
        {},
        battlePassEvent({ productId: IAP_PRODUCT_GENESIS_SQUAD }),
      ),
    ).toBeNull();
    expect(
      serverMonetization.buildBattlePassUpdate({}, battlePassEvent({ expirationAtMs: null })),
    ).toBeNull();
    expect(
      serverMonetization.buildBattlePassUpdate({}, battlePassEvent({ expirationAtMs: 0 })),
    ).toBeNull();
  });
});

describe("genesis purchase fulfillment path", () => {
  it("a parsed genesis purchase event feeds the shared grant builder", () => {
    const event = serverMonetization.parseRevenueCatEvent({
      api_version: "1.0",
      event: {
        type: "NON_RENEWING_PURCHASE",
        app_user_id: "uid123",
        product_id: IAP_PRODUCT_GENESIS_SQUAD_EARLY,
      },
    });

    expect(event).not.toBeNull();
    expect(serverMonetization.isGenesisIapProduct(event!.productId)).toBe(true);
    expect([...serverMonetization.GENESIS_PURCHASE_EVENT_TYPES]).toContain(event!.type);

    // Same one-grant builder as the referral path, with the purchase source.
    const grant = serverReferrals.buildGenesisSquadGrantRaw({ holobots: [] }, "purchase");
    expect(grant!.updates.genesisSquadClaimed).toBe("purchase");
    // And it is one-shot, which is what makes webhook retries idempotent.
    expect(serverReferrals.buildGenesisSquadGrantRaw(grant!.updates, "purchase")).toBeNull();
  });
});
