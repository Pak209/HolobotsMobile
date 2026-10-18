import { afterEach, describe, expect, it } from "vitest";
import { buildBuddyUnitPurchase, buildCatalog } from "../../../test-fixtures/host-pin/src/lib/vendors";
import { ZONE_EXPEDITION_DEFAULT_SELECTOR } from "../../../test-fixtures/host-pin/src/config/zoneExpedition";
import hostMarket from "../../qa/fixtures/city-market-vendor-3.json";
import {
  CATALOG_INVALID_TEXT, CITY_MARKET_COPY, cityMarketReducer, initialCityMarketState, listingNeedsRequestId, listingPurchasable,
  listingPurchase, presentCityMarket, readVendorCatalog, refusalNotice, type CityMarketState, type VendorCatalog,
} from "../cityMarket";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const catalog = () => readVendorCatalog(clone(hostMarket.catalog), "marketplace");
const ready = (value: VendorCatalog = catalog()): CityMarketState => cityMarketReducer(initialCityMarketState(true), { type: "loaded", catalog: value });
const listing = (value: VendorCatalog, id: string) => value.listings.find((row) => row.listingId === id)!;
const row = (state: CityMarketState, id: string) => presentCityMarket(state).sections.flatMap((section) => section.rows).find((entry) => entry.listingId === id)!;

describe("city market host fixtures", () => {
  afterEach(() => { delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG; });
  it("cityMarketFixturesMatchHost: the QA catalog, purchase reply and re-read are the host builders' own output", () => {
    delete process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG;
    const profile = clone(hostMarket.profile) as Record<string, unknown>;
    expect(buildCatalog(profile, "marketplace", hostMarket.nowMs)).toEqual(hostMarket.catalog);
    const purchase = buildBuddyUnitPurchase(profile, hostMarket.purchaseRequest as Parameters<typeof buildBuddyUnitPurchase>[1]);
    expect(purchase.reply).toEqual(hostMarket.purchaseReply);
    expect(buildCatalog({ ...profile, ...purchase.updates }, "marketplace", hostMarket.nowMs)).toEqual(hostMarket.catalogAfter);
  });
  it("reads every host marketplace and workshop catalog, including healing and expedition rows", () => {
    const profile = clone(hostMarket.profile) as Record<string, unknown>;
    expect(readVendorCatalog(buildCatalog(profile, "workshop", hostMarket.nowMs), "workshop").listings.every((row) => row.kind === "part")).toBe(true);
    process.env.HOLOCITY_ZONE_EXPEDITION_CONFIG = ZONE_EXPEDITION_DEFAULT_SELECTOR;
    const withExpedition = readVendorCatalog(buildCatalog(profile, "marketplace", hostMarket.nowMs), "marketplace");
    const expedition = withExpedition.listings.filter((row) => row.purchase.callable === "holoZoneHost");
    expect(expedition.map((row) => row.listingId)).toEqual(["item.expedition_energy", "item.extraction_charge"]);
    // A well-formed row lite cannot send renders as DESKTOP ONLY; it never fails the catalog or reaches the host.
    expect(expedition.every((row) => !listingPurchasable(row))).toBe(true);
    expect(row(ready(withExpedition), "item.expedition_energy").action).toEqual({ label: CITY_MARKET_COPY.desktopOnly, enabled: false });
  });
});

