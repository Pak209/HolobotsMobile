# W12 — Mobile host-state consumers

Stacked on PR #83's corrected exhaustive parity grid. No host changes, deployment, editor, production account access or new economy rules.

## Consumers

`mobile/src/lib/hostState/readers.ts` consumes the existing desktop-account-1/-2/-3 reply envelope. It validates the authenticated UID, immutable host storyFlags, numeric tournamentsWon **0–3**, consistent third-win arenaArcBuilt, holoZonesArcBuilt and optional Pilot Rank (missing older field **0**, otherwise a nonnegative safe integer). The local Story Mode boolean cache is untouched.

`firebase.ts` calls the actual exported endpoint **desktopAccountSnapshot**, requesting **desktop-account-3**; the product brief's desktop account host is this callable. It never sends a caller UID, uses Firebase authentication, and checks the signed-in UID before and after both success and error. No direct Firestore writes. Host snapshot defaults/migrations remain the existing server behavior.

`stores.ts` has per-UID session instances, deduplicated account loads, validated snapshots, **15000 ms** existing callable timeout, disposal generation guards and retry after errors. The rival reader invokes **rivalBattleHost** for status/issue with **rival-battle-3**. It consumes only structured `details.rejectionCode = rival_cooldown` and safe integer `details.retryAfterMs >= 0`, anchored at response receipt time. It keeps separate rival deadlines, prevents older responses overwriting new ones, and clears only a successful issue's deadline. It never locally denies a host issue, predicts rewards, or writes a cooldown ledger. A missing/unrelated/malformed duration is not guessed from message text. The existing **300000 ms** host cooldown is not redefined.

`useHostStoryState(uid)` loads on mount and exposes account/loading/error/refresh. `useRivalCooldown(uid, rivalId)` exposes exact remaining milliseconds and request; its display ticks every **250 ms**, ends at zero, and cleans timers. Both replace sessions on account changes and support React StrictMode's cleanup/setup. These are reusable screen-facing consumers; no new Arena/Rival screen or combat settlement UI is added. Screens can use the hooks without touching the local story flag cache; all grants/admission still require the host.

## Known bad first and verification

Real React lifecycle tests initially reproduced **2 failures / 2 passes**: StrictMode cleanup permanently disposed both memoized stores, so the account never loaded and rival requests failed session_closed. `w12-hooks-known-bad.txt` records the red control. Generation-scoped activation/disposal fixes this; tests also cover old responses arriving after reactivation, account switching/logout, unsubscribe, stale and malformed snapshots, hung reads, exact countdown boundaries and teardown.

There are **63 new tests**: **42** reader/host parity, **12** store behaviors, **5** authenticated Firebase adapter behaviors, **4** real React hook lifecycle tests. Real Firebase transport is stubbed; no remote calls or accounts are used. Host reply builders are real. React **19.0.0** test renderer/types are pinned development dependencies only, matching the app's React version; its upstream deprecation notice is visible in test logs.

Targeted initial candidate **61/61** passed; a typecheck then caught two test callbacks returning VitestUtils instead of void. After correcting those annotations and adding two generation-race regressions, full suite **638 passed / 0 failed / 1 existing skip (639 total)** in **6.361 s** wall time; final typecheck passed at **8.576 s** cumulative. Each full command capped at **300 s**. Commands: `cd mobile && npm test -- --maxWorkers=1 --reporter=json --outputFile=/private/tmp/w12-consumers-full.json`, then `npm run typecheck`.

No tests skipped, timeout increased, runtime dependencies added, production state changed or foreign dirty files staged. The existing local Story Mode concurrency/durability observations from #83 remain separate.
