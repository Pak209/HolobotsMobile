# lite-arena-polish-1: CPU Arena host-compat, honest states, City copy

This is a client-only PR into `mobile-holocity-lite`. It makes the lite CPU Arena safe against host #143's settle floor and payout caps (deploy HELD), and it closes the functioning rows F2, F3, F4 and F7 and the UX rows L1, L2, L3, L4, L5, L7, L8, L18 and L21 from `HolobotsUnity/Documentation/HANDOFFS/2026-10-17-critic-review.md`. It also removes the remaining player-visible "host" strings (DECISIONS #71). Every new player string is in a block marked PLACEHOLDER (Lex): `ARENA_SCREEN_COPY` and the error map in `lib/arenaCopy.ts`, and `ARENA_RESULT_COPY`.

Hard rule 1 holds: the City admits, settles and pays. The client still runs only the existing practice sim between `start` and `settle`. Nothing here decides an outcome, a reward, an HP value or eligibility. The KO guard and the payout notice only display what the City recorded or replied.

Nothing here touches `functions/`, `firestore.rules`, PvP files, the 3v3 bench or `arenaMatch3v3` files, or Home/City files.

## Base

When this lane started, #141, #142, #137 and #139 were all still open. The branch starts at the GitHub-verified lite tip `c187921`, with the four heads merged locally in the verified order: #141 `b0c43fc`, #142 `bbc323d`, #137 `d21f78f`, #139 `ae7e71a`. The only conflict was the expected additive import in `mobile/src/qa/HoloCityPreview.tsx`; every line is kept. **Rebase onto the real tip once those four merge.** Baseline on that combined state: vitest 1107 pass / 4 skip, tsc 0.

## Row → fix → evidence

Test files: `lib/__tests__/arenaSettleConfirm.test.ts` (fake timers), `lib/__tests__/arenaPolish.test.ts`, `components/arena/__tests__/arenaResultPresenter.test.ts`, `components/arena/__tests__/arenaUxGuards.test.ts`, `qa/__tests__/arenaPolishPreviewRoutes.test.ts`, `lib/__tests__/liteCopy.test.ts`. The cells are the simulator witness (see below).

### (A) Host-compat: CPU settle floor and payout caps (host #143, deploy HELD; host-economy-hardening-2 in parallel)

| Item | Fix | Evidence |
|---|---|---|
| A1 `too_fast` is PENDING, not an error | `ArenaMatchFlow.settle()` persists `{matchId, report}` per account (`arena-match-settle-pending-1:<uid>`) **before** sending. A stored body for the same match is resent unchanged and never rebuilt. `lib/arenaSettleConfirm.ts` then resends: after exactly `details.retryAfterMs` when the refusal has one (0..10 min), otherwise on a 1/2/4/8/16 s backoff (31 s in all), then hands over a manual TRY AGAIN. The floor is never hardcoded. The hint shares the same five-resend budget, so a host that keeps saying "not yet" cannot loop forever. An unknown outcome (timeout, `unavailable`, dropped reply, `arena_busy`) uses the same budget. Any other definite refusal (e.g. `match_expired`) ends the loop and retires the body. Only a terminal reply, a reply for another match, or that definite refusal clears the stored body. The screen keeps the result locked behind "The City is confirming your win…" (PLACEHOLDER) and never shows the code. On a relaunch or foreground, `resume` finds the stored body for the open match and resends it. A forfeit while it is pending opens an in-app confirmation that says the win is unconfirmed and will be discarded. | `arenaSettleConfirm.test.ts`: the hint is honoured to the millisecond (2,499 ms → no resend, 2,500 ms → resend); the backoff without a hint; byte-identical resends (the same body `{schemaVersion, operation, matchId, …4 fields}`); give-up after 5 resends / 31 s → `stalled` → TRY AGAIN resends the same body; the hint budget is bounded; it survives a kill (a new flow on the same storage resends the stored body); a second `settle()` never rebuilds the report; `stop()` cancels the armed resend; a first send that hit `arena_busy` before storing still settles; `match_expired` ends it; too_fast never yields a `refused` phase and its copy contains neither `too_fast` nor "host". `arenaPolish.test.ts` "forfeit while a win is pending asks first". Cells 04 (confirming) and 05 (not confirmed). |
| A2 `payoutWithheld` on the receipt | `arenaReceiptResult` returns `payoutWithheld`. It accepts only `daily_cap` / `under_floor`, and only with an all-zero settlement (`exp`, `awardedExp`, `holos`, `syncPoints` = 0, `blueprints` null); anything else is `arena_result_unavailable`. The presenter shows no rows, "CITY RECEIPT · NO REWARDS", and one notice: "Daily Arena rewards reached · resets 00:00 UTC" or "Quick loss · no rewards" (PLACEHOLDER). | `arenaPolish.test.ts` "accepts payoutWithheld … only with an all-zero settlement" (unknown reason and each non-zero field are refused); `arenaResultPresenter.test.ts` "(A)2". Cell 06. |
| A3 `payoutCapped` on issue (**ANTICIPATED**) | `arenaIssuePayoutCapped(reply)`: only a literal `true` on the reply or its match means capped. Absent means unknown and is never assumed. When it is true, the screen stops after the issue (no auto-START) and shows "Daily Arena rewards reached · this match pays no rewards" above START and CANCEL · REFUND ENTRY. The field location is marked `TODO(host-economy-hardening-2)`: that PR was not open when this lane finished (no branch on origin), so the field name and shape still have to be matched to it. | `arenaPolish.test.ts` "(A)3" (true, nested true, absent, `"true"`, null; the reader keeps the additive key; the source stops before `launch()`). Cell 03. |

