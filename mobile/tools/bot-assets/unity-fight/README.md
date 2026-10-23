# Unity fight clip port — lite-battle-pace-1

Candidate ports for 11 of the 12 bundled bots. HARE remains the original asset: two pack attempts reached 2,013,044 and 2,011,580 bytes, above the strict 2,000,000-byte cap. Do not silently increase that cap, drop a take, lower texture resolution, or simplify geometry to make this lane pass.

The manifest pins Unity `1252e63acc6da12be0ab2cbdbde1408e2687251f` and original Mobile `cdf6318d961c532f43d9428e75c00154b5b4f8ad`. Installed Unity `.anim` curves and controller speeds are the motion authority. These are frequently newer than the original FBX. ACE hit/defeat and the explicitly identified TSUIN guard use FBX takes. This is not a claim that every original FBX hierarchy was independently validated.

The original 86 animation takes stay in the bundle. Accepted bots add nine named takes each: `FightLight`, `FightHeavy`, `FightSpecial`, `FightHitLight`, `FightHitHeavy`, `FightGuard`, `FightKO`, `FightIdle`, `FightRun`. The shipped catalog remains 12 bots; JUSAN is not added by this lane.

## Reproduction

Use Blender 5.2 headless and the pinned source snapshot, with real Git LFS content verified against its pointer hash. No Unity editor is involved. The evidence root used below is a vault/scratch directory, never a Unity Assets directory. Dependency versions are those in `../package.json`; `BOT_TOOLS_PACKAGE` can identify an isolated cached copy without changing the repository dependency lock.

```sh
python3 mobile/tools/bot-assets/unity-fight/census.py --unity-root "$PACE_SOURCE" --output "$PACE_OUT/unity-fight-source.json"
python3 -m unittest discover -s mobile/tools/bot-assets/unity-fight -p 'test_*.py'
/Applications/Blender.app/Contents/MacOS/Blender -b -t 2 --python-exit-code 7 --python mobile/tools/bot-assets/unity-fight/export_clips.py -- --bot wolf --source-root "$PACE_SOURCE" --input "$PACE_OUT/wolf-before.glb" --config "$PACE_OUT/unity-fight-source.json" --output "$PACE_OUT/export/wolf.glb"
node mobile/tools/bot-assets/unity-fight/pack.mjs "$PACE_OUT/export/wolf.glb" "$PACE_OUT/packed/wolf.glb" "$PACE_OUT/wolf-before.glb"
node mobile/tools/bot-assets/unity-fight/validate_poses.mjs "$PACE_OUT/export/wolf.glb" "$PACE_OUT/packed/wolf.glb" "$PACE_OUT/export/wolf.json" "$PACE_OUT/packed/wolf.poses.json"
node mobile/scripts/validate-bots.mjs --report "$PACE_OUT/asset-validation.json"
```

`stage_manifest.py` requires a complete guarded-status report with exactly 11 accepted bots and HARE excluded. It copies only the accepted candidate bytes and writes checksums/provenance. It does not grant approval to install a held candidate. `fight-source-manifest.json` is the committed immutable inventory; the runtime timing subset is `src/lite/lib/bots/fightClipTiming.json` (or `src/lib/bots/` on the lite integration branch).

## Gates and limitations

- The curve guard rejects weighted/stepped/non-finite curves, missing animated bindings and non-identity scale. It prevents an animated Idle reference from filling missing target channels.
- Calibration fits a shared source take and tests three held-out keys. This source-to-rig measurement is separate from the packing measurement. ACE's maximum held-out error is 3.3775 mm / 1.2145 degrees; its reference fit is 0.0087 mm.
- Export uses a common 120 Hz timebase. Near-integral floating-point endpoints are snapped within 0.001 frame to preserve a 1.8-second take that Blender otherwise floors to 215/120 seconds. This does not retime authored motion.
- Clamp/renormalize to the top two skin weights. Record the posed vertex difference against the original weights; this is not lossless. Worst sampled TSUIN delta is 133.6 mm. The paired close-ups are part of the evidence.
- No second geometry simplification. Original named compressed texture payloads must be restored exactly; missing payload correspondence is a hard failure. Blender can remove degenerate triangles during import/export; the actual resulting triangle counts are reported.
- Lossless constant-rest channels are removed. Animation resampling tolerance is `1e-7`; `1e-4` failed the decoded contact-pose gate and is not used.
- Independently decode packed GLB and compare every joint at start, quarters, end and authored contact for every original/new take. Required maximum is 1 mm / 0.2 degrees. This checks sampled poses, not all interpolation instants.
- Preserve original clip names/durations/endpoints, meshopt JS/WASM parity, normalized weights, 1024 maximum texture dimension, zero Khronos errors, and the 2 MB per-bot cap.
- ACE travel uses the installed hover controller's BattleReady/FableHover motion. Its incompatible legacy Run binding is rejected, not filled from Idle.
- TSUIN GuardHold is the vault-authored candidate from `2026-10-20-tsuin-guard-clips-1`; Unity's installed fallback was AttackBasic and its native blend witness remains queued. No exact shipped-guard parity is claimed.

`render_proof.py` renders decoded packed candidates, four contact/end poses, the worst sampled clamp pose, and the same action on the original weights. These are Blender Workbench skin/rig checks, not native game-lighting evidence. `make_sheets.py` produces inventoried six-cell sheets and paired worst-pose crops. Native simulator evidence and the full gate table are in `~/HolobotsVault/QA/2026-10-23-astra-lite-battle-pace/`; Unity's QA README records holds and the full test run.
