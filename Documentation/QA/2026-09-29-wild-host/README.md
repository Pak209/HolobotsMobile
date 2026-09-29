# Wild encounter server seam

Authenticated callable `wildEncounterHost` implements the existing acquisition-0 and capture-world-1 presentation records. Nothing was deployed, provisioned or pushed. Default remains unavailable.

## Transport

Request: `{operation:"refresh"}`; `{operation:"worldState",encounterId}`; `{operation:"offerToy",intent:{schemaVersion:"capture-world-1",requestId,encounterId,itemId}}`; `{operation:"capture",intent:{schemaVersion:"acquisition-0",requestId,encounterId,toyId,observedHealth01}}`.

Reply always contains `encounters`, `worldStates`, `withdrawnEncounterIds`, `roster`; capture replies also contain `captureResult`. Exact types: `functions/src/acquisition/wildEncounterDomain.ts`. JSON unknown fields are discarded before hashing. Health observation is validated but never used in deciding capture.

Rejections use Firebase callable errors with `details.rejectionCode`: invalid_request, not_allowed, unavailable, sequence_conflict. Authentication failure uses unauthenticated.

## Server ownership

Admin must explicitly provision `wildEncounterSessions/{uid}` with the Session shape, enabled true, and an approved `returnRefusedUnit:true` policy. No client writes or seed endpoint. Stable encounter IDs, allowed items, item counts, affinity increments and chance table come solely from that document. This root collection and receipt descendants are denied by the existing catch-all Firestore rules. User UID comes exclusively from Firebase authentication.

Toy/capture commands are one Firestore transaction covering state and immutable `receipts/{requestId}`. Canonical body digest conflicts reject; same body preserves the persisted ruling inside a current-state response. Server random draw is fixed across transaction retries. No client-controlled health/chance can grant ownership. Receipt replay carries current session snapshots and revision with the original immutable capture result, without re-spending. Toy replays correlate the current world state using the original request ID and toy_accepted reaction. Ended encounters remain withdrawn. Adapters should still reject genuinely out-of-order snapshots and process the intent result before current world state.

A refusal returns the Unit only when the server provisioner explicitly ratifies that policy; there is no implicit free stock. Duplicate conversion is unavailable until its policy is approved. Captures currently update the server session's acquisition roster only. Synchronization with the existing legacy mobile holobots ownership and squad store is NOT implemented: do not enable production capture until that migration is integrated. No paid economy, currency or blueprint grant is invented.

Server withdrawals set the provisioned encounter's ended flag; refresh emits tombstone IDs. Superseding spawns need new stable IDs. No spawn cadence or placement policy is fabricated here.

## Verification

`npm --prefix functions run build`: TypeScript and shared parity pass.
`node --test functions/scripts/test-wild-encounter.mjs`: seven tests pass (disabled policy, stable identity, toy/exhaustion, refusal/retry/capture/withdraw, health non-authority/duplicate fail-closed, invalid request/server data, receipt replay/conflict).

Not run at initial checkpoint: authenticated callable deployment, physical bridge, native Unity Play. Firestore concurrency was subsequently verified below.

## Follow-up: concurrency and legacy seam

Reply now also carries `revision` from session.revision. It changes on both Toy and capture commands; consumers ignore entire replies older than their latest revision, Receipts now rebuild the current envelope while preserving the original outcome. Roster revision alone cannot detect an old affinity snapshot.

Cached Firestore emulator proof passed 4/4: twelve simultaneous replays spend one Toy; two distinct requests cannot spend the last Toy twice; eight simultaneous successful capture replays grant one session entitlement; changed-body replay conflicts; an unprovisioned UID cannot select another user's session with a payload field. Command: `rules-tests/node_modules/.bin/firebase emulators:exec --project demo-holobots-wild-tests --only firestore 'node --test functions/scripts/test-wild-encounter-emulator.mjs'`. No downloads, production connection or deploy. Callable authentication itself is not exercised by these direct store tests.

Legacy integration finding: existing server mint path (`functions/src/progression/mintHolobot.ts`) updates the root user document's holobots array in a transaction. Genesis grant record has seven fields: name, level, experience, nextLevelExp, rank, attributePoints, boostedAttributes (`functions/src/lib/referrals.ts:49`). Those default values belong to Genesis, not a ratified capture policy. No SquadSwap, SetSquadActive or team-slot storage contract exists in mobile/src. Therefore the safe next contract must specify captured bot progression records, root-user ownership projection and the destination squad storage/authority before enabling this endpoint in production. Reading the client-writable legacy holobots array can reject duplicates but is not a new trusted entitlement source. Duplicate conversion and team mutation stay unavailable.

An attempted implementation of the legacy ownership projection was rejected by automatic approval review before execution: persistent users/{uid}.holobots mutations with an unverified legacy schema were outside the verified authorization. No account-write code was installed or retried. Producer/Pak must approve that exact integration after the schema/policy is reviewed. The isolated-session concurrency proof above completes unaffected work; it does not prove the rejected account projection.

Replay regression follow-up: cached Firestore emulator now passes 6/6, including refusal replay after newer Toy affinity, Toy replay after a newer refusal, and Toy replay after capture (no encounter revival). Domain tests remain 7/7; TypeScript/shared parity pass.
