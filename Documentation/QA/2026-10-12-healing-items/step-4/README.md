# Step 4 — healing reward grants
Known-bad.log first: baseline boss defeat and rank upgrade award no Kit. Candidate emulator.log: 14/14 including new boss once-only/replay/concurrent, no boss/instant-boss, mobile blueprint upgrade/Rank Skip plus existing zone/rival progression regressions. build.log: shared mirrors and TypeScript pass.

One Kit per eligible boss defeat; existing minimum 20 seconds prevents immediate reward farming. One Kit per crossed Holobot rank tier (levels 1/11/21/31/41), through blueprint upgrades, Rank Skips, server battle XP, training and quest claims; mint/new ownership is excluded. No Full grants. City 40% issue unchanged. No deploy or production calls.

Depends on step 1's stock helper (PR #71). Branches target main; merge step 1 before this PR so its dependency commit drops out of the diff. Existing client-observed boss outcome trust boundary remains; this is not combat replay validation. Grant and settlement/rank writes share one transaction; retries do not duplicate.

Final route review: added fitness-sync, Watch workout XP and owned Legendary ascension hooks to the same rank-crossing helper. routes-known-bad.log reproduces no Kit on owned Legendary ascension. routes-emulator.log 4/4 (original grant controls + owned ascend 1 -> 41 grants four Kits, new mint none); routes-build.log shared/TypeScript pass. Fitness/Watch hook call sites compiled and source-reviewed; no real workout/account used.
