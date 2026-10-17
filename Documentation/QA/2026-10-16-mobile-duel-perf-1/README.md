# W65 mobile duel performance

The accepted change hides fully transparent, depth-write-disabled guard rims after their original first draw. It preserves shader warmup and the existing 700 ms defend fade. Normal rendering submits two draws instead of four; a visible guard adds one. No bot asset, texture, clip or host behavior changes.

## Same-rig measurement

iPhone 17 Pro simulator, iOS 26.5, Debug native app, Apple Software Renderer, 402 × 874 GL backing buffer, balanced Lambert materials, one-third backing scale. Original ACE + WOLF assets (1,787,952 bytes) and the same offline eight-round/16-action receipt; NO REWARDS, no account. Native GL completion barriers remain enabled. Both runs recorded video while sampling. Video frame rate is not the reported runtime FPS.

| Measurement | Clean baseline | Accepted guard fix |
|---|---:|---:|
| Playback samples | 24 | 24 |
| Median completed-frame FPS | 6.05 | 6.70 |
| Sample FPS range | 5.4–6.9 | 5.7–7.8 |
| Sample elapsed window, ms | 2123–49982 | 2102–49856 |
| Normal draw calls | 4 | 2 |
| Visible-guard draw calls | 4 | 3 |
| Bot triangles | 56,250 | 56,250 |
| Animation + frame preparation, weighted ms/frame | 0.366 | 0.381 |
| JS render submission, weighted ms/frame | 0.804 | 0.678 |
| Native GL completion, weighted ms/frame | 154.080 | 139.581 |
| GL setup through first completed draw, ms | 3269 | 3060 |

Median FPS increased 10.7% in this sequential simulator comparison. Noise and software rendering limit attribution; the draw-call reduction is directly verified. This is not a device performance claim or a cold-app-launch measurement. Native GL completion includes synchronization and is not a pure GPU measurement. The 50 FPS target remains HELD.

## Profile and fidelity stop

GPU skinning is already enabled by Three SkinnedMesh and bone-texture shaders; there is no per-frame CPU vertex deformation loop to replace. Here the simulator's Apple Software Renderer executes the GL work. A five-second native sample shows draw submission/completion stacks, consistent with the measured GL wait; it does not isolate physical GPU utilization.

ACE: 26,500 triangles, 23,354 vertices, 29 bones, 8 clips/720 tracks. WOLF: 29,750 triangles, 18,644 vertices, 26 bones, 7 clips/567 tracks. Two 1024 × 1024 colour textures total 8 MiB base RGBA. Existing inactive/background gating already skips mixer and renderer; both duel actors are visible, so offscreen idle removal is not applicable. Clips and textures were retained.

A conservative ACE simplification produced 24,606 triangles, above the requested approximately 15k. The second candidate reached 14,999 triangles, retained 29 bones and all eight clips/720 tracks, and passed GLB validation with zero errors. Native geometry counts verified the candidate really loaded. A fixed-pose comparison revealed flattened gauntlet contours and changed panel shading. **LOD rejected; original ACE restored; further optimization stopped at this first fidelity cost.** No LOD asset is included.

The first guard visual attempt hid the initial warmup draw and did not show the defend pulse convincingly. The single bounded retry retains first-draw prewarming; its video clearly shows the cyan guard pulse and is the accepted measurement above. An earlier baseline lost telemetry after Metro stopped during low disk space; it is excluded. Only this lane's disposable DerivedData was removed before the successful clean baseline.

## Evidence (outside git)

Vault root: `/Users/pak/HolobotsVault/QA/2026-10-16-mobile-duel-perf-1/`.

- `before-clean.mp4`, `before-clean-metrics.jsonl`, `before-clean-metro.log`: accepted baseline, complete playback.
- `after-guard-retry.mp4`, `after-guard-retry-metrics.jsonl`, `after-guard-retry-metro.log`: accepted change, complete playback.
- `GUARD_FIDELITY_VERIFIED.png`: four cells, top-left baseline normal (`before-50.png`), top-right accepted normal (`retry-50.png`), bottom-left baseline visible guard (`before-104.png`), bottom-right accepted visible guard (`retry-100.png`). Frame suffixes are tenths of a second in their respective videos.
- `LOD_FIDELITY_GATE.png`: original fixed-pose ACE (`ace-original-verified.png`, native count 26,500) beside rejected candidate (`ace-lod-idle.png`, native count 14,999). No animated fidelity acceptance inferred from this still.
- `w65-before.sample.txt`: exploratory native CPU sample, excluded from matched FPS comparison.
- `BotStage-final-profiling.tsx.txt`: temporary instrumentation used for accepted capture, not shipped. Frame preparation includes animation, camera and framebuffer binding; render submission and GL completion measured separately.
- `after-guard*` without `retry`: rejected first visual attempt, excluded from the committed comparison JSON. `before.*` without `clean`: interrupted baseline, excluded.

## Verification

TypeScript typecheck and focused guard/playback tests: 18 passed (two new guard tests plus 16 existing receipt tests). Native accepted capture verifies the defend pulse remains visible, normal draw culling, original geometry and completed result flow. No Unity editor, deploy, account access, texture changes or visual-quality reduction. Simulator harness identity/metrics instrumentation stays outside the commit.