### (B) Functioning rows

| Row | Fix | Evidence |
|---|---|---|
| F2 pending-admission wedge | `issue()` clears the stored request on a definite refusal (`invalid-argument`, `failed-precondition`, `not-found`, `permission-denied`), and keeps it on `unavailable`, `deadline-exceeded`, a timeout or a dropped reply. A reply that admits the stored requestId resolves it from any call. `discardPendingIssue()` is the explicit discard (single-flight). With no open match known, `resume` discovers the account's latest match, so an admission whose reply was lost (or whose request was discarded) still surfaces. The "earlier entry is still waiting" interstitial offers RETRY SAME ENTRY / DISCARD ENTRY. **KO guard:** the profile now passes through the City's `holobotVitals` ledger (strict reader `lib/arenaVitals.ts`; malformed → unknown). The picker disables PAY/USE PASS and says "KO · heal it before entering" only when the ledger records 0 HP. | `arenaPolish.test.ts` "F2" (4 definite codes clear, and the next pick is not blocked; 2 transient codes and a timeout keep; discard clears; admitted requestId resolves; discovery vs pinned resume; KO guard reads only the ledger, unknown is never KO). |
| F3 lost `start` reply → 0-HP forfeit | An active match with no local checkpoint is the "FIGHT INTERRUPTED" interstitial: RESTART FROM ENTRY HP starts the practice from the City's admitted snapshot, and FORFEIT MATCH reports the checkpoint HP, else the saved result's HP, else the admission HP. It is never `?? 0`, and "Interrupted fight" is gone. A stored settle always wins over a restart. | `arenaPolish.test.ts` "F3". |
| F4 last result re-opens on every mount | EXIT ARENA stores the matchId (`arena-match-ack-1:<uid>`). A terminal match already acknowledged falls back to the menu on mount and foreground. | `arenaPolish.test.ts` "F4". |
| F7 forfeit/cancel/refund show nothing | `arenaClosureResult` reads the City's receipt for a match closed without a settle. `presentArenaClosure` shows ENTRY REFUNDED ("Cancelled before the fight · 50 Holos returned"; timed out is noted) or FORFEIT ("entry not refunded · ACE HP 44 / 172"). A terminal record the readers refuse is the "MATCH UNREADABLE" interstitial, never a crash. | `arenaPolish.test.ts` "F7"; `arenaResultPresenter.test.ts` "F7 closures". Cell 07. |

### (C) UX rows and DECISIONS #71

