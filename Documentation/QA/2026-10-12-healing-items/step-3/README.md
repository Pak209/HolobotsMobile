# Step 3 — free Workshop squad heal
Known-bad.log first: missing callable. Candidate emulator.log retained a stale 150-HP KUMA expectation; actual host max is 200. Corrected fixture emulator-02.log: 4/4 including account deletion regression. Build/check:shared pass. No further run.

Instant free 100% heal for the owned travel squad (max 3); authoritative current combat stats supply maxima (fixture ACE 150, KUMA 200). Non-squad WOLF unchanged, 500 Holos and all stocks unchanged. Replay/concurrent requests cannot mutate twice. Missing health is initialized from stats; malformed existing health fails closed. Empty or foreign-owned squad refused. Open rival/zone/duel refuse battle_open; Arena refuses arena_no_heal. All guards and ledger write share one transaction. No server-verified NPC proximity claim, sim or multiplayer work.

Depends on PR #74 Arena/duel guards, itself held for step 2's fixture validation. This step's own tests pass; deployment remains held with dependencies. New workshopHeals receipts are default-denied and included in account cleanup. City 40% issue unchanged; no deploy, production or Pak account calls. Shared dirty files untouched.
