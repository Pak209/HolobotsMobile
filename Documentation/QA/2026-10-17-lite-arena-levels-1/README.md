# Lite Arena levels — bounded presentation preparation

Integration base mobile-holocity-lite b54bc59 (merged #117), explicitly approved. This adds a strict #118 issued-reply level adapter, an optional BattleArenaView prop seam, and signed-out fixture routes. **It does not close either live hold from #117.** No live admission/settlement call changes.

## Authority boundaries and remaining holds

CPU Arena is still legacy: `mobile/src/lib/arenaClient.ts:12` calls chargeArenaEntry, returning only balances. `mobile/src/screens/ArenaScreen.tsx:191` charges that route; lines194–199 construct local fighters. There is no arenaMatchHost/tournamentBracketHost transport in lite. Calling a new issue merely for a level could double-charge or create an unrelated admission. LIVE ARENA opponent levels therefore remain HELD until a scoped durable host-flow migration supplies the already-admitted reply. #118 was open/not deployed at census; nothing here assumes deployment.

PvP is independently client-authored: `mobile/src/hooks/useRealtimeArena.ts:135` builds a fighter from profile using buildPvpFighterDoc; createRoom at256 writes lineup into the room (players at279). `mobile/src/features/arena/pvpBattle.ts:76` copies that client fighter level. #118 covers CPU Arena/tournament, not PvP. LIVE PVP remains HELD pending an authoritative opponent snapshot contract. No backend work or local/profile/XP/rank/default-level fallback is invented.

## Prepared seam

BattleArenaView accepts optional hostMatchReply plus hostMatchId. The adapter requires arena-match-1 at both reply/match, exact expected host match ID, explicit alreadyProcessed, recognized state, correct side and fighter identity, canonical displayName, integer tier 0–1000000 and integer level1–99. Missing/old/mismatched data hides the badge. It never accepts a raw combat DTO or PvP room. Own-player account behavior from #117 remains intact. No live caller passes the new props yet.

The QA fixture is copied from #118's actual throwaway emulator issue: ACE45, HARE12. It uses the real BattleArenaView and existing portrait lookup, static combat values, no engine inputs, no charging or settlement. Routes ArenaHostLevelsKnownBad and ArenaHostLevels are only in the existing opt-in development preview; both show QA / SIMULATED / NO REWARDS. Empty action-card slots are intentional: this is a level-source witness, not combat-flow acceptance.

## Checks and evidence

Before the final tier-bound guard: full lite suite **549 passed / 4 existing skips**. Final focused suite **5/5 passed** and TypeScript typecheck green after adding the schema tier upper bound; no UI behavior changed for the captured tier-0 fixture. Tests prove local/PvP known-bad rejection, exact match/side mapping, missing/invalid/old-host hiding, terminal-reply retention. No new dependencies or native build.

Capture attempt1: level seam worked, but fixture inherited cityCombatantFighter's empty avatar, causing warnings/toast and missing HARE image. Preserved as failed visual setup. Corrected fixture only through getHolobotFullImageSource, no runtime card-layout change. Second/final capture uses the same cached Debug app, iPhone17Pro iOS26.5, offline localhost Metro. Second/final capture passed: both portraits present, no empty-avatar warning/toast; HARE LV12 appears only with the host reply. No further retry.

Evidence vault: `/Users/pak/HolobotsVault/QA/2026-10-17-lite-arena-levels-1/`; GATE_SHEET.png is 1000×1000, both cells inventoried (known-bad first, candidate second). No editor, deploy, credits, real account or physical device. Scratch index/Metro URL scheme changes and cached native harness are excluded from git. Own server/app stopped after captures.
