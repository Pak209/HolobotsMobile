import { describe, expect, it } from 'vitest';
import { ARENA_CAPTURE_ROUTES, previewInitialScreen } from '../previewRoutes';
const screens = { Home: null, ...Object.fromEntries(ARENA_CAPTURE_ROUTES.map(route => [route.name, null])) };
describe('offline QA startup routing', () => {
  it.each(ARENA_CAPTURE_ROUTES)('selects registered $name', ({name}) => {
    expect(previewInitialScreen(name, screens)).toBe(name);
  });
  it.each([undefined, '', 'Unknown', 'constructor', '__proto__', 'ArenaAdmittedRound?account=real'])('rejects unregistered %s', name => {
    expect(previewInitialScreen(name, screens)).toBe('Home');
  });
  it('orders the calibration before round and terminal modal', () => {
    expect(ARENA_CAPTURE_ROUTES.map(route => route.name)).toEqual(['ArenaAdmittedKnownBad', 'ArenaAdmittedRound', 'ArenaAdmittedResult']);
  });
});
