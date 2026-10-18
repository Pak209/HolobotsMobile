# lite-duel-perf-2: 3D duel cost table, knob sweep, device-run script

The 50 fps gate for the lite 3D duel is still **HELD**. This lane measured on the iPhone 17 Pro / iOS 26.5 simulator only. No physical device, account, host, build, install, deploy or network was used.

## Answer

**Most likely cause of ~120 ms native completion for 2 draws:** the simulator's CPU software rasterizer, multiplied by a 4-sample MSAA buffer.

- `BotStage` passes `msaaSamples={1}`. The live context reports `SAMPLES = 4`, `SAMPLE_BUFFERS = 1`.
- At 402×788 px that comes to 1.27 M samples per frame.
- Frame time follows the sample count. Arms with the same number of samples took the same time, whether the samples were cut with MSAA or with resolution: `msaa0` (402×788×1) 52.27 ms vs `halfRes` (201×394×4) 52.29 ms.
- A two-point fit gives about **29.7 ms that does not depend on samples, plus 71.1 ms per million samples**. On baseline that is ~90 of ~120 ms, or 75 %. The fit predicts the `combo` arm (79 k samples) at 35.4 ms; it measured 33.2 ms.
- The ~30 ms that does not depend on samples scales with triangles. Hiding WOLF (56,250 → 26,500 tris) cut it to 0.54×, against a triangle ratio of 0.47.

**Why this is the Apple Software Renderer and not a GL feature fallback** (read from files, not guessed):

- `expo-gl` 15.1.7 (Expo SDK 53.0.27) creates a plain `EAGLContext` with `kEAGLRenderingAPIOpenGLES3`, falling back to ES2 (`node_modules/expo-gl/ios/EXGLContext.mm:38`). The view is a `CAEAGLLayer` (`ios/GLView.swift:37`). There is no ANGLE or Metal path anywhere in `expo-gl/ios` or `expo-gl/common`. `getContextAttributes` is hard-coded (`common/EXWebGLMethods.cpp:53-61`), so nothing the app requests selects a renderer.
- The iOS 26.5 (23F77) simulator runtime's `OpenGLES.framework` contains exactly one renderer bundle, `GLRendererFloat.bundle`. Its strings include "Apple Software Renderer" and "APPLE-23.1.1". The probe read the same values from the live context: `RENDERER "Apple Software Renderer"`, `VERSION "OpenGL ES 3.0 APPLE-23.1.1"`.
- So every `EAGLContext` in this simulator is software-rendered. On a physical iPhone, Apple's OpenGL ES runs on the GPU instead. That GPU path is the open question the device run answers.
- How the 4 samples come about:
  - Expo always renders into a multisample framebuffer. It sizes it with `glRenderbufferStorageMultisample(msaaSamples)` (`GLView.swift:146-152, 165-171`) and resolves it with a blit every frame (`GLView.swift:238-277`).
  - GLES 3.0 treats `samples` as a minimum, and this renderer rounded 1 up to 4.
  - The device-perf-1 native sample shows the resolve as `glsDownsample2x2_BGRA8888`, a 2×2 supersample.

## Per-frame cost table (simulator, baseline arm)

