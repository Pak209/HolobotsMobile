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
const FACING_DEG: Record<MinimapPlayer["facing"], number> = { up: 0, right: 90, down: 180, left: 270 };

/**
 * Round D circular minimap: static-orientation render of the overworld walkability grid
 * (sent once in BRIDGE_HELLO), cyan POI dots for building interaction zones and a gold
 * player arrow rotated by facing. Translucent ring frame, no filters.
 */
export function Minimap({ map, player }: MinimapProps) {
  const insets = useSafeAreaInsets();

  const cells = useMemo(() => {
    if (!map) return null;
    const cell = INNER / Math.max(map.width, map.height);
    const originX = CENTER - (map.width * cell) / 2;
    const originY = CENTER - (map.height * cell) / 2;
    const rects: Array<{ key: string; x: number; y: number; walkable: boolean }> = [];
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        rects.push({ key: `${x},${y}`, walkable: map.walkable[y]?.[x] === true, x: originX + x * cell, y: originY + y * cell });
      }
    }
    return { cell, originX, originY, rects };
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
        {cells && map ? (
          <G clipPath="url(#minimap-clip)">
            {cells.rects.map((rect) => (
              <Rect
                fill={rect.walkable ? "rgba(23,217,255,0.18)" : "rgba(5,6,6,0.85)"}
                height={cells.cell}
                key={rect.key}
                width={cells.cell}
                x={rect.x}
                y={rect.y}
              />
            ))}
            {map.pois.map((poi) => (
              <Circle
                cx={cells.originX + (poi.x + 0.5) * cells.cell}
                cy={cells.originY + (poi.y + 0.5) * cells.cell}
                fill="#17d9ff"
                key={poi.id}
                r={2.2}
              />
            ))}
            {player ? (
              <Polygon
                fill="#f0bf14"
                origin={`${cells.originX + (player.x + 0.5) * cells.cell}, ${cells.originY + (player.y + 0.5) * cells.cell}`}
                points={arrowPoints(cells.originX + (player.x + 0.5) * cells.cell, cells.originY + (player.y + 0.5) * cells.cell)}
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
