import { describe, expect, it } from 'vitest';
import { PREVIEW_URL_SCHEMES, previewScreenFromUrl } from '../previewDeepLink';

const screens = { Home: null, ArenaAdmittedKnownBad: null, ArenaAdmittedRound: null, ArenaAdmittedResult: null };

describe('offline QA deep links', () => {
  it.each(PREVIEW_URL_SCHEMES)('opens a registered screen via %s://', scheme => {
    expect(previewScreenFromUrl(`${scheme}://qa/ArenaAdmittedRound`, screens)).toBe('ArenaAdmittedRound');
  });
  it('accepts the cached w64 app scheme', () => {
    expect(previewScreenFromUrl('holobotsw64://qa/ArenaAdmittedResult', screens)).toBe('ArenaAdmittedResult');
  });
  it.each([
    null, undefined, '', 'holobotsmobile://qa/Unknown', 'holobotsmobile://qa/constructor', 'holobotsmobile://qa/__proto__',
    'https://qa/ArenaAdmittedRound', 'evil://qa/ArenaAdmittedRound', 'holobotsmobile://other/ArenaAdmittedRound',
    'holobotsmobile://qa/ArenaAdmittedRound?account=real', 'holobotsmobile://qa/ArenaAdmittedRound/extra',
  ])('rejects %s', url => {
    expect(previewScreenFromUrl(url, screens)).toBeNull();
  });
});