| Cost | Per frame | Source |
|---|---|---|
| Draw calls | 2 (3 while a guard pulse is visible) | `renderer.info.render.calls`, every frame |
| Triangles | 56,250 (ACE 26,500 + WOLF 29,750) | `info.render.triangles`; scene inventory |
| Skinned vertices | 42,000 (23,354 + 18,644), 4 joints per vertex | inventory; GLB accessors |
| Bones / bone textures | ACE 29, WOLF 26; two 12×12 RGBA32F bone textures uploaded via `texSubImage2D` (2 per frame) | inventory; GL call counts |
| Materials / programs | 2 `MeshLambertMaterial`, both **double-sided** (as authored), opaque; 2 programs. Floor and grid hidden; guard rims hidden at opacity 0 | inventory |
| Lights | 3 (hemisphere + 2 directional), 0 shadow casters | inventory |
| Shadow pass | none: `shadowMap.enabled = false` | probe |
| Post pass | none (no composer). sRGB encode is in-shader. Expo resolves MSAA with one blit per frame | code; probe |
| Render target | 402×787–788 px (render scale 1/3 of the 3× screen) × 4 samples = 1.27 M samples | probe |
| Textures | 2 × 1024² JPEG base colour, `LinearFilter`, no mipmaps | inventory |
| Animation | 2 mixers, 1 running action each (90 / 81 tracks), 0.14 s crossfades; frame prep **0.28 ms** | inventory; `prepMs` |
| React re-renders | **0/s** with cues held; **8.2/s** with the cue runner on (about 1 per completed frame; 32 ms `setInterval` + `setElapsed`) | render counter |
| JS→GL bridge calls | **41** per frame (42.3 with the cue runner on). The only blocking call is `flushEXP`. Breakdown: 8 `pixelStorei`, 8 `texParameteri`, 4 `bindTexture`, 4 `activeTexture`, 4 `uniformMatrix4fv`, 2 `uniformMatrix3fv`, 2 `texSubImage2D`, 2 `bindVertexArray`, 2 `drawElements`, 1 each `bindFramebuffer` / `clear` / `finish` / `endFrameEXP` / `flushEXP` | GL call wrapper |
| JS submit (`renderer.render`) | **0.68 ms** | `renderMs` |
| Native completion (`finish` + `endFrameEXP` + `flushEXP`) | **~120 ms** | `barrierMs` |

## Per-knob fps (one run, 5 s of completed frames per arm)

Method:

- Same completed-frame counting as device-perf-1: a frame counts after the `gl.finish()` / `endFrameEXP()` / `flushEXP()` barrier.
- Each arm remounts the GL context, warms up for 1 s, then measures 5 s. The scene is held on round 1 with idle loops; `baselineLive` releases the cue runner.
- `fps` = completed frames ÷ 5.000 s. The spread is completed frames in each whole second.

| # | Arm | Knobs | fps | 1 s spread | Native completion ms | Buffer × samples | Δ vs 8.2 |
|---|---|---|---|---|---|---|---|
| 1 | baseline | production | **8.2** | 7–9 | 119.9 | 402×788×4 | 1.00× |
| 2 | shadowOff | null control (shadows already off) | 8.2 | 7–9 | 120.9 | 402×788×4 | 1.00× |
| 3 | postOff | null control (no post pass exists) | 8.4 | 8–9 | 118.9 | 402×788×4 | 1.02× |
| 4 | msaa0 | `msaaSamples` 1 → 0 | **18.6** | 18–20 | 52.3 | 402×788×0 | 2.27× |
| 5 | halfRes | drawing buffer ½ per axis | **18.8** | 18–19 | 52.3 | 201×394×4 | 2.29× |
| 6 | anim30 | mixer capped at 30 Hz | 7.4 | 7–8 | 134.1 | 402×788×4 | 0.90× |
| 7 | cullBack | front-face culling (**look-changing, measurement only**) | 10.4 | 9–12 | 94.2 | 402×788×4 | 1.27× |
| 8 | combo | msaa0 + halfRes + anim30 | **29.2** | 27–32 | 33.2 | 201×394×0 | 3.56× |
| 9 | comboHideRival | combo, WOLF hidden (26,500 tris; triangle probe) | 52.4 | 48–56 | 18.1 | 201×394×0 | 6.39× |
| 10 | baselineEnd | production (drift control) | 8.6 | 8–9 | 117.5 | 402×788×4 | 1.05× |
| 11 | baselineLive | production, cue runner on | 8.0 | 7–9 | 118.2 | 402×788×4 | 0.98× |

How to read it:

