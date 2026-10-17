# W27: host-backed city hub

The live hub reads `desktopAccountSnapshot({schemaVersion:"desktop-account-3"})` on focus and uses its `storyFlags`. A previously seen gathering then refreshes `arenaGatheringHost({schemaVersion:"arena-gathering-1"})`; an unseen account must explicitly join. The host supplies all eight citizen IDs, names, bots and rings. No account UID is sent in either request. Flags remain closed until verified, and delayed responses cannot cross accounts or overwrite a newer explicit join.

The existing `EXPO_PUBLIC_HOLOCITY_PREVIEW=1` development route continues passing its fixture. Fixture hub reads and cooldown views never invoke host operations. No new toggle or schema is introduced. Arena navigation remains available after the host marks the gathering seen; tournament eligibility remains host-owned, independent of numeric Pilot Rank or `arenaArcBuilt`.

Rival pins/list rows display per-citizen cooldown observations. `rival_cooldown` uses the host's finite nonnegative `details.retryAfterMs` relative to receipt time, not an invented five-minute retry. Clocks expire locally for presentation; the host still authorizes all admissions. Observations are scoped by account, excluded from fixtures, and timers/listeners are released on unmount.

## Compatibility hold

PR #94 deliberately omits `playerCombatants` from citizen issues. This lite branch's legacy combat player requires that array, while resolver admissions provide a different `duel.player/opponent` receipt contract. Opening such a battle previously caused the compatibility-error handler to submit a loss. Live citizen issuance is therefore blocked *before any callable* and the challenge panel explains that duels are unavailable in this build. Offline duels remain available. Do not remove this guard until mobile can consume the deployed admission mode and present/settle host receipts. This lane does not fabricate stats, change host authority, or implement the receipt migration.

## Verification

- `npm run typecheck`: passed.
- Full mobile Vitest: **503 passed, 4 existing skips**, 59 files, 1.54 s. Skips: existing signup case and three opt-in host integration cases.
- Targeted coverage: snapshot/roster request shapes, host names, unseen/missing/foreign flags, offline zero calls, unsupported live issuance zero calls; cooldown refusal validation, relative clock expiry, cross-account/fixture isolation, timer cleanup and same-millisecond publication.
- An initial typecheck caught the new hook test in an accidentally nested directory; moved to the intended test directory and reran successfully. No runtime test failures.
- No native visual run, emulator, live account, deployment, or Firebase project write. Native layout and receipt-capable live citizen play remain unverified/held respectively.
