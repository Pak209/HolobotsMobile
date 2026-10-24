# Readiness R1 — off-editor handoff and Unity dashboard steps

R1 adds `users/{uid}.syncReadiness` as a protected top-level map, separate from the owner-writable `holobots` array. Entries are `{ [BOT_NAME]: { milli: 0..100000, atMs: epochMilliseconds } }`. Only a newly counted, identified phone or Watch workout for an exactly matching owned bot may add readiness. A 300-second session adds 100,000 milli-points, shorter sessions add `floor(100000 * seconds / 300)`, and the value caps at 100,000. No tagged match, replay, cap, interim sync, missing activity ID or offline retry adds readiness. Existing EXP fallback behavior is unchanged. No shop or client profile write can add it.

Readiness is lazily projected with `floor(milli * 0.8 ^ (elapsedMs / 86400000))`; this is 20% of the remaining amount per day. A `readinessFadeFractionPerDay(battleIq)` hook exists but returns the R1 base rate until the separate hidden Battle IQ lane. Only display reads are added; R1 does **not** change starting SYNC, battles, expedition sends or purchases.

The host feature is **off by default**: `HOLOCITY_READINESS_ACCRUE=1` would enable accrual and additive reply fields on a future authorized deployment. The companion/lite UI is separately **off by default**: `EXPO_PUBLIC_HOLOCITY_READINESS=1` reveals the workout-result copy and lite workout-partner bar in a future build. Neither flag was flipped here. The phone reply gains optional `readiness: { holobotName, before, gained, after } | null`; the Watch reply adds the same optional property per workout result. The desktop account reply adds optional `syncReadiness: { [BOT_NAME]: { value, atMs, fadePerDay: 20 } }` only while the host flag is on. No schema files, Unity contracts or legacy reply shapes were edited.

## Producer: Unity dashboard installation (editor lane later)

1. After Pak merges and separately authorizes a host deploy/flag flip, mirror the optional `syncReadiness` account reply in the dashboard's read-only DTO. Keep it outside `holobots`; missing field means the readiness feature is hidden.
2. On the HOLOBOTS roster card and STATS detail page, add a 0–100 `SYNC READINESS` bar for the selected bot using the host's matching name key. Use `{ value, atMs, fadePerDay }` solely to animate the visible fade; the host computes the authoritative value again on any action.
3. At 0 show “Train in the companion app to fill readiness”; at 100 show “100 = Decisive” as future send guidance. Do not imply an R1 combat bonus: starting-SYNC and sends are R2/X3.
4. Keep the bar hidden when the optional field is absent or the feature flag is off. Do not save readiness into a scene, prefab or the writable `holobots` array; no new image asset is needed.
5. In a clean in-memory editor scene, witness 0, partial, 100 and one-day fade (100→80) with host-shaped mock replies, then validate narrow/phone dashboard layouts and zero console errors. The producer owns editor claims, scene/prefab work and native checks.

Validation in this PR: `functions npm run build` (including `check:shared`), host unit suite **581 passed / 1 existing skip**, mobile typecheck and full mobile suite **1,564 passed / 4 existing skips**, focused Firestore emulator deny/allow tests **2 passed**, and full rules suite **120 passed**. No editor, scene, HoloBall, fight code, deploy, credits or real account use.