describe("readVendorCatalog fail-closed", () => {
  const bad: Array<[string, (c: Record<string, any>) => void]> = [
    ["pre-vendor-3 schema", (c) => { c.schemaVersion = "vendor-1"; }],
    ["another vendor", (c) => { c.vendorId = "workshop"; }],
    ["string Holos", (c) => { c.holosTokens = "5000"; }],
    ["negative Holos", (c) => { c.holosTokens = -1; }],
    ["missing inventory field", (c) => { delete c.inventory.rankSkips; }],
    ["malformed buddy units", (c) => { c.inventory.buddyUnits = 3; }],
    ["listings not an array", (c) => { c.listings = {}; }],
    ["duplicate listing id", (c) => { c.listings[1].listingId = c.listings[0].listingId; }],
    ["unknown kind", (c) => { c.listings[0].kind = "weapon"; }],
    ["string price", (c) => { c.listings[0].price = "100"; }],
    ["NaN owned", (c) => { c.listings[0].owned = Number.NaN; }],
    ["other currency", (c) => { c.listings[0].currency = "gems"; }],
    ["affordable not boolean", (c) => { c.listings[0].affordable = 1; }],
    ["numeric detail", (c) => { c.listings[0].details.healFraction = 0.25; }],
    ["missing purchase", (c) => { delete c.listings[0].purchase; }],
    ["array request", (c) => { c.listings[0].purchase.request = []; }],
  ];
  it.each(bad)("rejects %s", (_name, edit) => {
    const value = clone(hostMarket.catalog) as Record<string, any>;
    edit(value);
    expect(() => readVendorCatalog(value, "marketplace")).toThrow(CATALOG_INVALID_TEXT);
  });
  it.each([null, undefined, [], "catalog", 7])("rejects %s", (value) => {
    expect(() => readVendorCatalog(value, "marketplace")).toThrow(CATALOG_INVALID_TEXT);
  });
});

describe("listing purchase calls", () => {
  it("sends the listing's own call; only <client-generated> is replaced", () => {
    const c = catalog();
    expect(listingPurchase(listing(c, "item.arena_pass"))).toEqual({ callable: "purchaseMarketplaceItem", request: { itemName: "Arena Pass" } });
    expect(listingPurchase(listing(c, "booster.rare"))).toEqual({ callable: "purchaseMarketplaceBooster", request: { packId: "rare" } });
    expect(listingNeedsRequestId(listing(c, "buddy.medium"))).toBe(true);
    expect(listingPurchase(listing(c, "buddy.medium"), "req_1")).toEqual({ callable: "purchaseBuddyUnit", request: { tierId: "buddy_medium", requestId: "req_1" } });
    expect(listingPurchase(listing(c, "item.repair_kit"), "req_2")).toEqual({ callable: "desktopItemsHost", request: { schemaVersion: "desktop-items-2", operation: "buy", itemId: "item.repair_kit", requestId: "req_2" } });
    expect(listingPurchase(listing(c, "buddy.medium"))).toBeNull();
    expect(listingPurchase(listing(c, "buddy.medium"), "bad id!")).toBeNull();
  });
  it("never sends an unlisted callable or a non-buy operation", () => {
    const c = clone(hostMarket.catalog) as Record<string, any>;
    c.listings[0].purchase = { callable: "deleteUserAccountV2", request: {} };
    c.listings[1].purchase.request.operation = "use";
    c.listings[2].purchase.callable = "constructor";
    const read = readVendorCatalog(c, "marketplace");
    for (const entry of read.listings.slice(0, 3)) { expect(listingPurchasable(entry)).toBe(false); expect(listingPurchase(entry, "req_1")).toBeNull(); }
  });
});

