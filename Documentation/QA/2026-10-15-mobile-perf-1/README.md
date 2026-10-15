# W18 — native host-receipt playback performance

**50 fps gate failed. No performance fix applied.** W15 `duel-receipt-1` completed all eight host rounds / sixteen actions and displayed its recorded victory on iPhone 17 Pro Simulator, iOS 26.5. W15 code pinned at `a5568e8f319a86bca488e3fc36891dabe9acb8eb`; W14 assets at `93fd28ec7a599dd2d30ea70b2d04ecbda41b84de`. All twelve manifest entries and the ACE/WOLF GLB hashes match #88. After W16 rebased #90 to `b9956eabc6ec9475270eeaa6b622266d8fa7cd3c`, the measured BotStage, DuelPlaybackScreen, bot libraries/assets and mobile dependency files were diffed and remain byte-identical. No host call, authentication, account, deploy or asset/runtime optimization occurred.

## Measured results

| Measurement | Result |
|---|---:|
| Fresh-container launch request → first completed native draw | 4,194 ms |
| JavaScript fixture entry → first completed native draw | 2,740 ms |
| GL context callback → first completed native draw | 2,371 ms |
| Active playback median completed-native fps | 6.85 |
| Active playback range | 6.6–7.9 fps |
| Active samples | 24, three per host round |
| Receipt timeline completed | 51,200 ms, 8 turns / 16 actions |
| Sampled process RSS min / peak / last | 409.22 / 537.58 / 419.45 MiB |
| Median sampled process CPU | 100.95%, approximately one host core |
| Native render surface | 402×874, 351,348 pixels |
| Combined compressed ACE + WOLF | 1,787,952 bytes |

| Host round | Samples | Median fps | Range |
|---:|---:|---:|---:|
| 1 | 3 | 7.0 | 6.8–7.3 |
| 2 | 3 | 6.8 | 6.8–7.5 |
| 3 | 3 | 6.7 | 6.6–6.7 |
| 4 | 3 | 6.9 | 6.8–7.0 |
| 5 | 3 | 6.9 | 6.7–7.9 |
| 6 | 3 | 6.8 | 6.8–6.9 |
| 7 | 3 | 6.9 | 6.8–7.0 |
| 8 | 3 | 7.0 | 6.8–7.6 |

`summary.json`, `metrics.jsonl`, `memory-retry.jsonl`, `launch-retry.json`, `asset-analysis.json` and `asset-hashes.json` preserve raw values and provenance. RSS was sampled 32 times every two seconds starting ~11 seconds after process launch; the peak is the **observed sampling peak**, not a startup allocation high-water mark. End RSS is not a leak verdict. `ps` RSS includes more than JavaScript heap and is not physical footprint. Values in MiB are KiB / 1024.

## Method and limits

Mac16,10, arm64, 10 CPU cores, 16 GiB RAM. Other local development jobs were not suspended; this is observed session performance, not an otherwise idle-host benchmark. Booted iPhone 17 Pro simulator `70B47994-793B-44B3-BCF6-2CBE9519EF36`, iOS 26.5. Existing W6 native shell build 37 was copied to a temporary app, given a separate bundle ID/container, and embedded with the pinned W15 offline receipt entry. Native shell executable SHA is in `native-shell.json`. No native dependency change was required. Watch extensions were excluded from the measurement copy. The existing app, its data, and its Metro server were untouched.

`perf-entry.tsx.txt` is the exact temporary harness (copy under mobile to reproduce). It registers only the real `DuelPlaybackScreen`, bundled receipt, fonts and safe-area provider. It mounts no auth provider. Expo `export:embed --entry-file w18-perf-entry.tsx --platform ios --dev true --max-workers 2 --bundle-output <app>/main.jsbundle --assets-dest <app>` creates the development bundle. The app is ad-hoc signed for Simulator and launched using XcodeBuildMCP. The fresh app container has no asset cache; operating-system filesystem caches are retained. The cold-load figure includes tool dispatch and process/JS/font startup, and ends at the existing first-native-draw callback. It is **offline duel-fixture startup**, not production full-app startup or compositor presentation latency.

Rendering settings are unchanged: balanced Lambert materials, 1/3 render scale on a 3× display, native `gl.finish()` / `endFrameEXP()` / `flushEXP()` barriers. FPS counts completed native batches rather than unbounded JavaScript submissions. Existing two-second samples span interval boundaries; each is attributed to the host round containing its endpoint (`floor(elapsedMs / 6400) + 1`). The legacy diagnostic `round` field counts action rows; the actual HUD and this table use eight host turns. Zero-fps warmup and result-idle samples are excluded.

First native attempt rendered correctly, but React Native console output did not reach the MCP OSLog filter; it is not used as a complete performance dataset. The second attempt journaled existing metric callbacks to the isolated app's Documents directory. File writes are serialized, about three small records per two seconds, with no network transport. This instrumentation and development mode add overhead; no release-build or physical-device claim is made. No crash or renderer-error surface appeared. Native logs contain packager connection and existing UIKit/background-mode warnings, not a clean-console claim.

The measurement run’s round 08/8 and VICTORY were visually inspected through XcodeBuildMCP. A later warm replay was used solely for the saved round-five image; its samples are excluded. That image was also inspected: both textured bots, round 05/8, recorded HP and Heavy cue. Screenshot: `/Users/pak/HolobotsVault/QA/2026-10-15-mobile-perf-1/round-5.png`. Both measurement apps were stopped afterward. Shared W6 app and Metro were not stopped. Temporary instrumentation is not wired into the app or committed as executable application code.

## Proposed next changes — not applied

| Candidate | Current measured or inspected workload | Proposed target | Expected scope, not an fps promise |
|---|---|---|---|
| Texture tier | ACE and WOLF each have one 1024² texture: 8 MiB RGBA base levels combined | Optional 512² duel textures: 2 MiB combined (−75%; mipmaps approximately 10.67 → 2.67 MiB) | Lower texture memory/bandwidth; preserve #88 originals and validate appearance. Compression bytes do not equal GPU memory. |
| Invisible guard draws | Two one-primitive skinned meshes plus two always-visible opacity-zero guard spheres; floor/grid hidden | Set guard meshes visible only during their 700 ms effect: ordinary scene submissions 4 → 2 by source inspection | Remove two transparent wireframe submissions; confirm actual draw calls with renderer telemetry before claiming gain. |
| Animation loading | ACE 8 + WOLF 7 = 15 clips, 1,287 total channels | Lazily prepare the 5 relevant takes per bot (idle, evade, three commands): 10 clips / 855 channels (−33.6% channels) | Cold-load/memory experiment only. Do not remove any of the 86 source clips; inactive clips are not automatically per-frame work. |
| Pixel workload | 402×874 = 351,348 pixels | Optional 201×437 = 87,837 pixels (−75%) while HUD stays full resolution | Requires a lower render-scale floor than today's 0.25 clamp; visual approval needed. Try separately from textures to isolate effect. |

The scene has 56,250 bot triangles (26,500 ACE + 29,750 WOLF); a later geometry experiment could target ~28,000 combined, but is lower priority than measuring native barrier/software-renderer cost. None of these changes is assumed to achieve 50 fps. Preserve bounded native submission: removing `gl.finish()` just to report 60 JavaScript fps would revive the previously documented misleading queue measurement.

HELD: performance acceptance at 50 fps, any optimization implementation, release-build/physical-device performance, and all earlier live-account/host migration holds. This PR contains evidence and proposals only.
