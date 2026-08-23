# HoloCity Expansion — extending the atlas pipeline beyond the H3 plaza

Status: DRAFT — 2026-08-23. Describes how the Round B pipeline (on `main`) grows to the rest of HoloCity.
Anything marked **proposed** is not in the repo yet. Companion docs: `docs/HOLOCITY_PLAZA_COMPOSITION.md`
(art), `docs/ART_STYLE_GUIDE.md` (palette), `docs/STORY_BRIDGE_CONTRACT.md` (bridge), `docs/STORY_MODE_PLAN.md` (slices).

## (a) Pipeline recap + invariants (as built)

| Piece | File | What it does |
|---|---|---|
| Manifest | `overworld/assets/runtime/atlas-manifest.json` | `tiles` (128×128 re-exports in `runtime/terrain/`), `props` (keyed crops in `runtime/props/`), `buildings` (keyed in `runtime/buildings/`); per-entry `rect`, `redraw` (don't repeat-tile), `aspectDistortion` (stretched export) |
| Registry | `overworld/assets/textureRegistry.ts` | `import.meta.glob('./runtime/**/*.png', {eager, query:'?url'})` bundles every PNG (same-origin, hashed in build); `loadTextureRegistry()` sets `TextureSource.defaultOptions.scaleMode='nearest'` then loads each manifest name via Pixi `Assets` and re-asserts `nearest` per texture; `tile()/prop()/building()` throw on unknown names; `TILE_SCALE = 32/128`, `PROP_SCALE = 32/110` (one reference cell ≈110 px ≈ one tile) |
| Layout data | `overworld/maps/h3Plaza.ts` | pure data: `terrain` (tile overrides), `details` (rotatable path tiles), `canals`, `props` (name, tile, layer, blocks), `blocked`, `h3` (origin/footprint/doorway/interaction), `wispSpawns` |
| Collision | `overworld/TileMap.ts` | single source of truth: `BUILDINGS` placements + entrance tiles (`getEntrancePosition`), plaza cells → `path`, H3 footprint → `building` minus doorway, props → `prop`; `isWalkable()` |
| Scene | `overworld/OverworldScene.ts` | layers `ground → groundDetail → canals → lowDecor → actors (sortableChildren, zIndex = bottom y) → foregroundOcclusion → lightingParticles`, `uiOverlay` on stage; sprites anchored bottom-center; pulse/wisps are sprite alpha/scale only |
| Tests | `overworld/maps/__tests__/plazaCollision.test.ts`, `overworld/assets/__tests__/atlasManifest.test.ts` | BFS reachability of every entrance + guide, footprint/doorway/prop blocking, asset-name existence, no-redraw tiling bases; manifest↔PNG integrity (128×128 tiles, sizes, flags) |

Invariants to keep for every new district: **same-origin bundling only** (no fetch to other hosts); **nearest-neighbor
everywhere** (default + per-texture); **collision lives in `TileMap`/layout data, never derived from sprites**; **no floating
text labels** — identification by doorway lighting/signage props; **no full-screen filters** (particles/glow = sprites).

## (b) Recipe: adding a building or district

1. **Manifest + PNG** — add the entry under `buildings`/`props`/`tiles` with its source `rect`; drop the keyed PNG in the
   matching `runtime/<dir>/`; `npm test` (`atlasManifest`) must stay green (names `[a-z0-9-]`, tiles exactly 128×128).
2. **Layout module** — new `overworld/maps/<district>.ts` (pure, no pixi): terrain/details/props/blocked/anchors, mirroring
   `h3Plaza.ts`. Keep base tiling names `redraw:false`; use `redraw:true` pieces as one-offs.
3. **Placement + event** — add a `BuildingPlacement` to `BUILDINGS` in `TileMap.ts` (x, y, width, height, `event`), an
   entrance in `getEntrancePosition`, and — if interactive — a `BuildingEventId` in `TileTypes.ts` + a callback in
   `Interactions.ts` (`BuildingCallbacks` + `EVENT_TO_CALLBACK`). Non-interactive structures get no event.
4. **Sprite rules** (as implemented in `OverworldScene.buildMapGraphics`): building sprite `anchor(0.5, 1)`, `scale =
   PROP_SCALE`, positioned at footprint bottom-center `((x + w/2)·32, (y + h)·32)`, `zIndex = sprite.y`; **block the whole
   footprint, re-open the doorway tile** on the bottom row; **interaction tile directly south of the doorway** carries the
   `TileEvent`; optional `stairs-*`/`curb-*` props in front for the raised-foundation read.
5. **Signage** — a doorway marker in `lowDecor` on/near the entrance tile (`pad-target-round`, `lantern-*`, `terminal-holo`,
   cyan node tile) instead of text.
6. **Tests** — extend `plazaCollision.test.ts`: entrance reachable from spawn by BFS, footprint blocked except doorway, new
   layout names exist in the manifest, callback fires via `triggerBuildingEvent`.

Footprint estimate: `rect.w / 110` × `rect.h / 110` tiles (round up for the blocked footprint, keep the doorway column open).

## (c) Per-site plan

| Site | Sprite (rect) | Footprint est. | Entrance / collision | Layer | Callback / bridge | Notes |
|---|---|---|---|---|---|---|
| Arena | `arena-colosseum` (465×306) | ~4.2×2.8 → 4×3 | door bottom-center; today placement (8,2,4×3), entrance (10,5) | actors | **existing** `arena` → `enterArena`; bridge `ENTER_BUILDING 'arena'` (native answers `UNKNOWN_BUILDING` until allowlisted) | colosseum arc reads best with 1 tile of plaza stone in front |
| Gacha Shrine | `gacha-shrine` (353×282) | ~3.2×2.6 → 4×3 | placement (2,7,4×3), entrance (4,10) | actors | **existing** `gacha` → `openGacha`; native navigates to Gacha | purple crystals: keep cyan lanterns away; gold bollards ok |
| Story Archive | `story-archive` (405×282) | ~3.7×2.6 → 4×3 | **proposed** placement east of plaza; doorway south | actors | **proposed** `storyArchive` → `openStoryArchive`; bridge `ENTER_BUILDING 'storyArchive'` answered by native from slice 1 (journal) | cyan arch door = natural signage |
| Holobot Workshop | `holobot-workshop` (425×238) | ~3.9×2.2 → 4×2 (+1 row stairs) | today reskins `trainingLab` at (14,7), entrance (15,10) | actors | **existing** `trainingLab` → `openTraining` (rename **proposed** `workshop`) | crates/robot-arm art; align door to x=15 column |
| Pilot Supply Shop | `pilot-supply-shop` (411×238) | ~3.7×2.2 → 4×2 | **proposed** placement; awning faces south | actors | **proposed** `supplyShop` → `openSupplyShop` (Marketplace) | gold awning = the one warm accent allowed |
| Residential districts | `residential-hub` (418×287) | ~3.8×2.6 → 4×3 each | repeat with mirrored placement + varied planters; no entrance | actors | none | vary with `planter-*`/`vine-hanging`; never label |
| Transit Gate | `transit-gate` (436×287) | ~4.0×2.6 → 4×3 | today reskins `pvpTerminal` at (14,14), entrance (15,13) (north — **proposed** move entrance south of the gate) | actors | **existing** `pvpTerminal` → `openPvPTerminal`; **proposed** district transition = `SAVE_CHECKPOINT` with a new `mapId` + native `STORY_STATE` checkpoint hydration | gate glow = `data-wisp`/cyan node sprite, no filter |

## (d) Temporary programmatic character sheets → authored sheets

Round C authors the pilot, NPC (palette swap) and ACE companion **in code** under `overworld/characters/` (names
`temp-pilot`, `temp-pilot-npc`, `temp-ace`; canvas-drawn, nearest-filtered) — explicitly temporary. Replacement path
(**proposed**): add a `characters` section to `atlas-manifest.json`, e.g.
`"pilot": { "sheet": "characters/pilot.png", "cell": { "w": 32, "h": 48 }, "rows": ["down","up","left","right"], "frames": { "idle": 1, "walk": 4 } }`,
extend `textureRegistry.ts` with `character(name): CharacterSheet` (slices frames by cell grid, nearest), and swap the
constructor in `Player.ts`/`Npc.ts`/`Companion.ts` from `createPilotSheet()` to the registry — no scene changes.

## (e) Performance, memory, bridge implications

- Texture count today ≈ 115 PNGs (all 8 buildings, ~70 props, ~37 tiles) — fine for WKWebView; if districts push past
  ~300, group tiles/props into packed atlases (one `TextureSource` each) and keep the manifest names as frame aliases.
- Particles/glow: reuse one `data-wisp` texture across ≤12 sprites, animate `y`/`alpha`/`scale` only; **no filters**.
- Y-sort: only the `actors` band is sortable; static sprites set `zIndex` once; characters update per frame.
- Bridge: new districts need **no new inbound verbs** — `ENTER_BUILDING { buildingId }` covers them; the native allowlist
  (`STORY_BUILDING_IDS` in `mobile/src/config/storyMode.ts`) and, later, the server table grow instead. Map switches
  (**proposed**) ride on `SAVE_CHECKPOINT.mapId` + `STORY_STATE.checkpoint`; `DIALOGUE_STATE` (outbound) already gives
  per-NPC dialogue locking for any district.
