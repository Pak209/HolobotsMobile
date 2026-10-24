# Lite UX follow-up — offline simulator witness

The comparison sheet is `/Users/pak/HolobotsVault/QA/2026-10-24-lite-ux-followup/PAK_SHEET.png`. Its three rows are inventoried here:

| Row | Pak reference | iPhone 17 Pro | iPhone SE 3 |
| --- | --- | --- | --- |
| 01 navigation | `Reference/UI/Lite-UX-2026-10-24/01_nav_text_keys_vs_OG_icons.png` | `astra-lite-followup-pro-inventory-final.png` | `astra-lite-followup-se-inventory.png` |
| 02 Sync workout | `Reference/UI/Lite-UX-2026-10-24/02_sync_workout_OG_left_vs_lite_right.png` | `astra-lite-followup-pro-fitness-final2.png` | `astra-lite-followup-se-fitness-final2.png` |
| 03 Arena grid | `Reference/UI/Lite-UX-2026-10-24/03_arena_tiers_vs_entry_buttons.png` | `astra-lite-followup-pro-arena.png` | `astra-lite-followup-se-arena.png` |

The six captures are in the same vault directory. All use the local offline preview fixture; no account or host was contacted. The reference column shows Pak's OG versus merged #211 comparison, and the two simulator columns show this change.

## Change

- Restored the OG round navigation silhouettes and 52 pt tap targets in the existing rail, with navy/cyan HoloCity styling, order, and actions.
- Restored the OG workout hierarchy: session counter, portrait and EXP, swap action, speedometer, large kilometres readout, rewards, and GO. Static bot portrait preserves the lite responsiveness.
- Aligned the two Arena payment buttons with the two-column tier-card grid.

## Gates

- Native iOS simulator QA build succeeded on iPhone 17 Pro and iPhone SE 3 with `EXPO_PUBLIC_HOLOCITY_LITE=1` and offline preview fixtures.
- Held Home/Inventory frame samples reached steady 60 fps on both simulators; the Sync page sampled approximately 59.5–60 fps. The screen recorder and sampling probes were removed from source after measurement.
- Picker touch-to-shown: 84 ms on Pro and 76 ms on SE, under the 300 ms gate.
- One tap from Inventory and Sync returned Home on both simulators.
- `npm run typecheck` and `npm test` passed locally: 122 files, 1,609 passing tests, three existing skips.

## Scope and limits

No production account, deployment, or host operation was used. This is an offline simulator witness; Pak's visual acceptance and the PR's CI remain separate gates. The comparison uses the existing fleet portrait and icon assets.
