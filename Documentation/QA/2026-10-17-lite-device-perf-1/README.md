# Lite simulator follow-up, 2026-10-17

The simulator remains limited by native software OpenGL rendering. No runtime optimization was accepted or applied: geometry, textures, clips, two visible actors and native GL completion barriers are unchanged. The 50 FPS gate and physical-iPhone acceptance remain HELD. Physical-device use requires Pak's approval; no device or account was accessed.

## Reproduction and provenance

Existing isolated `fun.holobots.mobile.w64` Debug simulator app, build 37; iPhone 17 Pro / iOS 26.5 on macOS 26.5.1. Offline `HostDuel` fixture: ACE/WOLF, eight rounds, sixteen receipt actions, no rewards or account provider. Current lite source `d5cc1dd` was copied to disposable `/private/tmp/lite-device-perf-run/`; the W65 accepted BotStage instrumentation and its offline deep-link harness were reused. This documentation PR is based on main; no lite code is copied into main. The original W64 worktree's five dirty native/QA files were not edited.

No native rebuild was needed. ETTrace is not installed/cached; no dependency was downloaded. The bounded native `sample` trace identifies symbolicated Expo and GL paths but contains unsymbolicated generated software-renderer frames, so it does not support fine-grained shader attribution. The sampled run is excluded from completed-frame FPS evidence.

Known-bad first: W65's accepted baseline was 6.05 FPS at 4 draws; guard culling produced 6.70 FPS at 2 draws, with a 402 × 874 backing buffer. Today's buffer is 402 × 832, so today's numbers are **not a before/after improvement claim**. No code change means there is no new after-condition. Removing completion barriers would measure queued submission rather than completed rendering; it was not attempted.

## Clean completed-frame measurement

24 two-second telemetry samples / 384 completed frames: median **7.65 FPS**, range **6.8–9.1 FPS**. Weighted frame preparation **0.343 ms**, JS render submission **0.622 ms**, native completion **123.662 ms**. Normal draw calls **2** throughout this sampled window; triangles **56,250**. Warm GL setup through first draw **1,550 ms** (not cold app launch). Video duration **59.88 s**; the result card is visible by the 58 s cell. Raw rows and summary are retained.

## Native profile

Five-second sample: GL queue 2,969 samples; `glDrawElements_IMM_ES2Exec` 2,928 (98.62% of that queue), `gldRenderFillTriangles` 2,418 (81.44%). Denominators are GL-queue samples, not whole-process CPU. App CPU snapshot 99.9%; physical footprint 326.7 MiB, peak 335.9 MiB. Renderer explicitly reports `Apple Software Renderer`. Frame prep and JS submission are under 1 ms in normal samples; the dominant completion barrier contains renderer work and synchronization, not a physical GPU timing claim.

Original assets: ACE 26,500 tris / 29 bones / 8 clips, WOLF 29,750 tris / 26 bones / 7 clips; total 56,250 tris, 1,787,952 asset bytes, two 1024² colour textures. GPU-style shader skinning was already used; software rendering on this simulator does not become hardware GPU rendering by another JS flag. Both actors are visible. The prior 15k-triangle ACE candidate failed fidelity; no further simplification, texture reduction or clip removal was attempted.

## Attempts and evidence

Metro attempt 1 failed because the dependency symlink made Expo's relative App entry resolve outside the scratch root. Attempt 2 used an explicit scratch index and bundled 1,594 modules successfully. Capture attempt 1 could not write directly through the simulator service to the vault; attempt 2 wrote to `/private/tmp` and copied the completed video. No third attempts.

Vault: `/Users/pak/HolobotsVault/QA/2026-10-17-lite-device-perf-1/`.

- `offline-eight-rounds.mp4`: bounded 60-second clean run, context 3, no native sampling during capture.
- `metrics.jsonl`, `summary.json`, `metro.log`: clean context 3 telemetry and source log; context 1 was sampled, context 2 was the failed direct-vault capture, both excluded.
- `native.sample.txt`: separate exploratory native trace.
- `CONTACT_SHEET.png`: four cells left-to-right, capture 5 s, 20 s, 40 s, 58 s. Source images `frame-5.png`, `frame-20.png`, `frame-40.png`, `frame-58.png`; cell 1 = round 1 / ACE strike / 21 damage; cell 2 = round 3 / WOLF heavy / 24 damage; cell 3 = round 7 / ACE strike / 26 damage; cell 4 = round 8 / recorded VICTORY / WOLF 0 HP. All four visibly retain OFFLINE FIXTURE; duel cells retain NO REWARDS. Reviewed all four cells before handoff. No image is committed.

Next useful gate is the same offline receipt on an approved physical iPhone. Safe JS work cannot plausibly bridge an approximately 100+ ms software-renderer wait to the 20 ms budget. This report does not claim a device FPS result or approve TestFlight.
