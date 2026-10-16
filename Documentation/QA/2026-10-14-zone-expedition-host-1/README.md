# Zone expedition host — DECISIONS #61

Host-only, isolated worktree; no editor, build of a player, deploy, production account, or currency purchase. Depends on the exact shared `duelResolver.ts` from PR #85 (no resolver copy/fork).

## Review scope and status

`holoZoneHost` adds `zone-run-3` and `zone-extract-1`. Legacy `holozone-run-1` / `-2` behavior remains available, except all activity entry/healing paths now respect an active expedition lease. The v3 loop has unlimited re-entry and no additional cooldown: energy is its throttle. This branch does not change the legacy cooldown policy or add the unmerged #81 cooldown implementation.

The implementation is fail-closed until reviewed production tuning is provided in server environment `HOLOCITY_ZONE_EXPEDITION_CONFIG`. Missing/invalid configuration hides the two new vendor listings and refuses new purchases/entries/layout with `expedition_unavailable`. Existing issued runs retain their pinned configuration and remain settleable even if configuration is removed. Account energy defaults to **0**, not a free grant.

Required JSON keys: `version` (`zone-config-…`), `energyCapacity`, `energyPackUnits`, `energyPackPrice`, `sectorEnergyCost`, `fightEnergyCost`, `extractionChargePrice`, `bandLevels` (three fixed levels; first 1, second above 1, third >=21), `cacheFragments`, `bulkySalvageUnits`, `rareBlueprintChanceBasisPoints` (0–10000). All other numeric values are positive safe integers bounded at 1,000,000; energy pack/cost cannot exceed capacity; levels cap at 99. No tuning values in the test fixtures are production recommendations or approvals.

Already approved numbers reused: **Repair Kit 250 Holos, 50% max-HP heal** (from `repairItems.ts`); one carried extraction charge maximum; **8000 ms** host-clock channel; **one protected haul slot**. Kit healing preserves exact 50%, including odd maximum HP. W10's integer resolver floors fractional current HP only at combat entry. Shared duel policy stays `duel-receipt-1`, max 120 turns and existing STA/SYNC/moveset rules.

## Contract

All mutation requests require a stable client-generated `requestId` (1–128 alphanumeric/underscore/hyphen), with immutable per-account receipts. Reusing that ID with changed fields returns `request_conflict`; identical retries return the saved reply with `alreadyProcessed:true`. Authenticated uid chooses all document paths. No client seed, health, damage, winner, price, grant, loot, or guardian claim is accepted.

`zone-run-3` requests:

- `layout`: global UTC day/seed/layout plus server configuration.
- `status`: `enabled`, account `supplies:{energy,extractionCharges}`, `repairKits`, active `run` or null.
- `buy{itemId}`: `item.expedition_energy`, `item.extraction_charge`, or existing `item.repair_kit`; town only, atomically spends Holos. New vendor listings point to this callable/request, with server prices.
- `issue{repairKits,carryExtractionCharge}`: takes 0–99 existing Repair Kits and optionally one existing charge into carried stock; requires `arenaArcBuilt`, living owned travel squad, energy, and no competing activity.
- `move{runId,sectorId}`: adjacent host route only, energy spent per crossing. Zero energy permits retreat to beacon, refuses deeper entry. A sector encounter must be cleared before crossing deeper.
- `fight{runId,playerIntents}`: explicit 1–120 `strike/heavy/defend/finisher` intents; uses host-pinned stats and private seed; spends fight energy without disabling bots at zero. Host receipt determines HP, clear/guardian flag or immediate wipe. Returned `duelReceipt` is exactly W10's `duel-receipt-1`.
- `cache{runId}`: once per cleared cache; host rolls loot from private run entropy. Ordinary fragments and one possible rare discovery fragment stack (quantity = configured `cacheFragments`) enter unbanked haul.
- `protect{runId,haulId}`: selects exactly one existing haul entry/stack.
- `heal{runId,holobotId}`: safe room, carried Kit only, exact existing Kit amount; no free healing.
- `reorder{runId,order}`: safe room, permutation of the pinned squad.
- `utility{runId,utility}`: `ace/shadow/kuma` at matching host point; requires that companion alive in pinned squad. Returns host authorization; no new combat power/reward.

`zone-extract-1` requests:

- `extract{runId,mode:'normal'}`: beacon only; banks all haul.
- `emergency_start{runId}`: consumes one carried charge atomically and starts the server clock. **Prototype restriction: no unresolved encounter in the current sector** (`encounter_pending`). All unrelated actions remain blocked during channel.
- `emergency_finish{runId}`: at least 8000 ms elapsed; earlier response is `extraction_channeling` with `details.retryAfterMs`. Banks small blueprint fragments, abandons bulky salvage. A host receipt hit interrupts a channel; raw client hit reports are rejected.
- `wipe{runId}`: voluntary abandon or automatic host combat loss; banks only the protected slot, loses other unbanked haul, returns squad at 0 HP. Never removes owned bots, permanent upgrades, or preexisting banked items.

