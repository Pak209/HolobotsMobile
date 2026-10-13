# PR #78 merge with main (#71–#77) — 2026-10-13

Lane: CLAUDE (pr78-merge). `git merge origin/main` into `codex/r4-arena-match-record` (merge commit, no rebase, no force-push). No deploy and no production calls. Every run used a loopback Firestore emulator under the demo project `demo-holobots-pr78`.

## What conflicted
Seven files: `account/deleteUserAccount.ts`, `arena/chargeArenaEntry.ts`, `arena/settleArenaBattle.ts`, `holozone/holoZoneStore.ts`, `rival/rivalBattleStore.ts`, `vendors/desktopItemsHost.ts`, `index.ts`. Two files merged cleanly but needed semantic changes: `lib/healingGuards.ts` vs `lib/arenaActivity.ts`, and the `arena/arenaMatchStore.ts` settle path.

## Choices (the chair's rules)
1. **One guard module.** `lib/arenaActivity.ts` is now the canonical module. It holds `arenaOpen`, `duelOpen`, the new `leaseHolder`, and `ActivityError`, which now extends `RepairError` so both caller families still fail closed. `lib/healingGuards.ts` became a one-line re-export. This was the smaller diff because no healing caller had to change. `arenaMatchStore`'s inline duel parse now calls the shared `duelOpen`.
2. **Legacy callables stay closed.** `chargeArenaEntry` and `settleArenaBattle` keep #78's bodies and return `arena_match_required`. Healing's additions to these two files were dropped. #72's `withRankHealingReward` was the only reward hook on the legacy settle. It now runs on the durable `arenaMatchStore` settle. #74 added only the legacy match marker to these files, and the durable lease already covers that.
3. **`desktopItemsHost`.** Healing's full repair body is kept: duel heal with bench-only, switch-lockout and not-in-squad, plus the zone-ledger check. #78's `arena_no_heal` refusal runs first, inside the same transaction and before any write. A malformed Arena record (`ActivityError`) returns `unavailable`.
4. **`deleteUserAccount`.** Takes the union of both path lists, plus main's town-grant cleanup.
5. **`index.ts`.** Exports everything from both sides: `arenaMatchHost`, `townGrantIssue`/`townGrantRevoke`, `duelHealingHost`, and the workshop heal and craft hosts.
6. **Rival / zone stores.** One `requireLeaseFree` read (Arena parent plus duel run) in the issue transaction. An open Arena gives `activity_conflict`. An open duel gives healing's original code (`too_many_open` for rival, `unavailable` for zone). A malformed record gives `unavailable`. `withRankHealingReward` stays on every user update, and #78's refusal of first-time settle reward/HP writes during an Arena match is kept.

## Test adjustments (follow-up commit)
- `test-healing-use-emulator.mjs`: the old legacy charge/settle test could no longer pass because those callables are closed. It now runs the durable flow:
  - a KO entrant is refused with `holobot_ko`, and HP stays 0 (no city 40 % issue);
  - healing is refused with `arena_no_heal` while the match is open;
  - both legacy callables are refused with `arena_match_required`;
  - cancel closes the lease, and healing works afterwards.
- `test-arena-match-emulator.mjs` gained three tests:
  - a durable settle that crosses a rank tier (10 → 11) grants exactly +1 Repair Kit;
  - a known-bad control: levelling inside one tier grants none;
  - an open duel-healing run refuses rival, zone and Arena issue, with no writes.

## Results
Run 1 (port 8085, before the test adjustments): arena 38/38. desktop-items 8/10: the 2 failures were missing rules-tests node_modules plus a hard-coded port 18080 — environment only. healing-use 4/5: the 1 failure was the expected legacy-flow test. All others green.

Run 2/3 (port 18080, rules-tests `npm ci`):

| Suite | Pass/Total |
|---|---|
| arena-match | 41/41 (run 2 was 39/41 from a short requestId in my new fixture; fixed on attempt 2) |
| delete-user-data | 2/2 |
| holozone-health | 3/3 |
| rival-health | 3/3 |
| desktop-items | 10/10 |
| zone-ko-refusal | 5/5 |
| healing-catalog / contract / crafting / grants / rank-routes / use / workshop | 1/1, 1/1, 2/2, 3/3, 1/1, 5/5, 3/3 |
| town-grant | 6/6 |
| rival-battle | 15/15 |
| holozone | 6/6 |
| rules-tests (vitest) | 101/101, 17 files |
| `npm run build` (check:shared + tsc) | green |

Known-bads that still fail as designed (they assert the vulnerable baseline): the three arena `KNOWN-BAD exact old callable` cases (unpaid settle mints, A→B→A pays three times, lost-reply double charge). The new same-tier no-Kit control also holds.
