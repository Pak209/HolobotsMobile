import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ARTBOARD_HEIGHT, ARTBOARD_WIDTH, FOOTER_LABEL_SIZE, FOOTER_LABEL_Y, FOOTER_PLATE, HEADER_PLATE_PATH, HOME_FOOTER_ITEMS, HOME_PAGE_PADDING,
  HOME_STATUS_STRIP, PART_OVERLAY, PART_SLOT_HEIGHT, PART_SLOT_WIDTH, PART_SLOT_XS, PART_SLOT_Y, footerIconArtRect, headerDiagonalX,
  homeCanvasFrame, type ArtRect,
} from "../homeLayout";

/** Portrait window and safe-area insets (pt) of the phones the critic measured. */
const PHONES = [
  { name: "iPhone SE 375×667", window: { width: 375, height: 667 }, insets: { top: 20, bottom: 0 } },
  { name: "iPhone X/11 Pro 375×812", window: { width: 375, height: 812 }, insets: { top: 44, bottom: 34 } },
  { name: "iPhone 15/16 Pro 393×852", window: { width: 393, height: 852 }, insets: { top: 59, bottom: 34 } },
  { name: "iPhone 15/16 Pro Max 430×932", window: { width: 430, height: 932 }, insets: { top: 59, bottom: 34 } },
] as const;
const pageHeight = (phone: (typeof PHONES)[number]) =>
  phone.window.height - phone.insets.top - HOME_PAGE_PADDING.top - phone.insets.bottom - HOME_PAGE_PADDING.bottom;
const smallestScale = Math.min(...PHONES.map((phone) => homeCanvasFrame(phone.window, phone.insets).scale));

/** The pre-fix FigmaCanvas (fillHeight): width from the window, height from the page. Known-bad control. */
function legacyCanvas(phone: (typeof PHONES)[number]) {
  const width = Math.min(phone.window.width, phone.window.height * (ARTBOARD_WIDTH / ARTBOARD_HEIGHT));
  return { scaleX: width / ARTBOARD_WIDTH, scaleY: pageHeight(phone) / ARTBOARD_HEIGHT };
}

const right = (rect: ArtRect) => rect.x + rect.width;
const bottom = (rect: ArtRect) => rect.y + rect.height;
const centreX = (rect: ArtRect) => rect.x + rect.width / 2;
const contains = (outer: ArtRect, inner: ArtRect) =>
  inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
const intersects = (a: ArtRect, b: ArtRect) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
/** Generous label box: 0.62 em per glyph covers the HUD face and the system fallback; cap height above the baseline, descent below. */
const labelBox = (item: (typeof HOME_FOOTER_ITEMS)[number]): ArtRect => {
  const width = item.label.length * FOOTER_LABEL_SIZE * 0.62;
  return { x: item.labelX - width / 2, y: FOOTER_LABEL_Y - FOOTER_LABEL_SIZE * 0.8, width, height: FOOTER_LABEL_SIZE };
};
const ONE_PERCENT = ARTBOARD_WIDTH * 0.01;

describe("L12 · Home artboard scale", () => {
  it.each(PHONES)("uses one scale for both axes, centred and inside the page, on $name", (phone) => {
    const frame = homeCanvasFrame(phone.window, phone.insets);
    expect(frame.width / ARTBOARD_WIDTH).toBeCloseTo(frame.height / ARTBOARD_HEIGHT, 12);
    expect(frame.width).toBeLessThanOrEqual(phone.window.width + 1e-9);
    expect(frame.height).toBeLessThanOrEqual(pageHeight(phone) + 1e-9);
    expect(frame.left).toBeGreaterThanOrEqual(0);
    expect(frame.top).toBeGreaterThanOrEqual(0);
    expect(frame.left * 2 + frame.width).toBeCloseTo(phone.window.width, 9);
    expect(frame.top * 2 + frame.height).toBeCloseTo(pageHeight(phone), 9);
  });
  it("known-bad control: the old canvas stretched every phone (SE squashed to 0.94)", () => {
    const ratios = PHONES.map((phone) => { const { scaleX, scaleY } = legacyCanvas(phone); return scaleY / scaleX; });
    expect(ratios[0]).toBeCloseTo(0.94, 2);
    for (const ratio of ratios) expect(Math.abs(ratio - 1)).toBeGreaterThan(0.05);
  });
});

