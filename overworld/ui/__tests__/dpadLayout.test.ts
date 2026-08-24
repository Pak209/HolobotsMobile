import { describe, expect, it } from "vitest";

import { computeDpadLayout, type ControlRect } from "../DPad";

const overlaps = (a: ControlRect, b: ControlRect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe.each([
  { left: 0, right: 0, bottom: 0 },
  { left: 0, right: 44, bottom: 34 },
])("computeDpadLayout($right,$bottom)", (insets) => {
  it("keeps every control in bounds and the action clear of the D-pad", () => {
    const viewport = { width: 390, height: 844 };
    const layout = computeDpadLayout(insets, viewport);
    for (const rect of Object.values(layout)) {
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(viewport.width);
      expect(rect.y + rect.h).toBeLessThanOrEqual(viewport.height);
    }
    for (const direction of ["up", "down", "left", "right"] as const) {
      expect(overlaps(layout.action, layout[direction]), direction).toBe(false);
    }
    expect(layout.action.w).toBeGreaterThanOrEqual(44);
    expect(layout.action.h).toBeGreaterThanOrEqual(44);
  });
});
