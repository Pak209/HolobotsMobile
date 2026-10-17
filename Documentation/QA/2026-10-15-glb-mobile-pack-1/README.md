# W14 glb-mobile-pack-1

Twelve processed GLBs and reproducible tooling, isolated from the shared `HolobotsMobile-lite` working tree. Initially reproduced against `694be3483625b8e6fb74e63a683b61a27e857579` (`main`, #80 merged), then stacked on W6 PR #87 at `c71a30613b4e163598a7bec9bc9f3b5790bf979b` when its owner published the baseline. The GLBs already belong to #87; this PR contributes the independently verified reproducibility/provenance delta. Merge #87 first, then retarget this PR to main. No deployment, editor, production pilot, app wiring or foreign dirty-file changes.

## Before and after

The pinned original fleet is **97,049,036 bytes**; all **12/12** exceed the **2,000,000-byte** mobile gate before compression (`source-size-baseline.json`). The first pack attempt passed in **2.529 s** within a **300 s** bound. The output is **12,102,060 bytes**, with all **12/12** under budget, all **86/86** original animation names and **148/148** Meshopt buffers decoded identically by pure JavaScript and WASM. All skins are present and textures are within **1024 px**. Khronos validation: **0 errors**, **1 warning per GLB**, as recorded in the manifest.

The first extended validator attempt failed in **0.150 s** because it compared the source's declared clip span with an absolute final key time (`wolf/Evade`, 1.9583 s vs 2.0 s). Read-only inspection confirmed that source clips start at 1/24 s (ACE 1/30 s). The validator now separately pins and compares the original first/last key times and checks their span against the source manifest. No animations were retimed, no assertions or tolerances were loosened to accept a changed clip. The second attempt passed in **0.543 s**. Both logs and timings are retained; no further candidate attempts were needed. After stacking on the published #87 tree, the same verifier again passed all 12 bots / 86 clips / 148 buffers. The final asset manifest and static lookup match that base exactly.

`npm ci --prefix mobile/tools/bot-assets --ignore-scripts --offline --dry-run` accepted the pinned tool lockfile. The actual pack/verify used the same exact installed versions from W6's read-only tool directory via a local ignored symlink. No fresh-install or cross-platform byte identity is claimed; the documented `npm ci` command provides the portable dependency setup.

## Provenance and visual evidence

Source repository: `https://github.com/Pak209/holocity-promo-glb`, commit `970cc690e4fa9ce370ebf30da4d513b08c67297f`. This lane read its clean local checkout at `/Users/pak/Projects/HolobotsMobile-lite/.work/holocity-promo-glb` and reproduced the assets rather than staging the foreign working tree. Original manifest and GLB hashes are pinned in `mobile/tools/bot-assets/source-manifest.json`.

Every generated GLB is **byte-identical to W6's existing pack**, recorded by `identicalToW6: true` for all 12 rows in `validation.json`. The three existing W6 simulator captures below were inspected: ACE, HARE and WOLF are upright, textured and framed. These are prior W6 rendering evidence for the identical asset bytes, **not new W14 simulator runs or device-performance proof**. Their images remain outside this commit:

- `/Users/pak/Projects/HolobotsMobile-lite/Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/BotACE.png`
- `/Users/pak/Projects/HolobotsMobile-lite/Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/BotHARE.png`
- `/Users/pak/Projects/HolobotsMobile-lite/Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/BotWOLF.png`

Existing full-fleet/native-renderer evidence: `/Users/pak/Projects/HolobotsMobile-lite/Documentation/QA/2026-10-14-mobile-holocity-lite/W6.md`. Its simulator FPS limitations remain; no physical-device or fresh renderer claim is made here.

## Sizes

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

## Handoff

Rebuild instructions and loader requirements: `mobile/docs/bot-asset-pack.md`. Generated static lookup API matches W6 (`BOT_ASSETS`, `BOT_MANIFEST`, `BotId`, `resolveBotId`). W15 owns loader, app dependencies, Metro configuration and duel playback; these files are intentionally outside this PR. No W14 asset gate remains HELD. All unrelated holds remain.
