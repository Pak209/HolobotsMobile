# Approved capture ownership — DECISIONS #40

Pak approved the exact account mutation on 2026-09-29 at 11:49 PDT, superseding the earlier approval-review rejection documented in README.md. Implementation and tests are local only; no deployment, provisioning or production account writes occurred.

## Fields and outcomes

Every wildEncounterHost reply includes `travelSquad: {schemaVersion:"travel-squad-1", revision:number, holobotIds:string[]}`. Storage is `users/{uid}.travelSquad` with the same shape. IDs are normalized using the existing toHolobotKey convention and must match `^[a-z0-9_]{1,128}$` on the wire. Order is slot order; maximum three distinct owned IDs. Missing storage reads as revision zero and empty slots, without writing on refresh. Invalid schema, duplicate/unknown owned references, too many slots or invalid revision fail closed. Revision increments only when an auto-fill changes the squad. Full squads and duplicate captures preserve it exactly.

CaptureResult adds:

| ownershipOutcome | blueprintDelta | Meaning |
|---|---:|---|
| `added_to_squad` | 0 | Newly owned bot appended and added to a free travel slot |
| `new_bot` | 0 | Newly owned bot appended; full squad kept unchanged |
| `blueprints` | 5 | Existing owned bot preserved; its normalized blueprint balance increased |
| empty string | 0 | Refused; no account grant |

A new bot is appended to `users/{uid}.holobots` with name uppercase, level 1, experience 0, nextLevelExp calculateExperience(2), rank getHolobotRank(1), attributePoints 10, boostedAttributes empty. Existing records and unrelated profile fields remain unchanged. Duplicates update only the existing blueprint map and never add to the squad. No currency or other reward is granted.

All account updates, encounter/inventory changes and immutable request receipt are in one Firestore transaction. The UID is authenticated by the callable. Same-request replay retains the original outcome while returning current world, roster and squad snapshots. Changed-body replay rejects. Distinct successful encounters for the same species serialize into one owned record and a duplicate blueprint grant.

Firestore rules deny client creation, modification and deletion of travelSquad, while allowing unchanged merges and owner reads. The existing client-writable holobots field is a legacy limitation; this change does not expand that permission. Server-only encounter/receipt paths remain denied. Dashboard squad replacement is a separate explicit intent and is not implemented here; automatic capture never replaces anyone.

## Verification

| Check | Result |
|---|---|
| TypeScript build and shared parity | PASS |
| Domain tests | 9/9 |
| Firestore transaction emulator | 14/14 |
| Squad rules + economy/mobile/auth regressions | 35/35 |

Concurrency proof covers repeated receipts, last Toy contention, duplicate capture receipt, two encounters for the same new species, and two new species competing for the final squad slot. Other cases cover exact standard record, full squad, refusal without account writes, mixed-case owned-name normalization, malformed squad rollback and replay with current squad. One initial test import path typo was corrected before the accepted run.

Commands:
- `npm --prefix functions run build`
- `node --test functions/scripts/test-wild-encounter.mjs`
- `rules-tests/node_modules/.bin/firebase emulators:exec --project demo-holobots-wild-tests --only firestore 'node --test functions/scripts/test-wild-encounter-emulator.mjs && cd rules-tests && ./node_modules/.bin/vitest run tests/travel-squad.test.ts tests/economy-freeze.test.ts tests/mobile-writes.test.ts tests/auth-privilege.test.ts'`

No physical mobile/Unity transport, authenticated deployed callable, or live-account verification is claimed.
