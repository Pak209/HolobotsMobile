# W68 tournament unlock notifications

`desktopAccountSnapshot` adds `tournamentUnlocks` to all desktop-account-1/2/3 replies. Existing fields and schema version negotiation remain unchanged. This is an additive Contract-Change, not a new tournament admission or payment API.

```json
{"tournamentUnlocks":[{"tournamentId":"starter","requiredLevel":2,"holobotId":"ace","level":2}]}
```

Rows use the existing `tournamentAdmission` gate: Starter level 2 with 0 prior wins, Champion level 11 with 1 prior win, Rare level 21 with 2 prior wins. Numeric pilotRank does not replace Holobot level. At most one tournament is currently eligible because the prior-win rule is sequential. Each tournament notifies once per account, not once per bot or level. The lexicographically first uniquely owned roster Holobot meeting the gate identifies the row. Unknown/duplicate bot identities and invalid levels cannot generate an unlock. Temporary health, payment and activity conditions remain admission checks, not notification gates.

On snapshot/ack, the transaction derives and persists `users/{uid}.tournamentUnlocks` and lazily initializes `tournamentUnlockAcknowledged: []`. The reply recomputes from host-read account data; it never trusts a stored/client-supplied queue. Unchanged snapshots do not rewrite these fields. Existing eligible accounts receive their current next tournament on the first snapshot (backfill); completed tournaments are not surfaced. Pending rows refresh to current bot/level and disappear if no longer eligible or already won. This is not an event archive or a background trigger.

## Acknowledge through desktopAccountSnapshot

```json
{"schemaVersion":"desktop-account-3","operation":"ackTournamentUnlock","tournamentId":"starter"}
```

The authenticated account is the only target. Returns the full selected desktop-account reply with remaining `tournamentUnlocks`. Only the named tournament is acknowledged. Repeated acknowledgements are idempotent; increased levels or a changed representative bot never resurrect the same tournament. A stale notification for a tournament already won can be acknowledged without clearing the newly eligible tournament. Ack does not grant admission, mark a win, change HP, pay rewards or rebuild story gates.

Missing operation (existing callers) or `operation:"snapshot"` reads normally. Ack allows only `schemaVersion`, `operation`, `tournamentId`. Unknown operations/IDs, missing ack ID and extra ack fields refuse `invalid-argument` with `details.rejectionCode:"invalid_request"`. An unacknowledged tournament not eligible and not previously won refuses `failed-precondition` / `not_eligible`. Already acknowledged IDs succeed even after eligibility changes. Corrupt acknowledgement state refuses `unavailable`; authentication/profile/schema errors retain existing behavior.

Both `tournamentUnlocks` and `tournamentUnlockAcknowledged` are forbidden on client account creation and protected against add/change/delete on updates. Unchanged protected values remain permitted in otherwise valid writes. The pre-existing owner-writable Holobot progression trust boundary is unchanged: notification rows are derived by the host, but this PR does not harden all historical progression fields.

No deployed behavior changes until separately reviewed/deployed. No client UI, Unity/editor work, admission thresholds, economics or production account use is included.
