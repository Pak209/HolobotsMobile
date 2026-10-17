# Mobile Holobot assets and replay

W6 uses all 12 rigs from https://github.com/Pak209/holocity-promo-glb at commit `970cc690e4fa9ce370ebf30da4d513b08c67297f`. Geometry is in metres, Y-up. GLBs are generated with glTF Transform 4.2.1, Meshopt 0.22.0 medium compression, 25% triangle simplification target (maximum error 0.001; borders locked), animation resampling tolerance 0.0001, 1024 px base/emissive JPEG85 textures, and 512 px normal/ORM PNG textures. Every source animation name is preserved. `assets/bots/manifest.json` records sizes, hashes, idle/clip names, source bytes and Khronos validation counts; `index.ts` contains static Metro asset references.

## Rebuild inside this clone

Pinned source hashes, original animation key ranges, and the extended verifier are documented in [bot-asset-pack.md](bot-asset-pack.md).

```sh
mkdir -p .work
git clone https://github.com/Pak209/holocity-promo-glb .work/holocity-promo-glb
git -C .work/holocity-promo-glb checkout 970cc690e4fa9ce370ebf30da4d513b08c67297f
npm ci --prefix mobile/tools/bot-assets
node mobile/scripts/prepare-bots.mjs --source-dir .work/holocity-promo-glb
node mobile/scripts/validate-bots.mjs
```

The validation script compares all **148 compressed buffer views** decoded using the exact JavaScript decoder imported by native with the upstream WebAssembly decoder, checks all 86 clips, skins, texture dimensions, hashes, and the strict 2,000,000 byte per-bot budget. Khronos validator reported zero errors for every generated file (Meshopt extension support warnings are recorded in the manifest).

| Bot | Source MB | Mobile MB | Triangles | Clips |
| --- | ---: | ---: | ---: | ---: |
| WOLF | 6.517 | 0.799 | 29,750 | 7 |
| KUMA | 6.910 | 0.944 | 29,626 | 7 |
| KEN | 7.246 | 0.991 | 35,736 | 7 |
| TSUIN | 6.536 | 0.852 | 29,938 | 7 |
| HARE | 13.932 | 1.681 | 42,982 | 7 |
| SHADOW | 5.930 | 0.906 | 27,540 | 8 |
| WAKE | 7.041 | 0.904 | 29,586 | 7 |
| TORA | 6.974 | 1.017 | 40,258 | 7 |
| GAMA | 12.379 | 1.144 | 29,878 | 7 |
| KURAI | 6.860 | 0.822 | 29,848 | 7 |
| ERA | 7.003 | 1.054 | 35,122 | 7 |
| ACE | 9.721 | 0.989 | 26,500 | 8 |

Total GLBs: **12.102 MB decimal**. The largest is HARE at 1.681 MB. These are asset bytes, not the native app installation size or JavaScript bundle size.

## Native renderer

`HolobotViewer` wraps Expo GL / Three / Expo Three. It accepts `botId`, `style`, `active`, `onReady`, `onMetrics`, and `showMetrics`. Its ref exposes `play(clipName): boolean`. Exact take names and Unity `HB_<BOT>_Mixar_<Clip>` names work. Idle resolves to `FableHover` for ACE, `HoverIdle` for WOLF, and `Idle` for the other ten bots. Explicit per-bot tables resolve `Strike`, `Heavy` and `Finisher` to three distinct authored takes, including ACE's Skybreaker/CometCross/MeteorHammer signatures. Legacy `AttackBasic` and `AttackSignature` retain their existing Unity mappings. The manifest's alphabetic order never selects an attack. Unknown or unavailable clips return `false`. One-shot takes return to idle. The outer world transform is separate from the animated rig, preserving ACE's animated Armature scale. HARE's Idle/Walk/Run Hips quaternion tracks receive the same +90° X locomotion correction documented by Unity's `FleetMixarImportTool.RepairHareLocomotionAxes`; attack takes and source GLB bytes are unchanged.

Hermes does not need WebAssembly: the loader imports Meshopt's pure JavaScript reference decoder directly. It is slower than the WASM decoder; measure native performance instead of treating web timings as native. Embedded image buffer views are written to Expo's app texture cache and loaded as local assets, bypassing browser Blob/object-URL APIs unsupported by React Native. All GL geometry, textures, skeleton bone textures and materials are disposed when the stage changes or unmounts, and native contexts are explicitly destroyed. Render updates pause while the app is backgrounded or `active=false`.