describe("presentCityMarket renders the host reply only", () => {
  it("shows host prices, owned counts, stock and Holos verbatim, grouped by host kind", () => {
    const view = presentCityMarket(ready());
    expect(view.holosText).toBe("5,000 HOLOS");
    expect(view.sections.map((s) => s.title)).toEqual(["SUPPLIES", "BOOSTER PACKS", "BUDDY UNITS"]);
    const state = ready();
    expect(row(state, "buddy.medium")).toMatchObject({ title: "MEDIUM BUDDY UNIT", priceText: "300 HOLOS", metaText: "OWNED 0 · IN STOCK", action: { label: "BUY", enabled: true } });
    expect(row(state, "item.repair_kit")).toMatchObject({ priceText: "250 HOLOS", metaText: "OWNED 2 · IN STOCK", detailText: "HEALS 50% HP" });
    expect(row(state, "item.wildcard_blueprints")).toMatchObject({ priceText: "300 HOLOS · ×5 PER BUY", metaText: "OWNED 5", action: { label: "RESTOCKING", enabled: false } });
    expect(row(state, "booster.elite")).toMatchObject({ metaText: "IN STOCK", detailText: "BONUS · EXP BOOSTER" });
    expect(row(state, "item.rank_skip").action).toEqual({ label: "BUY", enabled: true });
  });
  it("uses the host's affordable flag, never a local Holos comparison", () => {
    const poor = clone(hostMarket.catalog) as Record<string, any>;
    poor.listings.find((r: any) => r.listingId === "buddy.heavy").affordable = false;
    poor.listings.find((r: any) => r.listingId === "item.rank_skip").affordable = true;
    poor.holosTokens = 0;
    const state = ready(readVendorCatalog(poor, "marketplace"));
    expect(row(state, "buddy.heavy").action).toEqual({ label: "NEED HOLOS", enabled: false });
    expect(row(state, "item.rank_skip").action).toEqual({ label: "BUY", enabled: true });
    expect(presentCityMarket(state).holosText).toBe("0 HOLOS");
  });
  it("after a purchase shows the re-read catalog's Holos and owned count, not before minus price", () => {
    const after = clone(hostMarket.catalogAfter) as Record<string, any>;
    after.holosTokens = 4321; // a host value no local subtraction could produce
    const view = presentCityMarket(ready(readVendorCatalog(after, "marketplace")));
    expect(view.holosText).toBe("4,321 HOLOS");
    expect(row(ready(readVendorCatalog(after, "marketplace")), "buddy.medium").metaText).toBe("OWNED 1 · IN STOCK");
  });
  it("signed-out and unavailable plates", () => {
    expect(presentCityMarket(initialCityMarketState(false))).toMatchObject({ plate: { title: "SIGN IN FIRST", refresh: false }, sections: [], holosText: "— HOLOS" });
    const failed = cityMarketReducer(ready(), { type: "loadFailed", text: CATALOG_INVALID_TEXT });
    expect(presentCityMarket(failed)).toMatchObject({ plate: { title: "UNAVAILABLE", body: CATALOG_INVALID_TEXT, refresh: true }, sections: [], holosText: "— HOLOS", refreshEnabled: true });
  });
});

describe("cityMarketReducer BUY → CONFIRM", () => {
  it("opens confirm only for a buyable row and gates one purchase at a time", () => {
    let state = ready();
    expect(cityMarketReducer(state, { type: "select", listingId: "item.wildcard_blueprints" })).toBe(state);
    expect(cityMarketReducer(state, { type: "select", listingId: "nope" })).toBe(state);
    expect(cityMarketReducer(state, { type: "purchaseStarted", listingId: "buddy.medium" })).toBe(state);
    state = cityMarketReducer(state, { type: "select", listingId: "buddy.medium" });
    expect(presentCityMarket(state).confirm).toMatchObject({ text: "BUY MEDIUM BUDDY UNIT FOR 300 HOLOS?", enabled: true });
    state = cityMarketReducer(state, { type: "purchaseStarted", listingId: "buddy.medium" });
    expect(row(state, "buddy.medium").action).toEqual({ label: "CONFIRMING…", enabled: false });
    expect(row(state, "buddy.heavy").action.enabled).toBe(false);
    expect(cityMarketReducer(state, { type: "select", listingId: "buddy.heavy" })).toBe(state);
    expect(cityMarketReducer(state, { type: "cancel" })).toBe(state);
    state = cityMarketReducer(state, { type: "purchaseFinished", notice: { tone: "ok", text: "PURCHASE CONFIRMED · Medium Buddy Unit" } });
    expect(presentCityMarket(state)).toMatchObject({ confirm: null, notice: { tone: "ok" } });
  });
  it("prints the host's refusal code", () => {
    const c = catalog();
    expect(refusalNotice(listing(c, "buddy.heavy"), { code: "functions/failed-precondition", details: { rejectionCode: "not_enough_holos" } }).text).toBe("REFUSED · not_enough_holos — Not enough Holos.");
    expect(refusalNotice(listing(c, "item.arena_pass"), { code: "functions/invalid-argument", details: { rejectionCode: "on_cooldown" } }).text).toContain("REFUSED · on_cooldown");
    expect(refusalNotice(listing(c, "item.arena_pass"), new Error("timed out")).text).toBe("The host did not confirm this purchase. Check the stalls below before buying again.");
    expect(refusalNotice(listing(c, "buddy.medium"), { code: "functions/unavailable" }).text).toContain("resends the same receipt");
    expect(refusalNotice(listing(c, "buddy.medium"), { code: "functions/unauthenticated" }).text).toBe("Sign in first, then reopen the market.");
  });
});
