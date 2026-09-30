# Persistent travel squad selection

Authenticated Firebase callable: `travelSquadHost`. No deploy or push performed. Existing storage is `users/{authenticated uid}.travelSquad`; no client-supplied UID is used.

## Exact wire

Refresh request:
```json
{"operation":"refresh"}
```
Selection request:
```json
{"operation":"setSlot","intent":{"schemaVersion":"travel-squad-1","requestId":"unique-request-id","expectedRevision":1,"slotIndex":1,"holobotId":"hare"}}
```
Reply (example shape, not test evidence):
```json
{"schemaVersion":"travel-squad-1","requestId":"unique-request-id","travelSquad":{"schemaVersion":"travel-squad-1","revision":2,"holobotIds":["ace","hare","shadow"]}}
```
Refresh replies use empty requestId. A setSlot reply echoes the requestId. Squad IDs must be canonical `^[a-z][a-z0-9_]{0,127}$`; request IDs match `^[a-zA-Z0-9_-]{1,128}$`. Revisions are integers zero through 2147483647. Slots are zero-based 0..2.

## Rules

- Replace an existing slot, or append at exactly the current squad length. Never create holes.
- Bot must already be owned in the persisted profile. Never grants a bot or changes currency/blueprints.
- A bot assigned elsewhere is rejected as not_allowed; no implicit reorder. Choosing the bot already in that slot is a successful no-op with a receipt and unchanged revision.
- expectedRevision must match current revision. A successful changed squad increments once; overflow fails closed.
- Receipt key is `travelSquadCommands/{uid}/receipts/{requestId}`, outside client-writable user subcollections. Receipt and squad update are atomic. Same accepted request/body replay returns CURRENT squad without reapplying. A changed body with the same request ID is sequence_conflict.
- Stale requests have no accepted receipt. Refresh and submit a new intent/request ID after reviewing the latest squad; preserve request ID on transport retry of the same intent.
- Missing user, invalid persisted squad or unowned persisted member fails closed; data is never silently repaired or replaced.

Firebase failures expose `details.rejectionCode`: invalid_request (invalid-argument), not_allowed/stale_revision (failed-precondition), sequence_conflict (already-exists), unavailable (unavailable). Missing authentication uses unauthenticated.

## Verified

- TypeScript/shared parity build passes.
- Seven local Firestore emulator tests pass: persistent replacement and refresh, eight parallel identical retries, two competing revisions, old replay after a newer selection, no-op/duplicate assignment, contiguous append and invalid inputs, malformed storage/missing user/int32 overflow.
- Three rules tests pass, including the new direct squad-receipt forgery rejection. No new rule exception is needed: root travelSquadCommands is denied by the existing default rule.

Command: `rules-tests/node_modules/.bin/firebase emulators:exec --project demo-holobots-squad-tests --only firestore 'node --test functions/scripts/test-travel-squad-emulator.mjs && cd rules-tests && ./node_modules/.bin/vitest run tests/travel-squad.test.ts'`.

Callable auth, deployment, mobile/native embedding and Unity UI acceptance are not claimed by these direct store tests. The legacy ownership array remains client-writable under its existing attribute-spend rules; this endpoint does not expand that permission.
