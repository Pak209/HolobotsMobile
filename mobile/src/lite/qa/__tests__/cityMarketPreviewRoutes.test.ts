import { describe, expect, it } from 'vitest';
import { previewInitialScreen } from '../previewRoutes';
import { previewScreenFromUrl } from '../previewDeepLink';
import { CITY_MARKET_PREVIEW_ROUTES, cityMarketFixtures, KNOWN_BAD_CATALOG } from '../cityMarketFixtures';
import { CATALOG_INVALID_TEXT, readVendorCatalog } from '../../lib/cityMarket';
import type { CityMarketFixture } from '../../lib/cityMarketClient';

// Same shape as HoloCityPreview's registry: the market routes are spread in as own keys.
const screens = { Home: null, ...Object.fromEntries(CITY_MARKET_PREVIEW_ROUTES.map(name => [name, null])) };
describe('lite market offline QA routes', () => {
  it('registers the six market witness routes', () => {
    expect(CITY_MARKET_PREVIEW_ROUTES).toEqual(['CityMarket', 'CityMarketConfirm', 'CityMarketBought', 'CityMarketRefused', 'CityMarketSignedOut', 'CityMarketUnavailable']);
  });
  it.each(CITY_MARKET_PREVIEW_ROUTES)('opens %s by env and by holobotsmobile://qa deep link', name => {
    expect(previewInitialScreen(name, screens)).toBe(name);
    expect(previewScreenFromUrl(`holobotsmobile://qa/${name}`, screens)).toBe(name);
    expect(previewScreenFromUrl(`holobotsw64://qa/${name}`, screens)).toBe(name);
  });
  it.each(['CityMarketLive', 'citymarket', 'CityMarket?account=real', 'CityMarket/extra', '__proto__'])('rejects %s', name => {
    expect(previewInitialScreen(name, screens)).toBe('Home');
    expect(previewScreenFromUrl(`holobotsmobile://qa/${name}`, screens)).toBeNull();
  });
  it('serves the host catalog except on the signed-out and known-bad routes', () => {
    for (const [name, fixture] of Object.entries(cityMarketFixtures) as [string, CityMarketFixture][]) {
      if (name === 'CityMarketSignedOut') { expect(fixture.signedIn).toBe(false); expect('catalog' in fixture).toBe(false); continue; }
      if (name === 'CityMarketUnavailable') { expect(() => readVendorCatalog(fixture.catalog, 'marketplace')).toThrow(CATALOG_INVALID_TEXT); continue; }
      expect(readVendorCatalog(fixture.catalog, 'marketplace').listings.length).toBeGreaterThan(0);
    }
    expect(KNOWN_BAD_CATALOG.schemaVersion).toBe('vendor-1');
  });
});
