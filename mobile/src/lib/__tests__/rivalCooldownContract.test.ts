import { afterEach, describe, expect, it, vi } from 'vitest';
import contract from '../../../../docs/contracts/economy-host-1.json';
import {
  readRivalLastSettled, requireRivalOffCooldown, rivalLastSettledAfterSettle,
  RIVAL_COOLDOWN_MS, RIVAL_LAST_SETTLED_FIELD,
} from '../../../../functions/src/lib/rivalLadder';

// Host-backed contract coverage; this is not a mobile cooldown hook/countdown implementation.
const settledAt = Date.UTC(2026, 9, 14, 18);
const rivalId = 'citizen_mina';
afterEach(() => vi.useRealTimers());

describe('rival cooldown contract available to mobile', () => {
  it('pins the five-minute duration and refusal vocabulary to the published fixture', () => {
    expect(contract.rivalCooldownMs).toBe(300_000);
    expect(RIVAL_COOLDOWN_MS).toBe(contract.rivalCooldownMs);
    expect(contract.rivalCooldownRejection).toBe('rival_cooldown');
  });

  it.each([0, 1, 120_000, 299_999])('reports the exact positive retryAfterMs at elapsed %i ms', elapsed => {
    vi.useFakeTimers(); vi.setSystemTime(settledAt + elapsed);
    const lastSettled = { [rivalId]: settledAt };
    expect(() => requireRivalOffCooldown(lastSettled, rivalId, Date.now())).toThrowError(
      expect.objectContaining({ code: 'rival_cooldown', retryAfterMs: 300_000 - elapsed }),
    );
    expect(lastSettled).toEqual({ [rivalId]: settledAt });
  });

  it.each([300_000, 300_001, 86400_000])('accepts the exact deadline and later times without changing the ledger: %i', elapsed => {
    const lastSettled = { [rivalId]: settledAt };
    expect(() => requireRivalOffCooldown(lastSettled, rivalId, settledAt + elapsed)).not.toThrow();
    expect(lastSettled).toEqual({ [rivalId]: settledAt });
  });

  it('does not block a different citizen or a pilot with no cooldown history', () => {
    expect(() => requireRivalOffCooldown({ [rivalId]: settledAt }, 'citizen_ren', settledAt)).not.toThrow();
    expect(() => requireRivalOffCooldown({}, rivalId, settledAt)).not.toThrow();
  });

  it('keeps future host timestamps locked with their full remaining time', () => {
    expect(() => requireRivalOffCooldown({ [rivalId]: settledAt }, rivalId, settledAt - 1000)).toThrowError(
      expect.objectContaining({ code: 'rival_cooldown', retryAfterMs: 301_000 }),
    );
  });

  it('defaults an absent ledger and copies valid history without exposing the persisted map', () => {
    expect(readRivalLastSettled(undefined)).toEqual({});
    expect(readRivalLastSettled({})).toEqual({});
    const stored = { [rivalId]: settledAt }, parsed = readRivalLastSettled({ [RIVAL_LAST_SETTLED_FIELD]: stored });
    parsed[rivalId] = 0;
    expect(stored[rivalId]).toBe(settledAt);
  });

  it.each([null, [], 'history', { [rivalId]: '1000' }, { [rivalId]: NaN }, { [rivalId]: Infinity }])(
    'refuses malformed persisted history: %j', raw => {
      expect(() => readRivalLastSettled({ [RIVAL_LAST_SETTLED_FIELD]: raw })).toThrow('unavailable');
    },
  );

  it('starts only the settled rival, preserves live rivals, and prunes exactly expired entries', () => {
    const old = { expired: settledAt - 300_000, live: settledAt - 299_999, [rivalId]: settledAt - 400_000 };
    const next = rivalLastSettledAfterSettle(old, rivalId, settledAt);
    expect(next).toEqual({ live: settledAt - 299_999, [rivalId]: settledAt });
    expect(old[rivalId]).toBe(settledAt - 400_000);
    expect(() => requireRivalOffCooldown(next, 'live', settledAt)).toThrowError(expect.objectContaining({ retryAfterMs: 1 }));
    expect(() => requireRivalOffCooldown(next, 'expired', settledAt)).not.toThrow();
  });
});
