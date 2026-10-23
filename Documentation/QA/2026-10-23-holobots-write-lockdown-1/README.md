# holobots-write-lockdown-1: the client can no longer write its own Holobots

Base: main `8c6e96d`. Pak, 2026-10-23: "yes, lock it down". Finding from the expedition auto-battle readiness design (HolobotsUnity `Documentation/HANDOFFS/2026-10-23-expedition-autobattle-readiness-design.md`): `users/{uid}.holobots` was client-writable, so a modified client could set its own bots' levels, XP, attributes and sync stats. No deploy, no device, no real account. Astra's separate `syncReadiness` field (readiness-r1) is not touched. The allowlist below makes any new field server-only by default, so it needs no rules change of its own.

## What changed in one paragraph

A client **update** of `users/{uid}` may now change **only** these keys: `dailyEnergy`, `lastEnergyRefresh`, `stepEnergyDate`, `stepEnergyGrantedToday`, `rewardSystem`, `syncDistanceUnit`, `referralCode` and `presenceOptOut`. One `affectedKeys().hasOnly(...)` check enforces this. Every other field is written only by callables, which use the Admin SDK and bypass the rules. A client **create** may carry only those keys plus `isDevAccount: false`, `fitnessSource` and `onboardingPath`. Sign-up now runs through `createGenesisProfile`, the callable HoloCity desktop already uses. The four client writes that used to touch locked fields now call callables: three new ones and one existing one.

## Census: every client write to the profile doc (origin/main `8c6e96d`)

The Watch app does not write to Firestore. It has no Firebase SDK and talks to the phone over WatchConnectivity. The Unity client does not write to Firestore either. Its `DesktopFirebaseClient.cs` uses Identity Toolkit and calls the callables over `cloudfunctions.net` only, and it has no Firestore endpoint. So every client write is in `mobile/`, covering the main app and the lite tree.

| # | File:line (origin/main) | Writes | Callable that should do it | This PR |
|---|---|---|---|---|
| 1 | `mobile/src/contexts/AuthContext.tsx:439` (signup) | full profile: `holobots[starter]`, `battle_cards`, `arena_deck_template_ids`, `starter_deck_claimed`, `inventory`, `asyncBattleTickets`, `leaderboardScore`, zero balances | **`createGenesisProfile`** (exists; desktop sign-up) | **moved** to the callable |
| 2 | `AuthContext.tsx:463` ("recover setup": auth exists, no doc) | same as #1 | `createGenesisProfile` | **moved** |
| 3 | `AuthContext.tsx:265` (sync-progression backfill) | `holobots` (unchanged), `syncPoints`, `lifetimeSyncPoints`, `seasonSyncPoints`, `syncRank`, `leaderboardScore` | none needed. The sync fields were already frozen, so this write was already denied whenever it changed one | **removed**. The leaderboard mirror now recomputes the score (see below) |
| 4 | `AuthContext.tsx:281` (legacy starter-deck backfill) | `battle_cards`, `arena_deck_template_ids`, `starter_deck_claimed` | none existed | **moved** to new **`claimStarterDeck`** |
| 5 | `mobile/src/screens/InventoryScreen.tsx:171` + `lite/screens/InventoryScreen.tsx:155` (equip Sync Ability) | the whole `holobots` array with `equippedSyncAbilityId` | none existed | **moved** to new **`equipSyncAbility`** |
| 6 | `mobile/src/screens/HomeScreen.tsx:578` + `lite/screens/HomeScreen.tsx:666` (equip part) | the whole `equippedParts` map, including part `rarity` / `name` that `getEquippedPartBoosts` reads | none existed | **moved** to new **`equipHolobotPart`**. The host copies the owned part's record |
| 7 | `mobile/src/lib/moveLabClient.ts:42` + `:62` (Move Lab fallback) | `holobots` + `syncPoints` (move upgrade), `holobots` (kit save) when the callable was unreachable | `upgradeHolobotMove` / `saveHolobotCombatKit` (exist) | **fallback removed**. The callable is the only path, and offline shows "needs a connection" like every other economy action |
| 8 | `mobile/src/lib/profile.ts:336` (`updateUserProfile` recompute) | `leaderboardScore` on any `holobots` / `syncPoints` / `seasonSyncPoints` write | the mirror trigger | **removed**. `updateUserProfile` now emits only allowlisted keys |
| 9 | `mobile/src/hooks/useEnergyRegen.ts:52` | `dailyEnergy`, `lastEnergyRefresh`, `stepEnergyDate`, `stepEnergyGrantedToday` | none. Regen uses the device's local calendar day | **kept** and **capped** at `maxDailyEnergy`, which is now server-only (follow-up below) |
| 10 | `mobile/src/screens/QuestsScreen.tsx:76,105`, `TrainingScreen.tsx:76,104` (main app) | `dailyEnergy`, `rewardSystem` (quest-board refresh, legacy local starts, sync-boost toggle) | `startQuestRun` / `startTrainingSession` exist (lite uses them) | **kept**. `rewardSystem` pays nothing, because claims validate against server-only `progressionTimers`. Energy is capped |
| 11 | `mobile/src/lite/lib/progressionHostClient.ts:49` | dotted `rewardSystem.<key>` (quest-board / sync-boost preferences) | n/a | **kept** (allowlisted) |
| 12 | `mobile/src/screens/FitnessScreen.tsx:91`, `lite/screens/FitnessScreen.tsx:74` | `syncDistanceUnit` | n/a, cosmetic | **kept**. Allowlisted, `"km"` / `"mi"` only |
| 13 | `mobile/src/screens/MarketplaceScreen.tsx:141`, `lite/screens/MarketplaceScreen.tsx:137` | `referralCode` (own code, lazily published) | n/a. `applyReferralCode` re-derives ownership | **kept**. Allowlisted, ≤ 12 characters |