- **Noise floor.** Five arms produce the same frames: baseline, shadowOff, postOff, baselineEnd, plus anim30, whose cap is a unit-tested no-op when frames are slower than 30 Hz. Together they span 7.4–8.6 fps, median 8.2. Treat ±10 % as noise.
- **Shadow off, skip post, 30 Hz animation** have no measurable effect. There is nothing to remove: no shadow pass, no post pass, and 0.28 ms of mixer work.
- **LOD / decimated GLB was not run.** `mobile/assets/bots/manifest.json` has one GLB per bot. Those files are already the pipeline's 25 % simplification target, and no LOD variant exists. Nothing was decimated locally. `comboHideRival` is a triangle-count probe, not a LOD candidate.
- **The look cost is visible.** In the vault's `EDGE_CROPS.png`:
  - msaa0 shows stair-stepped silhouettes.
  - halfRes is visibly soft.
  - combo is blocky.
  - cullBack showed no hole in that crop, but the materials are authored double-sided, so it was never a candidate.
  - None of these is proposed for shipping. Any of them is a creative call for Lex/Pak.
- **Predictions.** These were written down before the run (vault `predictions.md`) and all landed inside their stated bands: msaa0 and halfRes ~15–22, combo ~28–40, comboHideRival ~45–60. The stated falsifier did not fire: msaa0 and halfRes did not stay within 20 % of baseline.
- **Not a before/after claim against device-perf-1.** The buffer is 402×788 here against 402×832 there, because the harness now has a capture-button row. The code is also different.

## Run provenance

- Simulator: iPhone 17 Pro / iOS 26.5, `70B47994-793B-44B3-BCF6-2CBE9519EF36`, already booted.
- App: the cached `fun.holobots.mobile.w64` (build 37, no embedded `main.jsbundle`), launched once with `simctl launch`. No install and no build.
- Metro was run offline from this branch's working tree (`node_modules` symlinked from the lite checkout):
  - Environment: `CI=1 EXPO_OFFLINE=1 EXPO_PUBLIC_HOLOCITY_PREVIEW=1 EXPO_PUBLIC_HOLOCITY_PREVIEW_SCREEN=HostDuelPerfSweep`.
  - Command: `expo start --offline --port 8081 --clear`.
  - Result: `iOS Bundled 9673ms index.js (1607 modules)`. No redbox, no `HolobotViewer:error` or shader error.
  - Existing warnings: the @firebase/auth exports warning, and three's "EXT_color_buffer_float not supported". The second is irrelevant, since nothing renders to float targets.
- Screenshots were taken during each arm's 1 s warm-up, outside its 5 s window. No video was recorded, because encoding on the host would compete with the CPU renderer.
- Cleanup: app terminated, Metro stopped, `lsof -i :8081` empty. The simulator was left booted, as found.

Vault: `~/HolobotsVault/QA/2026-10-17-lite-duel-perf-2/` contains:
- `metro.log`
- `arms.jsonl`, `probes.jsonl`, `inventories.jsonl`, `sweep-summary.json`
- `arm-01…11-*.png`, `CONTACT_SHEET.png`, `EDGE_CROPS.png`
- `sim-opengles-framework.txt`, `predictions.md`
- the watcher, sheet and GLB-inventory scripts (`*.txt`)

Every contact-sheet cell was reviewed and shows OFFLINE FIXTURE · NO REWARDS on ROUND 01. Cell 9 shows ACE alone, as intended. Cell 11 shows the live cue runner's stamina bar.

## What changed (all development-only; production unchanged)

- `BotStage` takes an optional `perf` prop, ignored outside `__DEV__`. Without it, the render path is unchanged: `msaaSamples={1}`, the same scale and signature, and a mixer update every frame. With it, `BotStage`:
  - changes `msaaSamples`, resolution, mixer cap, `shadowMap`, culling or rival visibility;
  - logs `[HolobotViewer:probe]` (GL strings, default-framebuffer samples, extensions, three capabilities);
  - logs `[HolobotViewer:inventory]` (meshes, bones, textures, programs, lights, mixers);
  - logs `[HolobotViewer:perfArm]` (5 s summary, GL calls by name, React renders/s);
  - counts JS→GL calls by shadowing that context's methods.