describe("L13 · footer nav and part slots are centred", () => {
  it("puts the footer label centroid within 1% of the artboard centre (was 809.5 of 900)", () => {
    const centroid = HOME_FOOTER_ITEMS.reduce((sum, item) => sum + item.labelX, 0) / HOME_FOOTER_ITEMS.length;
    expect(Math.abs(centroid - ARTBOARD_WIDTH / 2)).toBeLessThanOrEqual(ONE_PERCENT);
    expect(HOME_FOOTER_ITEMS.map((item) => item.label)).toEqual(["ARENA", "INVENTORY", "SYNC", "MARKET"]);
  });
  it.each(HOME_FOOTER_ITEMS)("centres the $key icon's visible art over its label", (item) => {
    expect(Math.abs(centreX(footerIconArtRect(item)) - item.labelX)).toBeLessThanOrEqual(ONE_PERCENT);
  });
  it("centres the five part slots with equal side margins (were 68 left vs 404 right)", () => {
    const left = PART_SLOT_XS[0];
    const rightMargin = ARTBOARD_WIDTH - (PART_SLOT_XS[4] + PART_SLOT_WIDTH);
    expect(left).toBe(rightMargin);
    const centroid = PART_SLOT_XS.reduce((sum, x) => sum + x + PART_SLOT_WIDTH / 2, 0) / PART_SLOT_XS.length;
    expect(Math.abs(centroid - ARTBOARD_WIDTH / 2)).toBeLessThanOrEqual(ONE_PERCENT);
  });
});

describe("L13 · every hotspot stays on its own art", () => {
  const items = HOME_FOOTER_ITEMS.map((item) => ({ item, art: footerIconArtRect(item), label: labelBox(item) }));
  it.each(items)("$item.key hotspot covers its icon art and label, inside the footer plate", ({ item, art, label }) => {
    expect(contains(item.hotspot, art)).toBe(true);
    expect(contains(item.hotspot, label)).toBe(true);
    expect(contains(FOOTER_PLATE, item.hotspot)).toBe(true);
    expect(Math.abs(centreX(item.hotspot) - centreX(art))).toBeLessThanOrEqual(ONE_PERCENT);
  });
  it.each(items)("$item.key hotspot touches no other item's art, label or hotspot", ({ item }) => {
    for (const other of items.filter((entry) => entry.item.key !== item.key)) {
      expect(intersects(item.hotspot, other.art)).toBe(false);
      expect(intersects(item.hotspot, other.label)).toBe(false);
      expect(intersects(item.hotspot, other.item.hotspot)).toBe(false);
    }
  });
  it("keeps every footer hotspot at least 44 pt on the smallest phone", () => {
    for (const { item } of items) expect(Math.min(item.hotspot.width, item.hotspot.height) * smallestScale).toBeGreaterThanOrEqual(44);
  });
  it("keeps each part hotspot exactly on its slot frame, with the part icon inside it", () => {
    PART_SLOT_XS.forEach((x, index) => {
      const slot = { x, y: PART_SLOT_Y, width: PART_SLOT_WIDTH, height: PART_SLOT_HEIGHT };
      const overlay = { x: x + PART_OVERLAY.dx, y: PART_SLOT_Y + PART_OVERLAY.dy, width: PART_OVERLAY.width, height: PART_OVERLAY.height };
      expect(contains(slot, overlay)).toBe(true);
      expect(contains({ x: 0, y: 0, width: ARTBOARD_WIDTH, height: ARTBOARD_HEIGHT }, slot)).toBe(true);
      const next = PART_SLOT_XS[index + 1];
      if (next !== undefined) expect(intersects(slot, { ...slot, x: next })).toBe(false);
    });
  });
});

describe("L14 · header status strip clears the plate diagonal", () => {
  // The status row is a 10 pt label with 2 pt padding: 20 pt bounds it at any line height.
  const STATUS_ROW_PT = 20;
  it("ties the diagonal to the drawn plate path", () => {
    expect(HEADER_PLATE_PATH).toContain("H1530 L1410 425");
  });
  it.each(PHONES)("ends the strip left of the diagonal on $name", (phone) => {
    const { scale } = homeCanvasFrame(phone.window, phone.insets);
    const rowBottom = HOME_STATUS_STRIP.top + STATUS_ROW_PT / scale;
    expect(HOME_STATUS_STRIP.right).toBeLessThan(headerDiagonalX(rowBottom));
  });
  it("known-bad control: the old right edge (7% inset, x 1674) ran under the diagonal", () => {
    expect(ARTBOARD_WIDTH * 0.93).toBeGreaterThan(headerDiagonalX(HOME_STATUS_STRIP.top));
  });
});

describe("Home wiring", () => {
  const source = readFileSync(fileURLToPath(new URL("../../screens/HomeScreen.tsx", import.meta.url) as unknown as string), "utf8");
  it("sends MARKET to the HoloCity lite market tab, never the legacy Marketplace route", () => {
    expect(HOME_FOOTER_ITEMS.find((item) => item.key === "market")?.route).toBe("CityMarket");
    expect(HOME_FOOTER_ITEMS.map((item) => item.route)).not.toContain("Marketplace");
    expect(source).not.toMatch(/navigate\(\s*["']Marketplace["']/);
  });
  it("never stretches the vector layer", () => {
    expect(source).not.toContain('preserveAspectRatio="none"');
  });
  it("L16 · gives every SVG label the HUD font", () => {
    const tags = [...source.matchAll(/<Text\b[^>]*>/g)].map((match) => match[0]);
    expect(tags.length).toBeGreaterThanOrEqual(12);
    for (const tag of tags) expect(tag).toContain("fontFamily={HUD_FONT}");
    expect(source).toContain("const HUD_FONT = theme.type.display.fontFamily;");
  });
});
