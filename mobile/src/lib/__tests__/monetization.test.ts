import { describe, expect, it } from "vitest";

import {
  describeEntitlementGrant,
  ENTITLEMENT_BATTLE_PASS,
  ENTITLEMENT_GENESIS_SQUAD,
  GENESIS_IAP_PRODUCT_IDS,
  IAP_PRODUCT_BATTLE_PASS_MONTHLY,
  IAP_PRODUCT_GENESIS_SQUAD,
  IAP_PRODUCT_GENESIS_SQUAD_EARLY,
} from "@/lib/monetization";

describe("IAP catalog", () => {
  it("product ids match the App Store Connect drafts exactly", () => {
    expect(IAP_PRODUCT_GENESIS_SQUAD).toBe("genesis_squad_499");
    expect(IAP_PRODUCT_GENESIS_SQUAD_EARLY).toBe("genesis_squad_early_199");
    expect(IAP_PRODUCT_BATTLE_PASS_MONTHLY).toBe("battle_pass_monthly");
  });

  it("both genesis price points map to the one genesis entitlement", () => {
    expect([...GENESIS_IAP_PRODUCT_IDS]).toEqual([
      "genesis_squad_499",
      "genesis_squad_early_199",
    ]);
    expect(ENTITLEMENT_GENESIS_SQUAD).toBe("genesis_squad");
    expect(ENTITLEMENT_BATTLE_PASS).toBe("battle_pass");
  });
});

describe("describeEntitlementGrant", () => {
  it("describes the genesis squad entitlement", () => {
    const grant = describeEntitlementGrant(ENTITLEMENT_GENESIS_SQUAD);

    expect(grant).not.toBeNull();
    expect(grant!.entitlementId).toBe("genesis_squad");
    expect(grant!.title).toBe("Genesis Squad");
    expect(grant!.description).toContain("KUMA + SHADOW");
    expect(grant!.description).toContain("GENESIS badge");
  });

  it("describes the battle pass entitlement", () => {
    const grant = describeEntitlementGrant(ENTITLEMENT_BATTLE_PASS);

    expect(grant).not.toBeNull();
    expect(grant!.entitlementId).toBe("battle_pass");
    expect(grant!.title).toBe("Battle Pass");
  });

  it("returns null for unknown entitlements", () => {
    expect(describeEntitlementGrant("mystery_box")).toBeNull();
    expect(describeEntitlementGrant("")).toBeNull();
  });
});
