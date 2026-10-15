/**
 * HoloCity HUD, ported from HolobotsUnity HudTokens / HoloPanelToken /
 * SlotAccentPalette. These are presentation tokens, never progression state.
 */
export const theme = {
  colors: {
    carbon: "#101318",
    accent: "#62DDE8",
    text: "#F4F7FA",
    muted: "#A9BDC8",
    subtle: "#728A98",
    border: "#304956",
    graphite: "#343941",
    disabled: "#59616D",
    success: "#53E083",
    warning: "#FFD21A",
    danger: "#FF603D",
    purple: "#B07CFF",
    magenta: "#F238B8",
    blue: "#4BA7FF",
    orange: "#FF7A35",
    cursor: "#FFCB6C",
  },
  plates: {
    navy: "#081723",
    raised: "#102532",
    keycap: "#030B12",
    overlay: "rgba(3, 11, 18, 0.92)",
    borderWidth: 1,
    notch: 8,
    cornerTick: 12,
  },
  rings: {
    player: ["#2FE6FF", "#7CFF4F", "#B07CFF"],
    rival: ["#FF7A1A", "#FF3D8B", "#FFD21A"],
  },
  type: {
    display: { fontFamily: "HoloDisplay", fontSize: 34, lineHeight: 38 },
    header: { fontFamily: "HoloDisplay", fontSize: 22, lineHeight: 28 },
    label: { fontFamily: "HoloDisplay", fontSize: 16, lineHeight: 22 },
    value: { fontFamily: "HoloDisplay", fontSize: 16, lineHeight: 22 },
    body: { fontFamily: "HoloBody", fontSize: 14, lineHeight: 21 },
    caption: { fontFamily: "HoloBody", fontSize: 12, lineHeight: 18 },
    micro: { fontFamily: "HoloDisplay", fontSize: 10, lineHeight: 14 },
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { sm: 4, md: 8, lg: 12 },
  touchTarget: 48,
} as const;

/** Slot identity is stable; identical bot skins still have different rings. */
export function slotAccent(rival: boolean, slot: number): string {
  const normalized = Number.isFinite(slot) ? Math.trunc(slot) : 0;
  return theme.rings[rival ? "rival" : "player"][((normalized % 3) + 3) % 3];
}
