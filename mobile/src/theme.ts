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
  /** HoloCity battle HUD (lite-battle-ui-1, DECISIONS #72.56): Pak's 10-14 mobile battle concept over the in-engine
   * HoloCombatHudView / HoloCombatCommandGraphic colours. Presentation tokens only. */
  hud: {
    /** Hex command plate bevels, by command (concept: cyan STRIKE, orange COMBO/HEAVY, yellow DEFEND, gold FINISHER). */
    plate: { strike: "#67F5F2", heavy: "#FF7A35", defend: "#FFD21A", finisher: "#FFE066" },
    /** Unity HoloCombatCommandGraphic.Accent: the glyph colours (FAST, BREAK, INTERCEPT). */
    glyph: { strike: "#23D8FF", heavy: "#FF9E36", defend: "#FFDD1F" },
    /** Unity glyph inner fills: ICE highlight, BREAK body/ember/core, INTERCEPT crest. */
    ice: "#C9F2FF",
    breakBody: "#FFDA8B",
    breakEmber: "#4C2214",
    breakCore: "#FFF5BE",
    interceptCrest: "#654C09",
    /** Unity Frame face: outer bevel, ink core and the cool vertical finish (top → bottom). */
    plateBevel: "#394E5A",
    plateInk: "#0C1720",
    plateFaceTop: "#172632",
    plateFaceBottom: "#0A141C",
    plateScrim: "rgba(8, 16, 24, 0.92)",
    /** The STA cost chip in the plate's bottom notch. */
    chipFill: "#06121B",
    chipStroke: "#4898B0",
    chipText: "#D8F6FF",
    /** Fighter cards: the angled frame, HP bars (green you / red rival), STA pips. */
    frame: "#3EA6E6",
    frameFill: "rgba(6, 18, 30, 0.86)",
    hpPlayer: "#2AF05A",
    hpRival: "#F83A24",
    stamina: "#00D8F8",
    pipEmpty: "#0B2633",
    /** Unity HoloCombatHudView.ReadinessFill / ReadinessText_Tint: LOCKED / HALF READY / FULL READY. */
    readiness: {
      locked: { fill: "rgba(22, 30, 40, 0.86)", text: "#8292A0" },
      half: { fill: "rgba(92, 64, 8, 0.92)", text: "#FFC428" },
      full: { fill: "rgba(255, 210, 26, 0.96)", text: "#0E1622" },
    },
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
