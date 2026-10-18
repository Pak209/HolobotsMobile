/**
 * HoloCity-lite Marketplace: a strict reader and presenter for the host's vendor-3 catalog
 * (HolobotsMobile functions/src/lib/vendors.ts buildCatalog, served by vendorCatalogHost).
 *
 * Presentation only (hard rule 1). Every price, owned count, stock flag, affordability flag and
 * Holos balance shown here is the host's. Nothing in this module computes one. A listing is
 * bought by sending ITS OWN purchase {callable, request}. The page then re-reads the catalog
 * and redraws from that reply, never from a local prediction.
 *
 * Mirrors Unity's VendorCatalogContract (HolobotsUnity Assets/Holobots/Shared/Scripts/Runtime/
 * Dashboard/VendorCatalogContract.cs), with one deliberate difference: a well-formed listing
 * whose callable this app cannot send is shown as not purchasable. Unity fails the whole
 * catalog instead. The live marketplace catalog names desktopItemsHost (healing items) and,
 * when the expedition config is on, holoZoneHost.
 */
import { record } from "./cityHub";

export const VENDOR_SCHEMA = "vendor-3";
export const VENDOR_CATALOG_CALLABLE = "vendorCatalogHost";
export const CITY_MARKET_VENDOR = "marketplace";
export const VENDOR_IDS = ["marketplace", "workshop", "boutique"] as const;
export type VendorId = (typeof VENDOR_IDS)[number];
export const LISTING_KINDS = ["item", "booster", "buddy_unit", "part", "clothing"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];
export const REQUEST_ID_PLACEHOLDER = "<client-generated>";
export const REQUEST_ID_RULE = /^[a-zA-Z0-9_-]{1,128}$/;
const INVENTORY_FIELDS = ["arenaPasses", "gachaTickets", "energyRefills", "expBoosters", "rankSkips", "wildcardBlueprints", "parts"] as const;

/**
 * The purchase callables this app may send. `operation` pins the request's operation field
 * for multi-operation hosts, so a catalog row can never make the app "use" or "favorite".
 * wardrobeHost (boutique) and holoZoneHost (expedition supplies) are not sent from lite.
 */
export const LITE_PURCHASE_CALLABLES: Readonly<Record<string, { operation?: string }>> = {
  purchaseMarketplaceItem: {},
  purchaseMarketplaceBooster: {},
  purchaseMarketplacePart: {},
  purchaseBuddyUnit: {},
  desktopItemsHost: { operation: "buy" },
};

export type VendorListing = {
  listingId: string;
  kind: ListingKind;
  displayName: string;
  price: number;
  currency: "holos";
  quantity: number;
  owned: number;
  affordable: boolean;
  available: boolean;
  availableAtMs: number;
  details: Record<string, string | string[]>;
  purchase: { callable: string; request: Record<string, unknown> };
};
export type VendorInventory = Record<(typeof INVENTORY_FIELDS)[number], number> & { buddyUnits: { light: number; medium: number; heavy: number } };
export type VendorCatalog = { schemaVersion: typeof VENDOR_SCHEMA; vendorId: VendorId; holosTokens: number; inventory: VendorInventory; listings: VendorListing[] };

