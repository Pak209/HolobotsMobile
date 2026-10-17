# Lite CPU Arena admitted flow

Integration base mobile-holocity-lite 92def49, explicitly authorized. Host contract proof is main PR #120; existing runtime lifecycle and #118 snapshots already exist on host main. This client calls only arenaMatchHost for CPU 1v1, never chargeArenaEntry/settleArenaBattle. No host runtime change or deployment.

## Source and lifecycle

ArenaScreen uses arenaMatchClient + arenaMatchFlow: explicit issue persists the request before network activity; unknown outcome retains that same request for explicit retry. Constructor/render never charges. Initial discovery is resume without ID; once known, every resume/start/settle/cancel pins the same ID. Reply identity, tier/payment binding, positive issued entrant HP, snapshot fields and terminal receipt are validated. Frozen snapshots compare recursively sorted object keys with ordered arrays, accommodating Firestore field ordering. Concurrent commands refuse; account/epoch guards discard late replies. Unmount stops the owned combat loop; foreground/continue restarts it only for the same admitted checkpoint. Sign-out cannot apply an old reply to a new account; busy state resets on controller change.

If a process dies, no authoritative in-progress combat checkpoint exists. Resume shows the admission but does not rebuild active fighters at full HP. A same-ID in-memory fight may continue; missing checkpoint requires explicit cancel/forfeit, with the UI warning that unknown HP is reported as KO. Unstarted cancellation uses the host refund. No timeout healing or silent new admission.

Host receipt alone supplies result outcome/rewards. Local simulation result is merely the trigger to submit final HP and bounded performance counts; failed settlement exposes retry for the same match. No local XP/currency/ledger writes. Each explicit new admission is one match, not the former client-created free multiround chain.

## Combat policy / remaining holds

Narrow host-snapshot mode copies host attack, defense, speed, intelligence, level, current/max HP and command stamina capacity/regen. gap_closer and break_heavy use issued damageScale and commandRules strike/combo cost and Sync gain. No local profile stat calculation, local card kit, innate ability or derived finisher. Unpublished defense/finisher extras are visibly unavailable. Generic existing CPU practice damage normalization, stamina/combo modifiers, AI cadence and timing are retained, explicitly CLIENT SIMULATION. Damage and client-reported final HP remain unverified (existing Holocity #2 finding); this does not claim server-resolved combat.

CPU migration source is implemented. Live-network integration witness remains HELD under the no-account/no-deploy lane limits. PvP still uses client-authored room fighters and remains HELD; it is not covered by #118. 3v3 entry now refuses before any charge because the host admits one fighter. No invented squad contract or PvP authority.

## Checks

Final full lite suite: 562 passed / 4 existing skips (66 files passed, 1 skipped); includes 10 controller/receipt/schema tests and 2 snapshot mode tests. TypeScript --noEmit green after final loop cleanup. Covers no-charge construction/discovery, lost issue reply same-request retry, single-flight, foreign ID/tier/payment, stale session, frozen values versus reordered keys, terminal reward replay, missing move rejection and unavailable signatures.

Typecheck attempt1: wrong existing dependency cache lacked expo-gl/three, producing only dependency/downstream diagnostics. Relinked this checkout to an existing complete lite cache; typecheck passed, no downloads. Subsequent source changes received targeted/final checks; no test failure.

## Simulator capture — HELD, two attempts exhausted

Attempt1: simulator was Shutdown. Launch tool reported app absent; simctl confirmed Shutdown. No render. Attempt2: booted existing iPhone17Pro iOS26.5 and launched cached fun.holobots.mobile.w64 PID88513 without build/install. Offline Metro bundled in15.708s. Native deep-link navigation did not select the registered Arena fixture routes; screenshots stayed on Home. Preserved diagnostics, stopped rather than rebuilding/retrying. This is NOT a round1/result witness.

QA fixture routes are implemented using the real controller with recorded throwaway replies and actual BattleArenaView / BattleResultsModal, labeled QA / SIMULATED / NO REWARDS. They do not call a real account and are not production/live fight evidence. Cached simulator harness/native/Metro files are excluded from git. Owned Metro session18718 and app88513 stopped.

Vault: /Users/pak/HolobotsVault/QA/2026-10-17-lite-arena-admitted-flow-1/. GATE_SHEET.png ≤1600; all cells inventoried, known-bad first, actual failed-capture image explicit. No editor, native/host build output, deploy, credit, device or real account.
