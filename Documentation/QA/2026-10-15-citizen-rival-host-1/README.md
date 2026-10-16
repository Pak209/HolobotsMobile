# W19 citizen-rival-host-1

Host-only correction, stacked on resolver PR #85 (`3e9af4ff58616867785deddecdb0bdf295aba1d5`). No Unity edits, editor use, deploy, production accounts or credits.

## Contract

The actual Unity request (`RivalBattleClient.ArenaGathering.cs`) is:

```json
{"schemaVersion":"rival-battle-3","operation":"issue","healthSchema":"rival-health-1","storySchema":"arena-gathering-1","rivalId":"<roster citizenId>"}
```

The real host already accepts the roster citizen and binds its assigned bot. The mismatch was the optional `playerCombatants` array: the stand-in removes it and the host did not. The host now removes it only from a gathering issue projection, after pinning host vitals and resolver fighters. Ordinary rival replies retain it. No schema version bump; an existing optional field is omitted for this route.

Issue keys: `schemaVersion`, `battleId`, `expiresAtMs`, `tier`, `encounter`, `status`, `duel`. `encounter.opponentPilot` uses the existing wire keys `{pilotId: citizenId, displayName: pilotName, tier: "Rookie"}`. These are deliberately the shipped contract keys, not renamed `citizenId`/`pilotName`/`rank` fields. The roster itself still uses those latter names. Opponent stats retain the account's existing rival difficulty tier; as #80 specifies, Rookie is the presentation label, not a new difficulty reset. Tests exercise a 90-rival-win account to prove this.

No server flip: unset `HOLOCITY_RIVAL_ISSUE_RESOLVER` yields `duel.mode=legacy`; only `1` opts new issues into resolver. `duel.player` and `duel.opponent` remain available under the explicit resolver flag, and settlement still rules from pinned fighters/receipts.

Unity's current optional-block handling (`RivalBattleContract.cs:329–351`, `:475–487`) accepts the absent player block, retains its local player presentation payload, and ignores the additive `duel` field. Consequently the existing Unity gathering legacy path does not submit fielded/health snapshots derived from this omitted block. This migration limitation is preserved, not represented as authoritative combat; the future receipt presentation lane must migrate before the resolver flip. The test covers both Unity's minimal didWin settle and the supported health-aware settle. No Unity code changed.

Rewards and cooldown are unchanged: 100 Holos win / 25 loss after the existing 20,000 ms anti-farm window; 300,000 ms per-citizen cooldown after settle, with `details.retryAfterMs`. Replay pays once and does not move the cooldown. The tests age only their own throwaway battle fixture to avoid wall-clock sleeps.

## Evidence

- Known-bad first: real callable emulator regression on the prerequisite host: 1 passed / 3 failed, all failures the unwanted `playerCombatants` key (`known-bad.txt`).
- Corrected combined emulator: 32 passed / 0 failed across citizen, existing gathering/tournament/rules, and rival regressions (`emulator.txt`).
- Final exact-key/minimal-settle fixture check: see `final-targeted.txt` (4 cases).
- `npm --prefix functions run build`: green; its `check:shared` reports 3 shared files in sync.
- `npm --prefix functions test`: 156 passed / 0 failed / 1 existing skipped (`units.txt`).
- Loopback Firestore only, dedicated port 18089, project `demo-holobots-citizen-rival`, each invocation bounded at 300 seconds. No cloud services/emulator auth account used; `.run` calls the real callable handler with throwaway authenticated UIDs.
- Test guards reject other ports/project IDs. Run `npm --prefix functions run test:citizen-rival` only against that local demo emulator.

The combined suite installs the repository rules for its negative client-rules cases; their permission-denied logs are expected. Initial emulator configuration warning about permissive defaults is limited to the Admin-backed isolated demo harness. No rules were changed.

## Holds

Deploy and resolver flip remain held. Runtime presentation and device validation belong to their existing lanes. No new economy numbers or Player-account migration.
