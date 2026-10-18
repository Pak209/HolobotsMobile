import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ auth: { currentUser: { uid: "pilot-a" } as { uid: string } | null }, call: vi.fn(), callable: vi.fn() }));
vi.mock("@/config/firebase", () => ({ auth: fixture.auth, functions: {}, httpsCallable: (...args: unknown[]) => { fixture.callable(...args); return fixture.call; } }));
import { createCityMarketController, fixtureCityMarketHost, liveCityMarketHost, NOT_SOLD_HERE_TEXT, NOT_SOLD_IN_LITE_TEXT, type CityMarketFixture, type CityMarketHost } from "../cityMarketClient";
import { CATALOG_INVALID_TEXT, cityMarketReducer, initialCityMarketState, presentCityMarket, readVendorCatalog, refusalNotice, SESSION_SWITCHED_CODE, UNVERIFIED_REPLY_CODE, type CityMarketEvent, type CityMarketState } from "../cityMarket";
import { createCityRequestJournal } from "../cityRequestJournal";
import { subscribeHostEconomyChanged } from "../hostDashboard";
import { cityMarketFixtures, CITY_MARKET_HOST_FIXTURE as hostMarket, NOT_ENOUGH_HOLOS_REFUSAL } from "../../qa/cityMarketFixtures";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const listing = (id: string, value: unknown = hostMarket.catalog) => readVendorCatalog(clone(value), "marketplace").listings.find((row) => row.listingId === id)!;
function memoryJournal() {
  const store = new Map<string, string>();
  let n = 0;
  return { store, journal: createCityRequestJournal({ getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async (k) => { store.delete(k); } }, () => `req_${++n}`) };
}
/** Drives the real reducer from the controller, the way the screen does. */
function harness(host: CityMarketHost | null) {
  let state: CityMarketState = initialCityMarketState(host);
  const events: CityMarketEvent["type"][] = [];
  const controller = createCityMarketController(host, (event) => { events.push(event.type); state = cityMarketReducer(state, event); });
  return { controller, events, get state() { return state; }, get view() { return presentCityMarket(state); }, select: (id: string) => { state = cityMarketReducer(state, { type: "select", listingId: id }); } };
}
const spyHost = (fx: CityMarketFixture) => { const host = fixtureCityMarketHost(fx); return { host: { readCatalog: vi.fn(host.readCatalog), buy: vi.fn(host.buy) } }; };

