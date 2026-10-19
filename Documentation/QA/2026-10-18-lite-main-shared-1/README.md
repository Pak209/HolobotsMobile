# lite-main-shared-1: close lite-main-port-2's two HELD shared-file hunks

Base: `origin/main` `285e95bc55d59c40207ad795afecb9b62f6d0721` (#149), verified against GitHub. The proofs below were run on `8d60440` (#152 merge). The branch was then rebased onto `285e95b`; #153 and #149 change only `functions/`, `Schemas/` and docs, nothing under `mobile/`, and the full suite re-run on `285e95b` gives the same results. Branch `claude/lite-main-shared-1`.

Pak ruled on the two hunks #152 left HELD (see `Documentation/QA/2026-10-18-lite-main-port-2/README.md`): edit the shared original-app files, additively and carefully. This change does exactly that, and nothing the original app (MainApp) runs behaves differently.

## Changes

| File | What | Original app (flag unset) |
|---|---|---|
| `mobile/src/contexts/AuthContext.tsx` | `AuthContextValue.retryProfile: () => void`, implemented by `AuthProvider` (bumps `profileRevision`) and `OfflinePreviewAuthProvider` (no-op). The profile effect now depends on `[user, profileRevision]`. A retry of the **same account** keeps the failed read's error until the read answers. A successful retried read then clears it, last, after `setProfileLoading(false)`, so on an unbatched (legacy-root, iOS) render no state ever reads "signed in, no profile, loading, no error", which would make LiteApp unmount Home. | MainApp never calls `retryProfile`, so `profileRevision` stays 0 and `retrying` is always false. Every subscribe still clears the error up front. The success path's new clear runs only `if (retrying)`, so the original app's success path performs exactly the old two state updates. No existing member, export, type or default changed. |
| `mobile/src/types/profile.ts` | `readonly holobotVitals?: Readonly<Record<string, Readonly<{ currentHealth: number; maxHealth: number }>>> \| null` (the same shape as lite's `HostVitals`). | Optional, type only, erased from the bundle. |
| `mobile/src/lib/profile.ts` | `FirestoreUserDocument.holobotVitals?: unknown`; a private strict reader `readHolobotVitals` with the lite `readHostVitals` rules; `...(isLiteEnabled() ? { holobotVitals: … } : {})`, the same gate `storyFlags` uses. | The mapped profile has no `holobotVitals` key and equals today's output (tested). `updateUserProfile` writes an explicit allowlist with no `holobotVitals` (tested), so the client never writes it. |
| `mobile/src/lite/screens/HomeScreen.tsx` | Reads `retryProfile` from `useAuth()` again; the HELD workaround is gone. The file now **equals lite tip** (`d14e1d3`) after path mapping. | Gated lite only. |
| `mobile/src/lite/screens/ArenaScreen.tsx` | `hostVitals={readHostVitals(profile?.holobotVitals)}`; the `hostVitalsField` workaround is gone. The file now **equals lite tip**. | Gated lite only. |
| `mobile/LiteApp.tsx` | Comment only. The `profileReadPending` guard stays, because lite #142's same-batch `setProfileLoading(true)` at sign-in was **not** added to the shared AuthContext: it would change the original app's first render after sign-in. | Gated lite only. |
| `mobile/src/lite/lib/__tests__/homeRoster.test.ts` | The tripwire (`not.toContain("retryProfile")`) is now a positive test of the shared retry semantics, plus the LiteApp guard. | Test. |
| `mobile/src/contexts/__tests__/authProfileRetry.test.ts` (new) | Runs the **real** AuthProvider under a minimal hooks harness (no `react-test-renderer` needed), both batched and unbatched (each setter renders, like iOS's legacy root). It covers: the no-retry sequences (sign-in, success, failure, same-uid user object, sign-out); retry → a profile / no document / a new failure; and a guard that the shared sign-in order (`setUser` before the read starts) never changes. Against the **base** `8d60440` AuthContext, all 6 no-retry cases pass, so the original-app sequence is unchanged, and the retry cases fail. Against the pre-fix version, the critic's unbatched no-document retry fails. A mutant that sets the ref before computing `retrying` fails 4 cases. | Test. |
| `mobile/src/lib/__tests__/profileHolobotVitals.test.ts` (new) | Pins the following. Flag truly unset / `"0"` / `"true"`: the mapping has no key and is unchanged. Flag `"1"`: the mapping equals lite `readHostVitals` across 12 cases. `updateUserProfile` never writes the field. | Test. |

In a lite build, Home's roster RETRY now re-subscribes. A failed read shows CAN'T LOAD YOUR ROSTER + RETRY; a retry shows LOADING ROSTER… and then the roster or the failure again, never "NO HOLOBOTS YET" by mistake. The Arena KO guard reads the City's ledger, display only (Rule 1). The City still decides `holobot_ko`. No new player-visible copy was added.

## Proof (before `8d60440` → after this branch)

1. **Import graph.** From `MainApp.tsx` + `src/config/liteFeature.ts`: 229 → 229 modules, the identical set, 0 lite. From `LiteApp.tsx`: 434 → 434, identical. No new module edge: the vitals reader is inline in `profile.ts`, and the type change is erased.
2. **Offline `expo export --platform ios`, flag unset.** `CI=1 EXPO_OFFLINE=1 … --no-bytecode --no-minify --source-maps --clear` with an APFS clone of the same local `node_modules`. Both exit 0.
   - Bundle `AppEntry-55dba04d….js` 12,267,075 B → `AppEntry-f41c75b3….js` 12,268,743 B (+1,668 B).
   - Modules 1,618 → 1,618: none added, none removed. `isLiteEnabled` → `return false` in both.
   - **Exactly 5 modules differ:**
     - `src/contexts/AuthContext.tsx` (+16 −2): the `retryProfile` type member, the `profileRevision` state + `profileReadRef`, the `retrying` check (`setProfileError(null)` becomes `if (!retrying) setProfileError(null)`), the success-path `if (retrying) setProfileError(null)`, the deps `[user]` → `[user, profileRevision]`, and the two `retryProfile` implementations.
     - `src/lib/profile.ts` (+19 −0): the `holobotVitals?: unknown` doc field, `readHolobotVitals`, and the gated spread.
     - Gated lite modules: `LiteApp.tsx` (comment only, +4 −3), `src/lite/screens/HomeScreen.tsx` (+2 −6) and `src/lite/screens/ArenaScreen.tsx` (+1 −5).
   - Every other module is byte-identical: the remaining 355 of 357 non-lite project modules, 135 of 138 lite modules, and all 1,122 `node_modules` modules.
3. **Boundary stand-in** (`react-dom/static`, because `react-test-renderer` is missing locally): 7/7 pass before and 7/7 after.
4. **Tests.**

| Run | Before (`8d60440`) | After |
|---|---|---|
| `npx vitest run` files | 103 passed, 2 failed, 1 skipped (106) | 105 passed, 2 failed, 1 skipped (108) |
| `npx vitest run` tests | 1,344 passed, 4 skipped | 1,374 passed, 4 skipped |
| `npx tsc --noEmit` | 2 errors | 2 errors (identical) |

The 2 failing files and 2 tsc errors are the known `react-test-renderer` gap (CI is the run of record). No pre-existing test file changed outcome. That includes #147's `src/lite/lib/__tests__/progressionHost.test.ts`, the whole `src/lite` suite (Quests and Training use the shared AuthContext), and `genesisSignupParity.test.ts`, which reads AuthContext's source. The +30 tests are the two new files: `authProfileRetry.test.ts` (13) and `profileHolobotVitals.test.ts` (17).

## Adversarial self-review

A read-only critic subagent ran refute-first on original-app behaviour changes and #147 regressions. It had no ref writes and made no edits. It could not refute any of these: MainApp is unchanged at `profileRevision` 0, through sign-in, signup, sign-out, an account switch and a StrictMode remount; Firestore never calls `next` after `error`; the flag-off mapping is key-identical; nothing writes `holobotVitals`; the reader matches `readHostVitals`; the KO guard is honest; Home and Arena equal lite tip; there is no #147 regression (Quests, Training and `useEnergyRegen` read only `profile`, `user` and `updateProfile`); and no new copy was added.

Findings and what was done:
- **F1, CONFIRMED, fixed.** On iOS's legacy root, a retried "no document" answer briefly made LiteApp unmount Home. The fix: error cleared last and only on a retried read. Reproduced and pinned by the harness test.
- **F3, CONFIRMED, fixed.** The source-text-only test was replaced by the runtime harness test, plus the sign-in-order guard.
- **F4, fixed.** The original app's success path is now literally the old two updates.
- **F6, fixed.** The flag-unset case now leaves the flag genuinely unset.
- **F2, suspected, not changed.** An offline retry can land in "missing" via a cache-miss snapshot. That is existing `subscribeToUserProfile` behaviour; follow-up.
- **F5, not changed.** `homeRoster.ts`'s docstring describes lite's AuthContext; the file is kept equal to lite tip.
- **F7, accepted.** Main keeps the error only on the retry-triggered run, not on any same-uid re-subscribe, and that is exactly what keeps MainApp unchanged.

## HELD items from lite-main-port-2

- **#142 `retryProfile`: CLOSED.** It is in the shared AuthContext, and lite Home uses it.
- **#144 `holobotVitals`: CLOSED.** It is in the shared profile mapping and type, and the lite Arena KO guard uses it.
- **Still deliberately not on main:** lite #142's same-batch `setProfileLoading(true)` at sign-in, because it would change the original app. LiteApp's `profileReadPending` guard gives the lite build the same result.
