# energy-quest-server-1: energy regen and every quest / training start on the host

Base: main `d987294` (holobots-write-lockdown-1, #203, merged). Pak's calls, 2026-10-23: "1) approved, 2) Local midnight, 3) yes". Nothing was deployed. No device, credentials or real account were used.

1. **Phone sign-ups get the desktop starting grants.** Confirmed already in #203: `AuthContext` sign-up and "recover setup" call `createGenesisProfile`, the callable desktop sign-up uses. That covers the Repair Kit, the starter Light Buddy Unit, `pilotRank: 0`, the first travel holobot and onboarding step 0. `genesisSignupParity.test.ts` pins this. This PR makes no change for it.
2. **Daily energy regen moves to the host, with the reset at the player's local midnight.** The new callable `refreshEnergy` handles it, and the quest and training start callables regenerate before they check energy. `dailyEnergy`, `lastEnergyRefresh`, `stepEnergyDate` and `stepEnergyGrantedToday` are now server-only.
3. **Main-app quest and training starts** call `startQuestRun` / `startTrainingSession`, the host callables the lite tree already uses. Neither app writes anything to start a run.

## Census: every client write of the energy fields and the starts (main `d987294`)

The census covers every client: the main app, lite, the Watch (no Firebase SDK), Unity desktop (callables only, no Firestore endpoint) and the legacy holobots-fun web app. The only profile writer in `mobile/` is `updateUserProfile` (`mobile/src/lib/profile.ts`), plus the lite dotted `rewardSystem.<key>` writer.

| # | Where (main `d987294`) | Wrote | Now |
|---|---|---|---|
| 1 | `mobile/src/hooks/useEnergyRegen.ts:52` (main + lite Quests / Training screens) | `dailyEnergy`, `lastEnergyRefresh`, `stepEnergyDate`, `stepEnergyGrantedToday`, computed on the **device** clock and local day | **moved** to new **`refreshEnergy`**. The hook only decides *when* to ask (see "Client") |
| 2 | `mobile/src/screens/QuestsScreen.tsx:105` (main, send quest) | `dailyEnergy − cost` + the whole `rewardSystem` map with a client-built `activeQuests` entry | **moved** to **`startQuestRun`** (exists; lite uses it) |
| 3 | `mobile/src/screens/TrainingScreen.tsx:76` (main, start training) | `dailyEnergy − cost` + the whole `rewardSystem` map with a client-rolled `activeTraining` | **moved** to **`startTrainingSession`** (exists) |
| 4 | `QuestsScreen.tsx:76` (main, refresh board) | the whole `rewardSystem` map | **kept** as a client preference, but now writes only the three dotted board keys (`updateRewardSystemPreferences`), the same keys as lite. A stale map can no longer overwrite the host's run display copies |
| 5 | `TrainingScreen.tsx:98` (main, sync-boost toggle) | the whole `rewardSystem` map | **kept**, now the single dotted key `rewardSystem.syncBoostEnabled` |
| 6 | lite `QuestsScreen` / `TrainingScreen` starts | none. They already called the callables | unchanged. The callables now regenerate first |
| 7 | holobots-fun `updateUserEnergy` (`../holobots-fun/src/lib/firestore.ts`) | `dailyEnergy` | **denied** from now on. This extends the 2026-07-12 owner decision that web economy writes break until the web app migrates |

No other client path writes these fields. `AuthContext`'s sign-up `dailyEnergy: 100` is the optimistic local frame and is never written. `lite/qa/previewProfile.ts` is the offline QA fixture.

## Time-zone design (`functions/src/lib/energyRegen.ts`, pure)

Device clocks and zones cannot be trusted, so the design rests on three rules.

- **Every instant comes from the host clock.** The request is `{}` or `{timeZone}`. Any other key, such as a client "now" or a day key, is `invalid_request`.
- **The account's zone is stored server-side.** It lives in `energyTimeZone`, an IANA name canonicalised through `Intl` (Node 22 full ICU). The device zone is only a *proposal*. The **first** valid proposal is stored. A **different** one replaces it only when 7 days have passed since `energyTimeZoneChangedAt` (`TIME_ZONE_CHANGE_COOLDOWN_MS`). The first set starts no cooldown. Inside the cooldown the stored zone keeps computing, and the reply says `timeZoneStatus: "cooldown"` with `timeZoneChangeAvailableAt`. Until any zone is stored, the account computes in UTC and nothing is stored.
- **Reset rule.** A reset happens when the host's "now", read in the account zone, is a *strictly later* calendar day than the stored `energyDayKey`. It refills to `max(energy, maxDailyEnergy)`, so a refill-item top-up above max is never clipped.
  - **Westward** zone moves make the calendar go back, so they never reset.
  - **Eastward** moves never grant a reset by themselves. If the current energy day began less than 24 h ago (`energyDayStartedAt`), the new zone's today counts as already reset. The known-bad unit test covers this case: a hop to Pacific/Kiritimati 11 h after the LA reset gives only the 44 trickle intervals, not a second refill.
  - DST: on the fall-back day the reset lands at 00:00 PST (08:00Z). A unit test covers this.
- **Trickle and steps use the client's rates.** The trickle is +1 per whole 15 min since `lastEnergyRefresh`, and the clock advances only by consumed intervals. The step bonus is +1 per 250 steps, at most 40 per energy day, up to max. Steps are read from the **server-only** `users/{uid}/fitness_daily/{todayKey}.stepsTotal`, keyed by the host's today in the account zone. They are no longer read from the profile's `todaySteps`.
- **Legacy accounts** have no `energyDayKey`. Their day is `lastEnergyRefresh`'s day in the zone being set, which is what the device-local reset used. A `lastEnergyRefresh` in the future (a client clock skew) settles on "now" without a grant. A missing one resets once, which matches the old client behaviour, and clients can no longer delete it.
- **Reply** (`energy-regen-1`): `changed`, `dailyEnergy`, `maxDailyEnergy`, `energyDayKey`, `timeZone`, `timeZoneStatus`, `timeZoneChangeAvailableAt` and `nextResetAt`, the host's next local midnight, searched to the exact second. A pass with nothing due writes nothing.

New server-only fields: `energyDayKey`, `energyDayStartedAt`, `energyTimeZone`, `energyTimeZoneChangedAt`. They are written as Timestamps and strings.

Residual risk: a player can still pick any zone once per 7 days. That shifts *when* their midnight falls but never adds a reset. The 24 h guard and the strictly-later rule hold the worst case to one reset per real calendar day in some zone. Steps are reported by the device's HealthKit and, as before, are capped at 40 energy a day.

## Rules: before / after (`firestore.rules`, `match /users/{uid}`)

| | Before (#203) | After |
|---|---|---|
| `clientWritableKeys()` | `dailyEnergy`, `lastEnergyRefresh`, `stepEnergyDate`, `stepEnergyGrantedToday`, `rewardSystem`, `syncDistanceUnit`, `referralCode`, `presenceOptOut` | `rewardSystem`, `syncDistanceUnit`, `referralCode`, `presenceOptOut` |
| Energy | client-writable, capped at `maxDailyEnergy` by `energyNotInflated` | **server-only**. The four fields and the four new regen fields are on `protectedFieldsUntouched` as a second guard. `energyNotInflated` was removed because nothing left calls it |
| Create | `clientCreateKeys()` = allowlist + `isDevAccount: false`, `fitnessSource`, `onboardingPath` | same formula, so energy fields can no longer appear on a client create (sign-up is `createGenesisProfile` anyway) |
| Unchanged-value merges | legal | still legal (MapDiff), so a full-profile merge carrying the energy fields unchanged passes |

## Client (mobile)

- `useEnergyRegen` (shared by main and lite) calls `refreshEnergy` with the device zone. It calls on mount and sign-in, when the host's `nextResetAt` has passed, and when the local `computeEnergyRegen` *hint* says something looks due. Calls are at most once a minute, and only every 5 min after a reply that changed nothing (`shouldRefreshEnergy`). Requests are shared across mounted screens, and the profile listener shows the result. Offline, the hook keeps the last host value and retries on the next tick.
- Main `QuestsScreen` / `TrainingScreen` starts use `startQuestRunAuthoritative` / `startTrainingSessionAuthoritative` (`mobile/src/lib/progressionClient.ts`) with one request id per (kind, id, holobot). That id is kept after an unknown (network) outcome, so a retry replays instead of starting twice. Main training changes in one way: a **finished but unclaimed** session must now be claimed before a new start, because the host refuses `training_active`. The old client overwrote it. The lite app already behaved this way.
- `UserProfileUpdates` no longer has the energy keys, so the compiler rejects any client energy write. `profileWriteAllowlist.test.ts` still parses the rules allowlist, and now also asserts the energy keys are absent from it.
- The main screens use non-lite modules (`progressionClient.ts`), which keeps the lite flag-off proof (`progressionHost.test.ts`) green.

## Tests

| Suite | Result |
|---|---|
| Rules emulator (`rules-tests`, 26 files) | **160 / 160 pass**. New `energy-server-only.test.ts` (15 tests): 12 tampers denied on update **and** merge-set. 8 are energy-field tampers (refill to max, any spend, rewinding `lastEnergyRefresh` a day or 6 h, re-arming or re-dating the step ledger, the old four-field regen tick, deleting `lastEnergyRefresh`) and 4 are host regen-state tampers (zone hop, clearing the cooldown, rolling the day back, aging the day). Also: an unchanged-field full merge plus settings pass, and creates carrying energy are denied. 15 existing assertions were updated: the ones that used `dailyEnergy` as the "benign write" stand-in now use `referralCode`, and the ones that asserted client energy writes pass (mobile regen replay, web `updateUserEnergy`, the fat-account regen, the sane `stepEnergyGrantedToday`, the in-cap `dailyEnergy`) now assert the denial |
| Known-bad, in-suite | the 8 energy tampers **succeed** against the #203 rule shape, derived from the checked-in rules by putting the energy keys back on the allowlist and removing the new denylist entries. A guard checks that the derivation changed the text |
| Known-bad, literal origin/main rules | `ENERGY_KNOWN_BAD_RULES=<origin/main firestore.rules>` scratch run (not committed): **all 8 ALLOWED by origin/main `d987294`**, and every tamper **DENIED by this branch** (15 / 15) |
| Functions unit (`npm test`) | **603 pass, 0 fail**. New `scripts/test-energy-regen.mjs` has 14 tests: zone validation; request shape (no client time); the reset to the second at LA midnight, with Tokyo at the same instant *not* resetting; trickle; idempotency; the cooldown; the eastward-hop known-bad; westward no-reset; the first set / default / invalid zone; a missing or future refresh; step bonus, cap and carry; the above-max top-up; DST; Timestamp reads |
| Functions emulator | new `scripts/test-energy-regen-emulator.mjs` (5 tests): first zone stored, local-midnight reset, Timestamps written, no-op replay; steps read from `fitness_daily/{account-zone today}`, not the profile; the cooldown refusal; bad request / no auth writes nothing; `startQuestRun` regenerates and then debits. The full `npm run test:emulator` run gives **249 / 252**. The 3 failures also fail on untouched main `d987294`, run the same way. They are the stat assertions in `test-attribute-boost-emulator.mjs` (2) and `test-desktop-account-emulator.mjs` (v3 `battleStats`). They are unrelated to energy, and CI does not run this suite |
| Functions build (`npm run build`, shared parity) | pass |
| Mobile typecheck (`tsc --noEmit`) | pass |
| Mobile vitest | **1573 pass, 3 skipped**. New `energyHostClient.test.ts` (9 tests): `refreshEnergy` sends only a zone, the `shouldRefreshEnergy` schedule, the main-app starts send exactly `{id, holobotName, requestId}`, refusal vs unknown-outcome request-id handling, and dotted preference keys |

There was no UI simulator pass. As in #203, the offline QA preview has no backend and cannot exercise a callable.

## Deploy order (Pak deploys; nothing was deployed)

1. **Functions first, then rules, in the same session.** Deploy `refreshEnergy` (new), `startQuestRun` / `startTrainingSession` (changed: they regenerate before the energy check), then `firestore.rules`.
2. **Installed builds older than this PR break once the rules land:**
   - **Every old build:** energy **never refills on its own**. The old regen write is denied (it logs only, with no alert). Old *lite* builds still get the regen at each quest / training start, because the start callables now regenerate, so their energy catches up at the next start.
   - **Old main-app builds:** quest send and training start are denied ("Quest Failed" / "Training Failed"). Claims keep working.
   - Ship the app build with this PR to testers before deploying the rules, or accept the gap for the beta cohort.
3. Order relative to #203: #203's notes still apply (deploy its functions before its rules). This PR's rules include #203's.
4. No backfill is needed. Each account's first `refreshEnergy` stores its zone and derives its energy day from `lastEnergyRefresh`.

## Not in this lane (follow-ups)

- **Unity desktop** shows `dailyEnergy` from `desktopAccountSnapshot`, which does not regenerate. Desktop quest and training starts *do* regenerate (through the start callables). If desktop shows energy prominently, have it call `refreshEnergy` with the OS zone, or regenerate inside the snapshot.
- `syncFitnessActivity` still takes the client's `date` key for `fitness_daily`. The step bonus reads the host-computed key, so a mis-dated sync only fails to count. It cannot add energy beyond the cap of 40 per day.
- The holobots-fun web app has no regen path now (2026-07-12 decision).