describe("live market host (vendorCatalogHost + the listing's own purchase call)", () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.auth.currentUser = { uid: "pilot-a" }; });
  it("reads the marketplace catalog with the exact host intent and no uid", async () => {
    fixture.call.mockResolvedValueOnce({ data: hostMarket.catalog });
    const { journal } = memoryJournal();
    expect(await liveCityMarketHost("pilot-a", journal).readCatalog()).toEqual(hostMarket.catalog);
    expect(fixture.callable).toHaveBeenLastCalledWith({}, "vendorCatalogHost");
    expect(fixture.call).toHaveBeenLastCalledWith({ operation: "catalog", vendorId: "marketplace" });
  });
  it("S12: a listing whose host purchase takes no requestId never reaches a purchase call", async () => {
    const { journal, store } = memoryJournal();
    const host = liveCityMarketHost("pilot-a", journal);
    for (const id of ["item.arena_pass", "item.rank_skip", "booster.rare"]) await expect(host.buy(listing(id))).rejects.toThrow(NOT_SOLD_HERE_TEXT);
    expect(fixture.callable).not.toHaveBeenCalled();
    expect(fixture.call).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
  it("keeps a Buddy Unit requestId across an uncertain outcome and clears it after the host verdict", async () => {
    const { journal, store } = memoryJournal();
    const host = liveCityMarketHost("pilot-a", journal);
    fixture.call.mockRejectedValueOnce({ code: "functions/deadline-exceeded" });
    await expect(host.buy(listing("buddy.medium"))).rejects.toEqual({ code: "functions/deadline-exceeded" });
    expect(fixture.call).toHaveBeenLastCalledWith({ tierId: "buddy_medium", requestId: "req_1" });
    expect([...store.values()]).toEqual(["req_1"]);
    fixture.call.mockResolvedValueOnce({ data: { ...hostMarket.purchaseReply, requestId: "req_1", alreadyProcessed: true } });
    await host.buy(listing("buddy.medium"));
    expect(fixture.call).toHaveBeenLastCalledWith({ tierId: "buddy_medium", requestId: "req_1" });
    expect(store.size).toBe(0);
    fixture.call.mockRejectedValueOnce(NOT_ENOUGH_HOLOS_REFUSAL);
    await expect(host.buy(listing("buddy.heavy"))).rejects.toBe(NOT_ENOUGH_HOLOS_REFUSAL);
    expect(fixture.call).toHaveBeenLastCalledWith({ tierId: "buddy_heavy", requestId: "req_2" });
    expect(store.size).toBe(0);
  });
  it("buys a healing item through desktopItemsHost buy with a fresh requestId", async () => {
    fixture.call.mockResolvedValueOnce({ data: { schemaVersion: "desktop-items-2", result: { kind: "buy", itemId: "item.repair_kit" } } });
    const { journal } = memoryJournal();
    await liveCityMarketHost("pilot-a", journal).buy(listing("item.repair_kit"));
    expect(fixture.callable).toHaveBeenLastCalledWith({}, "desktopItemsHost");
    expect(fixture.call).toHaveBeenLastCalledWith({ schemaVersion: "desktop-items-2", operation: "buy", itemId: "item.repair_kit", requestId: "req_1" });
  });
  it("never calls the host for a listing lite cannot send", async () => {
    const forged = clone(hostMarket.catalog) as Record<string, any>;
    forged.listings[3].purchase = { callable: "deleteUserAccountV2", request: {} };
    const { journal } = memoryJournal();
    await expect(liveCityMarketHost("pilot-a", journal).buy(listing(forged.listings[3].listingId, forged))).rejects.toThrow(NOT_SOLD_IN_LITE_TEXT);
    expect(fixture.call).not.toHaveBeenCalled();
  });
  it("refuses a stale or switched session before and after the call", async () => {
    const { journal } = memoryJournal();
    fixture.auth.currentUser = null;
    await expect(liveCityMarketHost("pilot-a", journal).readCatalog()).rejects.toEqual({ code: "unauthenticated" });
    expect(fixture.call).not.toHaveBeenCalled();
    fixture.auth.currentUser = { uid: "pilot-a" };
    fixture.call.mockImplementationOnce(async () => { fixture.auth.currentUser = { uid: "pilot-b" }; return { data: hostMarket.catalog }; });
    await expect(liveCityMarketHost("pilot-a", journal).readCatalog()).rejects.toEqual({ code: "unauthenticated" });
  });
});

