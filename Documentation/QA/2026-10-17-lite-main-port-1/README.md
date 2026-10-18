# lite-main-port-1: port lite #126, #127 and #128 into main's gated lite tree

Base: `origin/main` `3b1e790d80f2ef8067bdcb7b1e94c6aa0047b04f` (#129). Branch `claude/lite-main-port-1`.

Main's gated copy (#125) was taken from `mobile-holocity-lite` at `51abaa9` (#121). Before this PR, the four existing files these merges touch matched `51abaa9` exactly, apart from the `@/…` → `@/lite/…` path rewrite and main's lazy `Enabled*` module split. So main was missing three later lite merges. This PR ports those three merges and fixes the offline-preview script (L23). It closes critic rows **L6** and **L23**:

- **L6.** On main, EXIT ARENA was carbon `#101318` on the raised plate `#102532` (1.18:1). It is now the accent label (9.77:1). Also, `EnabledArenaAdmittedPreview` no longer prints the fixture's rewards under a "NO REWARDS" subtitle.
- **L23.** `scripts/package-offline-preview.mjs` used `node_modules/expo/AppEntry.js` and never set `EXPO_PUBLIC_HOLOCITY_LITE=1`, so a preview packaged from main could never show lite.

## Source PR → files

Every ported `mobile/src` file equals the lite-branch file at `e281819` after the path rewrite (checked with `diff` for each file). `ArenaScreen.tsx` keeps #125's shared `@/types/profile` import. Two shared root files differ on purpose: `mobile/index.js` gains a comment about main's entry, and the preview script also sets the lite flag (L23).

| Source PR (merge SHA) | Lite-branch file | Main file |
|---|---|---|
| #126 `fc29189fd` offline QA capture routes | `mobile/src/qa/HoloCityPreview.tsx` | `mobile/src/lite/qa/EnabledHoloCityPreview.tsx` |
| | `mobile/src/qa/previewRoutes.ts` | `mobile/src/lite/qa/previewRoutes.ts` |
| | `mobile/src/qa/__tests__/previewRoutes.test.ts` | `mobile/src/lite/qa/__tests__/previewRoutes.test.ts` |
| | `Documentation/QA/2026-10-17-lite-cpu-capture-2/README.md` | not ported (lite-branch evidence) |
| #127 `f7109033f` project-local entry, cached w64 QA scheme | `mobile/src/qa/HoloCityPreview.tsx` | `mobile/src/lite/qa/EnabledHoloCityPreview.tsx` |
| | `mobile/src/qa/previewDeepLink.ts` | `mobile/src/lite/qa/previewDeepLink.ts` |
| | `mobile/src/qa/__tests__/previewDeepLink.test.ts` | `mobile/src/lite/qa/__tests__/previewDeepLink.test.ts` |
| | `mobile/index.js` | `mobile/index.js` (shared root; one comment added) |
| | `mobile/scripts/package-offline-preview.mjs` | same (`--entry-file index.js`) |
| | `mobile/package.json` `"main": "index.js"` | **not ported**: stays `expo/AppEntry` (see below) |
| #128 `e281819f7` RESULT presenter, legible EXIT ARENA | `mobile/src/components/arena/BattleResultsModal.tsx` | `mobile/src/lite/components/arena/BattleResultsModal.tsx` |
| | `mobile/src/components/arena/arenaResultPresenter.ts` | `mobile/src/lite/components/arena/arenaResultPresenter.ts` |
| | `mobile/src/components/arena/__tests__/arenaResultPresenter.test.ts` (+ `.snap`) | `mobile/src/lite/components/arena/__tests__/…` |
| | `mobile/src/qa/ArenaAdmittedPreview.tsx` | `mobile/src/lite/qa/EnabledArenaAdmittedPreview.tsx` |
| | `mobile/src/screens/ArenaScreen.tsx` | `mobile/src/lite/screens/ArenaScreen.tsx` |
| L23 (main only) | n/a | `mobile/scripts/package-offline-preview.mjs`: `EXPO_PUBLIC_HOLOCITY_LITE: '1'` |

Import rewrites: `@/theme` → `@/lite/theme`, `@/types/arena` → `@/lite/types/arena`, `@/screens/…` → `@/lite/screens/…`. `@/contexts/AuthContext` stays shared, as in #125. Main's original-app files are untouched, including its own `mobile/src/components/arena/BattleResultsModal.tsx`.

## Entry decision: `package.json` "main" stays `expo/AppEntry`

On main, `"main"` is the original app's Release entry. Both the iOS "Bundle React Native code and images" phase and `android/app/build.gradle` call `expo/scripts/resolveAppEntry`, which reads it. Switching it to `index.js` would change the entry module of every Release build: `index.js` imports the whole `expo` index (`errors/ExpoErrorManager`, `environment/ExpoGo`, `hooks/useEvent` and the `expo-modules-core` re-exports), where `AppEntry` imports only `registerRootComponent`. That is Expo's standard template and probably harmless, but it is not byte-for-byte, and no native Release build can be run here to witness it. So this PR:

- keeps `"main": "expo/AppEntry"`. `resolveAppEntry` resolves to `node_modules/expo/AppEntry.js` both before and after.
- adds `mobile/index.js`, which is inert for Release (Expo only falls back to `index.*` when `"main"` is absent). The offline preview passes it explicitly as `--entry-file`, which fixes the symlinked-`node_modules` `../../App` failure for that script.
- leaves `expo start` / `expo export` in a worktree with symlinked `node_modules` resolving `../../App` outside the checkout, as before. That only affects QA harnesses and is listed below as a follow-up.

The preview script now also sets `EXPO_PUBLIC_HOLOCITY_LITE=1`. Without it, `isLitePreviewEnabled()` is false and the "preview" was the original app in dev mode. The script only targets simulator `.app` bundles. It is not a Release mechanism: no committed path sets the flag for an archive.

## Flag-off proof

"Before" is `origin/main` `3b1e790`. "After" is this branch. Both trees were exported with `git archive` into the scratchpad, with an APFS clone of the same local `node_modules` (no install, no network).

1. **Diff scope.** `git diff --name-only origin/main..HEAD` touches only `mobile/src/lite/**`, `mobile/index.js`, `mobile/scripts/package-offline-preview.mjs` and this README. There are no edits to `App.tsx`, `MainApp.tsx`, `LiteApp.tsx`, `package.json`, `src/config/liteFeature.ts` or any original-app file.
2. **Import graph.** A walk of the runtime imports in `mobile/` (static imports, `import()` and `require`, type-only imports skipped) starting at `MainApp.tsx` + `src/config/liteFeature.ts` reaches 229 project modules and **0** under `src/lite/**` or `LiteApp.tsx`. None of the ported modules is reached, and neither is `index.js`. The ported modules are reachable only through `App.tsx -[import()]-> LiteApp.tsx`, which `App` takes only when `EXPO_PUBLIC_HOLOCITY_LITE === "1"`. A grep finds no file outside `src/lite` and `LiteApp.tsx` that names `arenaResultPresenter`, `previewRoutes`, `previewDeepLink`, `EnabledHoloCityPreview`, `EnabledArenaAdmittedPreview` or any `/lite/` path. (The one exception is the existing `liteBoundary.test.ts`.)
3. **Release entry.** `node -e "require('expo/scripts/resolveAppEntry')" <mobile> ios absolute` gives `node_modules/expo/AppEntry.js` both before and after.
4. **Offline `expo export --platform ios`, env unset.** Run with `--no-bytecode --no-minify --source-maps --clear`, `EXPO_OFFLINE=1`, and `EXPO_PUBLIC_HOLOCITY_LITE` / `_PREVIEW` / `_PREVIEW_SCREEN` unset. **Both exit 0** (85.7 s / 34.2 s).
   - Bundle `AppEntry-f5e7828c….js` 11,898,282 B → `AppEntry-83a328f9….js` 11,902,288 B. Entry `node_modules/expo/AppEntry.js` in both. `index.js` is not in either bundle.
   - Source-map modules: 1,577 → 1,580. Added: `src/lite/components/arena/arenaResultPresenter.ts`, `src/lite/qa/previewRoutes.ts`, `src/lite/qa/previewDeepLink.ts`. Removed: none. Changed `sourcesContent`: only `src/lite/screens/ArenaScreen.tsx`, `src/lite/components/arena/BattleResultsModal.tsx`, `src/lite/qa/EnabledHoloCityPreview.tsx` and `src/lite/qa/EnabledArenaAdmittedPreview.tsx`. The other 1,573 modules are identical.
   - In both bundles `isLiteEnabled` compiles to `function isLiteEnabled() { return false; }`, with 0 raw `EXPO_PUBLIC_HOLOCITY_LITE` references left.
5. **Boundary behaviour.** `src/config/__tests__/liteBoundary.test.ts` cannot load here (see HELD), so a scratch stand-in ran its assertions with `react-dom/server` (19.0.0, installed) in both trees. The stand-in was not committed. For `EXPO_PUBLIC_HOLOCITY_LITE` unset / `"0"` / `"true"` / `"01"`, `App` renders the main flow and the `LiteApp` module is never evaluated. Only `"1"` renders lite. Preview also needs the lite flag. **6/6 pass before, 6/6 pass after.**
6. **L23, the real script.** `node scripts/package-offline-preview.mjs` ran against a stub simulator `.app` (`Info.plist` `DTPlatformName=iphonesimulator`) inside each tree. Both exit 0 and pass the script's asset checks.
   - Before: entry `__r(0)` = `node_modules/expo/AppEntry.js`. The env module defines only `EXPO_PUBLIC_HOLOCITY_PREVIEW: "1"`, so `isLiteEnabled()` is false and the preview is the original app in dev mode.
   - After: entry `__r(0)` = `index.js`. The env module defines `EXPO_PUBLIC_HOLOCITY_LITE: "1"` and `EXPO_PUBLIC_HOLOCITY_PREVIEW: "1"`, so the gated lite offline preview is what gets packaged. Nothing was installed or launched.

## Test counts (full mobile suite, same worktree, same shared `node_modules`)

| Run | Before (`origin/main` 3b1e790) | After (this branch) |
|---|---|---|
| `npx vitest run` test files | 80 passed, 2 failed, 1 skipped (83) | 83 passed, 2 failed, 1 skipped (86) |
| `npx vitest run` tests | 877 passed, 4 skipped (881) | 911 passed, 4 skipped (915) |
| `npx tsc --noEmit` | 2 errors | 2 errors (identical) |

The per-file results are identical except for the 3 new files: `arenaResultPresenter.test.ts` (9), `previewDeepLink.test.ts` (15) and `previewRoutes.test.ts` (10), which make up the +34 tests. The 2 failing files and both tsc errors are the same before and after. All of them are `Cannot find module 'react-test-renderer'` in `src/config/__tests__/liteBoundary.test.ts` and `src/lib/hostState/__tests__/hooks.test.ts` (see HELD). The worktree sparse set adds `functions/` and `docs/` read-only, because main's parity tests import them. Without them, 23 files fail to load. Neither path is edited.

## Known LOW follow-up

- **QA deep-link schemes (security critic).** The `__DEV__` + `EXPO_PUBLIC_HOLOCITY_LITE=1` + `EXPO_PUBLIC_HOLOCITY_PREVIEW=1` harness listener accepts `holobotsmobile://`, `holobotsw64://` and `fun.holobots.mobile://` `qa/<Screen>` links. It is ported as is from #127 and limited to own-key screen names (no `__proto__`/`constructor`, no query or extra segments). Narrowing it to the one cached simulator scheme is a separate change.

## HELD

- **`react-test-renderer` dependency gap.** Main's `mobile/package.json` declares `react-test-renderer` and `@types/react-test-renderer` 19.0.0. The shared local `node_modules` used here (from the lite checkout) lacks them, so `liteBoundary.test.ts` and `hostState/__tests__/hooks.test.ts` cannot load either before or after. Nothing was installed. The `react-dom/server` stand-in above covers the boundary assertions. This PR's CI (`npm ci`, then `tsc` + `vitest`) is the run of record for both files.
- **`package.json` `"main": "index.js"` (#127) is not ported.** See the entry decision above. Switching main's Release entry needs its own reviewed change, plus a native Release build witness.
- **Symlinked `node_modules` in `expo start` / `expo export`** still resolves `expo/AppEntry`'s `../../App` outside the checkout on main. This affects QA harnesses only. The preview script is fixed by its explicit entry.
- **No simulator witness or native build.** None was taken (not required). No account, deploy or install.
- **#126's lite-branch QA README** (`Documentation/QA/2026-10-17-lite-cpu-capture-2/`) is lite-branch evidence and is not copied.
- **Later lite merges are out of scope.** `origin/mobile-holocity-lite` has since moved to `59d30c9` (#131 market browse, #132 dashboard live). Main's gated copy does not have those yet.
