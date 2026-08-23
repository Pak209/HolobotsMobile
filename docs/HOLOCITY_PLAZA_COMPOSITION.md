# HoloCity plaza composition (Round B)

Art-direction source for composing the civic plaza + H3 Core. Visual claims **from reference sheet** (`overworld/assets/reference/holocity-terrain-tileset-reference.png`, `holocity-buildings-reference.png`). Names match `overworld/assets/runtime/atlas-manifest.json`. One reference cell ≈110 px ≈ one 32-px game tile. Map 20×20; plaza **x5–14 × y7–15**. Arena entrance stays **(10,5)**; gacha entrance **(4,10)**; Guide **(11,9)**; spawn **(10,10)**. Do not place `arena-colosseum` / `gacha-shrine` / `story-archive` sprites inside this slice (their footprints sit outside or on the edge — keep existing callbacks). No floating labels. See `docs/ART_STYLE_GUIDE.md`.

Tiles = full cells (replacement, not overlays). Tall props = **bottom-anchor**. `redraw` = do not repeat-tile. `aspectDistortion` = stretched 128×128 re-export.

## 1. Visual glossary

| name | depicts (from sheet) | use | anchor | flags |
|---|---|---|---|---|
| `floor-plaza-a` | clean light stone | plaza fill A | cell | — |
| `floor-plaza-b` | light stone + moss tuft | fill B | cell | — |
| `floor-plaza-cracked-a` | cracked light stone | sparse cracks | cell | — |
| `floor-plaza-mossy` | mossy cracked stone | edge wear | cell | — |
| `floor-plaza-cross-seam` | + mortar seams | under path nodes | cell | — |
| `floor-plaza-inlay-gold` | gold + on light stone | gold-path bed | cell | — |
| `floor-plaza-glass-inlay` | glass square inlay | **avoid tiling** — 1× accent max | cell | **redraw** |
| `path-cyan-h-a` | cyan circuit H on dark metal | H runs (rot90 = v) | cell | **aspectDistortion** |
| `path-cyan-corner` | cyan L | turns toward Core | cell | **aspectDistortion** |
| `path-cyan-t` | cyan T | Guide tile / junction | cell | **aspectDistortion** |
| `path-cyan-cross-a` | cyan + | spawn node | cell | **aspectDistortion** |
| `path-cyan-node-round` | round cyan node | Core approach accent | cell | **aspectDistortion** |
| `path-gold-h` | gold line H on light stone | one guidance run | cell | — |
| `path-gold-end` | gold stub | terminate gold | cell | — |
| `path-gold-corner` | gold L | gold turn | cell | — |
| `canal-h-a` | holo canal H | 2-tile segment only | cell | **redraw + aspectDistortion** — **avoid tiling** |
| `canal-bend` | canal L | unused this slice | cell | **redraw + aspectDistortion** — **avoid** |
| `canal-pool` | small square pool | canal cap | cell | **redraw** — **avoid tiling** |
| `curb-straight-a` | gold-capped stone curb | long edges | bottom | — |
| `curb-corner-a` | inner L curb | outline corners | bottom | — |
| `curb-u-notch` | U notch | width change / stairs mouth | bottom | — |
| `curb-u-wide` | wide U | south taper | bottom | — |
| `curb-gold-bend` | gold-piped S curb | gold-path exit | bottom | — |
| `curb-s-bend` | S-bend curb | **avoid** | bottom | **redraw** |
| `stairs-wide-a` | wide steps + gold posts | Core door + west ramp | bottom | — |
| `stairs-post` | single post | stair flanks | bottom | — |
| `ramp-gold` | gold centerline ramp | west transition alt | bottom | — |
| `planter-long` | long stone planter | west bed | bottom | — |
| `planter-box-a` | square planter | east bed | bottom | — |
| `bush-flower-a` | yellow flowers | veg cluster | bottom | — |
| `shrub` | green shrub | veg cluster | bottom | — |
| `fern` | fern | veg cluster | bottom | — |
| `tree-a` | small canopy tree | SE occluder | bottom | — |
| `lantern-cyan-tall` | tall cyan lamp | Core flanks | bottom | — |
| `lantern-gold` | gold lamp | south pair | bottom | — |
| `bench` | stone bench, gold trim | south sit | bottom | — |
| `terminal-holo` | cyan holo kiosk | gold-line terminus | bottom | — |
| `bollard-gold` | short gold bollard | path pinch | bottom | — |
| `pillar-cyan` | cyan pillar | Core door posts | bottom | — |
| `crate-stone` | weathered crate | cluster | bottom | — |
| `crate-metal` | metal crate | cluster | bottom | — |
| `debris-holobot` | collapsed bot + rubble | repair point | bottom | — |
| `data-wisp` | cyan orb + trail | particles (reuse) | center | — |
| `pad-target-round` | cyan targeting disc | Core roof glow | cell | — |
| `h3-core-sanctuary` | cylindrical sanctuary, cyan rings, **south stairs** | landmark | bottom @ door | — |

## 2. Plaza plan (x5–14, y7–15)

Legend: `P`=`floor-plaza-a` `p`=`floor-plaza-b` `c`=`floor-plaza-cracked-a` `m`=`floor-plaza-mossy` `=`=`path-cyan-h-a` `|`=same rot90 `+`=`path-cyan-cross-a` `L`=`path-cyan-corner` `T`=`path-cyan-t` `g`=`path-gold-h` `e`=`path-gold-end` `~`=`canal-h-a` `o`=`canal-pool` `S`=`stairs-wide-a` `H`=Core body (block) `D`=doorway (walk) `.`=outside indent.

