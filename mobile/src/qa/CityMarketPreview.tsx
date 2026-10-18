import { CityMarketplaceScreen } from "@/screens/CityMarketplaceScreen";
import { cityMarketFixtures } from "./cityMarketFixtures";

/** Offline QA routes for the lite Marketplace (holobotsmobile://qa/CityMarket…). Recorded host replies only; no host call. */
export const cityMarketPreviewScreens = Object.fromEntries(Object.entries(cityMarketFixtures).map(([name, fixture]) => [
  name, function CityMarketPreview() { return <CityMarketplaceScreen fixture={fixture} />; },
]));
