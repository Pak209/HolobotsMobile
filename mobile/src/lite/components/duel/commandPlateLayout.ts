/**
 * lite-battle-ui-1 (DECISIONS #72.56): geometry for the HoloCity battle HUD, free of react-native so the layout test
 * runs on it directly. The four command plates sit 2×2 as in Pak's 10-14 mobile battle concept: elongated hexagons with
 * the STA cost chip straddling the bottom edge. Every number here is layout; no combat state is read.
 */
export type Point = readonly [number, number];
export type Rect = { x: number; y: number; width: number; height: number };
export type PlateSlot = Rect & { plate: Rect; chip: Rect; hex: Point[] };
export type CommandPlateLayout = { width: number; height: number; slots: PlateSlot[] };

/** Unity HoloCombatHudView.ReadinessText states for the FINISHER plate. */
export type FinisherReadiness = 'locked' | 'half' | 'full';
/** Unity HoloCombatHudView.ReadinessText. */
export const READINESS_TEXT: Record<FinisherReadiness, string> = { locked: 'LOCKED', half: 'HALF READY', full: 'FULL READY' };
/** The concept's 2×2 placement: STRIKE / DEFEND on top, HEAVY (the concept's COMBO plate) / FINISHER below. */
export const PLATE_POSITION: Readonly<Record<string, number>> = { strike: 0, defend: 1, heavy: 2, finisher: 3 };

/** Apple HIG minimum tap target. */
export const MIN_TAP = 44;
export const PLATE_GAP = 8;
export const PLATE_ROW_GAP = 4;
export const CHIP_HEIGHT = 18;
/** The chip is centred on the plate's bottom edge, so half of it hangs below the plate. */
export const CHIP_OVERHANG = CHIP_HEIGHT / 2;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** An elongated hexagon in a w×h box: the side points sit at mid-height, `k` in from the left/right edges. */
export function hexPoints(width: number, height: number, k = Math.round(height * 0.38)): Point[] {
  return [[k, 0], [width - k, 0], [width, height / 2], [width - k, height], [k, height], [0, height / 2]];
}

/** Parallel inset of a convex polygon (clockwise in screen space) by `d`: each edge moves inward, corners re-meet. */
export function insetPolygon(points: readonly Point[], d: number): Point[] {
  const n = points.length;
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % n];
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    // Screen space has y down, so the inward normal of a clockwise polygon is (-dy, dx).
    const nx = -dy / len, ny = dx / len;
    return { p: [p[0] + nx * d, p[1] + ny * d] as Point, dx, dy };
  });
  return lines.map((line, i) => {
    const prev = lines[(i + n - 1) % n];
    const det = prev.dx * line.dy - prev.dy * line.dx;
    if (Math.abs(det) < 1e-9) return line.p;
    const t = ((line.p[0] - prev.p[0]) * line.dy - (line.p[1] - prev.p[1]) * line.dx) / det;
    return [prev.p[0] + prev.dx * t, prev.p[1] + prev.dy * t] as Point;
  });
}

export const toSvgPoints = (points: readonly Point[], dx = 0, dy = 0) => points.map(([x, y]) => `${(x + dx).toFixed(2)},${(y + dy).toFixed(2)}`).join(' ');

/** The 2×2 grid for a bar `width` points wide. `compact` (the duel stages) keeps the plates a little flatter. */
export function commandPlateLayout(width: number, { compact = false, count = 4 }: { compact?: boolean; count?: number } = {}): CommandPlateLayout {
  const plateWidth = Math.max(MIN_TAP, (width - PLATE_GAP) / 2);
  const plateHeight = Math.round(clamp(plateWidth * (compact ? 0.46 : 0.52), 72, 96));
  const slotHeight = plateHeight + CHIP_OVERHANG;
  const slots = Array.from({ length: count }, (_, index) => {
    const x = (index % 2) * (plateWidth + PLATE_GAP);
    const y = Math.floor(index / 2) * (slotHeight + PLATE_ROW_GAP);
    const chipWidth = Math.min(plateWidth * 0.5, 96);
    return {
      x, y, width: plateWidth, height: slotHeight,
      plate: { x, y, width: plateWidth, height: plateHeight },
      chip: { x: x + (plateWidth - chipWidth) / 2, y: y + plateHeight - CHIP_HEIGHT / 2, width: chipWidth, height: CHIP_HEIGHT },
      hex: hexPoints(plateWidth, plateHeight).map(([px, py]) => [px + x, py + y] as Point),
    };
  });
  const rows = Math.ceil(count / 2);
  return { width, height: rows * slotHeight + Math.max(0, rows - 1) * PLATE_ROW_GAP, slots };
}

/** Fighter card frame (concept): the panel starts under the round portrait and its inner end is cut on both corners.
 * `mirror` flips it for the rival, whose portrait sits on the right. */
export function fighterPanelPoints(width: number, height: number, portrait: number, mirror = false): Point[] {
  const x0 = portrait / 2, top = 14, bottom = 8;
  const points: Point[] = [[x0, 0], [width - top, 0], [width, top], [width, height - bottom], [width - bottom, height], [x0, height]];
  return mirror ? points.map(([x, y]) => [width - x, y] as Point).reverse() : points;
}

/** The angled counter plate between the fighter cards (a chamfered octagon). */
export function roundPlatePoints(width: number, height: number, c = 9): Point[] {
  return [[c, 0], [width - c, 0], [width, c], [width, height - c], [width - c, height], [c, height], [0, height - c], [0, c]];
}

/** The last-action strip: a long bar with cut ends (concept "Quick Jab · 9 DMG"). */
export function actionStripPoints(width: number, height: number, c = 10): Point[] {
  return [[c, 0], [width, 0], [width, height - c], [width - c, height], [0, height], [0, c]];
}

/** Axis-aligned overlap (shared edges do not count). */
export const rectsOverlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
