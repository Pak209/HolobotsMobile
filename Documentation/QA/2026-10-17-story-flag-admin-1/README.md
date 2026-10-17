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
  --holo-zones-arc-built true \
  --pilot-rank 3
```

Replace both UID placeholders with the same exact UID. Rank3 is an example, not a progression/tuning recommendation. Select only fields you intend to change. Accepted setters: --arena-arc-built true|false, --holo-zones-arc-built true|false, --pilot-rank NONNEGATIVE_SAFE_INTEGER. At least one is required; omissions are untouched. --project is mandatory and never inferred from gcloud defaults. Flags and ranks reject malformed values, unknown/duplicate options, and missing confirmation. No positional or bulk selector exists.

For an Arena flag change, add --arena-arc-built true or false only if consistent with the existing tournamentsWon. Host invariant is arenaArcBuilt === (tournamentsWon === 3). The tool refuses a conflicting request and DOES NOT silently change tournamentsWon. This preserves the record rather than creating a flag combination the host rejects. An arbitrary Arena override is outside this version's scope.

Credentials are read only at execution from the normal local gcloud ADC location (~/.config/gcloud/application_default_credentials.json, or CLOUDSDK_CONFIG). Only type authorized_user with a refresh token is accepted in memory. Service accounts, external credentials and impersonation are rejected. GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_GHA_CREDS_PATH, metadata overrides, service-account impersonation variables and FIREBASE_TOKEN must be unset; the tool never falls back to metadata/key files. It prints no credentials. Login is a user action; script delivery itself is complete without account access.

## Safety and output

One transaction reads users/<uid>, refuses an absent document, validates existing field shapes and the resulting Arena invariant, and updates only explicitly selected dotted flag paths / pilotRank. No upsert/query/batch and no currency, inventory, progression or other-account writes. Before/after output contains the target storyFlags and pilotRank only, plus UID/project and changed paths; it never prints the full profile. The reported after state is the committed transaction result, not a race-prone follow-up read.

## Verification

Known-bad first: missing --confirm, service-account credentials and malformed options reject before any database operation. Unit suite covers those controls, selected false/zero, emulator isolation, invariant refusal and private-profile output exclusion. Demo emulator tests cover exact field preservation, unrelated UID unchanged, unknown UID no-upsert and rejected mutation atomicity. No credentials were read in tests; credential examples are synthetic strings.

Commands: npm --prefix functions run test:story-flag-admin; tsc --noEmit. Emulator uses cached Firestore v1.19.8 directly on127.0.0.1:8193, project demo-story-admin, 300-second cap, owned process stopped in finally. No Firebase CLI download/build/deploy.

Final measurements and sheet: /Users/pak/HolobotsVault/QA/2026-10-17-story-flag-admin-1/. Known-bad first, every cell inventoried, ≤1600px. Root/chair owns shared inbox and checkout cleanup.

## User-credential transport review

Firebase Admin's explicit refreshToken credential is not accepted by its Firestore adapter. Final script therefore uses the already-installed Google Cloud Firestore client with an explicitly constructed GoogleAuth wrapping the verified UserRefreshClient. It does not call applicationDefault or rediscover credentials after validation. Offline construction regression uses synthetic user credentials, checks the transport retains that exact auth client, and does not request a token/network access. The demo emulator uses the same Firestore factory.

The new offline credential regression initially failed at a test-only top-level v1 import; the installed library exports that transport at build/src/v1/index.js. Corrected once: final 7/7 unit tests pass. Earlier emulator 2/2 used the superseded Admin transport and is retained but not final transport acceptance. Final direct-transport emulator: 2/2 pass, 3.876 seconds total (3.194 seconds test runner); final unit7/7, noEmit and node --check green. No production login or credential file was inspected by the agent.

Example deliberately refused on a fresh account (tournamentsWon0):

```sh
node functions/scripts/admin/story-flags.mjs --project holobots-24046 \
  --uid 'PASTE_EXACT_TARGET_UID' --confirm 'PASTE_EXACT_TARGET_UID' \
  --arena-arc-built true
```

It reports the tournamentsWon invariant and writes nothing. Fresh-account Arena override is HELD pending explicit paired-win authorization; other selected fields/rank remain usable. No hidden paired write is implemented.
