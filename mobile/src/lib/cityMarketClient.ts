import { auth, functions, httpsCallable } from "@/config/firebase";
import { CALLABLE_TIMEOUT_MS, withTimeout } from "./async";
import {
  CITY_MARKET_VENDOR, VENDOR_CATALOG_CALLABLE, isSignedOutError, isUncertainOutcome, listingNeedsRequestId, listingPurchasable,
  listingPurchase, marketUnavailableText, purchaseConfirmed, purchaseNotice, readVendorCatalog, refusalNotice,
  type CityMarketEvent, type MarketNotice, type VendorListing,
} from "./cityMarket";
import { notifyHostEconomyChanged } from "./hostDashboard";

/** The two host reads/writes the market page makes. Live = Firebase callables; fixture = offline QA. */
export type CityMarketHost = { readCatalog(): Promise<unknown>; buy(listing: VendorListing): Promise<unknown> };
export type CityMarketRequestJournal = {
  acquire(uid: string, action: string): Promise<string>;
  complete(uid: string, action: string, requestId: string): Promise<void>;
};

/** Captures the session across each call so a delayed reply cannot cross accounts. */
async function marketCall(uid: string, name: string, request: Record<string, unknown>): Promise<unknown> {
  if (!uid || auth.currentUser?.uid !== uid) throw { code: "unauthenticated" };
  const reply = await withTimeout(httpsCallable<Record<string, unknown>, unknown>(functions, name)(request), CALLABLE_TIMEOUT_MS,
    name === VENDOR_CATALOG_CALLABLE ? "The market host is taking too long. Refresh to retry." : "The market host did not confirm this purchase in time.");
  if (auth.currentUser?.uid !== uid) throw { code: "unauthenticated" };
  return reply.data;
}

export const NOT_SOLD_IN_LITE_TEXT = "This listing is sold on the desktop app only.";
const journalAction = (listing: VendorListing) => `vendor:${CITY_MARKET_VENDOR}:${listing.listingId}`;

/**
 * Live host for one signed-in pilot. A listing whose request carries "<client-generated>" gets a
 * journaled requestId: kept after an uncertain outcome (so a resend replays the same receipt and
 * never buys twice), cleared after any host verdict. Other listings are sent exactly as named and
 * are never retried automatically (the legacy purchase callables are not idempotent).
 * Only a confirmed purchase reply publishes the economy-change signal, so the dashboard re-reads its
 * Holos; a refusal, an uncertain outcome or an unreadable reply never does.
 */
export function liveCityMarketHost(uid: string, journal: CityMarketRequestJournal): CityMarketHost {
  return {
    readCatalog: () => marketCall(uid, VENDOR_CATALOG_CALLABLE, { operation: "catalog", vendorId: CITY_MARKET_VENDOR }),
    async buy(listing) {
      if (!listingPurchasable(listing)) throw new Error(NOT_SOLD_IN_LITE_TEXT);
      const action = journalAction(listing);
      const requestId = listingNeedsRequestId(listing) ? await journal.acquire(uid, action) : undefined;
      const call = listingPurchase(listing, requestId);
      if (!call) throw new Error("This listing could not be bought.");
      const settle = async () => { if (requestId) { try { await journal.complete(uid, action, requestId); } catch { /* a stale id only replays a receipt */ } } };
      let reply: unknown;
      try {
        reply = await marketCall(uid, call.callable, call.request);
      } catch (error) {
        if (!isUncertainOutcome(error)) await settle();
        throw error;
      }
      await settle();
      if (purchaseConfirmed(reply)) notifyHostEconomyChanged(uid);
      return reply;
    },
  };
}

export type CityMarketFixture = {
  signedIn: boolean;
  /** The host's own catalog output (or a known-bad edit of it). */
  catalog?: unknown;
  catalogError?: unknown;
  purchase?: { outcome: "accepted"; reply: unknown; catalogAfter: unknown } | { outcome: "refused"; error: unknown };
  /** Witness seam: open the confirm plate on, or buy, one listing once the first catalog renders. */
  open?: { confirm?: string; buy?: string };
};

/** Offline QA host. Serves recorded host replies only; never computes a price, balance or result. */
export function fixtureCityMarketHost(fixture: CityMarketFixture): CityMarketHost {
  let accepted = false;
  return {
    async readCatalog() {
      if (fixture.catalogError !== undefined) throw fixture.catalogError;
      return accepted && fixture.purchase?.outcome === "accepted" ? fixture.purchase.catalogAfter : fixture.catalog;
    },
    async buy() {
      if (!fixture.purchase) throw new Error("Offline preview: purchases are disconnected.");
      if (fixture.purchase.outcome === "refused") throw fixture.purchase.error;
      accepted = true;
      return fixture.purchase.reply;
    },
  };
}

/**
 * load(): read the catalog and replace the page with the reply (or UNAVAILABLE / signed out).
 * confirm(listing): one purchase at a time through the listing's own call, then always re-read.
 */
export function createCityMarketController(host: CityMarketHost | null, dispatch: (event: CityMarketEvent) => void) {
  let busy = false;
  let serial = 0;
  async function load(): Promise<void> {
    if (!host) { dispatch({ type: "signedOut" }); return; }
    const read = ++serial;
    dispatch({ type: "loadStarted" });
    try {
      const catalog = readVendorCatalog(await host.readCatalog(), CITY_MARKET_VENDOR);
      if (read === serial) dispatch({ type: "loaded", catalog });
    } catch (error) {
      if (read === serial) dispatch(isSignedOutError(error) ? { type: "signedOut" } : { type: "loadFailed", text: marketUnavailableText(error) });
    }
  }
  async function confirm(listing: VendorListing): Promise<boolean> {
    if (!host || busy) return false;
    busy = true;
    try {
      dispatch({ type: "purchaseStarted", listingId: listing.listingId });
      let notice: MarketNotice;
      try { notice = purchaseNotice(listing, await host.buy(listing)); } catch (error) { notice = refusalNotice(listing, error); }
      dispatch({ type: "purchaseFinished", notice });
      await load();
      return true;
    } finally {
      busy = false;
    }
  }
  return { load, confirm, get busy() { return busy; } };
}
