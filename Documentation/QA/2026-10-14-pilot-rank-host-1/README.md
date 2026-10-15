# pilot-rank-host-1

2026-10-14. W2 host contract change, stacked on arena-gathering-host-1 PR #80 (`6379b765abb20452690a61c97408197d53395982`). #80 is still open; this PR targets its branch for a W2-only review. Merge #80 first, then retarget/rebase this PR onto main and confirm integration checks. No deploy, production credentials, Pak account, editor operation, or Unity asset write was used.

## Contract

`users/{uid}.pilotRank` is a host-owned nonnegative safe integer, default **0**. Genesis host signup stores zero. Missing legacy/mobile-created values read as zero and are persisted by desktop account snapshot, tournament admission, or the first successful rival win. There is no retroactive conversion from `rivalWins`, `syncRank`, or Holobot level. Malformed values fail closed (`unavailable`) when read by these paths; incrementing `Number.MAX_SAFE_INTEGER` also refuses rather than losing precision.

Every existing desktop account version (`desktop-account-1`, `desktop-account-2`, `desktop-account-3`) adds `pilotRank` beside `storyFlags`:

```json
{
  "schemaVersion": "desktop-account-3",
  "uid": "authenticated-pilot",
  "storyFlags": {"arenaGatheringSeen": false, "tournamentsWon": 0, "arenaArcBuilt": false, "holoZonesArcBuilt": false},
  "pilotRank": 0
}
```

Other reply fields remain as before. The example is abbreviated. The additive reply fields use the existing schema versions, following #80's additive story-field compatibility pattern.

A first successful `rivalBattleHost` settle with a winning stored ruling increases `pilotRank` by **1** in the same transaction as the win/reward/receipt. Ordinary rivals, gathering citizens, and Zell share this path; all rival wire versions count. Losses, issue, status, refused settlements, and replay grant **0** rank. Concurrent distinct wins each count; concurrent duplicate settles count once. Existing client-observed combat trust remains unchanged: this adds no server combat simulation. No new reward, fee, cooldown, or damage number is introduced.

Tournament admission uses the participating **Holobot's level**, unchanged from #80: starter **2**, champion **11**, rare **21**. Pilot Rank never gates admission. Every newly issued tournament match adds the current host value to its immutable tag:

```json
{
  "schemaVersion": "arena-match-1",
  "match": {
    "tournament": {
      "schemaVersion": "arena-tournament-1",
      "tournamentId": "starter",
      "requiredLevel": 2,
      "pilotRankAtAdmission": 7
    }
  }
}
```

The server reads the account in the admission transaction; request payloads cannot supply this value. Request replay, start, settle, and resume retain the original snapshot if the account rank later changes. Present invalid snapshots fail closed. Older #80 admission tags that lack the field remain valid and replay without inventing a historical rank. `tournamentResultHost` and its `arena-tournament-1` result reply retain the #80 shape and progression rules; third win still flips only Arena and `holoZonesArcBuilt` remains false. Arena matches and tournament results do not increase Pilot Rank.

Firestore rules deny client creation of `pilotRank` (including zero), adding it to an existing account, increasing/decreasing/retyping/deleting it, and replacing/deleting the whole profile to erase it. An otherwise allowed merge containing the same existing rank remains valid. New mobile profiles omit the field until a host materializes the zero default.

## Verification

- Known-bad first: `known-bad.txt` records the #80 baseline failing the required desktop default assertion (`undefined !== 0`) before the correction.
- `npm run build`: passed, including TypeScript.
- `npm run check:shared`: 3 shared files in sync.
- `npm test`: 145 total; 144 passed, 1 existing skip, 0 failed.
- Emulator attempt 1: **83 passed / 1 failed** of **84** in **110.85 s**. All **13** new rank tests passed; the single failure was the existing rival-suite desktop key whitelist omitting the newly required additive `pilotRank` field. Corrected that contract fixture; attempt 2: **84 passed / 0 failed / 0 skipped** in **118.79 s**. Both attempt logs are committed.
- Local emulator safety: Dedicated demo-only project `demo-holobots-pilot-rank-20261014`, Firestore `127.0.0.1:18087`, websocket `19187`, hub `14402`, logging `14502`; 300-second process-group bound. Fixtures use generated throwaway UIDs. No production reads or writes.
- The focused 13-test suite covers defaults and idempotent migration, Genesis, all rival reply versions, a gathering citizen, losses/refusals, duplicate and distinct concurrent wins, no historical replay backfill, malformed/overflow refusal, all exact Holobot thresholds and below-threshold refusals independent of Pilot Rank, immutable/legacy/corrupt admission tags, unchanged tournament result behavior, and real client rules denials. Existing #80 gathering, R4 Arena, rival, and desktop suites run with it.

The emulator suite command (run from `functions/` inside the guarded emulator session) was:

```sh
node --test --test-concurrency=1 scripts/test-pilot-rank-emulator.mjs scripts/test-arena-gathering-emulator.mjs scripts/test-arena-match-emulator.mjs scripts/test-rival-battle-emulator.mjs scripts/test-desktop-account-emulator.mjs
```

`npm run test:pilot-rank` is the focused entrypoint; it refuses non-loopback or non-`demo-` environments before loading Firebase Admin. Existing regression fixture exporters write into this isolated worktree only. Their incidental historical-fixture rewrites are excluded from the commit.

## Review and limits

Independent parent review found no blocker in rank normalization, the atomic first-win increment/replay guard, protected rules, desktop defaults, or admission snapshot compatibility.

The increment uses the actual first settlement after the replay early return, and commits with the receipt. Transaction retries re-read the account counter; no request rank is trusted. Admission tags are host-owned durable records and do not join the deduplication request identity: replay intentionally returns the original historical snapshot. Preexisting #80 records stay readable. No bulk migration or backfill is attempted. All unrelated holds remain in place.