- `DuelPlaybackScreen` passes `perf` through and adds `holdCues`, which is development-only and keeps round 1 on screen.
- QA harness screen `HostDuelPerfSweep` (`src/qa/DuelPerfSweepPreview.tsx`) runs the 11 arms in order and logs `[HolobotViewer:perfSweep]`.
- `src/lib/bots/stagePerf.ts` (arms, summary, mixer cap) is covered by 8 unit tests in `src/lib/__tests__/stagePerf.test.ts`. `src/lib/bots/stageProbe.ts` holds the probe and inventory.
- Checks: `tsc --noEmit` exit 0. Vitest: 70 files passed, 1 skipped; 604 tests passed, 4 skipped.

## Device run (for when Pak plugs in the iPhone)

Prerequisites, all Pak-only:

- The iPhone has Developer Mode on and trusts this Mac.
- An Apple development team is selected for the `HolobotsMobile` target in Xcode. This is needed because `expo run:ios --device` builds and signs a Debug app.
- The phone and the Mac are on the same network.

```sh
mkdir -p ~/HolobotsVault/QA/<date>-lite-duel-perf-device
cd <checkout of this branch>/mobile
EXPO_PUBLIC_HOLOCITY_PREVIEW=1 EXPO_PUBLIC_HOLOCITY_PREVIEW_SCREEN=HostDuelPerfSweep \
  npx expo run:ios --device "<iPhone name>" 2>&1 | tee ~/HolobotsVault/QA/<date>-lite-duel-perf-device/device-sweep.log
```

- The app opens straight into the sweep. Leave the phone untouched with the screen on for about 2 minutes, until the banner reads `PERF SWEEP COMPLETE`. Then press Ctrl-C.
- Read the results:

```sh
LOG=~/HolobotsVault/QA/<date>-lite-duel-perf-device/device-sweep.log
grep -m1 'HolobotViewer:probe' "$LOG" | grep -o '"renderer":"[^"]*"\|"defaultFramebufferSamples":[0-9]*'
grep 'HolobotViewer:perfArm' "$LOG" | sed 's/^[^{]*//' | python3 -c '
import sys, json
for line in sys.stdin:
    j = json.loads(line); s = j["summary"]
    print("%-15s %6s fps  1s %s-%s  barrier %7s ms  prep %s  render %s  %sx%sx%s" % (j["arm"], s["fps"], s["fps1s"]["min"], s["fps1s"]["max"], s["barrierMs"], s["prepMs"], s["renderMs"], j["drawWidth"], j["drawHeight"], j["defaultFramebufferSamples"]))'
```

What to check:

1. **Renderer string.** It must not be `Apple Software Renderer`. Write down the GPU string and the samples value.
2. **Gate.** If `baseline` and `baselineEnd` are both ≥ 50 fps, the 50 fps gate passes with production settings and nothing changes. Also record `baselineLive` (cue runner on).
3. **If baseline is under 50**, apply the first case that matches:
   - `msaa0` or `halfRes` ≥ 50: that knob is the candidate. It goes to Lex/Pak as a look call, with `EDGE_CROPS.png` from the device.
   - Only `combo` ≥ 50: the combination is the candidate, and it is the same look call.
   - Only `comboHideRival` ≥ 50: the duel is bound by vertices and triangles. The fix is lower-polygon GLBs generated by the asset pipeline, not a JavaScript knob.
4. **Where the time goes.** If `barrierMs` is small but fps is under 50, the cost is on the JavaScript side. Read `prepMs` / `renderMs`, and `reactRendersPerSecond` on `baselineLive`. The Debug build runs JavaScript in dev mode, so treat JS-side numbers as an upper bound.

This document makes no device fps claim and approves no TestFlight build.