describe("economy-change signal (#132) from the live buy path", () => {
  const offs: (() => void)[] = [];
  beforeEach(() => { vi.clearAllMocks(); fixture.auth.currentUser = { uid: "pilot-a" }; });
  afterEach(() => { offs.splice(0).forEach((off) => off()); });
  function listen() { const seen: string[] = []; offs.push(subscribeHostEconomyChanged((uid) => seen.push(uid))); return seen; }

  it("publishes once, for this pilot, only after the host reply that charged", async () => {
    const seen = listen();
    const { journal } = memoryJournal();
    let seenBeforeReply = -1;
    fixture.call.mockImplementationOnce(async () => { seenBeforeReply = seen.length; return { data: { ...hostMarket.purchaseReply, requestId: "req_1" } }; });
    await liveCityMarketHost("pilot-a", journal).buy(listing("buddy.medium"));
    expect(seenBeforeReply).toBe(0);
    expect(seen).toEqual(["pilot-a"]);
  });
  it("publishes for a desktopItemsHost buy receipt; anything else is no verdict: rejected as unverified, requestId kept, nothing published", async () => {
    const seen = listen();
    const { journal, store } = memoryJournal();
    const host = liveCityMarketHost("pilot-a", journal);
    fixture.call.mockResolvedValueOnce({ data: { schemaVersion: "desktop-items-2", items: [], result: { kind: "buy", itemId: "item.repair_kit" } } });
    await host.buy(listing("item.repair_kit"));
    expect(seen).toEqual(["pilot-a"]);
    expect(store.size).toBe(0);
    const notConfirmations = [
      null, {}, { schemaVersion: "desktop-items-2" }, { schemaVersion: "desktop-items-2", result: { kind: "use", itemId: "item.repair_kit" } },
      { schemaVersion: "desktop-items-2", result: { kind: "buy", itemId: "item.full_restore" } },
    ];
    for (const data of notConfirmations) {
      fixture.call.mockResolvedValueOnce({ data });
      await expect(host.buy(listing("item.repair_kit"))).rejects.toEqual({ code: UNVERIFIED_REPLY_CODE });
    }
    // Every unverified retry resent the SAME kept requestId, so a real charge can only be replayed.
    const sent = fixture.call.mock.calls.slice(1).map(([request]) => (request as { requestId: string }).requestId);
    expect(new Set(sent)).toEqual(new Set(["req_2"]));
    expect([...store.values()]).toEqual(["req_2"]);
    for (const data of [{ ...hostMarket.purchaseReply, requestId: "someone_elses" }, { ...hostMarket.purchaseReply, requestId: "req_3", tierId: "buddy_heavy" }]) {
      fixture.call.mockResolvedValueOnce({ data });
      await expect(host.buy(listing("buddy.medium"))).rejects.toEqual({ code: UNVERIFIED_REPLY_CODE });
    }
    expect(seen).toEqual(["pilot-a"]);
    // The page reads it as "did not confirm", never as a confirmation (critic: notice and signal agree).
    expect(refusalNotice(listing("buddy.medium"), { code: UNVERIFIED_REPLY_CODE }).tone).toBe("info");
  });
  it("a stale session at tap time sends nothing and keeps an earlier kept requestId", async () => {
    const { journal, store } = memoryJournal();
    const host = liveCityMarketHost("pilot-a", journal);
    fixture.call.mockRejectedValueOnce({ code: "functions/deadline-exceeded" });
    await expect(host.buy(listing("buddy.medium"))).rejects.toEqual({ code: "functions/deadline-exceeded" });
    expect([...store.values()]).toEqual(["req_1"]);
    fixture.call.mockClear();
    fixture.auth.currentUser = null;
    await expect(host.buy(listing("buddy.medium"))).rejects.toEqual({ code: "unauthenticated" });
    expect(fixture.call).not.toHaveBeenCalled();
    expect([...store.values()]).toEqual(["req_1"]);
  });
  it("fails closed on a desktop-items row whose receipt this app cannot verify (schema bump)", async () => {
    const bumped = clone(hostMarket.catalog) as Record<string, any>;
    bumped.listings.find((row: any) => row.listingId === "item.repair_kit").purchase.request.schemaVersion = "desktop-items-3";
    const { journal, store } = memoryJournal();
    await expect(liveCityMarketHost("pilot-a", journal).buy(listing("item.repair_kit", bumped))).rejects.toThrow(NOT_SOLD_HERE_TEXT);
    expect(fixture.call).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
  it("critic F6: a throwing listener never turns a real charge into a refusal", async () => {
    const seen = listen();
    offs.push(subscribeHostEconomyChanged(() => { throw new Error("listener blew up"); }));
    const { journal, store } = memoryJournal();
    const reply = { ...hostMarket.purchaseReply, requestId: "req_1" };
    fixture.call.mockResolvedValueOnce({ data: reply });
    await expect(liveCityMarketHost("pilot-a", journal).buy(listing("buddy.medium"))).resolves.toEqual(reply);
    expect(store.size).toBe(0);
    expect(seen).toEqual(["pilot-a"]);
  });
  it("a reply that lands after an account switch is uncertain, not 'sign in first': no publish, requestId kept", async () => {
    const seen = listen();
    const { journal, store } = memoryJournal();
    fixture.call.mockImplementationOnce(async () => { fixture.auth.currentUser = { uid: "pilot-b" }; return { data: { ...hostMarket.purchaseReply, requestId: "req_1" } }; });
    const error = await liveCityMarketHost("pilot-a", journal).buy(listing("buddy.medium")).then(() => null, (e: unknown) => e);
    expect(error).toEqual({ code: SESSION_SWITCHED_CODE });
    expect(seen).toEqual([]);
    expect([...store.values()]).toEqual(["req_1"]);
    expect(refusalNotice(listing("buddy.medium"), error)).toEqual({ tone: "info", text: "The City did not confirm this purchase. Check the stalls below; buying again resends the same receipt." });
  });
  it("does not publish when the host refuses the buy", async () => {
    const seen = listen();
    const { journal } = memoryJournal();
    fixture.call.mockRejectedValueOnce(NOT_ENOUGH_HOLOS_REFUSAL);
    await expect(liveCityMarketHost("pilot-a", journal).buy(listing("buddy.heavy"))).rejects.toBe(NOT_ENOUGH_HOLOS_REFUSAL);
    fixture.call.mockRejectedValueOnce({ code: "functions/failed-precondition", details: { rejectionCode: "on_cooldown" } });
    await expect(liveCityMarketHost("pilot-a", journal).buy(listing("item.repair_kit"))).rejects.toBeTruthy();
    expect(seen).toEqual([]);
  });
  it("does not publish on an uncertain outcome, an unreadable reply, a switched session or a listing lite cannot send", async () => {
    const seen = listen();
    const { journal } = memoryJournal();
    const host = liveCityMarketHost("pilot-a", journal);
    fixture.call.mockRejectedValueOnce({ code: "functions/deadline-exceeded" });
    await expect(host.buy(listing("buddy.medium"))).rejects.toEqual({ code: "functions/deadline-exceeded" });
    fixture.call.mockResolvedValueOnce({ data: null });
    await expect(host.buy(listing("item.repair_kit"))).rejects.toEqual({ code: UNVERIFIED_REPLY_CODE });
    fixture.call.mockImplementationOnce(async () => { fixture.auth.currentUser = { uid: "pilot-b" }; return { data: hostMarket.purchaseReply }; });
    await expect(host.buy(listing("buddy.medium"))).rejects.toEqual({ code: SESSION_SWITCHED_CODE });
    fixture.auth.currentUser = { uid: "pilot-a" };
    const forged = clone(hostMarket.catalog) as Record<string, any>;
    forged.listings[3].purchase = { callable: "deleteUserAccountV2", request: {} };
    await expect(host.buy(listing(forged.listings[3].listingId, forged))).rejects.toThrow(NOT_SOLD_IN_LITE_TEXT);
    expect(seen).toEqual([]);
  });
  it("publishes for the replayed receipt of an earlier uncertain charge, so the dashboard re-reads", async () => {
    const seen = listen();
    const { journal } = memoryJournal();
    fixture.call.mockResolvedValueOnce({ data: { ...hostMarket.purchaseReply, requestId: "req_1", alreadyProcessed: true } });
    await liveCityMarketHost("pilot-a", journal).buy(listing("buddy.medium"));
    expect(seen).toEqual(["pilot-a"]);
  });
  it("the offline fixture host never publishes", async () => {
    const seen = listen();
    const h = harness(fixtureCityMarketHost(cityMarketFixtures.CityMarket));
    await h.controller.load();
    await h.controller.confirm(h.state.catalog!.listings.find((row) => row.listingId === "buddy.medium")!);
    expect(h.view.notice?.tone).toBe("ok");
    expect(seen).toEqual([]);
  });
});

describe("market page flow (controller + reducer + presenter, host fixtures)", () => {
  it("catalog valid → listings and host Holos", async () => {
    const h = harness(fixtureCityMarketHost(cityMarketFixtures.CityMarket));
    expect(h.view.loading).toBe(true);
    await h.controller.load();
    expect(h.state.phase).toBe("ready");
    expect(h.view.holosText).toBe("5,000 HOLOS");
    expect(h.view.sections.flatMap((s) => s.rows)).toHaveLength(15);
  });
  it("catalog invalid → UNAVAILABLE + REFRESH, and refresh recovers", async () => {
    const fx: CityMarketFixture = { ...cityMarketFixtures.CityMarketUnavailable };
    const h = harness(fixtureCityMarketHost(fx));
    await h.controller.load();
    expect(h.view.plate).toEqual({ title: "UNAVAILABLE", body: CATALOG_INVALID_TEXT, refresh: true });
    fx.catalog = hostMarket.catalog;
    await h.controller.load();
    expect(h.view.plate).toBeNull();
  });
  it("host offline → UNAVAILABLE with a connection message; signed-out reply → SIGN IN FIRST", async () => {
    const offline = harness(fixtureCityMarketHost({ signedIn: true, catalogError: { code: "functions/unavailable" } }));
    await offline.controller.load();
    expect(offline.view.plate?.body).toBe("The market is offline. Check your connection and refresh.");
    const expired = harness(fixtureCityMarketHost({ signedIn: true, catalogError: { code: "functions/unauthenticated" } }));
    await expired.controller.load();
    expect(expired.view.plate?.title).toBe("SIGN IN FIRST");
  });
  it("signed out → SIGN IN FIRST plate and no host read", async () => {
    const h = harness(null);
    await h.controller.load();
    expect(h.view.plate).toEqual({ title: "SIGN IN FIRST", body: expect.any(String), refresh: false });
    expect(h.events).toEqual(["signedOut"]);
  });
  it("purchase accepted → BUY → CONFIRM → one call → catalog re-read redraws from the host", async () => {
    const { host } = spyHost(cityMarketFixtures.CityMarket);
    const h = harness(host);
    await h.controller.load();
    h.select("buddy.medium");
    const medium = h.state.catalog!.listings.find((row) => row.listingId === "buddy.medium")!;
    const first = h.controller.confirm(medium);
    expect(await h.controller.confirm(medium)).toBe(false); // a double tap never sends twice
    await first;
    expect(host.buy).toHaveBeenCalledTimes(1);
    expect(host.buy).toHaveBeenCalledWith(medium);
    expect(host.readCatalog).toHaveBeenCalledTimes(2);
    expect(h.events).toEqual(["loadStarted", "loaded", "purchaseStarted", "purchaseFinished", "loadStarted", "loaded"]);
    expect(h.view.notice).toEqual({ tone: "ok", text: "PURCHASE CONFIRMED · Medium Buddy Unit" });
    expect(h.view.holosText).toBe("4,700 HOLOS");
    expect(h.view.sections.flatMap((s) => s.rows).find((r) => r.listingId === "buddy.medium")!.metaText).toBe("OWNED 1 · IN STOCK");
    expect(h.view.confirm).toBeNull();
  });
  it("purchase refused → player copy (never the raw code), catalog still re-read", async () => {
    const { host } = spyHost(cityMarketFixtures.CityMarketRefused);
    const h = harness(host);
    await h.controller.load();
    h.select("buddy.heavy");
    await h.controller.confirm(h.state.catalog!.listings.find((row) => row.listingId === "buddy.heavy")!);
    expect(h.view.notice).toEqual({ tone: "refused", text: "Not enough Holos." });
    expect(host.readCatalog).toHaveBeenCalledTimes(2);
    expect(h.view.holosText).toBe("5,000 HOLOS");
  });
  it("a failed re-read after a purchase shows UNAVAILABLE, never the stale catalog", async () => {
    let reads = 0;
    const host: CityMarketHost = { readCatalog: async () => { if (++reads > 1) throw { code: "functions/unavailable" }; return hostMarket.catalog; }, buy: async () => hostMarket.purchaseReply };
    const h = harness(host);
    await h.controller.load();
    h.select("buddy.medium");
    await h.controller.confirm(h.state.catalog!.listings.find((row) => row.listingId === "buddy.medium")!);
    expect(h.state.catalog).toBeNull();
    expect(h.view.plate?.title).toBe("UNAVAILABLE");
    expect(h.view.notice?.text).toBe("PURCHASE CONFIRMED · Medium Buddy Unit");
    expect(h.view.holosText).toBeNull();
  });
});
