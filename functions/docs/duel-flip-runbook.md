# Rival resolver flip — operator runbook

**Status: preparation only; Pak authorizes and performs the production flip.** Requires [host PR #85](https://github.com/Pak209/HolobotsMobile/pull/85) landed and built. This PR changes neither environment files nor deployed functions. `rival-battle-3` wraps `duel-receipt-1`; the client cannot choose issue mode.

## Ship Unity first

Complete [Holocity PR #5's presentation brief](https://github.com/Pak209/Holocity/pull/5): mode-aware DTOs, command-tile **batch** `playerIntents` (1–120 strike/heavy/defend/finisher strings at settle; short plans repeat), and receipt-only playback. There is no live per-round host API. Use `duel.player/opponent` snapshots, not optional `playerCombatants`; reject unknown modes/schemas instead of falling back. Play receipt rows in host order, including wait/refused actions and duplicate round numbers; use host HP, STA/SYNC, final state and winner. Disable autonomous damage/HP/winner writes and DamageFrame authority during playback. Retry the same battle and deduplicate receipt/reward presentation. Preserve legacy handling for old issues. Producer native tests and a complete receipt capture must pass, including KO, round limit, multi-bot transitions, refusal and replay. Plan-entry UX/art choices still require producer acceptance; this runbook does not approve them.

## Emulator gate (repository root; disposable local data only)

Build the landed host (`cd functions && npm run build`, then return to root). Run:

```sh
GCLOUD_PROJECT=demo-holobots-duel-flip rules-tests/node_modules/.bin/firebase emulators:exec \
  --project demo-holobots-duel-flip --only firestore \
  'node --test functions/scripts/smoke-duel-flip.mjs'
```

The script refuses non-demo projects or non-loopback Firestore endpoints **before loading Admin**, creates random `flip_smoke_*` pilots, invokes real callable handlers locally and cleans up only its own documents. It does not use Auth credentials, an existing pilot, or a deployed callable. Three tests cover unset/0/true legacy issues, legacy settlement after flip, exact `1` resolver issue/settle, tampered outcome/damage, replay without payment, rollback with a pinned open resolver battle, and a new legacy issue. It ages only emulator fixture timestamps for the 20-second win gate. This is handler + Firestore coverage, not deployed HTTPS/Auth/App Check validation. For pre-merge review only, `DUEL_FLIP_HOST_ROOT=/absolute/path/to/compiled/functions` may select a separately built #85 checkout; omit it after landing.

## Flip (manual, only after approval)

1. Record host SHA, shipped Unity version, emulator result and prior environment value. Check `functions/.env` and project-specific `.env.holobots-24046` for conflicting overrides; make the effective value unambiguous. Do not commit environment files.
2. Set **`HOLOCITY_RIVAL_ISSUE_RESOLVER=1` in `functions/.env`**. Only the exact string `1` enables resolver issues; unset, `0` and `true` are legacy. Leave `HOLOCITY_RIVAL_ALLOW_LEGACY_DIDWIN` unchanged (legacy settlement remains enabled unless exactly `0`).
3. From repository root, deploy only the owner function:
   `firebase deploy --project holobots-24046 --only functions:rivalBattleHost`
   Never use bare `--only functions`: this project shares functions with another repository (see [functions README](../README.md)).
4. Verify a newly issued battle reports `duel.mode=resolver`, settle returns `duelReceipt.schemaVersion=duel-receipt-1`, outcome/rewards follow the receipt, and a retry reports `alreadyProcessed:true` without paying again. Stop rollout on mode, receipt or replay failure. Production verification/account selection requires Pak's separately approved operational procedure; the supplied smoke never targets production.

## Rollback

Remove `HOLOCITY_RIVAL_ISSUE_RESOLVER` from `functions/.env` **and any effective project-specific override**, then run the same scoped deploy command. Merely unsetting the terminal variable does not remove dotenv configuration. Verify new issues are legacy. Issue mode/snapshots are pinned: open resolver battles **still require intents** until settled or expired (2-hour TTL); settled receipts remain replayable. Retain receipt-capable Unity through that drain and for replay afterward. Open legacy battles also stay legacy across a flip. Do not disable legacy settlement as part of this operation. Wins under 20 seconds refuse `too_fast`; earlier losses can settle but pay zero Holo/XP. These gates, cooldowns and existing 100/25 rewards do not change.