/** PLACEHOLDER copy (Lex): every player-facing string on the lite market. Prices, names and counts are never copy. */
export const CITY_MARKET_COPY = {
  hubCaption: "BROWSE THE STALLS",
  kicker: "HOLOCITY / MARKETPLACE",
  title: "BROWSE THE STALLS.",
  vendorName: "MARKETPLACE STALLS",
  intro: "Supplies, booster packs and Buddy Units. The city host sets every price and keeps your stock.",
  status: "HOST CATALOG",
  backLabel: "Back to the city",
  loading: "READING THE STALLS…",
  signedOutTitle: "SIGN IN FIRST",
  signedOutBody: "The market host prices every stall for your account. Sign in to browse.",
  unavailableTitle: "UNAVAILABLE",
  refresh: "REFRESH",
  refreshing: "REFRESHING…",
  refreshStalls: "REFRESH STALLS",
  footer: "PRICES, STOCK AND HOLOS COME FROM THE CITY HOST.",
  confirmBody: "Your Holos and stock update after the host confirms.",
  confirm: "CONFIRM",
  cancel: "CANCEL",
  buy: "BUY",
  buying: "CONFIRMING…",
  needHolos: "NEED HOLOS",
  restocking: "RESTOCKING",
  soldOut: "SOLD OUT",
  desktopOnly: "DESKTOP ONLY",
  inStock: "IN STOCK",
  sections: { item: "SUPPLIES", booster: "BOOSTER PACKS", buddy_unit: "BUDDY UNITS", part: "PARTS", clothing: "CLOTHING" } as Record<ListingKind, string>,
} as const;

export const CATALOG_INVALID_TEXT = "The market catalog could not be verified. Refresh to retry.";

const nonNeg = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const str = (value: unknown): value is string => typeof value === "string";
const bool = (value: unknown): value is boolean => typeof value === "boolean";
const own = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key);

function readDetails(value: unknown): Record<string, string | string[]> | null {
  const details = record(value);
  if (!details) return null;
  const out: Record<string, string | string[]> = {};
  for (const [key, entry] of Object.entries(details)) {
    if (str(entry)) out[key] = entry;
    else if (Array.isArray(entry) && entry.every(str)) out[key] = [...entry];
    else return null;
  }
  return out;
}

function readListing(value: unknown): VendorListing | null {
  const row = record(value);
  if (!row || !str(row.listingId) || !row.listingId || !str(row.kind) || !(LISTING_KINDS as readonly string[]).includes(row.kind) || !str(row.displayName)) return null;
  if (!nonNeg(row.price) || row.currency !== "holos" || !nonNeg(row.quantity) || !nonNeg(row.owned)) return null;
  if (!bool(row.affordable) || !bool(row.available) || !nonNeg(row.availableAtMs)) return null;
  const details = readDetails(row.details);
  const purchase = record(row.purchase);
  const request = record(purchase?.request);
  if (!details || !purchase || !str(purchase.callable) || !purchase.callable || !request) return null;
  let requestCopy: Record<string, unknown>;
  try { requestCopy = JSON.parse(JSON.stringify(request)); } catch { return null; }
  return {
    listingId: row.listingId, kind: row.kind as ListingKind, displayName: row.displayName, price: row.price, currency: "holos",
    quantity: row.quantity, owned: row.owned, affordable: row.affordable, available: row.available, availableAtMs: row.availableAtMs,
    details, purchase: { callable: purchase.callable, request: requestCopy },
  };
}

/** Fail-closed: anything that is not exactly the shape the host builds throws CATALOG_INVALID_TEXT. */
export function readVendorCatalog(value: unknown, expectedVendor: VendorId): VendorCatalog {
  const fail = (): never => { throw new Error(CATALOG_INVALID_TEXT); };
  const reply = record(value);
  if (!reply || reply.schemaVersion !== VENDOR_SCHEMA || reply.vendorId !== expectedVendor || !nonNeg(reply.holosTokens)) return fail();
  const inv = record(reply.inventory);
  const buddy = record(inv?.buddyUnits);
  if (!inv || !buddy || !INVENTORY_FIELDS.every((field) => nonNeg(inv[field])) || !nonNeg(buddy.light) || !nonNeg(buddy.medium) || !nonNeg(buddy.heavy)) return fail();
  if (!Array.isArray(reply.listings)) return fail();
  const ids = new Set<string>();
  const listings = (reply.listings as unknown[]).map((entry) => {
    const listing = readListing(entry);
    if (!listing || ids.has(listing.listingId)) return fail();
    ids.add(listing.listingId);
    return listing;
  });
  const counts = Object.fromEntries(INVENTORY_FIELDS.map((field) => [field, inv[field] as number])) as Record<(typeof INVENTORY_FIELDS)[number], number>;
  const inventory: VendorInventory = { ...counts, buddyUnits: { light: buddy.light as number, medium: buddy.medium as number, heavy: buddy.heavy as number } };
  return { schemaVersion: VENDOR_SCHEMA, vendorId: expectedVendor, holosTokens: reply.holosTokens, inventory, listings };
}

