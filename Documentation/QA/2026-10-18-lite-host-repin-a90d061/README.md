# lite-host-repin-a90d061: lite's parity tests pin the deployed host

The host hardening set (#143 and #145) is deployed to `holobots-24046` from main `a90d061` (2026-10-18). This PR re-pins lite's vendored host snapshot (`mobile/test-fixtures/host-pin`, from lite-test-parity-1 #141) from `3b1e790` to that commit. It takes main's updated parity expectations where the deployed host changed, and nothing else. It is test-only: no app code changes. It is a separate PR from lite-progression-host-1 (#146) so that one is not delayed; the two touch no files in common.

```
node mobile/scripts/pin-host.mjs --check a90d061996bd789779abb89f5552ea60d9721fe2   # before: DRIFT, 8 files
node mobile/scripts/pin-host.mjs --sha   a90d061996bd789779abb89f5552ea60d9721fe2 --note "…"
node mobile/scripts/pin-host.mjs --check a90d061996bd789779abb89f5552ea60d9721fe2   # after: OK
node mobile/scripts/pin-host.mjs --check                                            # snapshot == HOST_PIN.json: OK
```

The base is the GitHub-verified `mobile-holocity-lite` tip `0756650`.

## Drift that disappeared (the 8 re-pinned host files)

| Host file | Host change now pinned | Test effect |
|---|---|---|
| `lib/economy.ts` | `77a8605` S2: daily missions pay from the server-only `dailyMissionLedger`. `c379317` (#145): mission mirror merged, not replaced; `dailyMissionLedgerSummary`. | `economyServerParity` "claims pay the table amount once, then refuse" failed against the new pin (the counters in the client-writable mirror no longer complete a mission). This PR takes **main's S2 expectations**: progress from the ledger, and a forged mirror refused with `not_completed`. |
| `lib/progressionEconomy.ts` | `c379317` (#145): `getHolobotPowerScore` (host-computed quest power). | Took **main's #145 test**: "quest start power", server equals client for 12 bots × 5 levels × 4 boost sets. |
| `desktop/desktopAccountReply.ts` | `c379317` (#145): additive `dailyMissionLedger` on every desktop-account reply. | Existing tests pass unchanged (additive). |
| `lib/desktopItems.ts` | `77a8605` (S2). | Unchanged tests pass. |
| `config/zoneExpedition.ts` | `6a78c80`: zone-run-4 band dangerLabel = PLACE names (#71.3). | Unchanged tests pass. |
| `desktop/desktopDashboardFields.ts`, `holozone/expedition.ts`, `lib/holoZoneRuns.ts` | `c921d30`: HoloZones story gate on desktop zone rows and zone issue (`zone_locked`). | Unchanged tests pass. |

## Known drift that remains

- **`RIVAL_NAMED_PROFILES`** (`rivalLadderScaleParity`): the deployed host's `lib/rivalTierStats.ts` still appends it (main `9e2f4eb`), and lite's client copy still lacks it. The ratchet passes unchanged and still prints `KNOWN DRIFT`. It must be deleted when the client copy is synced (product work, not here).
- **`playerCombatants` omitted from citizen rival issues**: deployed `functions/src/rival/rivalBattleStore.ts:136` still deletes it for a `citizenId` issue (from `8f82e19`). Lite's `readCityRivalIssue` (`mobile/src/lib/cityRivalBattle.ts:35`) still requires it. Live citizen duels stay HELD behind `CITY_LIVE_DUELS_HELD`, so players cannot reach it. No pinned test covers it; the integration suite that would is opt-in and skipped.
- **Lite and main parity tests that differ for other reasons**, not because of the deploy, and left alone: `battleSettlementParity`, `desktopAccountParity`, `rivalLadderScaleParity` and `genesisSignupParity`. They differ by lite's pin-based reads, the known-drift branch, opt-in warnings, or main-only client code (`battlefieldMovement` on main's client). `desktopStoryFlagsParity` exists only on main.

## Verification

| | vitest | tsc |
|---|---|---|
| `0756650` (before) | 1221 pass / 4 skip (90 files + 1 skipped) | 0 |
| new pin, before taking main's expectations | 1 failed (`economyServerParity` S2) / 1220 pass / 4 skip | 0 |
| **this PR** | **1222 pass / 4 skip** (90 files + 1 skipped) | **0** |
| known-bad control, `HOLOCITY_HOST_ROOT=../functions` (lite's stale branch copy) | **6 failed** (5 files: desktopAccountParity, economyServerParity, hostPin ×2, progressionServerParity, rivalLadderScaleParity) | n/a |

## Note for the next deploy

Nothing in the repo records the deployed sha yet (#141's "deploy-time failure" note). Re-run `--check <deployed sha>` after every host deploy.