Other fields the old rules left client-writable that no client in this repo writes: `prestigeCount`, `maxDailyEnergy`, `lastAsyncTicketRefresh`, `attributeBoostRequestIds` (the boost replay ledger), `username`, and any field not yet invented. All of them are now server-only.

The read-only `fitnessSync.ts` transaction helpers and the legacy `minting.ts`, `arenaEconomy.ts` and `progressionClaims.ts` builders were never wired to a write. Only parity tests and display previews import them.

## Rules: before / after (`firestore.rules`, `match /users/{uid}`)

| | Before | After |
|---|---|---|
| Update | owner, minus a **denylist** (`protectedFieldsUntouched`: currency, blueprints, parts, Buddy Units, timers, …). Everything else was writable, including `holobots`, `equippedParts`, `battle_cards`, `inventory`, `leaderboardScore`, `prestigeCount`, `asyncBattleTickets`, `maxDailyEnergy` and any new key | owner, and **only** `clientWritableKeys()` may be added, changed or removed (`onlyClientWritableKeysChanged`). The denylist stays as a second guard and gains the fields above. Writing any field with an **unchanged** value still passes, so full-profile merges keep working |
| Energy | `0 ≤ dailyEnergy ≤ 1e8` | additionally `≤ maxDailyEnergy` (default 100). A balance the host already put above the cap may be spent down but not raised (`energyNotInflated`) |
| Settings | free-form | `syncDistanceUnit ∈ {km, mi}` when changed; `referralCode` ≤ 12; `presenceOptOut` bool |
| Create | owner, economy fields only at zero / defaults, `holobots` / cards / inventory allowed | owner, keys ⊆ `clientCreateKeys()` (allowlist + `isDevAccount: false`, `fitnessSource`, `onboardingPath`), `dailyEnergy ≤ 100` |
| Delete | denied | denied (unchanged) |

The evaluation budget is unchanged in kind. The new check is one MapDiff `hasOnly`, the same shape the 2026-07-18 budget fix chose. `equip-repro.test.ts` adds a full-profile merge on the deliberately fat account.

