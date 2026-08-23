import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, ClipPath, Defs, G, Polygon, Rect } from "react-native-svg";

export type MinimapMap = {
  width: number;
  height: number;
  walkable: boolean[][];
  pois: Array<{ id: string; x: number; y: number }>;
};

export type MinimapPlayer = { x: number; y: number; facing: "up" | "down" | "left" | "right" };

type MinimapProps = {
  map: MinimapMap | null;
  player: MinimapPlayer | null;
};

export const MINIMAP_SIZE = 96;
const RING_R = 44;
const CENTER = MINIMAP_SIZE / 2;
const INNER = RING_R * 2 - 4;
/** Display grid cap (Round E): 56×40 world → 2×-downsampled 28×20 blocks (560 rects, not 2,240). */
const MAX_DISPLAY = 28;
const FACING_DEG: Record<MinimapPlayer["facing"], number> = { up: 0, right: 90, down: 180, left: 270 };

/**
 * Round D circular minimap: static-orientation render of the overworld walkability grid
 * (sent once in BRIDGE_HELLO), cyan POI dots for building interaction zones and a gold
 * player arrow rotated by facing. Translucent ring frame, no filters. Large maps are
 * block-downsampled for display (a block is walkable if ANY cell in it is walkable).
 */
export function Minimap({ map, player }: MinimapProps) {
  const insets = useSafeAreaInsets();

  const view = useMemo(() => {
    if (!map) return null;
    const block = Math.max(1, Math.ceil(Math.max(map.width, map.height) / MAX_DISPLAY));
    const displayW = Math.ceil(map.width / block);
    const displayH = Math.ceil(map.height / block);
    const cell = INNER / Math.max(displayW, displayH);
    const originX = CENTER - (displayW * cell) / 2;
    const originY = CENTER - (displayH * cell) / 2;
    const rects: Array<{ key: string; x: number; y: number; walkable: boolean }> = [];
    for (let by = 0; by < displayH; by += 1) {
      for (let bx = 0; bx < displayW; bx += 1) {
        let walkable = false;
        for (let y = by * block; y < Math.min(map.height, (by + 1) * block) && !walkable; y += 1) {
          for (let x = bx * block; x < Math.min(map.width, (bx + 1) * block); x += 1) {
            if (map.walkable[y]?.[x] === true) {
              walkable = true;
              break;
            }
          }
        }
        rects.push({ key: `${bx},${by}`, walkable, x: originX + bx * cell, y: originY + by * cell });
      }
    }
    const toX = (x: number) => originX + ((x + 0.5) / block) * cell;
    const toY = (y: number) => originY + ((y + 0.5) / block) * cell;
    return { cell, rects, toX, toY };
  }, [map]);

  return (
    <View pointerEvents="none" style={[styles.layer, { right: 18 + insets.right, top: insets.top + 12 }]}>
      <Svg height={MINIMAP_SIZE} viewBox={`0 0 ${MINIMAP_SIZE} ${MINIMAP_SIZE}`} width={MINIMAP_SIZE}>
        <Defs>
          <ClipPath id="minimap-clip">
            <Circle cx={CENTER} cy={CENTER} r={RING_R - 2} />
          </ClipPath>
        </Defs>
        <Circle cx={CENTER} cy={CENTER} fill="rgba(5,6,6,0.55)" r={RING_R} stroke="#17d9ff" strokeWidth={1.5} />
        {view && map ? (
          <G clipPath="url(#minimap-clip)">
            {view.rects.map((rect) => (
              <Rect
                fill={rect.walkable ? "rgba(23,217,255,0.18)" : "rgba(5,6,6,0.85)"}
                height={view.cell}
                key={rect.key}
                width={view.cell}
                x={rect.x}
                y={rect.y}
              />
            ))}
            {map.pois.map((poi) => (
              <Circle cx={view.toX(poi.x)} cy={view.toY(poi.y)} fill="#17d9ff" key={poi.id} r={2.2} />
            ))}
            {player ? (
              <Polygon
                fill="#f0bf14"
                origin={`${view.toX(player.x)}, ${view.toY(player.y)}`}
                points={arrowPoints(view.toX(player.x), view.toY(player.y))}
                rotation={FACING_DEG[player.facing]}
                stroke="#050606"
                strokeWidth={0.6}
              />
            ) : null}
          </G>
        ) : null}
        <Circle cx={CENTER} cy={CENTER} fill="none" r={RING_R - 3.5} stroke="rgba(23,217,255,0.35)" strokeWidth={0.75} />
      </Svg>
    </View>
  );
}

/** Up-pointing arrow centered at (cx, cy); rotated via the Polygon `rotation`/`origin` props. */
function arrowPoints(cx: number, cy: number): string {
  return `${cx},${cy - 4.2} ${cx + 3.2},${cy + 3.2} ${cx},${cy + 1.4} ${cx - 3.2},${cy + 3.2}`;
}

const styles = StyleSheet.create({
  layer: {
    height: MINIMAP_SIZE,
    position: "absolute",
    width: MINIMAP_SIZE,
    zIndex: 25,
  },
});