/** True when this app may send the listing's own purchase call. A capability check, never an economy rule. */
export function listingPurchasable(listing: VendorListing): boolean {
  const rule = own(LITE_PURCHASE_CALLABLES, listing.purchase.callable) ? LITE_PURCHASE_CALLABLES[listing.purchase.callable] : undefined;
  if (!rule) return false;
  return rule.operation === undefined || listing.purchase.request.operation === rule.operation;
}
export function listingNeedsRequestId(listing: VendorListing): boolean {
  return Object.values(listing.purchase.request).some((value) => value === REQUEST_ID_PLACEHOLDER);
}
/** The exact request the listing names, with each "<client-generated>" value replaced by requestId. Null when it may not be sent. */
export function listingPurchase(listing: VendorListing, requestId?: string): { callable: string; request: Record<string, unknown> } | null {
  if (!listingPurchasable(listing)) return null;
  if (listingNeedsRequestId(listing) && (!str(requestId) || !REQUEST_ID_RULE.test(requestId))) return null;
  const request: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(listing.purchase.request)) request[key] = value === REQUEST_ID_PLACEHOLDER ? requestId : value;
  return { callable: listing.purchase.callable, request };
}

function errorCode(error: unknown): string {
  return String(record(error)?.code ?? "");
}
export function hostRejectionCode(error: unknown): string | null {
  const code = record(record(error)?.details)?.rejectionCode;
  return str(code) && /^[a-z0-9_]{1,64}$/.test(code) ? code : null;
}
export function isSignedOutError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "unauthenticated" || code === "functions/unauthenticated";
}
const UNCERTAIN_CODES = new Set(["functions/unavailable", "functions/deadline-exceeded", "functions/internal", "functions/unknown", "functions/cancelled"]);
/** No host verdict reached the app (timeout, network, crash): the purchase may or may not have happened. */
export function isUncertainOutcome(error: unknown): boolean {
  if (hostRejectionCode(error) || isSignedOutError(error)) return false;
  const code = errorCode(error);
  return !code || UNCERTAIN_CODES.has(code);
}

const REFUSAL_TEXT: Record<string, string> = {
  not_enough_holos: "Not enough Holos.",
  on_cooldown: "This stall restocks weekly.",
  unknown_item: "This listing is no longer sold. Refresh the stalls.",
  invalid_request: "The host refused this request.",
  sequence_conflict: "This purchase id was already used. Refresh and try again.",
  unavailable: "Your account is unavailable right now.",
  between_battles_only: "Finish your expedition before buying this.",
};
export type MarketNotice = { tone: "ok" | "refused" | "info"; text: string };

