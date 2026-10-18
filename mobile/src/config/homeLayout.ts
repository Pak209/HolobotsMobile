/**
 * Home dashboard artboard geometry, in Figma units (1800 × 3200). Dependency-free so vitest can
 * check the layout: one scale for both axes (L12), footer nav and part slots centred on x = 900
 * (L13), and the header status strip clear of the plate's diagonal (L14). HomeScreen and
 * FigmaCanvas read their numbers from here.
 */
import type { RootTabs } from "../../App";

export const ARTBOARD_WIDTH = 1800;
export const ARTBOARD_HEIGHT = 3200;

export type ArtRect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Uniform ("meet") fit of the artboard into a page: one scale, centred, the rest letterboxed. */
export function fitArtboard(pageWidth: number, pageHeight: number) {
  const scale = Math.max(0, Math.min(pageWidth / ARTBOARD_WIDTH, pageHeight / ARTBOARD_HEIGHT));
  const width = ARTBOARD_WIDTH * scale;
  const height = ARTBOARD_HEIGHT * scale;
  return { scale, width, height, left: (pageWidth - width) / 2, top: (pageHeight - height) / 2 };
}

/** HomeScreen pads its canvas page by the safe-area insets plus these points. */
export const HOME_PAGE_PADDING = { top: 8, bottom: 12 } as const;
export function homeCanvasFrame(window: { width: number; height: number }, insets: { top: number; bottom: number }) {
  return fitArtboard(window.width, window.height - insets.top - HOME_PAGE_PADDING.top - insets.bottom - HOME_PAGE_PADDING.bottom);
}

/** Percent of the artboard, for absolutely positioned overlays that must stay on their art. */
export const artboardPercentX = (value: number) => `${(value / ARTBOARD_WIDTH) * 100}%` as const;
export const artboardPercentY = (value: number) => `${(value / ARTBOARD_HEIGHT) * 100}%` as const;

// ---------------------------------------------------------------------------------------------------------
// Equipped-part slots: five frames on one pitch, centred (were 68..1396, a 404 right margin vs 68 left).

export const PART_SLOT_Y = 2216;
export const PART_SLOT_WIDTH = 248;
export const PART_SLOT_HEIGHT = 260;
export const PART_SLOT_PITCH = 270;
/** The part icon sits clear of the star row above it and the rarity plate below it. */
export const PART_OVERLAY = { dx: 18, dy: 54, width: 208, height: 138 } as const;
const PART_SLOT_LEFT = (ARTBOARD_WIDTH - (4 * PART_SLOT_PITCH + PART_SLOT_WIDTH)) / 2;
export const PART_SLOT_XS: readonly number[] = [0, 1, 2, 3, 4].map((index) => PART_SLOT_LEFT + index * PART_SLOT_PITCH);

// ---------------------------------------------------------------------------------------------------------
// Footer nav: four columns on a 400 pitch centred on x = 900 (labels were at 210/622/1008/1398).
// Each icon box is placed so its visible art (measured opaque bounds of the PNG, drawn "contain")
// is centred over its label. The hotspot is the item's column: it covers the art and the label
// and stops short of the neighbouring column.

export const FOOTER_LABEL_Y = 3072;
export const FOOTER_LABEL_SIZE = 50;
export const FOOTER_PLATE = { x: 0, y: 2540, width: ARTBOARD_WIDTH, height: 630 } as const;
const FOOTER_PITCH = 400;
const FOOTER_HOTSPOT_WIDTH = 390;
const FOOTER_HOTSPOT_TOP = 2624;
const FOOTER_HOTSPOT_BOTTOM = 3100;

/** Source PNG size and its opaque bounds (alpha > 24, ≥3 px per row/column), measured from assets/figma/home. */
export type IconArt = Readonly<{ pixels: readonly [number, number]; opaque: readonly [number, number, number, number] }>;

