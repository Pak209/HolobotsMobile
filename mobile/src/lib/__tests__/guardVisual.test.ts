import { describe, expect, it } from 'vitest';
import { guardVisual } from '../bots/guardVisual';

describe('guard draw visibility', () => {
  it('omits untriggered and completed guards, preserving every positive-alpha frame', () => {
    expect(guardVisual(1000, undefined)).toEqual({ opacity: 0, visible: false });
    expect(guardVisual(1000, 1000)).toEqual({ opacity: 0.28, visible: true });
    expect(guardVisual(1350, 1000)).toEqual({ opacity: 0.14, visible: true });
    expect(guardVisual(1699.999, 1000).visible).toBe(true);
    expect(guardVisual(1700, 1000)).toEqual({ opacity: 0, visible: false });
    expect(guardVisual(2000, 1000)).toEqual({ opacity: 0, visible: false });
  });
  it('a later guard trigger reactivates the same rim without changing the fade', () => {
    expect(guardVisual(2000, 1000).visible).toBe(false);
    expect(guardVisual(2000, 2000)).toEqual({ opacity: 0.28, visible: true });
  });
});
