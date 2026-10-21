import { useCallback, useId, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polygon, Stop } from 'react-native-svg';
import { theme } from '../../theme';
import { actionStripPoints, insetPolygon, roundPlatePoints, toSvgPoints, type Point } from './commandPlateLayout';
import { GLOW_STROKES, HOLO_COMMAND_GLYPHS, glyphLayerPoints, type HoloGlyph } from './holoCommandGlyphs';

/** lite-battle-ui-1: vector art for the HoloCity battle HUD (react-native-svg, no bitmaps). Presentation only. */

/** Measures a box once it lays out (the frames are drawn in points, so strokes never stretch). */
export function useBoxSize(initial = { width: 0, height: 0 }) {
  const [size, setSize] = useState(initial);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(previous => Math.abs(previous.width - width) < 0.5 && Math.abs(previous.height - height) < 0.5 ? previous : { width, height });
  }, []);
  return [size, onLayout] as const;
}

const GLYPH_FILL = { ice: theme.hud.ice, breakBody: theme.hud.breakBody, breakEmber: theme.hud.breakEmber, breakCore: theme.hud.breakCore, interceptCrest: theme.hud.interceptCrest } as const;

/** One of the four Unity command glyphs, `size` points tall. */
export function HoloCommandGlyph({ id, size }: { id: HoloGlyph['id']; size: number }) {
  const glyph = HOLO_COMMAND_GLYPHS[id];
  const width = size * glyph.aspect, height = size;
  const accent = theme.hud.glyph[glyph.accent];
  const pad = size * GLOW_STROKES[0].width;
  return <Svg width={width + 2 * pad} height={height + 2 * pad} pointerEvents="none">
    {glyph.layers.map((layer, index) => {
      const points = toSvgPoints(glyphLayerPoints(layer, width, height), pad, pad);
      const fill = layer.fill === 'accent' ? accent : GLYPH_FILL[layer.fill];
      return [
        ...(layer.glow ? GLOW_STROKES.map((glow, g) => <Polygon key={`${index}g${g}`} points={points} fill="none" stroke={accent} strokeOpacity={glow.opacity} strokeWidth={size * glow.width} strokeLinejoin="round" />) : []),
        <Polygon key={index} points={points} fill={fill} />,
      ];
    })}
  </Svg>;
}

/** A plate face: coloured outer bevel, dark carbon core with Unity's cool vertical finish, and a thin inner trace.
 * `lit` (the action in use) warms the face toward the accent, as HoloCombatCommandGraphic.Lit does. */
export function PlateFrame({ width, height, points, accent, lit = false, dim = false, stroke = 2.4, inner = 5 }: { width: number; height: number; points: Point[]; accent: string; lit?: boolean; /** Unavailable: the bevel dims, the carbon face stays solid over the stage. */ dim?: boolean; stroke?: number; inner?: number }) {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '');
  if (width <= 0 || height <= 0) return null;
  const outer = insetPolygon(points, stroke / 2);
  const trace = insetPolygon(points, inner);
  return <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
    <Defs>
      <LinearGradient id={`face${id}`} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={lit ? accent : theme.hud.plateFaceTop} stopOpacity={lit ? 0.32 : 0.94} />
        <Stop offset="1" stopColor={theme.hud.plateFaceBottom} stopOpacity={0.94} />
      </LinearGradient>
    </Defs>
    <Polygon points={toSvgPoints(outer)} fill={theme.hud.plateScrim} />
    <Polygon points={toSvgPoints(outer)} fill={`url(#face${id})`} stroke={accent} strokeOpacity={dim ? 0.4 : 1} strokeWidth={lit ? stroke + 1 : stroke} strokeLinejoin="miter" />
    <Polygon points={toSvgPoints(trace)} fill="none" stroke={accent} strokeOpacity={lit ? 0.8 : dim ? 0.18 : 0.42} strokeWidth={1} strokeLinejoin="miter" />
  </Svg>;
}

/** A thin single-line frame (chips, round counter, action strip). */
export function LineFrame({ width, height, points, fill, stroke, strokeWidth = 1.2, trace }: { width: number; height: number; points: Point[]; fill: string; stroke: string; strokeWidth?: number; trace?: number }) {
  if (width <= 0 || height <= 0) return null;
  const outer = insetPolygon(points, strokeWidth / 2);
  return <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
    <Polygon points={toSvgPoints(outer)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="miter" />
    {trace ? <Polygon points={toSvgPoints(insetPolygon(points, trace))} fill="none" stroke={stroke} strokeOpacity={0.45} strokeWidth={1} /> : null}
  </Svg>;
}

/** The round portrait ring: a cyan ring with a thin outer halo. */
export function PortraitRing({ size, color }: { size: number; color: string }) {
  const r = size / 2;
  return <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
    <Circle cx={r} cy={r} r={r - 0.8} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth={1} />
    <Circle cx={r} cy={r} r={r - 4} fill="none" stroke={color} strokeWidth={2.2} />
  </Svg>;
}

/** The angled counter between the fighter cards (concept "ROUND 01 OF 3"); the caller supplies its own words. */
export function HudRoundPlate({ label, value, sub, testID }: { label: string; value?: string; sub?: string; testID?: string }) {
  const [box, onLayout] = useBoxSize();
  return <View onLayout={onLayout} testID={testID} style={styles.round}>
    <LineFrame width={box.width} height={box.height} points={roundPlatePoints(box.width, box.height)} fill={theme.hud.frameFill} stroke={theme.hud.frame} strokeWidth={1.6} trace={4} />
    <Text style={styles.roundLabel}>{label}</Text>
    {value ? <Text style={styles.roundValue}>{value}</Text> : null}
    {sub ? <Text style={styles.roundLabel}>{sub}</Text> : null}
  </View>;
}

/** The last-action strip above the plates (concept "Quick Jab · 9 DMG"). */
export function HudActionStrip({ text, testID }: { text: string; testID?: string }) {
  const [box, onLayout] = useBoxSize();
  return <View onLayout={onLayout} testID={testID} style={styles.strip}>
    <LineFrame width={box.width} height={box.height} points={actionStripPoints(box.width, box.height)} fill={theme.hud.frameFill} stroke={theme.hud.plate.strike} strokeWidth={1.4} trace={4} />
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.stripText}>{text}</Text>
  </View>;
}

const styles = StyleSheet.create({
  round: { width: 56, minHeight: 72, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  roundLabel: { ...theme.type.micro, color: theme.hud.plate.strike, fontSize: 9, lineHeight: 12, letterSpacing: 1 },
  roundValue: { ...theme.type.display, color: theme.colors.text, fontSize: 28, lineHeight: 32 },
  strip: { minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 8 },
  stripText: { ...theme.type.label, color: theme.colors.text, fontSize: 16, letterSpacing: 0.5, textAlign: 'center' },
});
