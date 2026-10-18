import { describe, expect, it } from 'vitest';
import { theme } from '@/lite/theme';
import { ARENA_RESULT_BUTTON, ARENA_RESULT_COPY, presentArenaResult } from '../arenaResultPresenter';

const FIXTURE_REWARDS = { exp: 95, syncPoints: 35, holos: 100, blueprintRewards: [{ holobotKey: 'hare', amount: 5 }] };
const saysNoRewards = (s: string) => /NO REWARDS|NOTHING GRANTED/.test(s);

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

describe('presentArenaResult — subtitle and rows from one source', () => {
  it('(a) QA stand-in: no rows, no rewards header, subtitle says NO REWARDS', () => {
    const view = presentArenaResult({ didWin: true, receipt: { kind: 'qa-standin' }, context: 'ACE LV 4 / HARE LV 12 · HOST FIXTURE RECEIPT' });
    expect(view.rows).toEqual([]);
    expect(view.rowsTitle).toBeNull();
    expect(view.subtitle.startsWith(ARENA_RESULT_COPY.qaStandIn)).toBe(true);
    expect(saysNoRewards(view.subtitle)).toBe(true);
  });

  it('(a2) QA stand-in type cannot carry rewards: a fixture receipt is never printed', () => {
    // @ts-expect-error the stand-in variant has no rewards field
    const view = presentArenaResult({ didWin: true, receipt: { kind: 'qa-standin', rewards: FIXTURE_REWARDS } });
    expect(view.rows).toEqual([]);
  });

  it('(b) host receipt with rewards: rows are exactly the receipt, subtitle never says NO REWARDS', () => {
    const view = presentArenaResult({ didWin: true, receipt: { kind: 'host', rewards: FIXTURE_REWARDS }, context: 'ACE LV 4 · HARE LV 12' });
    expect(view.rows.map(r => [r.label, r.value])).toEqual([
      ['EXP', '+95'], ['Sync Points', '+35'], ['HOLOS', '+100'], ['HARE BLUEPRINT', '+5'],
    ]);
    expect(view.rowsTitle).toBe('REWARDS');
    expect(view.subtitle).toBe('ACE LV 4 · HARE LV 12 · HOST RECEIPT');
    expect(saysNoRewards(view.subtitle)).toBe(false);
  });

  it('(b2) host receipt on a loss titles the rows CONSOLATION', () => {
    const view = presentArenaResult({ didWin: false, receipt: { kind: 'host', rewards: { exp: 20, syncPoints: 5 } } });
    expect(view.rowsTitle).toBe('CONSOLATION');
    expect(view.rows).toHaveLength(2);
  });

  it('(c) host receipt with zero rewards: no rows, no header, subtitle says nothing granted', () => {
    const view = presentArenaResult({ didWin: false, receipt: { kind: 'host', rewards: { exp: 0, syncPoints: 0, holos: 0, blueprintRewards: [] } }, context: 'ACE LV 4 · HARE LV 12' });
    expect(view.rows).toEqual([]);
    expect(view.rowsTitle).toBeNull();
    expect(view.subtitle).toBe('ACE LV 4 · HARE LV 12 · HOST RECEIPT · NOTHING GRANTED');
    expect(saysNoRewards(view.subtitle)).toBe(true);
  });

  it('agreement invariant: subtitle says no-rewards iff there are no granted rows', () => {
    const cases = [
      { kind: 'qa-standin' as const },
      { kind: 'host' as const, rewards: FIXTURE_REWARDS },
      { kind: 'host' as const, rewards: { exp: 0, syncPoints: 0 } },
      { kind: 'host' as const, rewards: { exp: 0, syncPoints: 7 } },
      { kind: 'host' as const, rewards: { exp: 0, syncPoints: 0, blueprintRewards: [{ holobotKey: 'ace', amount: 0 }] } },
    ];
    for (const receipt of cases) for (const didWin of [true, false]) {
      const view = presentArenaResult({ didWin, receipt });
      const granted = view.rows.filter(r => r.key !== 'rating').length;
      expect(saysNoRewards(view.subtitle)).toBe(granted === 0);
    }
  });

  it('PvP rating delta stays visible but does not count as a grant', () => {
    const view = presentArenaResult({ didWin: false, receipt: { kind: 'host', rewards: { exp: 0, syncPoints: 0, eloChange: -12 } } });
    expect(view.rows.map(r => [r.key, r.value, r.tone])).toEqual([['rating', '-12', 'negative']]);
    expect(saysNoRewards(view.subtitle)).toBe(true);
  });
});

describe('result buttons', () => {
  it('reuse the HUD BACK label treatment and keep the tap target', () => {
    expect(ARENA_RESULT_BUTTON).toMatchSnapshot();
    expect(ARENA_RESULT_BUTTON.plate.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('primary (EXIT ARENA on the selected plate) meets 4.5:1 on theme.plates.raised; the old carbon label did not', () => {
    expect(contrast(ARENA_RESULT_BUTTON.primaryLabel.color, theme.plates.raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.colors.carbon, theme.plates.raised)).toBeLessThan(1.5);
    expect(contrast(ARENA_RESULT_BUTTON.secondaryLabel.color, theme.plates.navy)).toBeGreaterThanOrEqual(4.5);
  });
});