/** A purchase reply the app reads as the host's confirmation (a fresh charge or the replayed receipt of one); purchaseNotice's "ok". */
export function purchaseConfirmed(reply: unknown): boolean {
  return record(reply) !== null;
}
export function purchaseNotice(listing: VendorListing, reply: unknown): MarketNotice {
  const body = record(reply);
  if (!body) return { tone: "info", text: "The host reply could not be verified. Check the stalls before buying again." };
  return { tone: "ok", text: `${body.alreadyProcessed === true ? "ALREADY CONFIRMED" : "PURCHASE CONFIRMED"} · ${listing.displayName}` };
}
export function refusalNotice(listing: VendorListing, error: unknown): MarketNotice {
  if (isSignedOutError(error)) return { tone: "refused", text: "Sign in first, then reopen the market." };
  const code = hostRejectionCode(error);
  if (code) return { tone: "refused", text: REFUSAL_TEXT[code] ? `REFUSED · ${code} — ${REFUSAL_TEXT[code]}` : `REFUSED · ${code}` };
  if (isUncertainOutcome(error)) {
    return { tone: "info", text: listingNeedsRequestId(listing)
      ? "The host did not confirm this purchase. Check the stalls below; buying again resends the same receipt."
      : "The host did not confirm this purchase. Check the stalls below before buying again." };
  }
  return { tone: "refused", text: error instanceof Error && error.message ? error.message : "The host refused this purchase." };
}
export function marketUnavailableText(error: unknown): string {
  if (error instanceof Error && error.message === CATALOG_INVALID_TEXT) return CATALOG_INVALID_TEXT;
  const code = errorCode(error);
  if (code === "functions/not-found") return "The market host is not available yet. Please try again after the service update.";
  if (hostRejectionCode(error) === "unavailable") return "The market host could not read your account. Refresh to retry.";
  if (!code || UNCERTAIN_CODES.has(code)) return "The market host is offline. Check your connection and refresh.";
  return "The market could not be read. Refresh to retry.";
}

export type CityMarketState = {
  phase: "signed_out" | "loading" | "ready" | "unavailable";
  catalog: VendorCatalog | null;
  refreshing: boolean;
  confirming: string | null;
  buying: string | null;
  notice: MarketNotice | null;
  unavailableText: string | null;
};
export type CityMarketEvent =
  | { type: "signedOut" }
  | { type: "loadStarted" }
  | { type: "loaded"; catalog: VendorCatalog }
  | { type: "loadFailed"; text: string }
  | { type: "select"; listingId: string }
  | { type: "cancel" }
  | { type: "purchaseStarted"; listingId: string }
  | { type: "purchaseFinished"; notice: MarketNotice };

export function initialCityMarketState(signedIn: unknown): CityMarketState {
  return { phase: signedIn ? "loading" : "signed_out", catalog: null, refreshing: false, confirming: null, buying: null, notice: null, unavailableText: null };
}
function buyable(listing: VendorListing | undefined): listing is VendorListing {
  return !!listing && listing.available && listing.affordable && listingPurchasable(listing);
}
const find = (catalog: VendorCatalog | null, id: string | null) => (id ? catalog?.listings.find((listing) => listing.listingId === id) : undefined);

export function cityMarketReducer(state: CityMarketState, event: CityMarketEvent): CityMarketState {
  switch (event.type) {
    case "signedOut": return initialCityMarketState(false);
    case "loadStarted":
      if (state.phase === "signed_out") return state;
      return state.catalog ? { ...state, refreshing: true } : { ...state, phase: "loading", refreshing: false, unavailableText: null };
    case "loaded": {
      if (state.phase === "signed_out") return state;
      const keep = state.buying || buyable(find(event.catalog, state.confirming)) ? state.confirming : null;
      return { ...state, phase: "ready", catalog: event.catalog, refreshing: false, confirming: keep, unavailableText: null };
    }
    case "loadFailed":
      if (state.phase === "signed_out") return state;
      return { ...state, phase: "unavailable", catalog: null, refreshing: false, confirming: null, unavailableText: event.text };
    case "select":
      if (state.phase !== "ready" || state.refreshing || state.buying || !buyable(find(state.catalog, event.listingId))) return state;
      return { ...state, confirming: event.listingId, notice: null };
    case "cancel":
      return state.buying ? state : { ...state, confirming: null };
    case "purchaseStarted":
      if (state.phase !== "ready" || state.buying || state.confirming !== event.listingId) return state;
      return { ...state, buying: event.listingId, notice: null };
    case "purchaseFinished":
      return { ...state, buying: null, confirming: null, notice: event.notice };
  }
}

export function formatHostNumber(value: number): string {
  return Number.isInteger(value) ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : String(value);
}

