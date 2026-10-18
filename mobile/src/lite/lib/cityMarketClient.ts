import { auth, functions, httpsCallable } from "@/config/firebase";
import { CALLABLE_TIMEOUT_MS, withTimeout } from "../../lib/async";
import {
  CITY_MARKET_VENDOR, VENDOR_CATALOG_CALLABLE, isSignedOutError, isUncertainOutcome, listingBlock,
  listingPurchase, marketUnavailableText, purchaseConfirmed, purchaseNotice, readVendorCatalog, refusalNotice, SESSION_SWITCHED_CODE, UNVERIFIED_REPLY_CODE,
  type CityMarketEvent, type MarketNotice, type VendorListing,
} from "./cityMarket";
import { notifyHostEconomyChanged } from "./hostDashboard";

/** The two host reads/writes the market page makes. Live = Firebase callables; fixture = offline QA. */
export type CityMarketHost = { readCatalog(): Promise<unknown>; buy(listing: VendorListing): Promise<unknown> };
export type CityMarketRequestJournal = {
  acquire(uid: string, action: string): Promise<string>;
  complete(uid: string, action: string, requestId: string): Promise<void>;
};

/**
 * Captures the session across each call so a delayed reply cannot cross accounts. A purchase reply that
 * lands after an account switch is an uncertain outcome (it may have charged the previous pilot), not
 * "sign in first": the journal keeps its requestId so that pilot's resend replays the same receipt.
 */
async function marketCall(uid: string, name: string, request: Record<string, unknown>, purchase = false): Promise<unknown> {
  if (!uid || auth.currentUser?.uid !== uid) throw { code: "unauthenticated" };
  // PLACEHOLDER copy (Lex, DECISIONS #71).
  const reply = await withTimeout(httpsCallable<Record<string, unknown>, unknown>(functions, name)(request), CALLABLE_TIMEOUT_MS,
    name === VENDOR_CATALOG_CALLABLE ? "The market is taking too long. Refresh to retry." : "The City did not confirm this purchase in time.");
  if (auth.currentUser?.uid !== uid) throw { code: purchase ? SESSION_SWITCHED_CODE : "unauthenticated" };
  return reply.data;
}

// PLACEHOLDER copy (Lex, DECISIONS #71).
export const NOT_SOLD_IN_LITE_TEXT = "This listing is sold on the desktop app only.";
export const NOT_SOLD_HERE_TEXT = "This stall can't take this order in this app yet.";
const journalAction = (listing: VendorListing) => `vendor:${CITY_MARKET_VENDOR}:${listing.listingId}`;

/**
 * Live host for one signed-in pilot. Only a listing whose request carries "<client-generated>" is
 * sent (S12); it gets a journaled requestId: kept after an uncertain outcome (so a resend replays
 * the same receipt and never buys twice), cleared after any host verdict. The legacy itemName /
 * packId purchases are not idempotent and never leave the app.
 * Only a confirmed purchase reply publishes the economy-change signal, so the dashboard re-reads its
 * Holos; a refusal, an uncertain outcome or an unreadable reply never does.
 */
export function liveCityMarketHost(uid: string, journal: CityMarketRequestJournal): CityMarketHost {
  return {
    readCatalog: () => marketCall(uid, VENDOR_CATALOG_CALLABLE, { operation: "catalog", vendorId: CITY_MARKET_VENDOR }),
    async buy(listing) {
      const block = listingBlock(listing);
      if (block) throw new Error(block === "desktop_only" ? NOT_SOLD_IN_LITE_TEXT : NOT_SOLD_HERE_TEXT);
      // A stale session sends nothing and leaves the journal alone (a kept requestId must survive).
      if (!uid || auth.currentUser?.uid !== uid) throw { code: "unauthenticated" };
      const action = journalAction(listing);
      const requestId = await journal.acquire(uid, action);
      const call = listingPurchase(listing, requestId);
      if (!call) throw new Error("This listing could not be bought.");
      const settle = async () => { try { await journal.complete(uid, action, requestId); } catch { /* a stale id only replays a receipt */ } };
      let reply: unknown;
      try {
        reply = await marketCall(uid, call.callable, call.request, true);
      } catch (error) {
        // Only the City's verdict clears the requestId; no verdict (timeout, switch, sign-out) keeps it.
        if (!isUncertainOutcome(error) && !isSignedOutError(error)) await settle();
        throw error;
      }
      // Anything but this purchase's own receipt is no verdict either: keep the requestId (a resend
      // replays the receipt), publish nothing, and let the page say the City did not confirm.
      if (!purchaseConfirmed(listing, reply, requestId)) throw { code: UNVERIFIED_REPLY_CODE };
      await settle();
      // A listener must never turn a real charge into a refusal: the signal is best-effort.
      try { notifyHostEconomyChanged(uid); } catch { /* listeners re-read on focus */ }
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
