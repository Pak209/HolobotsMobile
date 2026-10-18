# Local story flag / pilot rank admin tool

Main-based local script: functions/scripts/admin/story-flags.mjs. No deployed callable or runtime change, no service account key file, no dependency addition. Agent validation uses demo throwaway users only; Pak's real account was never read or written.

## Pak's explicit local command

Use your own authorized Google user with Firestore access. Firebase CLI login alone does NOT supply Firebase Admin application-default credentials. Run this yourself on your local machine; agents did not run login or a real-project command:

```sh
gcloud auth application-default login
node functions/scripts/admin/story-flags.mjs \
  --project holobots-24046 \
  --uid 'PASTE_EXACT_TARGET_UID' \
  --confirm 'PASTE_EXACT_TARGET_UID' \
  --arena-arc-built true \
  --holo-zones-arc-built true \
  --pilot-rank 3
```

Replace both UID placeholders with the same exact UID. Rank3 is an example, not a progression/tuning recommendation. Select only fields you intend to change. Accepted setters: --arena-arc-built true|false, --holo-zones-arc-built true|false, --pilot-rank NONNEGATIVE_SAFE_INTEGER. At least one is required; other omitted setters are untouched, with the Arena-enable expansion described below. --project is mandatory and never inferred from gcloud defaults. Flags and ranks reject malformed values, unknown/duplicate options, and missing confirmation. No positional or bulk selector exists.

Pak approved the paired local QA write on 2026-10-17. `--arena-arc-built true` atomically sets all three fields in the **same write** (one `documents:commit`, see the 2026-10-18 transport fix below):

```json
{"storyFlags.tournamentsWon":3,"storyFlags.arenaArcBuilt":true,"storyFlags.arenaGatheringSeen":true}
```

This works on a fresh existing account and intentionally marks Arena completion for QA. The command prints the committed before/after values and all changed paths. Repeating it is safe and leaves those values unchanged. Other story flags, account fields and other UIDs are preserved; optional HoloZones/pilot-rank setters above are still explicit choices. No deployed code changes or account action by an agent.

`--arena-arc-built false` has no paired win-count rollback: it still refuses on a completed three-win account. Direct tournamentsWon/arenaGatheringSeen setters are not exposed. Disabling progression was not authorized; the host invariant remains enforced.

Credentials are read only at execution from the normal local gcloud ADC location (~/.config/gcloud/application_default_credentials.json, or CLOUDSDK_CONFIG). Only type authorized_user with a refresh token is accepted in memory. Service accounts, external credentials and impersonation are rejected. GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_GHA_CREDS_PATH, metadata overrides, service-account impersonation variables and FIREBASE_TOKEN must be unset; the tool never falls back to metadata/key files. It prints no credentials. Login is a user action; script delivery itself is complete without account access.

## Safety and output

A masked read of users/<uid> (storyFlags + pilotRank only) refuses an absent document (404), validates existing field shapes and the resulting Arena invariant, and updates only selected dotted flag paths / pilotRank plus the three approved Arena-completion fields when enabling Arena. No upsert/query/batch, currency, inventory or other-account writes. Before/after output contains the target storyFlags and pilotRank only, plus UID/project and changed paths; it never prints the full profile. The single write carries a `currentDocument.updateTime` precondition equal to the read's updateTime, so a concurrent host write (or a delete) between read and write makes it refuse with nothing written; the reported after state is a masked re-read of the document.

## Verification

Known-bad first: missing --confirm, service-account credentials and malformed options reject before any database operation. Unit suite covers those controls, selected false/zero, emulator isolation, invariant refusal and private-profile output exclusion. Demo emulator tests cover exact field preservation, unrelated UID unchanged, unknown UID no-upsert and rejected mutation atomicity. No credentials were read in tests; credential examples are synthetic strings.

Commands: npm --prefix functions run test:story-flag-admin; tsc --noEmit. Emulator uses cached Firestore v1.19.8 directly on127.0.0.1:8193, project demo-story-admin-paired for the approved update, 300-second cap, owned process stopped in finally. No Firebase CLI download/build/deploy.

Final measurements and sheet: /Users/pak/HolobotsVault/QA/2026-10-17-story-flag-admin-1/. Known-bad first, every cell inventoried, ≤1600px. Root/chair owns shared inbox and checkout cleanup.

## User-credential transport review