```
      5 6 7 8 9 10 11 12 13 14
 y7   . . p H H  H  H  H  c  .
 y8   p P P H H  H  H  H  p  m
 y9   = = = = L  D  T  =  =  c
y10   | p P P P  +  p  |  m  p
y11   | c P p P  |  g  e  L  =
y12   S P p c P  |  P  ~  ~  o
y13   . m P P P  |  p  P  c  .
y14   . . c p P  |  p  .  .  .
y15   . . . . p  m  .  .  .  .
```

Non-rect curb (lowDecor, overlay; **no** `curb-s-bend`): `curb-corner-a` (6,8)(7,7)(13,7)(13,8)(5,11)(6,13)(12,14)(14,10); `curb-straight-a` on west x5 y9–10, east x14 y9, south y14 x8–10; `curb-u-notch` (5,12) at `S`; `curb-u-wide` (10,15); `curb-gold-bend` (12,11). Cyan converges on `D`(10,9) from W/E/S (`+` at spawn). One gold line (11–12,11) → terminal. Core stairs on `D`; west ramp `S`(5,12). Canal (12–13,12)+`o`(14,12). Cracks/moss only as shown.

## 3. Prop placement

| name | x,y | layer | block | note |
|---|---|---|---|---|
| `planter-long` | 5,8 | lowDecor | y | west bed |
| `planter-box-a` | 13,8 | lowDecor | y | east bed |
| `bush-flower-a` | 5,11 | lowDecor | y | W cluster w/ shrub |
| `shrub` | 6,13 | lowDecor | y | SW cluster |
| `fern` | 13,10 | lowDecor | n | E of path |
| `tree-a` | 14,13 | foregroundOcclusion | y | SE canopy |
| `lantern-cyan-tall` | 7,8 | actors | y | Core west flank |
| `lantern-cyan-tall` | 12,8 | actors | y | Core east flank |
| `lantern-gold` | 7,14 | actors | y | south pair |
| `lantern-gold` | 12,14 | actors | y | south pair |
| `bench` | 7,13 | lowDecor | y | faces N to Core |
| `terminal-holo` | 12,11 | actors | y | on gold `e`; kiosk lighting IDs it (no text) |
| `bollard-gold` | 9,10 | lowDecor | y | pinch at spawn |
| `bollard-gold` | 11,10 | lowDecor | y | pinch at spawn |
| `crate-stone` | 6,11 | lowDecor | y | cluster |
| `crate-metal` | 5,12 | lowDecor | y | cluster (stairs landing) |
| `debris-holobot` | 12,13 | actors | y | **repair point**; interact facing N |
| `data-wisp` | see note | lightingParticles | n | ≤12; reuse sprite; float ±4 px, 1.8–2.6 s |

Wisp tiles (12): (10,7) (9,8) (11,8) (10,9) (8,10) (12,10) (7,11) (10,12) (12,12) (13,12) (6,9) (13,9).

## 4. H3 Core

- Sprite `buildings/h3-core-sanctuary.png` origin tile **(8,7)**; visual ~5×3 tiles (x8–12, y7–9). South-facing stairs align to **`D` (10,9)** — overlay `stairs-wide-a` + `stairs-post` on (9,9).
- **Block** body: (8–12,7–8). **Walk** doorway (10,9) and Guide (11,9). Side wings (8,9)(12,9) blocked (lanterns/planters of the art).
- **Interact** (10,10) facing N (spawn). A-button zone for the H3 callback. Do not move Arena **(10,5)** / Gacha **(4,10)** / Story callbacks off their current tiles.
- Glow: `pad-target-round` at (10,7) roof disc; pulse **scale 1.00→1.08**, **alpha 0.55→1.00**, **period 2.4 s**; no fullscreen filters.
- Y-sort anchor: bottom-center of stairs, tile **(10,9)** south edge. Pilot y&lt;9 draws behind foundation; y≥10 in front of plaza.

## 5. Lighting / palette

`docs/ART_STYLE_GUIDE.md`: cyan `#17d9ff` **primary** (circuits, lanterns, canal, wisps, Core rings). Story Gold `#f0bf14` **sparse** (one path, two lamps, bollards, curb caps). Ink `#050606` in metal beds. No new yellow. Gold lines: the single `g–e` run only. Hangar-district stone, not grass fill (veg is props, not `grass-full-*` carpets).

## 6. Asset risks

| name | flag | workaround |
|---|---|---|
| `floor-plaza-glass-inlay` | redraw | skip this plaza |
| `canal-h-a` `canal-h-b` `canal-h-c` `canal-t` `canal-cross-a` `canal-cross-b` `canal-node` `canal-joint` | redraw+aspectDistortion | use **one** `canal-h-a` pair; do not autotile |
| `canal-bend` | redraw+aspectDistortion | unused |
| `canal-pool` | redraw | one cap tile |
| `path-cyan-*` (all 9) | aspectDistortion | replacement strips OK; don't mix stretch with gold on the same cell |
| `grass-*` | aspectDistortion | not plaza fill |
| `curb-s-bend` | redraw | unused; use `curb-gold-bend` / `curb-corner-a` |
