# W15 — W10 receipt playback

PR scope: mobile presentation only, stacked on W6/W5/W7 PR #87 (`2ea3748`; final tests rerun after base updates, preserving the newly exported FighterHud). Consumes W10 PR #85 (`abd162c`) `duel-receipt-1`; no combat calculation, purchase, settlement request, deploy, sign-in or Pak account. W14 #88 independently verifies the unchanged W6 GLBs.

## Change and contract

`normalizeDuelReceipt` accepts a direct `duel-receipt-1`, a settle reply's `duelReceipt`, an `{issue,settlement}` pair, and a callable `{data:...}` envelope. An explicitly present host receipt takes precedence over client traces and legacy `didWin`, including null/malformed receipts which fail closed. Legacy and explicitly synthetic W6 previews remain compatible.

The adapter checks the version, seed, winner, final teams, bounds and chronological rows. The W10 contract is **120 turns / 240 action rows**, exactly two distinct side rows per contiguous turn, including a knocked-out second actor's `wait`. UI round count follows the host turn numbers rather than action count. Each action still uses W6's **3200 ms** presentation slot, impact at **900 ms**; this is replay timing, not a new combat/pacing rule.

Host `strike/heavy/defend/finisher` map to existing W6 command-to-manifest clip aliases. Refused `wait` rows play idle and show the refusal, without an attack/hit cue. `hit` and `damage` are copied. `winner` alone selects the result card; zero HP never decides it. Observed HP and STA are copied from `defenderHpAfter` / `staAfter`; no subtraction, regen or combat simulation runs on the client. Values not yet observed show a dash, including first-frame HP on receipt-only replay. Command costs absent from the receipt remain unavailable, not invented. Final HUD values come from `playerFinal` / `opponentFinal`, including final host regeneration.

Squad rows select the correct player/rival actor IDs before animation. Switching actors clears the old HUD and pauses the cue stream until the new stage is ready. Pausing, background suspension and replay preserve chronological cue order. Invalid host data shows an invalid-receipt notice and no winner/reward fallback.

Fixtures are generated from W10's actual compiled resolver test helpers, not hand-authored outcomes. Seed **17**, equal Rookie stats, `strike/heavy/defend`, with player ID changed from wolf to ace for readability: **8 host turns / 16 actions**, host winner player. The second fixture is the exact weak-WOLF/strong-ACE carryover test input and checks squad selection. Both pin source commit and input in JSON. Regenerate with:

```sh
# Build the separate host checkout at abd162c first.
node mobile/scripts/generate-duel-receipt-fixture.mjs /path/to/pinned-host
npm --prefix mobile test
npm --prefix mobile run typecheck
```

Development-only W6 routes: `HostDuel`, `HostDuelRound1` through `HostDuelRound8`; each round route stops the real cue runner after the last action impact of that host turn. Fixtures show OFFLINE FIXTURE / NO REWARDS and never authenticate.

## Known-bad first and validation

- Old W6 adapter: **14 failed / 1 passed** new tests; it ignored W10's rounds/winner. `known-bad.txt` records the failure. The first attempted command used the wrong working directory and found no tests; that setup result is not claimed as the red witness.
- First implementation: **30/31** targeted tests passed. One assertion wrongly assumed the first actor was player; seed17 gives opponent initiative. Corrected the assertion to inspect the actual actor's still-unknown HP. Full suite then **510 passed / 4 existing skips**, typecheck green.
- Independent review found explicit-null fallback, truncated turns, and stale HUD on actor change. Two new expected-red assertions reproduced the first two; actor change was fixed by clearing HUD on the actor cue. Review read-through confirmed all three closed.
- Final: **513 passed / 4 existing skips**, **18 new receipt tests**, TypeScript green. Existing skips are three opt-in host-emulator integration tests and one historical main skip; no new skips. Final logs are adjacent. No dependency or lockfile change is committed.

## Rendered QA

Flow: offline W10 receipt → each of eight recorded rounds → host victory → replay. Actual W6 GLBs, clip mapping, HUD and screen were rendered. Browser plugin was unavailable; bundled Playwright drove installed Chrome headless with an isolated profile, SwiftShader WebGL, **402×874** viewport; desktop smoke **1280×800**. URL `http://localhost:8097/`, title `W15 Host Duel Receipt`.

A temporary Expo web entry mounted only this screen, SafeAreaProvider and bundled fonts. Expo's web runtime was installed only into the temporary worktree. The first rendered attempt failed on W6's native-only `Image.resolveAssetSource`; the second used a **web-only capture shim** returning the bundled asset unchanged. That shim and temporary entry were not committed or added to production code. No real account provider or callable ran. Network was restricted to localhost; no external request was attempted. Native iOS/Android performance and full native integration are **not** claimed by these screenshots.

| Check | Result |
| --- | --- |
| Page identity / meaningful content / no framework overlay | Pass |
| Actual textured GLBs visible | Pass; all ten image cells inspected |
| Eight host rounds and recorded HP/STA | Pass |
| Host winner → VICTORY | Pass |
| Pause, resume and replay controls | Pass |
| App console errors | 0 on final run |
| Existing warnings | React Native Web pointerEvents deprecation; SwiftShader readPixels screenshot stalls |
| Native / physical-device performance | Not measured in W15 |

Screenshot evidence stays outside git in `/Users/pak/HolobotsVault/QA/2026-10-15-duel-playback-receipt-1/`. `captures.json` inventories every cell, absolute path, dimensions and SHA-256. Contact sheet **1500×1400**, cells **1–8** host rounds1–8, **9** result, **10** desktop smoke. Round1 correctly shows unobserved resources as dashes. Desktop remains the existing portrait composition stretched across its viewport; no desktop redesign is claimed.

- [Contact sheet](/Users/pak/HolobotsVault/QA/2026-10-15-duel-playback-receipt-1/contact-sheet.png)
- [Recorded result](/Users/pak/HolobotsVault/QA/2026-10-15-duel-playback-receipt-1/result.png)
- Raw browser console and interaction evidence: `browser.json`, `capture.txt`; first failed web attempt retained separately.

## Holds and limits

Merge W6 #87 first, then retarget this PR to main. W10 host deployment and intent submission migration remain separately held; this change consumes receipts when supplied and does not turn the old mobile combat flow into the authoritative resolver flow. Existing no-trace replies remain result-only or explicitly labeled client traces. No reward is computed, granted or changed by playback. W6 native performance limitations and every unrelated hold remain.