## New callables (`functions/src/lib/holobotLoadout.ts`, pure and unit-tested)

| Callable | Request | Validates | Idempotency | Refusals (`details.rejectionCode`) |
|---|---|---|---|---|
| `equipSyncAbility` | `{holobotName, abilityId}` | holobot owned (case-insensitive). The ability is in its stored `syncAbilityUnlocks`, or, when that field is absent, in the unlocks its stored `syncStats` earn (the same fallback as mobile `normalizeUserHolobot`) | a set operation. Re-equipping the same ability writes nothing (`changed: false`) | `invalid_request`, `unavailable`, `not_owned`, `ability_locked` |
| `equipHolobotPart` | `{holobotName, slot: head\|torso\|arms\|legs\|core, partId}` | holobot owned; the part is in `users/{uid}.parts`, matched on the same id derivation as HomeScreen (`id` or `${name}-${index}`); it fits the slot (same word match as HomeScreen `compatibleParts`). The stored record `{id, name, rarity, slot}` is copied from the owned part, never from the request | a set operation; the same part again writes nothing | `invalid_request`, `unavailable`, `not_owned`, `part_not_found`, `slot_mismatch` |
| `claimStarterDeck` | `{}` | grants the Genesis starter deck only when `starter_deck_claimed` is not true **and** the account owns no cards | after one grant, every later call is `granted: false` with no write | `unavailable` |

`createGenesisProfile` was already transactional and idempotent: an existing profile reports `created: false` and is left untouched.

**Leaderboard:** `mirrorLeaderboardEntry` (via the new pure `lib/leaderboardProjection.ts`, also used by `scripts/backfill-leaderboard.mjs`) now **recomputes** `leaderboardScore` from `holobots`, `wins`, `seasonSyncPoints` and `prestigeCount` with the same `computeLeaderboardScore` the callables use. Before, it copied the stored field. A score a client tampered with before this change no longer ranks once that profile is next written. Run the backfill script after deploy to re-project everyone at once.

## Client flows changed

- **Sign-up and "recover setup"** call `createGenesisProfile` (15 s deadline) instead of `setDoc`. The optimistic local profile is unchanged. The parity test pins that its starter holobot and deck equal the host's. **Product note:** a phone sign-up now gets exactly the desktop account: also the host-only grants (one Repair Kit, the starter Light Buddy Unit, `pilotRank: 0`, the first travel holobot, onboarding step 0). Before, a phone account received these lazily or not at all. The parity test always intended desktop and mobile accounts to be equal.
- **Equip Sync Ability** (Inventory, main and lite) and **equip part** (Home part picker, main and lite) call the new callables. The profile listener shows the result. Error alerts are unchanged.
- **Move Lab** upgrades and kit saves no longer fall back to a local write when offline. They show the standard "This action needs a connection" message.
- **Legacy starter deck** is granted by `claimStarterDeck`, once per signed-in uid per session, and retried after a failure.
- `updateUserProfile` accepts only the allowlisted fields, enforced by its type. `profileWriteAllowlist.test.ts` parses `clientWritableKeys()` out of `firestore.rules` and fails if the writer can emit any key outside it.

## Tests