export type CityMarketRowView = { listingId: string; title: string; priceText: string; metaText: string; detailText: string | null; action: { label: string; enabled: boolean } };
export type CityMarketView = {
  holosText: string;
  loading: boolean;
  refreshing: boolean;
  refreshEnabled: boolean;
  plate: { title: string; body: string; refresh: boolean } | null;
  sections: { kind: ListingKind; title: string; rows: CityMarketRowView[] }[];
  confirm: { listingId: string; text: string; body: string; enabled: boolean } | null;
  notice: MarketNotice | null;
};

function detailText(listing: VendorListing): string | null {
  const { details } = listing;
  if (listing.kind === "booster" && str(details.bonusItem)) return `BONUS · ${details.bonusItem.toUpperCase()}`;
  if (listing.kind === "item" && str(details.healFraction) && Number.isFinite(Number(details.healFraction))) return `HEALS ${Math.round(Number(details.healFraction) * 100)}% HP`;
  if (listing.kind === "part" && str(details.rarity) && str(details.slot)) return `${details.rarity} · ${details.slot}`.toUpperCase();
  return null;
}
function rowAction(state: CityMarketState, listing: VendorListing): { label: string; enabled: boolean } {
  const copy = CITY_MARKET_COPY;
  if (state.buying === listing.listingId) return { label: copy.buying, enabled: false };
  if (!listingPurchasable(listing)) return { label: copy.desktopOnly, enabled: false };
  if (!listing.available) return { label: listing.availableAtMs > 0 ? copy.restocking : copy.soldOut, enabled: false };
  if (!listing.affordable) return { label: copy.needHolos, enabled: false };
  return { label: copy.buy, enabled: state.phase === "ready" && !state.refreshing && !state.buying };
}

/** Every string the screen renders, from the state alone. */
export function presentCityMarket(state: CityMarketState): CityMarketView {
  const copy = CITY_MARKET_COPY;
  const catalog = state.phase === "ready" ? state.catalog : null;
  const sections: CityMarketView["sections"] = [];
  for (const listing of catalog?.listings ?? []) {
    let section = sections.find((entry) => entry.kind === listing.kind);
    if (!section) { section = { kind: listing.kind, title: copy.sections[listing.kind], rows: [] }; sections.push(section); }
    const meta = [listing.kind === "booster" ? null : `OWNED ${formatHostNumber(listing.owned)}`, listing.available ? copy.inStock : null].filter(Boolean).join(" · ");
    section.rows.push({
      listingId: listing.listingId,
      title: listing.displayName.toUpperCase(),
      priceText: `${formatHostNumber(listing.price)} HOLOS${listing.quantity > 1 ? ` · ×${formatHostNumber(listing.quantity)} PER BUY` : ""}`,
      metaText: meta,
      detailText: detailText(listing),
      action: rowAction(state, listing),
    });
  }
  const confirming = find(catalog, state.confirming);
  return {
    holosText: catalog ? `${formatHostNumber(catalog.holosTokens)} HOLOS` : "— HOLOS",
    loading: state.phase === "loading",
    refreshing: state.refreshing,
    refreshEnabled: (state.phase === "ready" || state.phase === "unavailable") && !state.refreshing && !state.buying,
    plate: state.phase === "signed_out" ? { title: copy.signedOutTitle, body: copy.signedOutBody, refresh: false }
      : state.phase === "unavailable" ? { title: copy.unavailableTitle, body: state.unavailableText ?? CATALOG_INVALID_TEXT, refresh: true } : null,
    sections,
    confirm: confirming ? {
      listingId: confirming.listingId,
      text: `BUY ${confirming.displayName.toUpperCase()}${confirming.quantity > 1 ? ` ×${formatHostNumber(confirming.quantity)}` : ""} FOR ${formatHostNumber(confirming.price)} HOLOS?`,
      body: copy.confirmBody,
      enabled: !state.buying && !state.refreshing,
    } : null,
    notice: state.notice,
  };
}