Run view includes `runId`, public layout `seed`, `band`, `sector`, `energy`, `haul`, `protectedSlot`, pinned `layout`, host `squad/opponents`, config, carried `kits/charge`, `guardianDefeated`, revision and extraction state. Internal `privateSeed` is excluded. Layout has three fixed bands, two branches per band, safe gates/beacons, daily side-route links/cache/guardian positions and one rare-discovery cache. Layout is identical for all accounts on that UTC day; issued runs pin it across midnight. Private per-run entropy makes loot/combat independent of the public daily seed.

Terminal receipt: `{schemaVersion:'zone-extract-1',runId,outcome:'normal'|'emergency'|'wipe',closedAtMs,banked,lost,guardianDefeated,finalVitals}`. Normal/emergency/wipe races choose one immutable outcome and bank once. Terminal replay cannot restore inventory twice. Unspent carried kits and an unused carried charge return to account inventory on all terminal outcomes. Spent charges are never refunded.

Banked ordinary and rare-discovery fragments increment existing `itemStocks.blueprint_fragment` for Workshop crafting. `expeditionBank` records rare-discovery fragment count, bulky salvage count and guardian achievement; bulky salvage has no sale/service reward. `expeditionSupplies` and `expeditionBank` are client-write denied on create/update. Runs, entropy, request receipts and shared lease live under existing server-only `holoZoneRuns/{uid}`. No mid-run bank.

## Refusals and migration

Validation/availability: `invalid_request`, `invalid_intents`, `unknown_item`, `unavailable`, `expedition_unavailable`, `request_conflict`, `unknown_run`, `run_closed`.
Admission/economy: `arena_arc_required`, `squad_required`, `holobot_ko`, `no_energy`, `no_kit`, `no_extraction_charge`, `not_enough_holos`, `energy_full`, `stock_full`, `activity_conflict`, `expedition_open`.
World: `invalid_route`, `sector_not_cleared`, `safe_room`, `safe_room_required`, `already_cleared`, `no_cache`, `already_looted`, `unknown_haul`, `not_in_squad`, `already_full`, `no_utility`, `companion_required`, `beacon_required`, `encounter_pending`, `extraction_in_progress`, `extraction_not_started`, `extraction_channeling`.

Existing Arena/rival/duel/zone entry and external Workshop/item healing observe the same expedition lease inside their transactions. Expired wall time does not silently release an expedition. Legacy schemas cannot settle a v3 run or write HP/rewards during it. Existing same-request receipts remain read-only replayable. No schema downgrade or client-selected resolver mode.

## Evidence

Known-bad first: deployed `validateHoloZoneCommand` rejects `zone-run-3`; new strict routing accepts it. First new pure run: 7/13 passed, six assertions used a wrongly anchored error string matcher (`Error: code` versus `code`). The matcher was fixed; inspection also tightened zero-energy revisits. Approved two-attempt limit was respected. Review added concrete Workshop-fragment banking, odd-max-HP healing, requested reply aliases, and malformed-state cases.

Current build/shared and unit results: `npm run build` / `check:shared` green; **169 passed, 1 existing optional historical pre-Zell-baseline skip**. New expedition pure tests: **17 passed**. Exact shared resolver comparison remains unchanged from dependency.

First functional emulator: **60/62 passed in81.67s**, all10 new expedition cases passed; two legacy Arena migration fixtures still issued resolver battles but sent legacy `didWin`. Their helper now explicitly selects the server migration fixture mode, matching the reviewed #86 test seam. Second functional emulator: **64/64 passed in80.30s** (12 expedition cases plus52 Arena/legacy-zone/KO regressions). Final targeted review gate: **14/14 passed in 21.74 s**. Emulator uses demo throwaway uids only, Firestore 18086/websocket19186/hub14401/log14501, Java heap1GB and 300-second process-group guard. Initial sandbox launch exited before tests in2.28s (localhost EPERM); escalated local launch is the functional test run.

## HELD

- Production tuning/configuration, merge/deploy approval. No deploy performed.
- Real-time mid-fight escape: this prototype permits emergency channel only after the current host encounter is cleared. Future live encounter hits must be host-authoritative; no unapproved turn-to-seconds rule was invented.
- Guardian13 asset and final stats/identity. Current guardian is explicitly an existing WOLF-curve placeholder at configured band3 danger; no 13th bot or blueprint is granted.
- Cosmetic/title identifiers and their grants, salvage services, display shelves and NPC reactions. Guardian achievement flag is recorded; `holoZonesArcBuilt` remains unchanged.
- Native Unity presentation, pacing (15–25min target), telegraphs and scene integration. No editor was used and no scene was saved.

Final review also reserves a new request ID used to replay a closed run, preventing later mutation reuse. The actual callable now maps recognized shared health/story/ownership/activity errors to documented rejection codes (KO remains `holobot_ko`), while unexpected exceptions stay internal. Final targeted expedition emulator: **14/14 passed in 21.74 s**, including the two review cases. Final ports were checked after shutdown; no lingering emulator listener remained.
