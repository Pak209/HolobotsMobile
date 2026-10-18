/**
 * Offline QA fixtures for the lite Marketplace (CityMarketplaceScreen). Every catalog and reply is the
 * HOST builders' own output (see fixtures/city-market-vendor-3.json `_source`; cityMarket.test.ts rebuilds
 * it). Never used as a live fallback. Route names follow the #126 allowlist: holobotsmobile://qa/<Route>.
 */
import type { CityMarketFixture } from "@/lite/lib/cityMarketClient";
import hostMarket from "./fixtures/city-market-vendor-3.json";

export const CITY_MARKET_HOST_FIXTURE = hostMarket;
const accepted = { outcome: "accepted" as const, reply: hostMarket.purchaseReply, catalogAfter: hostMarket.catalogAfter };
/** The host's not_enough_holos refusal as the Firebase SDK surfaces it (HTTPS failed-precondition + details.rejectionCode). */
export const NOT_ENOUGH_HOLOS_REFUSAL = { code: "functions/failed-precondition", message: "Not enough Holos.", details: { rejectionCode: "not_enough_holos" } };
/** Known-bad control: the host catalog with a pre-vendor-3 schema string must render UNAVAILABLE. */
export const KNOWN_BAD_CATALOG = { ...hostMarket.catalog, schemaVersion: "vendor-1" };

export const cityMarketFixtures = {
  CityMarket: { signedIn: true, catalog: hostMarket.catalog, purchase: accepted },
  CityMarketConfirm: { signedIn: true, catalog: hostMarket.catalog, purchase: accepted, open: { confirm: "buddy.medium" } },
  CityMarketBought: { signedIn: true, catalog: hostMarket.catalog, purchase: accepted, open: { buy: "buddy.medium" } },
  CityMarketRefused: { signedIn: true, catalog: hostMarket.catalog, purchase: { outcome: "refused", error: NOT_ENOUGH_HOLOS_REFUSAL }, open: { buy: "buddy.heavy" } },
  CityMarketSignedOut: { signedIn: false },
  CityMarketUnavailable: { signedIn: true, catalog: KNOWN_BAD_CATALOG },
} satisfies Record<string, CityMarketFixture>;
export type CityMarketRoute = keyof typeof cityMarketFixtures;
export const CITY_MARKET_PREVIEW_ROUTES = Object.keys(cityMarketFixtures) as CityMarketRoute[];
