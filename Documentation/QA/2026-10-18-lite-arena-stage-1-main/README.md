# lite-arena-stage-1 (main): the gated port of lite #158

This port brings lite PR #158 (the CPU Arena round on the park-arena 3D duel stage) into `mobile/src/lite/**`, behind `EXPO_PUBLIC_HOLOCITY_LITE === "1"`. The behaviour, findings and simulator witness are in the lite PR and its `Documentation/QA/2026-10-18-lite-arena-stage-1/README.md`. The gate sheet is at `~/HolobotsVault/QA/2026-10-18-lite-arena-stage-1/GATE_SHEET.png`.

## Port

- **New:** `src/lite/components/duel/LiveDuelStage.tsx`, `src/lite/components/duel/liveDuelCommands.ts`, `src/lite/components/duel/__tests__/arenaLiveStage.test.ts` and `src/lite/qa/ArenaStagePreview.tsx`.
- **Changed:** `src/lite/components/city/CityLiveBattleView.tsx` (now a wrapper), `src/lite/screens/EnabledDuelPlaybackScreen.tsx` (FighterHud `levelTab`), `src/lite/screens/ArenaScreen.tsx`, `src/lite/lib/arenaCopy.ts`, `src/lite/qa/EnabledHoloCityPreview.tsx` and `src/lite/lib/__tests__/liteCopy.test.ts`.
- **Imports:** paths follow main's tree. The lite fork is used where one exists; otherwise the shared module (`components/arena/battleVisualStates`, `features/arena/finisherPolicy`, `assets/`). No new shared module is reached.
- **Test path reads:** the test reads FighterHud from `EnabledDuelPlaybackScreen.tsx`, per the lite-main-port-2 note on the lazy split.
- **Rebase:** rebased on `f6d77a2` (#156). The HELD `hostVitalsField` shim is gone there, so `ArenaScreen` keeps #156's `profile?.holobotVitals`.

## Flag-off proof (`EXPO_PUBLIC_HOLOCITY_LITE` unset)

"Before" is `f6d77a2` and "after" is this branch. Both are checked out as scratch worktrees with the same local `node_modules`. No install and no network were used.

1. **Diff scope.** 11 files: 10 under `mobile/src/lite/**`, plus this README. Nothing changes in `App.tsx`, `MainApp.tsx`, `LiteApp.tsx`, `package.json`, `src/config/liteFeature.ts`, any shared original-app file, `functions/` or `firestore.rules`.
2. **Import graph.** A walk of runtime imports (static, `import()`, `require`; type-only skipped) from `MainApp.tsx` + `src/config/liteFeature.ts` gives an **identical set before and after (116 modules), with 0 under `src/lite/**`**. Nothing outside `src/lite` references the new modules. `LiteApp` goes from 195 to 198 modules: it adds exactly the 3 new lite modules and no shared module.
3. **Offline `expo export --platform ios`, env unset.** Run with `CI=1 EXPO_OFFLINE=1 … --no-bytecode --no-minify --source-maps --clear`, using an APFS clone of `node_modules`. **Both exit 0.**
   - Modules: 1611 → 1614 bundled, and 1618 → 1621 source-map entries.
   - Only 8 modules differ, and **all 8 are under `src/lite/**`**.
   - **358 of 358 non-lite project modules and 1,122 of 1,122 `node_modules` modules are byte-identical.**
   - `isLiteEnabled` compiles to `return false`, with 0 raw `EXPO_PUBLIC_HOLOCITY_LITE` references.
4. **Tests (full mobile suite).**

| | Passed | Skipped | Failing files | tsc |
|---|---|---|---|---|
| Before (`f6d77a2`) | 1,374 | 4 | 2 | 2 errors |
| After | **1,390** | 4 | the same 2 | the same 2 errors |

The 2 failing files (`liteBoundary.test.ts` and `hostState/hooks.test.ts`) fail on the known missing `react-test-renderer` in the shared local `node_modules`, before and after. The tsc errors are the same 2 `react-test-renderer` ones.
