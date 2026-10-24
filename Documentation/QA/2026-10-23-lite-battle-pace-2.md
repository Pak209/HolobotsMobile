# lite-battle-pace-2 — presentation closure, HARE held

## 2026-10-23 HARE native re-witness

The HARE asset hold below is historical. Pak approved the exact 2,210,316-byte strict pack, installed in the lite-targeted #200 branch; that branch now carries the fresh native iPhone 17 Pro / iOS 26.5 HARE witness. Its ten-cell sheet (known-bad first, native HARE round and result in cells 9–10), source screenshots, and round-to-result video are at `/Users/pak/HolobotsVault/QA/2026-10-23-astra-lite-battle-pace/pace-3/native-rewitness/`. A clean Pods install and fresh simulator `xcodebuild` succeeded. The signed-out recorded fixture showed the installed HARE model, accepted one player STRIKE, reached HARE's KO endpoint, held the final pose for 2000 ms, and displayed the existing CITY RECEIPT. Native GL samples were 22.0–25.2 fps at 201×394, so the approximate 25 fps Arena target remains borderline; the tall PvP modal's separate 24.125 fps limit is unchanged. The #199 main-based presentation code has no asset change; the strict HARE pack and its native evidence live in #200.

CPU Arena and PvP now keep their real fight view mounted until pending presentation cues finish, the defeated actor reaches its authored KO endpoint, and 2,000 ms of foreground presentation time elapse. They then reveal their existing result UI. The accepted outcome, settlement timing, turn order, rewards and rules are unchanged. Intermediate 3v3 knockouts do not arm a terminal result: only overall `completed` does. The missing-model/2D fallback completes without waiting for a GL callback.

Evidence is offline iPhone 17 Pro / iOS 26.5 simulator with the existing cached native binary; no native build, live host, account or reward write. The QA PvP route injects an already-resolved session into the real `PvpArenaModalView`, without the live hook. The CPU route uses the real `ArenaScreen` and a recorded receipt. **CPU witness substitutes only KUMA geometry over recorded HARE stats/rewards; it is not a host-accepted KUMA issue.** The original HARE fixture and shipped HARE GLB remain unchanged.

## Evidence

Vault: `/Users/pak/HolobotsVault/QA/2026-10-23-astra-lite-battle-pace/pace-2/`

- `delivery/PHONE_SHEET.png`: 1,600 px wide, eight inventoried cells, known-bad baseline first; `delivery/sheet-inventory.json` pins source movie/frame/PTS/hash for every cell.
- `native/arena-ko.mp4`: actual CPU parent → KO endpoint at 18:00:12.252Z → result release at 18:00:14.261Z; 2,014.7 ms foreground hold. The real result retains HARE blueprint reward from the recorded receipt.
- `native/pvp-ko-final.mp4`: final source tree, actual PvP modal → KO endpoint at 18:02:25.481Z → release at 18:02:27.496Z; 2,014.3 ms foreground hold → existing Synced Battle / Victory. No idle recovery during hold.
- `native/tsuin-guard.mp4`: the already-shipped mobile `FightGuard` candidate plays, then returns to idle after 403.1 and 450.4 ms (frame quantization / blend). No replacement TSUIN asset or motion was authored. The separate Unity native blend witness stays queued.
- All 3,038 decoded frames of the five current delivery/measurement clips were reviewed: final PvP 467, CPU KO 445, TSUIN 720, bare PvP 828, Arena FPS 578. Each has a full frame/PTS index and all-frame combat atlas under `frames/` and `review/`. Root independently reviewed all CPU and TSUIN frames and the full-size CPU endpoint. The prior known-bad frame comes from the previously reviewed baseline. No exploded limbs or idle recovery seen; existing left-edge body clipping and the CPU QA banner remain visible.
- `pvp-ko.mp4` is a discarded same-route modal remount capture with no GL context; it is not delivery evidence. The fresh-app final capture supersedes it. `pvp-ko-r1.mp4` is an earlier functional witness, superseded by the final source capture.

## Measured performance limits

These are GL frame samples, not video cadence. Same simulator, cached native binary, balanced materials, renderScale 1/6, no concurrent lane Blender jobs during measurement. Captures include host PID/CPU/RSS/process-name snapshots. No controlled causal speedup claim.

| Capture | Target | Active intervals | Mean FPS | Gate |
|---|---|---:|---:|---|
| Arena unchanged ACE/HARE | 201×394 | 3 | 24.40 | Below ~25; short window, post-KO/confirming excluded |
| Comparable bare PvP ACE/KUMA | 201×394 | 8 | 32.85 | Approximately 33, below prior 34.36 sample |
| Real PvP modal TSUIN/KUMA | 201×437 | 8 | 24.125 | Below ~33; taller actual modal is not the bare-stage comparison |

The earlier lane measured Arena 25.73 / bare PvP 34.36. This continuation does not establish a blanket performance pass. `metrics-summary.json` contains each selected interval; the raw logs preserve all intervals.

## HARE — two failed attempts; no install

Strict cap remains 2,000,000 bytes and sampled decoded-pose tolerance remains 1 mm / 0.2 degrees. No geometry/texture degradation, clip deletion or tolerance relaxation.

1. Lossless GLB JSON default removal from the prior over-budget candidate: 2,011,580 → **1,987,352 B**, saved 24,228 B / 1,275 fields; BIN chunks byte-identical. Khronos 0 errors / 2 warnings. Decoded pose **2.291864 mm / 0.217491 degrees**, fails. `packed/hare.glb`, `hare-lossless.log`, `hare-poses.log`.
2. Fresh strict 1e-7 resample plus the same compactor: **2,210,316 B**, 210,316 over cap. Independent decoded-pose measurement **0.0697288 mm / 0.0781415 degrees**, passes precision but fails budget. `packed/hare-r2.glb`, `hare-repack-r2.log`, `hare-poses-r2.log`.

Exact commands are retained in the corresponding logs and `attempts.json`. Read-only diagnosis found only about 12,128 B min/max and 378 B names left, far below the 210,316 B gap. No viable metadata-only third correction; no third pack attempted. Original HARE 1,681,480 B / seven original takes remains installed. Candidate files are archived, never copied into assets.

Attempt rule: Unity `Documentation/HANDOFFS/2026-10-23-astra-overnight-burn-2-brief.md:3` inherits burn 1; `2026-10-22-astra-overnight-burn-brief.md:13` stops each item after two failures; `2026-10-07-astra-lead-chair-handoff.md:19` requires explicit chair permission for a third. The reviewed decision preserves this hold.

## Checks

Lite full suite: **1,430 passed / 4 known skips**, typecheck green. Targeted presentation suite: 25 passed. GLB compactor: 2 passed (BIN unchanged, nondefaults retained, idempotence, invalid header rejected). `git diff --check` green. New policy tests include intermediate 3v3 KO → send-in → final KO under one battle id, queue drain, final endpoint delay, foreground pause and reset/new battle. Native captures exercise actual parent UI transitions.

Known conditional skips: cityHostIntegration `parses the real callable gathering, unlocks Arena and keeps Zone hidden`; `plays every assigned citizen from real issue stats and parses settlement/replay/cooldown replies`; `heals and crafts through the actual workshop hosts without duplicate grants`; genesisSignupParity `field-by-field equal except the per-account timestamps`.

Main-mirror exact checks and both PR head/CI references are recorded in the final publication receipt. #199 targets main; #200 targets mobile-holocity-lite. Both stay draft for HARE / measured performance limitations. No release #190 change. Pak merges; no deploy.
