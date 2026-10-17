# Lite HUD levels

Candidate based on mobile-holocity-lite d5cc1dd. Pak explicitly approved a lite-targeted PR exception. This PR installs the tested eleven source/test files directly against mobile-holocity-lite; it supersedes the main-only package PR #116. Remote lite base remains exactly d5cc1dd, so the existing test and simulator evidence remains applicable.

## Sources and placement

The existing shared FighterHud puts a 14 px Carbon LV plate immediately right of the fighter name, matching Unity hud-levels-1 placement. Only integer levels 1–99 render. Missing, ambiguous, fractional, string and out-of-range values hide; no fallback 1, XP or rank arithmetic.

| Surface/mode | Source | Identity |
|---|---|---|
| City live legacy player card | verified desktopAccountSnapshot.holobots[].level | account name equals displayed bot id |
| City live legacy opponent card | issued encounter.opponentSquad[].level | holobotId |
| Resolver receipt playback cards | issued duel.player/opponent[].level | current active holobotId on correct side |
| Result screen | same retained issue/account and fighter cards | unchanged issued identity; receipt final stats never supply level |
| Offline host receipt preview | original committed fixture input.player/opponent[].level | same resolver mapping |

City hub retains its existing verified desktop reply; there is no additional city request or account mutation. Receipt/result does not replace issued levels with later account progression. Existing identity checks fail closed across sides and duplicate IDs.

Census: CityLiveBattleView and DuelPlaybackScreen share FighterHud. The playback result banner has no additional fighter card; the two HUD cards stay visible. This lite city path has no bench cards. The inherited separate ArenaScreen/BattleArenaView uses locally constructed BattleState and TeamHudChip (no host level field); its own-player badges now use a separately verified read-only account snapshot; opponent badges remain unavailable rather than deriving from local combat state. BattleResultsModal is a rewards dialog without fighter cards. No host contract, reward or gameplay behavior changes.

## Verification

Full isolated lite suite: 545 passed, 4 pre-existing skips; 63 files passed, 1 skipped. TypeScript typecheck passed. Five focused level tests cover original issued sources, switched identity/side, round/result envelope retention, legacy account source and invalid values. No Unity editor or host account used.

Simulator: iPhone 17 Pro, iOS 26.5, cached Debug harness fun.holobots.mobile.w64. Offline preview only, original host fixture ACE/WOLF level 1. Harness-only index entry and dedicated holobotsw64 URL scheme are excluded from product patch. Known-bad baseline captured first with no LV badges. Candidate capture uses the same simulator and fixture.

Setup failure accounting: initial sandbox Metro port probing exhausted port range and failed ERR_SOCKET_BAD_PORT; scoped localhost launch outside sandbox succeeded. Candidate scratch Metro initially could not resolve cached @babel/runtime outside its root; explicit scratch-only watchFolders/nodeModulesPaths resolved it, bundling 1496 modules in 1543 ms. No downloads. These two setup failures remain recorded; no further retry authorized after the current successful capture pass.

Evidence: /Users/pak/HolobotsVault/QA/2026-10-17-lite-hud-levels-1/ (GATE_SHEET.png, 1440×1120; inventory.json lists all three cells: known-bad round 1, candidate round 1, candidate result). Native harness, caches, evidence images and node_modules are not staged. No physical device, deploy, credentials, credits or production account.

## Narrow hold: inherited Arena cards

Reachable via App.tsx:89, ArenaScreen.tsx:521/539 and PvpArenaModal.tsx:288. AuthContext.tsx:214 obtains profile through subscribeToUserProfile; profile.ts:230 reads users/{uid} and maps raw holobots at142. updateUserProfile supports holobots at271/335. These values are not the verified desktopAccountSnapshot used by the city route and local progression writes exist. Own Arena active/bench/send-in cards now receive a read-only desktopAccountSnapshot with uid/schema validation, session checks before/after, cancellation and no profile fallback. One added mocked test covers verified data and foreign/stale sessions. Opponent and PvP badges remain HELD: entry returns balances, not an issued fighter-level snapshot. This package does not claim every reachable app battle card is complete.

## Superseded package verification

The earlier main-based package PR #116 is superseded by this direct lite-targeted PR under Pak's explicit exception. Its verification record is retained below for audit; no package applicator is part of this PR.

Arena own-player extension was unit/type checked after city captures; no additional simulator capture was attempted. Final full suite 545 passed / 4 existing skipped. Two package checks failed in one batch because handcrafted new-file headers were invalid. The chair reviewed the replacement Git-generated --binary --full-index patch, manifest, runner and sheet, then explicitly authorized ONE additional bounded verification (60-second subprocess timeouts; 300-second overall cap). It passed in 0.464 seconds on fresh clean /private/tmp/lite-hud-apply-authorized at exact d5cc1dd: internal apply check succeeded before mutation and all 11 postimage hashes matched. No further verification retry occurred. No source files were applied by either failed check.

Own Arena active/bench/send-in native visual witness remains PENDING; those additions have mocked-source tests and typecheck only. The city simulator witness covers unchanged city render source hashes. Pak approved the lite-targeted exception; no merge or deployment is performed. Current remote lite base was verified unchanged before publication.
