# Town presence — M1 host (2026-10-10)

Other signed-in pilots can be projected into HoloCity without sharing accounts or combat. This PR adds the host half; Unity is a staged package, not installed. No production deploy ran.

Contract: `presence-1`, matching the Unity M1 design (`Documentation/HANDOFFS/2026-10-10-m1-ghosts-in-town-design.md`). Caller UID comes only from authentication. The host reads the existing wardrobe-3 city loadout and travel-squad-1 records. Requests cannot supply names, clothes, levels, rank or economy. A server principal is refused, as required by SERVER_TOKEN.md. Every write is an aggregate-doc transaction, retaining parallel pilots, pruning expired rows, and removing opt-outs and deleted accounts. Deletion now removes the public row after profile deletion, so a racing heartbeat cannot resurrect a deleted identity.

| Gate | Result | Known-bad control |
|---|---|---|
| TypeScript and shared parity | 0 errors; 3 parity files unchanged | Test-only invalid TypeScript is rejected by the same compiler (verify.sh) |
| Pure projection | 4 tests pass | Forged name, level and wardrobe do not appear; bad scene/deployment/non-finite values refused |
| Local Firestore transaction | 3 tests pass | No-auth/server principals refused; invalid deployment writes nothing; expired emote cannot revive a pilot |
| Firestore rules | 2 tests pass | All forged creates/updates/deletes and anonymous reads refused; foreign/malformed opt-out denied |

Existing pure function regression: **124/124 pass**.

Run `bash scripts/verify-town-presence.sh`; dependencies must already be installed (no download). Emulator tests use demo-only project, isolated port, cached emulator and no Pak account. Local emulator never deploys.

Bounds are a conservative town presentation envelope, X/Z ±256 m, Y −64..256 m; 0.5 m rounded positions, 90 s expiry, 3 s wave. Chair must verify the current scene fits this envelope before installation. These are presentation coordinates, not collision validation. One Firestore document is deliberate for M1; write-contention/cost at larger crowds still needs deployment telemetry. Mobile is not a presence source.

Deploy only after Pak merges/approves: `presenceHost`, `deleteUserAccountV2`, rules. A real two-pilot Play witness is deferred to the editor lane against a local emulator; this host suite does not prove visual replicas or production presence.