| Row | Fix | Evidence |
|---|---|---|
| L1 raw unframed admitted/error states | Every non-fight state renders through `ArenaInterstitial` (GameDialogFrame, theme tokens, framed buttons). `lib/arenaCopy.ts` maps every host, HTTPS and local `arena_*` code to player copy; unknown codes read "NO ANSWER FROM THE CITY". | `arenaPolish.test.ts` "L1" (12 host codes + 5 local codes + timeout + bare HTTPS code: no code, no `arena_`, no "host" in the copy); `arenaUxGuards.test.ts` "L1". Cells 01 vs 02/05. |
| L2 EXTRAS UNAVAILABLE banner and panels | The banner is gone. The passive dock renders only fighters that have a passive (none for a City-issued CPU match). | `arenaUxGuards.test.ts` "L2". |
| L3 hardcoded paddingTop 45/70/90 | ArenaScreen uses `useSafeAreaInsets()` for the fight (below the pilot-menu cog), the interstitials and the overlays. The picker header uses `insets.top + 14` (it was 64). | `arenaUxGuards.test.ts` "L3". Cells 02–07. |
| L4 "HOST RECEIPT" | "CITY RECEIPT" / "CITY RECEIPT · NOTHING GRANTED" / "CITY RECEIPT · NO REWARDS" (PLACEHOLDER). | `arenaResultPresenter.test.ts` (b), (c), "L4". Cells 06/07. |
| L5 flat carbon battle background | BattleArenaView draws `holocity-park.jpg` (the city battle and duel stage) under a carbon scrim; the iso floor is 72 % opaque over it. | `arenaUxGuards.test.ts` "L5". Not in a cell (the fight needs a live start); see Not witnessed. |
| L7 two empty ghost move cards | Only real moves render: at most 3 commands, plus the signature only when the battle has one. No ghost slots. | `arenaUxGuards.test.ts` "L7". |
| L8 rail ornament through the labels | The card bay uses `BayFrame`, which has fixed 10 pt chamfers measured from its own layout and no stretched ornaments. Bay padding is 14/12 and the meter row is padded. | `arenaUxGuards.test.ts` "L8". |
| L18 fake progress rail, label-repeat icons | The 62 % header fill is now a plain divider. Reward rows draw the bundled glyphs (`rewardExp`, `rewardSync`, `rewardHolos`, `Blueprint.png`); the PvP rating keeps a "±" tag. | `arenaUxGuards.test.ts` "L18"; `arenaResultPresenter.test.ts` (glyph keys). Cell 06 (no rows by design); see Not witnessed. |
| L21 off-palette hexes | No raw hex or rgba in ArenaScreen, ArenaInterstitial, BattleResultsModal, BattleArenaView or ArenaPrebattleMenu. | `arenaUxGuards.test.ts` "L21". |
| #71 LV corner tab | The admitted/interrupted/not-confirmed cards (`ArenaFighterCard`) draw the City snapshot's level as a lower-left corner tab, and no tab when there is no valid level. The fight HUD keeps the existing inline name-plate badge. | `arenaUxGuards.test.ts` "DECISIONS #71". Cells 02/03/05. |

### (D) On-screen "host" strings

| Where | Before → after (PLACEHOLDER) |
|---|---|
| `ArenaScreen.tsx` | "RESUME HOST MATCH" → gone (CHECK AGAIN in the framed error state) |
| `arenaResultPresenter.ts` | "HOST RECEIPT", "HOST RECEIPT · NOTHING GRANTED" → "CITY RECEIPT", "CITY RECEIPT · NOTHING GRANTED" |
| `DuelPlaybackScreen.tsx` | "CLIENT TRACE · HOST SETTLEMENT", "HOST SETTLEMENT · NO ROUND TRACE", "This host reply contains no round trace." → CITY wording |
| `liveRivalPlayback.ts` | "…missing its host receipt…", "The host result conflicts…" → "…missing its City receipt…", "The City result conflicts…" |
| `hostDuelReceipt.ts` | "Invalid host duel receipt" → "This City duel receipt cannot be shown. The recorded result is preserved." |
| `arenaHostBattle.ts` | card description "Issued host move; …" → "City-issued move; …" |

`liteCopy.test.ts` now scans 30 files: #142's 16 plus the Arena and duel files. It allows exactly three literals that never reach the screen: the `'host'` / `"host"` receipt discriminator and the `` `host.${id}` `` template id. A new known-bad control shows the allowlist is exact-match only. Widening the scan also applied #142's bare-dash rule to `DuelPlaybackScreen`, which had four "—" values. Unknown HP, STA, round and round count are now hidden, not dashed.

**Release bundle (offline `expo export --platform ios --no-bytecode`, no network):** "HOST RECEIPT", "RESUME HOST MATCH", "RETRY SAME ADMISSION", "EXTRAS UNAVAILABLE", "CPU PRACTICE", "HOST SETTLEMENT", "host reply contains", "Invalid host duel receipt", "Interrupted fight" → 0. The QA cells (`ArenaPolishKnownBad`, `arenaPolishPreviewScreens`, "RECORDED REPLIES") → 0. "CITY RECEIPT" 4, "The City is confirming your win" 1. Vault `bundle-hits.txt`.

### (E) Daily Missions from the host ledger: **HELD**

`host-economy-hardening-2` has no PR and no branch on origin (checked at hand-back). The exact host dependency is an additive `dailyMissionLedger` **summary in the desktop account snapshot** (`desktopAccountSnapshot` reply): its field name, its shape and the snapshot schema version. Until then:
- `lib/dailyMissions.ts`, `DailyMissionsModal` and `lib/profile.ts` still read the client-writable `rewardSystem` mirror.
- `progressionSystems.ts` still spreads the four mission keys into quest/training writes.

Notes for the lane that picks this up:
- Since #143, the authoritative ledger is the server-only field `users/{uid}.dailyMissionLedger` (`firestore.rules` protected list). It is owner-readable, so the client could also read it from the profile, but its shape is the host's to change in hardening-2.
- Per #143's rules comment, `rewardSystem` stays owner-writable until the quest/training starts move to callables. Dropping the spread is therefore safe for the rules today, but it belongs with the summary switch.