export type HomeFooterKey = "arena" | "inventory" | "sync" | "market";
export type HomeFooterItem = Readonly<{
  key: HomeFooterKey;
  label: string;
  /** Root tab the hotspot opens. MARKET is the HoloCity lite market (CityMarket), not the legacy page. */
  route: keyof RootTabs;
  accessibilityLabel: string;
  labelX: number;
  /** The ArtImage box; the PNG is drawn "contain" inside it. */
  icon: ArtRect;
  iconArt: IconArt;
  hotspot: ArtRect;
}>;

const footerCentre = (index: number) => ARTBOARD_WIDTH / 2 + (index - 1.5) * FOOTER_PITCH;
const footerHotspot = (index: number): ArtRect => ({
  x: footerCentre(index) - FOOTER_HOTSPOT_WIDTH / 2, y: FOOTER_HOTSPOT_TOP, width: FOOTER_HOTSPOT_WIDTH, height: FOOTER_HOTSPOT_BOTTOM - FOOTER_HOTSPOT_TOP,
});

export const HOME_FOOTER_ITEMS: readonly HomeFooterItem[] = [
  // The arena PNG is mostly transparent on its left (opaque x 264..585 of 586), so its box sits left of the column.
  { key: "arena", label: "ARENA", route: "Arena", accessibilityLabel: "Open arena portal", labelX: footerCentre(0),
    icon: { x: -13, y: 2638, width: 432, height: 392 }, iconArt: { pixels: [586, 339], opaque: [264, 4, 585, 338] }, hotspot: footerHotspot(0) },
  { key: "inventory", label: "INVENTORY", route: "Inventory", accessibilityLabel: "Open inventory portal", labelX: footerCentre(1),
    icon: { x: 540, y: 2680, width: 320, height: 320 }, iconArt: { pixels: [388, 364], opaque: [0, 0, 387, 363] }, hotspot: footerHotspot(1) },
  { key: "sync", label: "SYNC", route: "Fitness", accessibilityLabel: "Open Sync fitness page", labelX: footerCentre(2),
    icon: { x: 950, y: 2690, width: 300, height: 300 }, iconArt: { pixels: [275, 318], opaque: [0, 0, 274, 317] }, hotspot: footerHotspot(2) },
  { key: "market", label: "MARKET", route: "CityMarket", accessibilityLabel: "Open marketplace portal", labelX: footerCentre(3),
    icon: { x: 1350, y: 2690, width: 300, height: 300 }, iconArt: { pixels: [371, 347], opaque: [0, 0, 370, 346] }, hotspot: footerHotspot(3) },
];

/** Where the opaque part of an icon lands when its PNG is drawn "contain" in its box. */
export function footerIconArtRect(item: Pick<HomeFooterItem, "icon" | "iconArt">): ArtRect {
  const { icon, iconArt } = item;
  const [pixelWidth, pixelHeight] = iconArt.pixels;
  const scale = Math.min(icon.width / pixelWidth, icon.height / pixelHeight);
  const left = icon.x + (icon.width - pixelWidth * scale) / 2;
  const top = icon.y + (icon.height - pixelHeight * scale) / 2;
  const [x0, y0, x1, y1] = iconArt.opaque;
  return { x: left + x0 * scale, y: top + y0 * scale, width: (x1 + 1 - x0) * scale, height: (y1 + 1 - y0) * scale };
}

// ---------------------------------------------------------------------------------------------------------
// Header: the navy plate's lower band ends in a diagonal from (1530, 300) to (1410, 425). The status
// strip (TIER · HOLOS · SYNC ... CITY › countdown) must end left of it (it used to run to x 1674).

export const HEADER_PLATE_PATH = "M0 100 H145 L168 124 H995 L1045 170 H1800 V300 H1530 L1410 425 H260 L230 450 H0 Z";
export const HEADER_DIAGONAL = { top: { x: 1530, y: 300 }, bottom: { x: 1410, y: 425 } } as const;
/** x of the plate's diagonal edge at height y (clamped to the diagonal's span). */
export function headerDiagonalX(y: number): number {
  const { top, bottom } = HEADER_DIAGONAL;
  const t = Math.min(1, Math.max(0, (y - top.y) / (bottom.y - top.y)));
  return top.x + (bottom.x - top.x) * t;
}
export const HOME_STATUS_STRIP = { left: 126, top: 304, right: 1400 } as const;
