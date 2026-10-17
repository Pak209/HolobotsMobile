# Lite HUD level patch package

This main-based package does not install lite UI into main. It applies only to mobile-holocity-lite commit d5cc1dd012b0c8691e9f1c52f50794d4bddf5f82. Use a clean isolated checkout; never apply to shared work or a different revision.

Run `python3 apply.py --check /absolute/path/to/isolated-lite-checkout` first. The checker verifies HEAD, clean tracked/untracked state, patch checksum, every before-file checksum and git apply --check. Only after review use `--apply` instead; it repeats all guards, applies the patch, then verifies every output checksum. No commit, push, install or server launch occurs.

The patch has eleven UI/helper/test files, no dependencies/native files/assets. Full lite suite: 545 passed / 4 existing skipped, typecheck passed. Simulator known-bad / round 1 / result sheet and scope holds are in Documentation/QA/2026-10-17-lite-hud-levels-1/README.md. Own Arena active/bench/send-in badges use a verified read-only account snapshot. Opponent/PvP badges remain HELD because no issued level snapshot exists in that route.
