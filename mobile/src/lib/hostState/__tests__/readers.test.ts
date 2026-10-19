import { describe, expect, it } from 'vitest';
import { buildDesktopAccountReply } from '../../../../../functions/src/desktop/desktopAccountReply';
import { readDesktopStoryState, readHostOnboarding, readHostStoryFlags, readRivalRetryAfterMs, remainingCooldownMs } from '../readers';
const defaults = { arenaGatheringSeen: false, tournamentsWon: 0, arenaArcBuilt: false, holoZonesArcBuilt: false };
describe('desktop host progress reader', () => {
  it.each(['desktop-account-1', 'desktop-account-2', 'desktop-account-3'] as const)('consumes real %s host replies at every tournament stage', schema => {
    for (const wins of [0, 1, 2, 3]) {
      const flags = { ...defaults, arenaGatheringSeen: true, tournamentsWon: wins, arenaArcBuilt: wins === 3 };
      const raw = buildDesktopAccountReply({ storyFlags: flags }, 'demo-reader', schema, { light: 1, medium: 0, heavy: 0 });
      expect(readDesktopStoryState(raw, 'demo-reader')).toEqual({ uid: 'demo-reader', schemaVersion: schema, storyFlags: flags, pilotRank: 0,
        onboarding: { step: 7, stepId: 'done', skipped: true, stepAt: null } });
    }
  });
  it('defaults old accounts without claiming a gate, preserving false and zero', () => {
    expect(readHostStoryFlags(undefined)).toEqual(defaults);
    expect(readHostStoryFlags({ arenaGatheringSeen: false, tournamentsWon: 0 })).toEqual(defaults);
  });
  it('preserves host-owned Pilot Rank separately from tournament wins', () => {
    expect(readDesktopStoryState({ uid: 'a', schemaVersion: 'desktop-account-3', pilotRank: 47 }, 'a').pilotRank).toBe(47);
  });
  it('returns immutable copies, permits unrelated additive reply fields', () => {
    const raw = { uid: 'a', schemaVersion: 'desktop-account-3', storyFlags: { ...defaults }, extra: 'future' };
    const parsed = readDesktopStoryState(raw, 'a'); raw.storyFlags.arenaGatheringSeen = true;
    expect(parsed.storyFlags.arenaGatheringSeen).toBe(false);
    expect(Object.isFrozen(parsed)).toBe(true); expect(Object.isFrozen(parsed.storyFlags)).toBe(true);
  });
  it.each([null, [], 'flags', { tournamentsWon: -1 }, { tournamentsWon: 4 }, { tournamentsWon: 1.5 },
    { tournamentsWon: '1' }, { tournamentsWon: NaN }, { tournamentsWon: null }, { arenaGatheringSeen: 1 },
    { arenaArcBuilt: true }, { tournamentsWon: 3 }, { holoZonesArcBuilt: 'false' }])('rejects malformed/inconsistent flags: %j', value => {
    expect(() => readHostStoryFlags(value)).toThrow('invalid_reply');
  });
  it.each([null, [], {}, { uid: 'b', schemaVersion: 'desktop-account-3' }, { uid: 'a', schemaVersion: 'future' },
    { uid: 'a', schemaVersion: 'desktop-account-3', pilotRank: -1 }, { uid: 'a', schemaVersion: 'desktop-account-3', pilotRank: '2' },
    { uid: 'a', schemaVersion: 'desktop-account-3', pilotRank: null }, { uid: 'a', schemaVersion: 'desktop-account-3', pilotRank: 1.5 }])('rejects mismatched account or malformed envelope: %j', value => {
    expect(() => readDesktopStoryState(value, 'a')).toThrow('invalid_reply');
  });
});
describe('host onboarding field (onboarding-host-1): optional and tolerated', () => {
  it.each(['desktop-account-1', 'desktop-account-2', 'desktop-account-3'] as const)('reads the real %s host reply at every step', schema => {
    for (const step of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const raw = buildDesktopAccountReply({ onboarding: { step, skipped: false, stepAt: 5 } }, 'a', schema, { light: 0, medium: 0, heavy: 0 });
      const parsed = readDesktopStoryState(raw, 'a');
      expect(parsed.onboarding?.step).toBe(step); expect(parsed.onboarding?.skipped).toBe(false); expect(parsed.onboarding?.stepAt).toBe(5);
      expect(Object.isFrozen(parsed.onboarding)).toBe(true);
    }
  });
  it('an older host without the field still parses (onboarding absent)', () => {
    const parsed = readDesktopStoryState({ uid: 'a', schemaVersion: 'desktop-account-3' }, 'a');
    expect('onboarding' in parsed).toBe(false);
  });
  it.each([null, [], 'x', {}, { schemaVersion: 'onboarding-2', step: 0, stepId: 'arrive', skipped: false, stepAt: 1 },
    { schemaVersion: 'onboarding-1', step: 0, stepId: 'done', skipped: false, stepAt: 1 },
    { schemaVersion: 'onboarding-1', step: 3, stepId: 'mentor_duel', skipped: true, stepAt: 1 },
    { schemaVersion: 'onboarding-1', step: 9, stepId: 'done', skipped: false, stepAt: 1 }])('an unrecognised onboarding value never fails the snapshot: %j', value => {
    expect(readHostOnboarding(value)).toBeUndefined();
    expect(() => readDesktopStoryState({ uid: 'a', schemaVersion: 'desktop-account-3', onboarding: value }, 'a')).not.toThrow();
  });
});
describe('structured rival cooldown reader', () => {
  it.each([0, 1, 299999, 300000, 301000])('reads exact host duration %i, including future-host-clock offsets', retryAfterMs => {
    expect(readRivalRetryAfterMs({ code: 'functions/failed-precondition', details: { rejectionCode: 'rival_cooldown', retryAfterMs } })).toBe(retryAfterMs);
  });
  it.each([undefined, null, '300000', -1, 1.5, NaN, Infinity])('ignores unusable durations %j', retryAfterMs => {
    expect(readRivalRetryAfterMs({ details: { rejectionCode: 'rival_cooldown', retryAfterMs } })).toBeNull();
  });
  it('never guesses from error text, codes alone or other refusal kinds', () => {
    for (const error of [new Error('rival_cooldown'), { code: 'rival_cooldown', retryAfterMs: 1000 }, { details: { rejectionCode: 'zone_cooldown', retryAfterMs: 1000 } }]) expect(readRivalRetryAfterMs(error)).toBeNull();
  });
  it('expires exactly at deadline and clamps after it without granting anything', () => {
    expect(remainingCooldownMs(300000, 299999)).toBe(1);
    expect(remainingCooldownMs(300000, 300000)).toBe(0);
    expect(remainingCooldownMs(300000, 400000)).toBe(0);
    expect(remainingCooldownMs(null, 10)).toBe(0);
  });
});
