# Lite UX restore 1 — offline simulator handoff

Pak's rule: retain the OG Home layout and direct navigation positions while using the HoloCity visual style. This lane changes presentation in `mobile/src/lite` only. It does not change host contracts, prices, fight authority, or deployment flags.

## Changes

- Inventory and Fitness roster cards and the Holobot picker use existing static portrait PNGs. The detail modal starts with a static portrait and mounts 3D only after **VIEW 3D**. Battle stages remain 3D; a single-bot stage uses a 30 fps draw cap without per-frame `gl.finish()` outside duels.
- The Lite `HomeCogButton` presents 52 pt direct HOME, STATS, SET, STORY, conditional PVP, and CITY keys. Fitness, City Hub, and City Market share it. The offline City Hub fixture now falls back to ordinary navigation when it has no navigation callback; a prior no-op made HOME and Vendor appear tappable without moving.
- Home rail and footer anchors match OG. The SE rail stays at least 48 pt, and the City entry is a real key. The rival countdown ticks in its own focused leaf; hidden tabs use `freezeOnBlur`.
- SEND, SELECT, and GO use filled cyan plates. GO is fully visible without scrolling on the SE. The Arena 3v3 notice follows the start buttons. The picker uses compact 72 pt rows and no fade animation.
- City Hub and City Market top copy clears the shared key column on SE.

## Before / after, same offline fixture

Source baseline: [lite-vs-og-ux-critique](../2026-10-24-lite-vs-og-ux-critique/README.md). Both measurements are iOS 26.5 Debug simulator builds with the real Lite screens under the disposable offline `UxHarness` and synthetic `previewProfile`. The harness was removed from the committed tree. A clean Metro launch of the normal Lite preview also reached Home after the harness was removed.

| Gate | Before | Restored 17 Pro | Restored SE |
|---|---:|---:|---:|
| Inventory JS fps, steady median | 14.2 | 60 (58 one-second windows) | 60 (latest 7 steady windows) |
| Sync JS fps, steady median | 17.1 | 60 | 60 |
| Workout-entry freeze | 2,180 ms | No ≥100 ms stall in sampled entry | No ≥100 ms stall in sampled entry |
| Picker | 1,576 ms freeze after opening | 85 ms touch-to-modal-show | 90 ms touch-to-modal-show |
| Section → HOME | 2 taps | 1 tap | 1 tap; 50–99 ms touch-to-second-frame in sampled returns |

The Pro Inventory entry had a 127 ms transient in one later rapid-navigation sample; its steady windows returned to 60 fps. The initial picker with a fade took 609 ms on Pro, so the transition was removed and retested at 85 ms. Measurements are JS `requestAnimationFrame` windows, not GPU frame pacing or device performance.

## Evidence in the vault

`~/HolobotsVault/QA/2026-10-24-lite-ux-restore-1/`

- `SHEET_og_vs_restored.png` (1500 × 5390): five rows, each with **OG 17 Pro | restored 17 Pro | restored SE**. Rows: Home, Inventory, Sync, picker, Arena. Every cell is labelled in the sheet.
- `SE_one_tap_flow.mp4`: Maestro-rendered, frame-verified Home → Inventory → Home → Sync → picker → Home → Arena flow, offline. Decoded sample frames at 1/4/8/12 seconds and visually inspected the Sync/GO frame.
- `shots/`: the final named Pro and SE captures, including City Hub and City Market. City views are new Lite routes and have no OG counterpart.
- `raw/`: Metro UXLOG journal and Maestro flow logs. `PICKER` timing used a disposable `Modal.onShow` probe and the harness's touch timestamp; both were removed from source before tests.

## Verification and limits

- `cd mobile && npm run typecheck`: pass.
- `cd mobile && npm test`: **122 files, 1609 tests pass; 3 existing integration skips**.
- iPhone 17 Pro and iPhone SE 3rd gen simulator: offline Home, Inventory, Sync, picker, Arena, City Hub, and City Market captures; no real account or network write.
- The signed-out City Market shows its expected sign-in plate; live catalog purchasing was not part of this offline presentation gate.
- No editor, real device, deploy, host contract, or authoritative fight action was used.
