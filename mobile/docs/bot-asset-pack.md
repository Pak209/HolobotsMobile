# Reproducible mobile Holobot asset pack

The 12 GLBs in `mobile/assets/bots` come from `Pak209/holocity-promo-glb` commit `970cc690e4fa9ce370ebf30da4d513b08c67297f`. Only the processed mobile files are committed here. Source GLBs stay in the external source clone. `mobile/tools/bot-assets/source-manifest.json` pins the original manifest hash, every source GLB hash, all 86 clip names and their original timing ranges.

## Rebuild and verify

From the repository root, with Node 20 or newer and Git installed:

```sh
npm ci --prefix mobile/tools/bot-assets
git clone https://github.com/Pak209/holocity-promo-glb /tmp/holocity-promo-glb-source
git -C /tmp/holocity-promo-glb-source checkout --detach 970cc690e4fa9ce370ebf30da4d513b08c67297f
node mobile/scripts/prepare-bots.mjs --source-dir /tmp/holocity-promo-glb-source
node mobile/scripts/validate-bots.mjs
```

The source clone is required only to rebuild. `validate-bots.mjs` checks the committed pack without downloading source assets. Optional `--report /tmp/bot-validation.json` writes machine-readable results. `prepare-bots.mjs --output-dir /tmp/rebuilt-bots` and `validate-bots.mjs --directory /tmp/rebuilt-bots` keep an experimental rebuild outside the repository. Both commands fail if a gate is violated; do not accept partial output from a failed build.

Tool dependencies are locked separately from the app: glTF Transform **4.2.1**, meshoptimizer **0.22.0**, sharp **0.34.5**, glTF validator **2.0.0-dev.3.10**. The transform sequence is dedup → weld → simplify (**25%** triangle target, maximum error **0.001**, borders locked) → animation resample (tolerance **0.0001**) → prune → texture compression → Meshopt medium. Base/emissive textures are at most **1024×1024**, JPEG quality **85**; normal/occlusion/metallic-roughness textures at most **512×512**, PNG. All texture dimensions remain at most **1024**; no Draco/KTX decoder is needed.

The verifier requires exactly the source 12 IDs and 86 clip names; checks SHA-256, GLB headers, strict **2,000,000 bytes** per bot, skins, nonempty animations, original key ranges, and texture dimensions; compares all compressed buffers decoded by the pure-JS and WASM decoders; and runs Khronos structural validation. The source manifest `seconds` field describes **last key minus first key**, not the absolute clip endpoint. Original keys begin at **1/24 s**, or **1/30 s for ACE**. Use the loaded Three `AnimationClip.duration` for the playback endpoint; names, times and source metadata have not been retimed.

## Loader contract

The generated `index.ts` preserves W6's API: `BOT_ASSETS` (static Metro `require` calls), `BOT_MANIFEST`, `BotId`, and `resolveBotId`. IDs are `wolf`, `kuma`, `ken`, `tsuin`, `hare`, `shadow`, `wake`, `tora`, `gama`, `kurai`, `era`, `ace`. Idle is `FableHover` for ACE, `HoverIdle` for WOLF, and `Idle` for the other ten.

The files require `EXT_meshopt_compression`. Configure `GLTFLoader.setMeshoptDecoder(...)`; the W6 Hermes loader uses `meshoptimizer/meshopt_decoder_reference.js` because native Hermes need not provide WASM. The pure-JS decoder was verified byte-for-byte against the WASM decoder for **148** buffer views. Metro must include `glb` in `resolver.assetExts`. Native embedded-image loading and animation-axis fixes remain responsibilities of the W6/W15 loader. This asset PR does not edit app dependencies, Metro configuration, renderer, or screens. It does not claim that main can render the assets without that integration.

## Size table

| Bot | Source bytes | Mobile bytes | Reduction | Clips | Triangles |
| --- | ---: | ---: | ---: | ---: | ---: |
| WOLF | 6,517,316 | 799,012 | 87.74% | 7 | 29,750 |
| KUMA | 6,909,784 | 943,788 | 86.34% | 7 | 29,626 |
| KEN | 7,245,868 | 990,696 | 86.33% | 7 | 35,736 |
| TSUIN | 6,536,380 | 851,688 | 86.97% | 7 | 29,938 |
| HARE | 13,931,624 | 1,681,480 | 87.93% | 7 | 42,982 |
| SHADOW | 5,929,768 | 905,576 | 84.73% | 8 | 27,540 |
| WAKE | 7,041,076 | 903,940 | 87.16% | 7 | 29,586 |
| TORA | 6,973,896 | 1,017,052 | 85.42% | 7 | 40,258 |
| GAMA | 12,379,092 | 1,143,744 | 90.76% | 7 | 29,878 |
| KURAI | 6,859,560 | 822,012 | 88.02% | 7 | 29,848 |
| ERA | 7,003,344 | 1,054,132 | 84.95% | 7 | 35,122 |
| ACE | 9,721,328 | 988,940 | 89.83% | 8 | 26,500 |

Total **12,102,060 bytes**, down from **97,049,036 bytes** (**87.53%** smaller). Largest: HARE **1,681,480 bytes**. These are asset-file sizes, not installed-app memory, GPU memory, or frame-rate measurements.
