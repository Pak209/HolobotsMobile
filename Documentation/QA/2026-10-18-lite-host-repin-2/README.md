# lite-host-repin-2: re-pin lite's host to 9315624 and add a tolerant onboarding read

The host `holobots-24046` is deployed from main `9315624` (2026-10-18). That deploy includes #160 (the KO heal floor) and #162 (the onboarding host). This PR re-pins lite's vendored host snapshot (`mobile/test-fixtures/host-pin`) from `a90d061` (#151) to that commit, and takes main's parity expectations where the host changed. It also adds an optional, lenient `onboarding` read to `readDashboardAccount`. Lite **presents nothing** from it: there is no UI. Only test, fixture, pin and reader code changes. `rivalTierStats.ts`, `cityRivalBattle.ts`, the Arena stage files, `functions/` and the rules are untouched.

Rule 1: the host decides, and the client presents.

```
node mobile/scripts/pin-host.mjs --check 931562477170ee0cdde447826b3e8dbd144c0280   # before: DRIFT, 4 differ + 1 unpinned
node mobile/scripts/pin-host.mjs --sha   931562477170ee0cdde447826b3e8dbd144c0280 --note "…"
node mobile/scripts/pin-host.mjs --check 931562477170ee0cdde447826b3e8dbd144c0280   # after: OK
node mobile/scripts/pin-host.mjs --check                                            # snapshot == HOST_PIN.json: OK
```

The base is the GitHub-verified `mobile-holocity-lite` tip `296f823` (#168). Work started on `49d9d92` (#165), then was rebased with no conflicts: #168 touches only the Arena stage files.

## Pin entries that changed (HOST_PIN.json)

The pin's `sha` / `srcTree` moved from `a90d061` / `3db577e` to `9315624` / `963931c`. The 23 test entry points are unchanged. The vendored files went from 43 to 44.

| Host file | Blob | Host change now pinned | Test effect |
|---|---|---|---|
| `lib/repairItems.ts` | `3623278` → `7ec158f` | #160, DECISIONS #72.1 "floor + item": an item heal on a bot below the 40 % KO fallback now starts **from** that floor. `result.currentHealth` is the final HP, with float noise rounded off. | `healingUseServerParity` failed against the new pin (expected 37.5, got 97.5). This PR takes **main's test**: HP 0 / 30 / 90 of 150 for each item gives patch 97.5 / 97.5 / 127.5, kit 135 / 135 / 150 and restore 150, always ≥ the floor. |
| `lib/rivalHealth.ts` | `2129b98` → `e2372c0` | #160: `KO_FALLBACK_FRACTION = 0.4`, one constant shared with `repairUse`. | `healingCityRecoveryParity` passes unchanged (60 of 150). |
| `lib/genesisSignup.ts` | `6f91418` → `c4b6169` | #162, DECISIONS #72.5: `buildGenesisHostGrants()` gives one Repair Kit, as host-only grants. | Took **main's new test**: the grants are `{itemStocks:{repair_kit:1}}`, and neither the mobile sign-up doc nor `buildGenesisSignupUserDoc` carries `itemStocks` or `onboarding`. The existing parity passes unchanged. |
| `desktop/desktopAccountReply.ts` | `b96e821` → `8bfa1bc` | #162: an additive top-level `onboarding` on every desktop-account-1/2/3 reply. | Existing tests pass unchanged (additive). The new `hostOnboarding.test.ts` reads the pinned builder's real replies. |
| `lib/onboarding.ts` | new, `993a02d` | #162: the onboarding spine (`readOnboarding`, `onboardingView`). | Vendored only because `desktopAccountReply.ts` now imports it. No test imports it directly. |

## Known drift: the ratchets

- **`RIVAL_NAMED_PROFILES`** (`rivalLadderScaleParity`): **unchanged.** `lib/rivalTierStats.ts` is byte-identical between `a90d061` and `9315624`, so the ratchet passes as before and still prints `KNOWN DRIFT`. Syncing the client copy is product work, and `rivalTierStats.ts` is out of scope here (open #157).
- **`playerCombatants` omitted from citizen rival issues**: **unchanged.** Deployed `functions/src/rival/rivalBattleStore.ts:141` still deletes it for a `citizenId` issue. Lite's `readCityRivalIssue` still requires it. Citizen duels stay HELD, and the file is out of scope here (open #157).
- No ratchet was added or removed.

## Onboarding reader

`readDashboardOnboarding` (`mobile/src/lib/hostDashboard.ts`) mirrors main's `readHostOnboarding` (`mobile/src/lib/hostState/readers.ts` at `9315624`):

- It accepts `schemaVersion: "onboarding-1"` only.
- `step` must be an integer 0–7, and `stepId` must be that step's id.
- `skipped` must be a boolean, and `skipped` implies step 7.
- `stepAt` must be null or a safe integer ≥ 0.

Anything else reads as `undefined`. `DashboardAccount.onboarding` is then absent, and the account read never fails because of the field. A well-formed value is returned frozen, without its `schemaVersion`. Like main, the reader tolerates extra keys. The fixture's 4th `knownBad` entry, `extra: true`, is a host-schema reject (`additionalProperties: false`), but both readers accept it. A test pins that behaviour.

Fixture: `mobile/src/qa/fixtures/onboarding.json` is a byte copy of main `9315624`'s `functions/scripts/fixtures/desktop-account/onboarding.json` (blob `7d799d3`, sha256 `98b9ea36…`). It is sha256-pinned in the test. `Schemas/onboarding-1.json` (blob `cdf145c`) does not exist on lite's branch. It is cited, not copied.

`hostOnboarding.test.ts` adds 23 tests:

- **Absent:** an older host's reply gives no `onboarding` key.
- **Well-formed:** the recorded returning, genesis and skipped replies, plus the pinned host's real v1/v2/v3 replies at steps 0–7 and the returning default.
- **Malformed:** null, an array, a string, a number, `{}`, the wrong schema, a mismatched stepId, a non-integer step, a non-boolean skipped, a negative stepAt, a missing stepAt, and the fixture's first three `knownBad` entries. Each reads as undefined, and the account still parses.

## Verification

| | vitest | tsc |
|---|---|---|
| `49d9d92` (before) | 1288 pass / 4 skip (94 files + 1 skipped) | 0 |
| new pin, before taking main's expectations | 1 failed (`healingUseServerParity`) / 1287 pass / 4 skip | 0 |
| this PR on `49d9d92` | 1312 pass / 4 skip (95 files + 1 skipped) | 0 |
| **this PR rebased on `296f823`** | **1322 pass / 4 skip** (96 files + 1 skipped; #168 adds 10) | **0** |
| host-pin parity subset (the 23 test files that import the pin) | 231 pass / 4 skip | n/a |
| known-bad control, `HOLOCITY_HOST_ROOT=<a90d061 functions>` | **6 failed**: hostPin, healingUseServerParity, genesis host grants, onboarding real-reply ×3 | n/a |

`pin-host --check 9315624` and `pin-host --check` (snapshot vs manifest) both report OK.

## Note for the next deploy

Re-run `--check <deployed sha>` after every host deploy. Nothing fails by itself when the deployed host moves.