Firebase Admin's explicit refreshToken credential is not accepted by its Firestore adapter. Final script therefore uses the already-installed Google Cloud Firestore client with an explicitly constructed GoogleAuth wrapping the verified UserRefreshClient. It does not call applicationDefault or rediscover credentials after validation. Offline construction regression uses synthetic user credentials, checks the transport retains that exact auth client, and does not request a token/network access. The demo emulator uses the same Firestore factory.

The new offline credential regression initially failed at a test-only top-level v1 import; the installed library exports that transport at build/src/v1/index.js. Corrected once: final 7/7 unit tests pass. Earlier emulator 2/2 used the superseded Admin transport and is retained but not final transport acceptance. Final direct-transport emulator: 2/2 pass, 3.876 seconds total (3.194 seconds test runner); final unit7/7, noEmit and node --check green. No production login or credential file was inspected by the agent.

## Approved paired-write validation

Final update: **8/8 unit tests, 3/3 emulator tests**, 3.879 seconds total (3.213 seconds runner), zero failed attempts for this approved correction; node syntax checks green. Unit tests cover exact three-field expansion, optional rank/other setters, false/omitted flag behavior and retained credential/confirmation guards. Emulator tests cover a fresh account's false/0/false → true/3/true in one transaction, before/after, changed paths, unrelated-field and second-UID preservation, identical replay, refused disable without win rollback, malformed requests and direct win-count setter refusal. No real account or credential file was accessed. Owned emulator stopped in finally.

Current evidence: `/Users/pak/HolobotsVault/QA/2026-10-17-story-flag-admin-paired/GATE_SHEET.png` (1440×900, three inventoried cells: missing-confirmation/unsafe direct setter controls; approved atomic before/after; test results and limits). Historical initial refusal and transport evidence above remains historical, not the final supported Arena-enable behavior. The earlier fresh-account Arena hold is superseded by Pak's paired-write approval; every unrelated hold stays.

## 2026-10-18 transport fix: Firestore REST (story-flag-admin-rest-fix)

Pak's first real run (owner account, `authorized_user` ADC) failed `7 PERMISSION_DENIED: Missing or insufficient permissions.` on a plain read through both the gRPC and `preferRest` transports, while `curl` with the same ADC token returned 200.

**Cause (reproduced offline, no network):** the script resolves `google-auth-library` **10.6.2** (hoisted), but `@google-cloud/firestore` 7.11.6 runs on `google-gax` 4.6.1, which bundles **9.15.1**. In v10 `UserRefreshClient.getRequestHeaders()` returns a WHATWG `Headers` object. grpc-js 1.14.3 copies call credentials with `Object.keys(headers)`, and gax's REST fallback with `{...authHeader}`. Both produce `{}` for a `Headers` instance, so **no `Authorization` header was ever sent**. The request reached Firestore unauthenticated, was evaluated by security rules as `request.auth == null`, and got the rules denial message. Measured: a v10 client gives gRPC `authorization=[]`, and a TLS capture server sees `authorization: null` on the REST `batchGet`. The v9 client used as a control gives `Bearer <token>` on both. The old offline test only checked construction, never the wire.

**Fix:** plain Firestore REST v1 over `fetch`. The bearer token comes from `UserRefreshClient.getAccessToken()` on the validated ADC. The tool does a masked GET, then a single `documents:commit` with `updateMask` and a `currentDocument.updateTime` precondition, then a masked GET. A 404 refuses with "Unknown UID; refusing upsert". FAILED_PRECONDITION refuses with "concurrent write", nothing written. Every guard is unchanged: the user-ADC-only check, the env refusals, `--uid`/`--confirm`/`--project`, the field allowlist and the Arena invariant. The emulator path is `http://127.0.0.1:<port>/v1/...` with `Bearer owner`. The write goes through `documents:commit` and not `PATCH ?currentDocument.updateTime=` because the Firestore emulator (v1.19.8) parses that query parameter as version 0 and refuses every PATCH. In the commit JSON body the same precondition works and refuses correctly. Both behaviours were measured.

**Verification:** 18/18 unit tests (`npm --prefix functions run test:story-flag-admin`), with a fake `fetch` covering: the bearer header on every request, the exact commit body/mask/precondition, before/after limited to storyFlags/pilotRank, 404 with no upsert, concurrent write refused, delete-between refused, allowlist and malformed refusals, project mismatch, no token in error text. Emulator: 5/5 (`npm --prefix functions run test:story-flag-admin:emulator`), which adds a concurrent host write and a delete between read and commit. Mutation checks: dropping the precondition fails 3 unit and 2 emulator tests, and dropping the Authorization header fails 2 unit tests.