| Suite | Result |
|---|---|
| Rules emulator (`rules-tests`, all 25 files) | **146 / 146 pass**. New `write-lockdown.test.ts`: 20 tamper writes denied (update **and** merge-set), cosmetic / energy / rewardSystem writes pass, unchanged-field full merge passes, energy cap cases, create allowlist. 13 existing assertions updated where they asserted the old client writes were allowed (signup create, part equip, attribute spend, deck / cards writes). They now assert the denial |
| Known-bad, in-suite | the same 20 tampers **succeed** against the pre-lockdown rule shape, which is derived from the checked-in rules by removing the allowlist, the energy cap and the new denylist entries, with a guard that the derivation changed the text |
| Known-bad, origin/main rules | scratch run, not committed: every one of the 20 tampers is **ALLOWED by origin/main `firestore.rules`** and **DENIED by this branch** (20 / 20) |
| Functions unit (`npm test`) | **589 pass, 0 fail**. The new `scripts/test-write-lockdown.mjs` has 13 tests: validation, refusals, idempotency, the record copied from the owned part, the synthesized part id, the starter deck granted once, and the recomputed leaderboard score ignoring a stored tamper |
| Functions build (`npm run build`, shared parity) | pass |
| Mobile typecheck (`tsc --noEmit`) | pass |
| Mobile vitest | **1562 pass, 3 skipped**. The genesis parity test is rewritten for the callable sign-up. The new `profileWriteAllowlist.test.ts` checks the writer against the rules allowlist |

### Emulator smoke of the affected flows (no real project, no real account)

The Auth, Firestore and Functions emulators ran under project `demo-holobots-lockdown`, with the branch rules and the built functions. The script drives the same Firebase JS SDK calls the app makes (`httpsCallable`, `updateDoc`):

```
SMOKE signup via createGenesisProfile: created, holobots [ 'KUMA' ] cards 20 itemStocks {"repair_kit":1}
SMOKE createGenesisProfile replay: created=false (idempotent)
SMOKE client holobots write: DENIED
SMOKE allowed writes OK; energy over maxDailyEnergy DENIED
SMOKE equipSyncAbility: locked refused, equip applied, replay changed=false
SMOKE equipHolobotPart: forged/slot refused, equip applied from owned part; client equippedParts write DENIED
SMOKE claimStarterDeck: no-op when claimed, legacy grant once, replay no-op
SMOKE leaderboard mirror score 265 (stored tamper 99999999 ignored)
SMOKE ALL PASS
```

There was no UI simulator pass of these screens. The offline QA preview (`isLitePreviewEnabled`) points Firebase at a closed port and has no backend, so it cannot exercise a callable. A UI pass needs a build wired to the emulators (or staging) on a test account, which is the device / TestFlight check below.

## Deploy notes (Pak deploys; nothing was deployed)

1. **Rules and functions must ship together, functions first.** These rules deny the old client writes that the new callables replace. Deploy the functions (`equipSyncAbility`, `equipHolobotPart`, `claimStarterDeck`, and the changed `mirrorLeaderboardEntry`), then the rules, in the same session.
2. **Installed app builds older than this PR break on three flows once the rules land.** On those builds, sign-up writes the profile with `setDoc` and is denied, which leaves a **new account with no profile**. The Sync Ability equip and part equip are denied too, with an "Equip failed" alert. Ship the app build with this PR to testers before deploying the rules, or accept the gap for the beta cohort. Already-created accounts keep working for every other flow.
3. After deploy, run `node functions/scripts/backfill-leaderboard.mjs --key …` once (build first). It re-projects every leaderboard entry with the recomputed score.
4. The holobots-fun web app (`~/Projects/holobots-fun`, last commit 2026-07-20) writes `holobots`, `equippedParts`, `inventory`, `username`, `maxDailyEnergy`, `prestigeCount`, `asyncBattleTickets` and its own sign-up doc from the client. Those writes are now denied, which extends the 2026-07-12 owner decision ("web economy writes break by design until it migrates").

## Not in this lane (follow-ups)

- **Energy authority.** `dailyEnergy` regen is still client-computed (trickle, steps and a local-day reset). It is now capped at the server-owned `maxDailyEnergy`, so the worst case is skipping the wait to refill to max, never inflating past it. A host regen needs a time-zone decision for the daily reset.
- **Main-app quest / training starts** still use the legacy local `rewardSystem` start (QuestsScreen / TrainingScreen). The lite app already uses `startQuestRun` / `startTrainingSession`. Those starts pay nothing, because claims validate against `progressionTimers`.
- Owner-writable subcollections under `users/{uid}/…` (other than `fitness_daily`) were not audited.
