# HoloCity mobile HUD port (W5)

The mobile HUD uses Carbon `#101318`, the shared navy panel `#081723`, cyan panel edges `#62DDE8`, corner ticks, and the Unity Rajdhani / Saira typography. `src/theme.ts` is the shared token contract for the dashboard, collection, combat, city hub, and existing mobile screens.

## Source provenance

The local source folder was `HolobotsUnity`, whose Git origin is **https://github.com/Pak209/Holocity.git**, at commit `99a1b23fb5d335c8317a2740f02f1a75c9a299b5`.

Read source:

- `Assets/UI/Tokens/HudTokens.cs` — Carbon, navy panel, cyan edge, amber selection cursor, spacing and typography.
- `Assets/UI/Foundation/Runtime/HoloPanelToken.cs` — notched panels and corner ticks.
- `Assets/UI/Foundation/Runtime/SlotAccentPalette.cs` — player `#2FE6FF / #7CFF4F / #B07CFF`; rival `#FF7A1A / #FF3D8B / #FFD21A`, indexed by slot and wrapping at three.
- `Assets/UI/Foundation/Runtime/HoloCombatHudView.cs` and `Documentation/UI/reference/combat-hud-2026-09-12/00_full_reference.png` — combat plate hierarchy.
- `Assets/Holobots/Shared/Scripts/Runtime/Dashboard/HomeScreen.cs` and `HolobotStatsPage.cs` — identity/squad layout and the **verbatim host rank** `TIER · <rank>` row.
- `Assets/Holobots/Shared/Scripts/Runtime/Rival/RivalCooldown.cs` — session-local presentation of host cooldown observations, never a client eligibility ruling.
- `Assets/UI/Resources/HoloUI/Items` and its font files/licenses.

## Assets and reproducibility

The request named 92 icons. This source revision contains **105 tracked PNG filenames**, all copied to `assets/items`. No arbitrary subset was discarded. The files have 104 unique SHA256 hashes: `clothing.socks_kneehighs.png` and `clothing.socks_stripedkneehighs.png` share source bytes but retain separate item IDs.

The copied icons total **18,938,563 bytes (18.94 MB decimal / 18.06 MiB)**. `assets/items/manifest.json` records every filename, byte size, SHA256, source path, and source commit. `assets/items/index.ts` is generated with literal Metro `require()` entries. The registry supports Unity's mixed dot/underscore filenames and host item aliases; marketplace, inventory, equipped parts and Holos balance use the ported assets. Existing leg-part art is retained because the Unity source has no matching leg-part icon.

```sh
# Run from the mobile/ directory. Supply the source checkout explicitly.
node scripts/sync-holo-ui.mjs /path/to/HolobotsUnity
node scripts/verify-holo-ui.mjs
npm run typecheck
npm test -- src/lib/__tests__/rivalHud.test.ts
```

Fonts are bundled under `assets/fonts` with the upstream OFL licenses. `HoloDisplay` is Rajdhani Medium; `HoloBody` is Saira Regular.

## Screen coverage and behavior

| Surface | Port and preserved behavior |
| --- | --- |
| Dashboard | Responsive HUD, host rival ladder status, wallet balance, observed rival countdown, selected Holobot TIER row, equipment, collection, quick navigation, squad, pilot stats, settings, native city entry. |
| Inventory / roster picker | Canonical `HolobotRosterCard`, slot accent/ring, experience meter, host rank, blueprint state, and W6 live viewer for the active card. Remaining cards retain portraits to avoid twelve simultaneous GL contexts. |
| Holobot detail | Live viewer, verbatim host rank, existing stats/abilities/blueprints, boosts, sync upgrades and mint actions. |
| Fitness | Responsive session/telemetry plates, SP/Holos/XP previews, workout partner, watch guard, unit settings, Quick Refill, claim/retry rewards, pause/resume/reset. |
| Arena / combat | Responsive command cards with contained cost/damage/state labels, vector navy arena floor and active-slot rings, embedded-safe-area support, scroll fallback for small/font-scaled viewports, existing 1v1/3v3/PvP and result callbacks. |
| Marketplace / Gacha | Ported item/Holos art, navy catalog/pack plates, existing server purchase/open flows. |
| Training / Quests / Leaderboard | Shared typography, surface frames, page and text tokens; original selection, timers, claim actions and ranking data. |
| Login / settings | Token dialog frames, readable field borders; original auth, Face ID preferences and account controls. |
| Overworld / WebSection | Native loading/error/overlay chrome uses tokens. The remote web document remains owned by its web application. |

`HoloCityCommandBar` provides the reusable portrait 2×2 Carbon command tiles for STRIKE / HEAVY / DEFEND / FINISHER. It reads caller-supplied cost/detail/selection and does not resolve combat or rewards. Without `onPress`, the tiles are informational replay surfaces. With `onPress`, they are touch buttons with a truthful TAP socket. Default informational sockets R1 / L2 / R2 / X come from `Assets/Holobots/Contracts/InputBindings.cs` and `InputGlyphs.cs` (Command0–3, PlayStation/generic pad); displaying them does not implement controller support. `CombatHudPresentation.cs` and `HoloCombatHudView.cs` supply the host-cost contract: absent costs remain UNAVAILABLE. Tile accent defaults use the imported ring palette in the source command-art order (cyan / orange / yellow / purple); callers can supply the active pilot's ring colour. `HoloCombatCommandGraphic.Accent` is the category-colour reference.

The common navigation key opens Dashboard, HoloCity, pilot stats, settings, Story, and PvP (where available); the former vertical stack no longer covers screen content.

The dashboard's **rival ladder tier** is distinct from a Holobot's **TIER rank**. `HolobotRosterEntry.hostRank` carries the raw host value; the latter is omitted when no host rank was supplied. Existing progression calculations still use the existing normalized rank for behavior.

`useRivalStatus` bounds status requests, ignores late replies after account changes/unmount or a newer same-account host publication, refreshes on navigation focus/foreground, and shares host settlement status. Cooldowns are per pilot and per authenticated account, observed from confirmed settlement or `retryAfterMs` refusal. The private server ledger is not readable by the mobile client. Missing observations display an unknown countdown and invite selecting a rival; they do not falsely show every rival as ready. Reloading the app clears these presentation observations. A rematch always asks the host again.

## Verification and evidence

- TypeScript passed after the port.
- Thirteen focused tests passed across HUD countdown/rank/palette, item aliases/unknown ids, combat visual-state routing, and existing finisher eligibility. The four HUD tests cover cooldown expiry/round-up, per-rival selection, exact six-colour Unity wrapping, and host rank labels without level-derived fallback.
- The asset verifier checked all 105 index entries, hashes, and byte counts.
- Home/Fitness action audit against the original source retained existing navigation, equipment updates, roster selection, workout and claim callbacks.
- Native iOS screen captures are recorded in `Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots` at the repository root. Captures use a development-only offline fixture, with no Pak account, deployment, or real purchase.
- Viewer loading, per-bot size, bundle size and simulator FPS are measured by W6 / integration and are reported with the shared PR evidence. W5 does not infer FPS from screenshots.

No W5 human-only blocker was encountered. Live server purchases, physical sensors and account operations were not exercised under the offline fixture.
