/**
 * lite-battle-ui-1: the four HoloCity command glyphs, ported point for point from Unity's procedural command art
 * (HolobotsUnity `Assets/UI/Foundation/Runtime/HoloCombatCommandGraphic.cs`, `Icon()`). Unity draws them as vector
 * polygons, not sprites, so they are copied here as the same unit-square point lists (top-left origin) and rendered with
 * react-native-svg. SKYBREAKER (the FINISHER slot) reuses the BREAK icon as drawn (Pak 2026-09-26). Free of
 * react-native so tests can read it.
 */
import type { Point } from './commandPlateLayout';

export type GlyphLayer = { points: Point[]; fill: 'accent' | 'ice' | 'breakBody' | 'breakEmber' | 'breakCore' | 'interceptCrest'; glow?: boolean;
  /** Unity `Inset(r, 7)` on the BREAK body, as a fraction of the icon box. */ inset?: readonly [number, number] };
export type HoloGlyph = { id: 'strike' | 'heavy' | 'defend' | 'finisher'; accent: 'strike' | 'heavy' | 'defend';
  /** Unity's icon rect for the slot (width / height), so the glyph keeps its drawn proportions. */ aspect: number; layers: GlyphLayer[] };

const pts = (...xy: number[]): Point[] => Array.from({ length: xy.length / 2 }, (_, i) => [xy[i * 2], xy[i * 2 + 1]] as Point);

/** FAST: three lightning streaks with ICE highlights. Icon rect 67×61. */
const STRIKE: GlyphLayer[] = [
  { points: pts(.13, .18, .68, .06, .39, .44, .43, .26), fill: 'accent', glow: true },
  { points: pts(.35, .44, .96, .24, .68, .69, .72, .46), fill: 'accent', glow: true },
  { points: pts(.35, .56, .51, .39, .48, .70, .02, .98), fill: 'accent', glow: true },
  { points: pts(.14, .21, .50, .12, .37, .26), fill: 'ice' },
  { points: pts(.49, .44, .84, .32, .66, .48), fill: 'ice' },
];
/** BREAK: the burst, its inset body, the ember crack and the hot core. Icon rect 83×66 (HEAVY), 66×58 (SKYBREAKER). */
const BURST = pts(.06, .31, .36, .40, .26, .11, .48, .35, .62, 0, .60, .33, .99, .07, .76, .44, .98, .49, .72, .58, .87, .85, .58, .70, .45, .95, .43, .71, .02, 1, .26, .63, .05, .64, .32, .50);
const breakLayers = (inset: readonly [number, number]): GlyphLayer[] => [
  { points: BURST, fill: 'accent', glow: true },
  { points: BURST, fill: 'breakBody', inset },
  { points: pts(.19, .77, .43, .48, .38, .31, .52, .46, .73, .28, .61, .56, .73, .69, .53, .64, .47, .82, .45, .61), fill: 'breakEmber' },
  { points: pts(.44, .51, .49, .43, .54, .55, .64, .56, .54, .61, .50, .71, .47, .59, .37, .62), fill: 'breakCore' },
];
/** INTERCEPT: the shield, its crest and the accent diamond. Icon rect 59×56. */
const DEFEND: GlyphLayer[] = [
  { points: pts(.21, .12, .37, .12, .5, .04, .63, .12, .79, .12, .79, .50, .71, .71, .5, .96, .29, .71, .21, .50), fill: 'accent', glow: true },
  { points: pts(.5, .20, .55, .38, .67, .47, .66, .63, .5, .80, .34, .63, .33, .47, .45, .38), fill: 'interceptCrest' },
  { points: pts(.5, .43, .59, .52, .5, .62, .41, .52), fill: 'accent' },
];

export const HOLO_COMMAND_GLYPHS: Record<HoloGlyph['id'], HoloGlyph> = {
  strike: { id: 'strike', accent: 'strike', aspect: 67 / 61, layers: STRIKE },
  heavy: { id: 'heavy', accent: 'heavy', aspect: 83 / 66, layers: breakLayers([7 / 83, 7 / 66]) },
  defend: { id: 'defend', accent: 'defend', aspect: 59 / 56, layers: DEFEND },
  finisher: { id: 'finisher', accent: 'heavy', aspect: 66 / 58, layers: breakLayers([7 / 66, 7 / 58]) },
};

/** Unity's Glow(): an 8 px stroke at 10 % and a 4 px stroke at 23 % under the fill, as fractions of a ~64 px icon. */
export const GLOW_STROKES = [{ width: 8 / 64, opacity: 0.1 }, { width: 4 / 64, opacity: 0.23 }] as const;

/** A layer's points in a w×h box (applies the BREAK body inset). */
export function glyphLayerPoints(layer: GlyphLayer, width: number, height: number): Point[] {
  const [ix, iy] = layer.inset ?? [0, 0];
  return layer.points.map(([x, y]) => [(ix + x * (1 - 2 * ix)) * width, (iy + y * (1 - 2 * iy)) * height] as Point);
}
