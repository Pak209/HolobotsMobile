# Story Mode Art Style Guide

Codifies the Story Mode design-round art direction. Coherence edits only; no new product decisions. Visual claims inferred from code (no screenshots). See `docs/STORY_MODE_PLAN.md` and `docs/STORY_BRIDGE_CONTRACT.md`.

**Loop, not GB conversion.** Power Quest is town → talk → robot fight. Holobot identity is already painted mecha (ACE: magenta armor, white crest, cyan visor, hard black line). Keep it; do not pixel-convert ACE.

**Two layers, never mixed.** Pixi overworld (32 px, nearest-neighbor) and native RN chrome (existing gold/dark frames). Story fights reuse `mobile/src/components/arena/BattleArenaView.tsx`. No second battle look.

## Palette — one Story Gold

Lock `#f0bf14` (`GameSurfaceFrame` default accent in `mobile/src/components/ui/GameSurfaceFrame.tsx`). These are aliases to migrate, not new hues:

- `#f5c40d` — `mobile/src/components/navigation/GameSectionChrome.tsx` (eyebrow, border)
- `#ffc107` — `mobile/src/components/AppLoadingScreen.tsx`
- `#fdb813` — `mobile/src/screens/HomeScreen.tsx` (radar stroke)

| Token | Hex | Use | Source |
|---|---|---|---|
| Ink | `#050606` | fills, dialog body | existing (`ArenaControlFrame` selected fill) |
| Gold | `#f0bf14` | frames, player marker, lock rims | existing — **Story Gold** |
| Cream | `#fef1e0` | titles | existing |
| Mute | `#ddd2b5` | body copy | existing |
| Strike | `#ff4d39` | hit, danger, fitness-lock pulse | existing (arena strike) |
| Sync cyan | `#17d9ff` | path glow, unlocked gates | existing |
| Stage | `#1d1d1d` | Pixi stage | existing — `overworld/OverworldScene.ts` `background: 0x1d1d1d` |

Town is a **hangar district**, not GB countryside. Retire Mario-green grass (`TILE_COLORS.grass` `0x4c9a3b` in `overworld/TileTypes.ts`). Per-bot signature colors (ACE magenta, KUMA earth, SHADOW void) live on sprites/portraits only — never on chrome.

## Sprite specs

Pixi facts live in `overworld/`, not root `src/App.tsx` (that file is a Figma dashboard preview). Keep `TILE_SIZE = 32`, `MAP_WIDTH` / `MAP_HEIGHT` = 20 (`overworld/TileTypes.ts`), and `antialias: false` (`overworld/OverworldScene.ts`).

Today's overworld is colored `Graphics` rects. Player is `rect(4, 4, TILE_SIZE - 8, TILE_SIZE - 8)` → **24×24** fill `0xffd54a` in `overworld/Player.ts` (placeholder gold, not Story Gold). Replace those fills; do not invent a second look.

| Asset | Spec |
|---|---|
| Tiles | 32×32 seamless, no divider lines. Slice-0 set: floor, path, wall, coolant, door-shut, door-open, fitness-lock overlay. One 256×256 sheet (8×8 cells). |
| Walkers (pilot + NPC) | 32×48, feet on tile baseline, 4 directions × 4 walk + 1 idle, 8 fps, magenta `#ff00ff` key, no baked shadow. |
| Door | 32×64 (two tiles tall), 2 frames (shut / open). |
| Companion Holobot | Slice 2 only. 32×32 follower, 4-dir × 2 frames; must read as the painted bot at a glance. |

**Slice 0 ships exactly four new sprite classes:** one tileset, one player walker, one NPC, one door.

**Arena combat:** do not generate pixel attack sheets. Existing pipeline in `mobile/src/components/character/holobotAnimationAssets.ts`: ACE arena idle is 50 frames, 8 cols × 7 rows, 30 fps, video+sheet. Story encounters reuse that view.

## Dialogue portraits

Reuse `mobile/assets/holobots/headshots/*.png` as-is (12 painted 3/4 busts: ace, era, gama, hare, ken, kuma, kurai, shadow, tora, tsuin, wake, wolf). Slot 128×128 inside `GameDialogFrame`, left, gold eyebrow nameplate. Headshots sit on studio gray — frame fill `#050606` behind them is enough for slice 0; no re-export. One human NPC gets a single painted bust; every later NPC is an edit-chain of that bust. Mouth flap optional (2 frames @ 6 fps); a still is fine for slice 0.

## UI chrome — native RN, not Pixi HUD

Pixi HUD today is white monospace + black stroke (`overworld/OverworldScene.ts` `TextStyle` fill `0xffffff`, stroke `0x000000`). Story overlays are RN:

- Dialogue / journal / reward → `GameDialogFrame` in `mobile/src/components/ui/GameSurfaceFrame.tsx` (default `accent="#f0bf14"`, `fill="#0b0c0e"`).
- Door / choice confirm → `GameSurfaceFrame` (same file) + `ArenaControlFrame` in `mobile/src/components/arena/ArenaTierFrames.tsx` (default `accent="#f0bf14"`).
- **Fitness-gated region (protect this):** gold frame, `#ff4d39` lock glyph, one mute-cream line (`SYNC X KM TO UNLOCK`). Must not look like Arena entry.

Don'ts: no rounded rects, no new yellow, no 1800×3200 Figma artboard inside Pixi (`ARTBOARD_WIDTH` / `ARTBOARD_HEIGHT` in `mobile/src/config/figmaAssets.ts` stay Home/Fitness only).

## Generation-batch strategy

1. **Anchor.** ACE full (`mobile/assets/holobots/full/ace.png`) + ACE headshot are the style bible. Never regenerate a named Holobot. ACE is the immutable style anchor.
2. **Slice 0, one prompt family.** Tileset first (verify a 2×2 seam), then player, then NPC, then door. Same lighting (top-left, hard), same outline weight, same magenta key.
3. **Arena sheets stay video-first.** Overworld walks stay 4×4 frames. Do not copy the 50-frame ACE idle onto town sprites.
4. **Slice 2 art pass.** Extra NPCs as edits of the slice-0 NPC. Fitness-lock as a tint overlay on existing wall/path, not a new biome. Spend the art budget on the gate, not more walkers.
5. **Reject.** GB 4-color conversion, pastoral grass town, 50-frame walk cycles, mixing Figma canvas into Pixi.

### Proposed asset layout (proposed)

Pixi: PNG sheets, nearest-neighbor scale, magenta `#ff00ff` keyed. RN: existing headshot PNGs plus the one NPC bust; chrome is SVG frames, not rasters.

```
overworld/assets/story/          Pixi PNG, nearest-neighbor
  tiles/tileset.png              256×256, 8×8 cells of 32×32
  walkers/player.png             32×48 cells, 4-dir × (4 walk + idle)
  walkers/npc-01.png             same cell spec
  props/door.png                 32×64, 2 frames
mobile/assets/story/             RN overlays
  portraits/npc-01.png           painted bust, edit-chain source
```

## Falsifier

If slice 0 ships more than four new sprite classes, or if anyone starts pixel-redrawing ACE, the batch has already slipped.
