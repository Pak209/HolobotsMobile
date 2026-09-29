# Wild encounter server seam

Authenticated callable `wildEncounterHost` implements the existing acquisition-0 and capture-world-1 presentation records. Nothing was deployed, provisioned or pushed. Default remains unavailable.

## Transport

Request: `{operation:"refresh"}`; `{operation:"worldState",encounterId}`; `{operation:"offerToy",intent:{schemaVersion:"capture-world-1",requestId,encounterId,itemId}}`; `{operation:"capture",intent:{schemaVersion:"acquisition-0",requestId,encounterId,toyId,observedHealth01}}`.

Reply always contains `encounters`, `worldStates`, `withdrawnEncounterIds`, `roster`; capture replies also contain `captureResult`. Exact types: `functions/src/acquisition/wildEncounterDomain.ts`. JSON unknown fields are discarded before hashing. Health observation is validated but never used in deciding capture.

Rejections use Firebase callable errors with `details.rejectionCode`: invalid_request, not_allowed, unavailable, sequence_conflict. Authentication failure uses unauthenticated.

## Server ownership

Admin must explicitly provision `wildEncounterSessions/{uid}` with the Session shape, enabled true, and an approved `returnRefusedUnit:true` policy. No client writes or seed endpoint. Stable encounter IDs, allowed items, item counts, affinity increments and chance table come solely from that document. This root collection and receipt descendants are denied by the existing catch-all Firestore rules. User UID comes exclusively from Firebase authentication.

Toy/capture commands are one Firestore transaction covering state and immutable `receipts/{requestId}`. Canonical body digest conflicts reject; same body returns the persisted response. Server random draw is fixed across transaction retries. No client-controlled health/chance can grant ownership. Receipt replay returns the original snapshot: adapters must reject older snapshot revisions rather than roll back newer state.

A refusal returns the Unit only when the server provisioner explicitly ratifies that policy; there is no implicit free stock. Duplicate conversion is unavailable until its policy is approved. Captures currently update the server session's acquisition roster only. Synchronization with the existing legacy mobile holobots ownership and squad store is NOT implemented: do not enable production capture until that migration is integrated. No paid economy, currency or blueprint grant is invented.

Server withdrawals set the provisioned encounter's ended flag; refresh emits tombstone IDs. Superseding spawns need new stable IDs. No spawn cadence or placement policy is fabricated here.

## Verification

`npm --prefix functions run build`: TypeScript and shared parity pass.
`node --test functions/scripts/test-wild-encounter.mjs`: seven tests pass (disabled policy, stable identity, toy/exhaustion, refusal/retry/capture/withdraw, health non-authority/duplicate fail-closed, invalid request/server data, receipt replay/conflict).

Not run: authenticated callable deployment, Firestore emulator transaction/concurrency tests, physical bridge, native Unity Play. Receipt unit tests cover replay decisions; they do not constitute Firestore concurrency proof.
