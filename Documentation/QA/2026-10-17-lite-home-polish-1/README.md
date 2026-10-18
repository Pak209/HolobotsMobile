# lite-home-polish-1: Home layout, City copy, STORY / duel / market gates

This is a client-only PR into `mobile-holocity-lite`, based on c187921 (which includes #131 Marketplace, #132 dashboard live and #133 duel perf). It fixes the confirmed UX critic rows L10–L14, L16, L17, L19, L20 and L22, plus the functioning and security rows F8, F11 and S12. Those rows come from `HolobotsUnity/Documentation/HANDOFFS/2026-10-17-critic-review.md`. It also does the producer's two Home wiring follow-ups. The copy rows follow Pak's DECISIONS #71: "host" never appears on screen, and the authority is "the City". Every changed string is marked PLACEHOLDER until Lex.

Nothing here touches the host, rules, `functions/` or any Arena/PvP file. Live citizen duels stay **HELD** (DECISIONS #71: the rival resolver flip is held). Re-enabling them needs the City's resolver path (`settleCityResolver`), never a client-decided `didWin`.

## Row → fix → evidence

| Row | Fix | Evidence |
|---|---|---|
| L12 Home artboard stretched (~6 %; SE 0.94) | `FigmaCanvas` fits the measured page at one scale and letterboxes the rest. The Home vector layer uses `xMidYMid meet`. All Home geometry lives in `src/config/homeLayout.ts`. | `homeLayout.test.ts` "L12": one scale on 375×667, 375×812, 393×852 and 430×932, centred inside the page; `FigmaCanvas` sizes itself with `fitArtboard`. A known-bad control re-derives the old canvas and gets SE 0.94. Cells 01 vs 04. |
| L13 footer and part slots left of centre | Footer columns are on a 400 pitch centred on x 900. Labels are at 300 / 700 / 1100 / 1500 (they were 210 / 622 / 1008 / 1398, centroid 809.5). Each icon box is placed so its visible art (the PNG's measured opaque bounds, drawn "contain") is centred over its label. There is one Pressable per column. The part slots are centred (236..1564; they were 68..1396). | `homeLayout.test.ts` "L13": label centroid within ±1 % of 900; icon art centred within ±1 % of each label; PNG sizes read from the files; equal slot margins. Each hotspot covers its art and label, stays inside the footer plate and touches no neighbour, and is ≥ 44 pt on SE. Part hotspots equal their frames. Critic: refuted with numbers. Cells 01 vs 04. |
| L14 header diagonal through "CITY › 04:54" | The status strip ends at x 1400 (it was 1674), left of the plate diagonal on every phone. The single scale (L12) plus the HUD font put the PILOT line on the plate's lower edge (critic F1). That line was already crossed in the known-bad cell. The two strip lines lost their 3 pt of padding and the strip starts at y 300. Every glyph (Rajdhani: 0.703 em above, 0.157 em below the baseline) now clears both the edge and the 3D city entry. The CITY link keeps its tap height through `hitSlop`. | `homeLayout.test.ts` "L14": the strip's right edge is left of the diagonal; the PILOT descenders are above the lower edge; the first line is below HOLOBOTS and the 3D entry. All on four phones. Known-bad controls cover the old 1674 edge and the committed padding at 375×812. Cell 04. |
| L16 SVG text in SF | Every Home SVG `<Text>` gets `fontFamily={HUD_FONT}` (`theme.type.display.fontFamily`). The status strip uses it too. | `homeLayout.test.ts` "L16" checks the source. Cells 01 vs 04. |
| L10 release STORY → "Overworld Blocked" + localhost URL | `isStoryOverworldAvailable()` is the same gate `OverworldScreen` applies; release accepts only an allowed https host. The pilot menu lists STORY only when it passes. The city's HoloZone district, the other door into the overworld (critic F2), is hidden behind the same gate. The blocked screen no longer prints the address. Its HTTP error no longer says "host". | `storyMode.test.ts`: release with localhost → hidden; https holobots.fun → shown; LAN, http, look-alike and file:// → hidden; dev → shown. Source checks cover the menu gate, the hub gate and the blocked text. Critic: same answer as `uriIsTrusted` in dev and release. |
| L11 dead "Challenge {pilot}" CTA | `CITY_LIVE_DUELS_HELD` (one switch) drives `cityChallengeEnabled()`. While held, a map pin opens the roster panel (critic F3: no dead tap) and is announced as "Meet {pilot}". The panel shows the existing hold sentence, its rows are disabled without the ↗, and the gathering card no longer invites a challenge. The offline fixture keeps its local duel. | `cityHubClient.test.ts`: the CTA is closed exactly while `issueCityRival` refuses, so flipping either side alone fails; source checks cover both CTA paths. |
| L17 "NATIVE CITY" dev button + raw native error | Renamed to "ENTER HOLOCITY" (PLACEHOLDER). It is hidden when the build has no `HolobotsUnityRuntime` module. A failed launch shows this module's own player messages or "HoloCity couldn't open. Try again.", never a raw native error. | `nativeUnitySession.test.ts` "3D city entry"; `liteCopy.test.ts` "L17". Cell 04: the cached Debug app has no module, so the entry is gone. |
| L19 "host" wording (hub, gathering, rival entry, city errors) | City wording throughout `cityHub.ts`, `cityHubClient.ts`, `cityRivalBattle.ts`, `CityHubScreen.tsx` and `CityRivalBattle.tsx`. For example: "REFRESH CITY ROSTER", "The City confirms the gathering roster…", "The City is offline…". | `liteCopy.test.ts` scans string literals and JSX text in the 15 lane files for the word "host". It finds none now, and 30 in the pre-fix sources. |
| L20 #131/#132 strings | "HOLOCITY LITE" captions removed (market and hub). Refusal codes map to player copy only; unknown codes say "The City refused this purchase." The lookup is own-key, so a code like `constructor` cannot reach a prototype. "HOST CATALOG" → "CITY CATALOG"; "…COME FROM THE CITY HOST" → "…COME FROM THE CITY". Home's "ROSTER UNAVAILABLE" / "Lv —" / "EXP —" become one state: "CAN'T LOAD YOUR ROSTER" + RETRY. The whole card is tappable and re-subscribes the profile (new `retryProfile` in `AuthContext`). | `cityMarket.test.ts` "L20"; `liteCopy.test.ts` "L20". Cells 05/06. |
| L22 bare "—" values | Home shows "TIER n" only when the rival status is known. The travel squad slot names stay empty until the squad loads. A squad member without an account level shows its name only. The market hides its Holos line until a catalog arrives. | `liteCopy.test.ts` "no bare placeholder dash" (5 in the pre-fix sources, 0 now); `hostDashboard.test.ts`; `cityMarket.test.ts`. |
| Zone band names | No change needed. The dashboard zones panel prints the account's `displayName` and `statusLabel` verbatim, and lite has no local band or tier labels. | `hostDashboard` reader and presenter tests (unchanged). |
| F8 dead `settleCityRival` (client `didWin`) | Deleted, with its two callers in `CityRivalBattle`: the settle-as-loss cleanup and the live settle, plus its forfeit dialog and "RETRY HOST CONFIRMATION". `CityRivalBattle` now settles only its offline preview. The hold constant stays. | `cityHubClient.test.ts` "F8": the module exports no `settleCityRival`; no City request carries `didWin` (the pre-F8 client had 2); the battle screen imports no settle call. |
| F11 `CITY_GATHERING_FIXTURE` in the release bundle | `CityRivalCombatPreview` and the fixture import moved to `src/qa/CityRivalPreview.tsx`, reached only from `HoloCityPreview` (the dev-gated harness). | Offline `expo export --platform ios --no-bytecode` (no network). Before: "Stall Linen" 1, `CV1_HB_CITIZEN3_StallLinen_13` 1, `CityRivalCombatPreview` 1, `settleCityRival` 3. After: see below. |
| S12 non-idempotent purchases | Lite sends a purchase only when the catalog's request carries a `<client-generated>` requestId: Buddy Units and the desktopItemsHost healing items. The legacy `itemName` / `packId` listings (Arena Pass, tickets, boosters, …) stay visible as "NOT SOLD HERE" (PLACEHOLDER) and never leave the app. Every purchase now goes through the requestId journal. | `cityMarket.test.ts` "S12" (the 10 legacy rows are blocked and unselectable; exactly 5 rows are purchasable); `cityMarketClient.test.ts` "S12" (no callable is invoked). Cell 05. |
| Follow-up A: HOME MARKET → legacy `Marketplace` | MARKET opens the `CityMarket` tab with `{ from: "Home" }`. Its back button returns to Home ("Back to the dashboard"); from the city's Vendor it still returns to the city (critic F5). The legacy Marketplace page is no longer linked from Home. | `homeLayout.test.ts` "Home wiring". Cell 03: a tap on MARKET opened BROWSE THE STALLS. |
| Follow-up B: purchases publish #132's signal | `liveCityMarketHost.buy` calls `notifyHostEconomyChanged(uid)` only after a confirmed purchase reply. It never fires on a refusal, an uncertain outcome, an unreadable reply, a switched session or a blocked listing, and never before the reply. A listener that throws cannot turn a real charge into a refusal (critic F6). A replayed receipt publishes: the signal carries no values. | `cityMarketClient.test.ts` "economy-change signal". Critic: refuted on every path. |

## Adversarial self-review

A read-only critic ran over commit 83964f8 with a refute-first brief covering small-phone layout, hotspots, the signal on refusal and STORY with a bad URL.

- **Refuted:** footer and slot hotspots, overlays vs scale, the signal paths, the STORY gate, scope.
- **Confirmed and fixed here:** F1 (PILOT line on the plate edge), F2 (HoloZone door), F3 (dead map pins), F5 (market back from Home), F6 (listener throw), and part of F7 (circular L12 test, PNG sizes hand-typed).
- **Not fixed:**
  - F4 is a look call (see HELD).
  - F7's remaining source-string checks are deliberate wiring pins.
  - F8: the zones and squad entry boxes overflow by 0.7 pt on 375×812. That is cosmetic; on SE the overflow was 3.45 pt before this change.

## Counts

| | vitest | tsc |
|---|---|---|
| Before (c187921) | 687 passed, 4 skipped, 0 failed (75 files + 1 skipped) | 0 errors |
| After | see the PR body | 0 errors |

The parity tests import `functions/` and `docs/contracts`, so the scratch worktree sparse-checks those out read-only.

## Simulator witness (one bounded session)

See `~/HolobotsVault/QA/2026-10-17-lite-home-polish-1/` (`README.md`, `GATE_SHEET.png`). The run used the iPhone 17 Pro / iOS 26.5 simulator and the cached `fun.holobots.mobile.w64` Debug app (no build, no install), with offline Metro and offline QA routes only. No account and no host.

## HELD / not done here

- **HOLOBOTS wordmark and heavy weights (critic F4, look call for Pak/Lex):** only Rajdhani-Medium is registered as HoloDisplay. The wordmark now renders upright Medium instead of SF Black Italic, and every 700–900 label renders Medium. Options: register a Rajdhani Bold face, or keep the wordmark on its own face.
- **STORY in a Debug build:** dev builds accept the local Vite URL, so the witness app still lists STORY. Release behaviour is unit-tested only.
- **Copy outside this lane still says "host":** `DuelPlaybackScreen` ("HOST SETTLEMENT", reachable only via held live duels and QA), `lib/bots/*` receipt errors, and L4/L18 in the Arena result presenter/modal (owned by lite-arena-polish-1).
- **Legacy Marketplace page:** no longer linked from Home. Whether to retire it is a product call.
- Out of scope, untouched: L4, L15 (SYNC tint), L18; every Arena/PvP file; host and rules.
