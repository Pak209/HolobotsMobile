# JRPG Dashboard UI Handoff

This folder contains the completed dashboard experiment copied from the temporary UI sandbox on 2026-07-12.

## Important

- These files are a handoff snapshot and are not wired into the production app.
- Merge them deliberately into the matching paths under `mobile/src`.
- Existing navigation, profile state, Holobot switching, equipment selection, settings, Arena, Inventory, Sync, and Market behavior were preserved in the experiment.
- No new raster assets were generated. The hologram and equipment frames are code-native SVG components, and existing project artwork is reused.

## Files

- `mobile/src/screens/HomeScreen.tsx`
- `mobile/src/components/dashboard/HologramPlatform.tsx`
- `mobile/src/components/dashboard/holobotPresentation.ts`
- `mobile/src/components/FigmaCanvas.tsx`
- `mobile/src/components/FigmaSvg.tsx`
- `mobile/src/components/arena/BattleArenaView.tsx`
- `mobile/assets/game/arena-moves/strike.png`
- `mobile/assets/game/arena-moves/defend.png`
- `mobile/assets/game/arena-moves/combo.png`
- `mobile/assets/game/arena-moves/finisher.png`

## Arena card prototype

`prototypes/arena-cards` contains the standalone Arena-card design and motion handoff:

- `reference.html` — full-size reference-faithful four-card layout.
- `battle-animation.html` — phone battle-screen prototype; tap Strike, Defend, or Combo to replay the card-play effect.
- `card-play-animation.gif` — recorded Combo animation preview.
- `battle-reference.png` — battle-screen backdrop used only by the standalone prototype.
- `strike.png`, `defend.png`, `combo.png`, `finisher.png` — self-contained prototype copies of the transparent card icons.

The production-path snapshot of `BattleArenaView.tsx` includes the angular SVG card frame, corrected icon mapping, runtime tinting, and final optical icon offsets. The animated interaction remains prototype-only and has not been ported into React Native.

## Verification

- TypeScript passed with `npm run typecheck`.
- All 234 mobile tests passed.
- The iOS Simulator build passed during the experiment.

## Visual direction

The snapshot retains the original yellow diagonal background, title and navigation bands, angular radar panel, live profile data, Legendary badge, upgraded equipped-part frames, and segmented hologram platform.