The stage mounts GL only after positive layout, keeps its native view hierarchy unflattened, and updates viewport/projection from layout rather than Expo's initial-only `drawingBufferWidth/Height` properties. Before each draw it restores Expo's default framebuffer. Native frames end with `gl.finish()`, `gl.endFrameEXP()` and `gl.flushEXP()` so the JS loop cannot outrun completed native work. Web skips the native-only barriers. Earlier asynchronous submissions appeared to run at 60 fps while the simulator's software renderer accumulated work and eventually presented blank views; **all of those earlier timings and captures are invalid**.

The final default is one sample, a logical-pixel 3D surface composited to the full view, and textured Lambert lighting (`materialQuality="balanced"`). The native HUD and static city plate remain at normal display resolution. `BotStage` also accepts `renderScale` and `materialQuality="pbr"` for explicit quality comparisons. Balanced lighting preserves base color, emissive textures, opacity and rig animation; it omits PBR reflection/normal/ORM shading. On the iOS 26.5 Apple Software Renderer, HARE improved from about 3 fps at 555×780 PBR, to 6.6 fps with balanced lighting, to about 9 fps at 370×520. These are simulator comparisons, not device performance claims.

Metrics arrive through `onMetrics`. Diagnostic `[HolobotViewer:metrics]` and error-stack logging is development-only:

- `loadMs`: from native GL context callback through asset reads, Meshopt decoding, textures, rig setup, first renderer draw, `gl.finish()`, `gl.endFrameEXP()` and the initial native queue flush; this includes first-frame shader compilation. It does not include time before GL context creation or a display-present completion signal.
- `fps`: completed native draw batches divided by wall-clock elapsed for each two-second active sample. Each native frame waits for GL completion and its queue barrier. This is application rendering throughput, not a display-compositor profiler reading. The initial `fps=0,frames=0` event denotes warming up; first active samples can still include UI warmup.
- `assetBytes`: sum of loaded GLB file sizes. `platform` distinguishes iOS, Android and web measurements. `drawWidth`, `drawHeight`, `renderScale`, `materialQuality`, and `contextId` identify the tested surface and settings.

The offline QA route exposes these metrics. Simulator measurements and screenshots belong in the mission QA report after a real iOS run; no unmeasured fps is claimed here.

## Duel receipt contract

`DuelPlaybackScreen` accepts `receipt`, optional `rounds`, `attackerBotId`, `defenderBotId`, `onClose`, and optional `onMetrics`, `fixture`, `showMetrics`. Its transparent `BotStage` uses `variant="duelPortrait"` over a static park/city plate. The camera is 0.9 m high with a 35 mm focal length. Actors are placed diagonally 1.8 m apart, with the player closer and facing the rival in three-quarter back view. Portrait staging uniformly normalizes each outer rig to 1.45 m posed height so differently scaled exports remain legible; individual roster/detail viewers retain source scale and fit their camera to the model bounds.

`BotStage` exposes `play(side, clip)`, `strike(side)`, `hit(side)`, and `guard(side)`. Strike only adds a short camera push; it never replaces the exact receipt clip. Hit returns to idle with an 8 cm recoil and two rendered frames of camera shake. Guard plays an available guard take or idle, with a brief cyan shield. The source GLBs have no Unity-derived HitLight/HitHeavy/Victory/Defeat or guard takes; the documented fallbacks are additive presentation only. None of these methods resolves an outcome or changes HP, stamina, rewards or the winner.

The repository's `rivalBattleHost` issue reply contains `encounter`, `playerCombatants`, and a seed; settle contains `didWin`, rewards and progression. Neither includes rounds. This UI therefore accepts the existing client's actual `actionHistory` as a separately labelled client replay, while using the host settlement for the result card. A receipt with no trace is shown as result-only. A seed alone is never expanded into fictitious host turns. The three-round ACE/WOLF QA fixture is explicitly marked synthetic and contains authored action, HP and stamina snapshots; the viewer copies those values and suppresses rewards.

Pure tests cover actual issue/settle shapes, absent traces, malformed rows, cue order, resource snapshots, and every bundled bot's idle/Unity/basic/signature aliases against the manifest.
