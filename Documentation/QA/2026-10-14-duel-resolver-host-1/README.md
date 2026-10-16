# duel-resolver-host-1 — host-authoritative rival receipts

Rationale: [P1 combat authority finding, Holocity PR #2](https://github.com/Pak209/Holocity/pull/2). The earlier path accepted `didWin`; the same issued battle could pay 100 or 25 Holos according to the first client claim. Resolver mode now pays from a host simulation using the persisted issue snapshot. No deployment, production account, credits, editor or scene operation occurred. Work used an isolated worktree and demo emulator throwaway pilots.

## Contract

The existing `rival-battle-1`, `-2`, and `-3` outer projections remain. Additive nested contracts:

- Issue `duel`: `{mode:"resolver", schemaVersion:"duel-receipt-1", maxRounds:120, player:[DuelFighterStats], opponent:[DuelFighterStats]}`. The stored `duel.input` also pins a private unsigned 32-bit seed, generated outside transaction retries. The seed is absent from issue metadata; the older `encounter.seed` is an independent presentation seed.
- Settle accepts `playerIntents`, an explicit list of 1–120 `strike | heavy | defend | finisher` strings. A shorter list repeats for the full simulation. Missing/empty/invalid/oversized lists refuse `invalid_request`; no automatic player plan is inferred at this public boundary.
- Settle adds `duelReceipt`: `{schemaVersion:"duel-receipt-1", seed, winner:"player"|"opponent", reason:"knockout"|"round_limit", rounds:[], playerFinal:[], opponentFinal:[]}`. The private seed is revealed only in the final receipt.
- `rounds` are chronological action rows, at most 240 for 120 two-sided turns. Each row has `{round, side, attacker, defender, move, moveId, requested, hit, damage, defenderHpAfter, staAfter, syncAfter, refusal?}`. Required playback fields are attacker/move/hit/damage/defenderHpAfter/staAfter. `staAfter` is after intent spending, before end-turn regeneration. A failed action records `wait`, zero damage, `hit:false` and `insufficient_stamina`, `sync_not_ready`, or `knocked_out`.
- Final fighter rows are `{holobotId,currentHealth,maxHealth,stamina,maxStamina,sync}`. Fighter inputs pin `{holobotId,level,tier,maxHealth,currentHealth?,attack,defense,speed,maxStamina,staminaRegen,moveset}`. Move rows pin `{moveId,staminaCost,damageScale,syncGain,syncCost,staminaRestore,guardReduction,source}`.

The pure `resolveDuel` API accepts 1–3 fighters per side to preserve existing rival squads; a tournament caller uses one Holobot on each side. Fighters enter in issued order as previous fighters are knocked out. Only the trusted pure API may omit intents for CPU-vs-CPU. The public rival host always requires them. `duelFighterFromCombatant` is shared with the tournament lane.

The host ignores claimed `didWin`, damage, stats, seed, HP, fielded IDs and resolution mode. XP participants are derived from actual receipt rows; benches receive no invented credit. Final HP comes from the receipt. Mode, seed and stats are pinned at issue; later profile edits and server rollout flag changes cannot alter a resolver battle. Settlement, receipt, HP, reward and cooldown are committed together. Duplicate/concurrent settles replay the exact original receipt, including when new/missing/invalid intents are supplied, and write no second grant.

Resolver issues require an owned travel squad (`squad_required`) and use the existing single health-run guard (`too_many_open`). They pin authoritative health even if a client omits `healthSchema`. Existing 40% KO recovery at issue is preserved. No scene/client health authority is added.

## Combat policy and numbers

This is a bounded host combat model, not a claim of equivalence to current Unity animation timing. Host level/tier/stats and issued named move damageScale are copied into each snapshot. The host command profile supplies STA costs because presentation combatants still contain the older STA110/regen16 values. Current command profile: max STA7, regeneration0.5 per turn, strike cost1/SYNC+10, heavy cost2/SYNC+14, defend cost0/restore2/SYNC+6/50% guard, finisher cost4/SYNC100. Guard applies for one turn; STA/SYNC never exceed their maxima or go below zero.

Mapping: strike uses an issued `strike` or `gap_closer` scale; heavy uses `heavy` or `break_heavy`; finisher uses `finisher` or `full_finisher` when supplied. Missing strike/heavy scales use explicit v1 fallbacks1/1.55. A missing finisher derives issued heavy scale ×2 (fallback3.1), marked `derived-host-heavy`. Each move records provenance; named move scales (including tier tuning when present on main) are never silently replaced by a global scale. Command costs/guard/regen are pinned from host `commandRules` (or the existing host profile for legacy payloads).

Damage is floor((attack × move scale × seeded variance − defense ×0.5) × guard multiplier), minimum1 for an executable attack, capped at remaining HP. Seeded variance spans0.9–1.1. Speed × variance selects initiative; exact ties use seeded randomness. CPU defends below strike cost, uses a charged affordable finisher, otherwise uses the documented seeded policy (20% defend branch; an additional low-STA defend branch below60%; heavy below60% when affordable, otherwise strike). Intents/STA are committed at turn start; the fighter knocked out before its action records refusal. End-turn regen follows both actions. After120turns the higher remaining squad HP fraction wins; exact ties use the seed. There is no unbounded loop or client damage parameter.

Economy unchanged: win100 Holos, loss25, existing20-second anti-farm threshold, daily first-win1 Light Buddy Unit, existing XP/patch grants and5-minute same-rival cooldown. No new economy number.

## One-release migration

- New issues default to legacy until Pak says “flip”. Only `HOLOCITY_RIVAL_ISSUE_RESOLVER=1` in `functions/.env` enables resolver issues. Clients cannot set it.
- Old untagged or explicitly legacy records remain settleable for one release using their old `didWin` path by default. Set `HOLOCITY_RIVAL_ALLOW_LEGACY_DIDWIN=0` to close that path; refusal is `legacy_settlement_disabled` (failed-precondition). Already settled receipts remain replayable.
- Remove this migration path in the next release after the existing2-hour open-battle TTL drains and the client sends intents/plays receipts. No caller can downgrade a stored resolver record. Existing old clients without intents cannot settle a new resolver battle; the resolver flip remains held for coordinated rollout.

New `squad_required` and `legacy_settlement_disabled` refusals map to failed-precondition. Existing invalid_request/unknown_battle/battle_expired/too_fast/activity_conflict/cooldown behavior remains. The historical pre-Zell comparison fixture deliberately selects legacy issue mode; the optional historical compiled-build comparison is skipped when no baseline is supplied.

## Verification

- `npm run build` and `npm run check:shared`: green (3 byte-identical shared modules).
- `npm test`: 152 passed, 0 failed, 1 historical baseline-build skip; includes8 resolver tests. Registered in Functions CI after build.
- 1000 seeds for all100tier pairs (100,000 simulations): deterministic bounded results, no HP/STA underflow, stronger-tier sanity. Matrix in `tier-pair-seeds.json`; same-tier player wins459–464/1000. This is a sanity measurement, not a balance or Unity damage/min acceptance claim.
- First broad pure regression run needed the legacy fixture's explicit migration setting; after correcting that fixture, all controls flag107/107 perturbations.
- Emulator attempt1:45/46pass in45.33s; all10new resolver cases passed. Existing health fixture reissued at34s, only4s after its settle, violating the existing5-minute rival cooldown. Fixture now reissues at330000ms (the expiry boundary).
- Emulator attempt2:46/46passed (all10new resolver cases plus36regressions),40.13s test duration. Dedicated loopback Firestore18086, websocket19186, hub14401, logging14501; 1GB JVM and300-second process-group timeout with SIGTERM/SIGKILL cleanup. Only demo/throwaway pilots.

Held: deployment, production use, and client receipt playback/real-time presentation parity. All unrelated holds remain. The broader Unity autonomous-damage and measured duel-duration acceptance in PR #2 is not claimed resolved by this source-only host delivery.

## Producer migration correction — 2026-10-15

Rebased on main `1d6744ee76c574a2868eb2f8d34613525e577a30`. PR #82 merged into the already-merged economy branch, so its two rank commits remain included as dependencies here; no economy ancestor is duplicated.

Default environment now issues legacy and settles without intents. `HOLOCITY_RIVAL_ISSUE_RESOLVER=1` is the sole production opt-in for new resolver issues. `HOLOCITY_RIVAL_ALLOW_LEGACY_DIDWIN` is unchanged. Existing resolver issues stay pinned through rollback; receipt replay remains exact.

- `npm --prefix functions run build`: passed, including `check:shared` (3 files).
- `npm --prefix functions test`: 156 passed, 0 failed, 1 historical baseline skip.
- Dedicated demo emulator: `test-duel-resolver-emulator.mjs`, `test-pilot-rank-emulator.mjs`, `test-economy-host-2-emulator.mjs`: 31/31 passed, 18.450 s test duration / 22.831 s wall, 300 s cap, 1 GB JVM. First correction validation attempt passed.
- New coverage: absent env issues legacy and settles both old/new records; explicit resolver env issues and settles a full receipt, refuses missing intents after rollback and replays exactly.
- No deploy, production accounts, editor activity or rollout flip. The Unity migration and explicit Pak “flip” remain held.
