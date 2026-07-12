# Arena 3v3 Showdown — Design & Implementation Plan

Status: Phases A+B IMPLEMENTED (PvE); Phase C (PvP) pending
Decisions taken: entry = 1x tier fee with one server settlement per enemy KO
(economically identical to a 3-round run — no server changes needed); full
send-in freeze; bench meter frozen; mode blocked under 3 owned Holobots.
Companion docs: `arena-card-to-move-implementation-plan.md`, `arena-move-system-testing-guide.md`
Scope: PvE (CPU teams) and realtime PvP, built on the converged ArenaCombatEngine

## 1. Concept

A team battle mode: each side brings **three Holobots, one active at a
time**, rotating Pokémon-style. The 1v1 combat everyone already knows is
untouched — same moves, meters, traps, guard stacks, and rule bends — but a
second strategic layer sits above it: **who is in, who is resting, and when
you pay the tempo cost to rotate**.

The mode works because the existing systems already interlock with
rotation:

- **Rule bends become matchup picks.** GAMA walls a charged signature;
  ACE opens safely into a trap-turtle; WOLF stays in gassed when anyone
  else would have to rotate; KURAI closes games from behind. Team select
  becomes a counterpick mini-game before the first hit lands.
- **The offense-only meter becomes rotation currency.** Meter persists on
  the bench but does not build there — rotating out preserves your banked
  finisher but stops your progress. TSUIN farming meter then benching to
  protect it is a real strategy; so is pressuring a fresh entry before it
  earns anything.
- **Guard stacks and traps anchor the switch counterplay.** Switching
  drops your armed trap and resets your chain and stacks (consistent with
  "attacking drops your guard") — so a defensive setup is a commitment,
  and forcing a turtle to rotate wastes their investment.
- **Stamina is the rotation engine.** Benched fighters keep regenerating
  (+1/2s), so rotating a gassed fighter out is genuinely restorative — the
  strategic reason to switch even without a matchup reason.

## 2. Core rules

### Team
- 3 distinct owned Holobots, ordered (lead + bench x2) at team select.
- Each brings its own saved Move Lab kit, ranks, ability, and signature.

### Rotation
- **Switch is a command** (like a move): available any time your side is
  actionable, gated by a **switch cooldown (10s per side)** and an
  **entry lock (1.5s)** during which the incoming fighter cannot act
  (both prevent swap-spam).
- Switching is a *retreat*: the outgoing fighter's **armed trap is
  dropped, combo chain and guard-stack streak reset**. HP, stamina,
  special meter, spent one-shot bends (ACE pierce, KURAI lifesteal
  budget), and move cooldown timestamps persist on the fighter.
- **Bench state:** stamina regenerates at the normal rate; special meter
  neither builds nor decays; **no HP recovery** (damage is permanent
  pressure — prevents stall).

### Knockouts
- A KO'd fighter is out for the match.
- On KO, the battle enters a brief **SEND-IN phase**: combat freezes for
  both sides, the KO'd side picks the replacement within **5 seconds**
  (auto-picks the next in order on timeout). The survivor does not get
  free hits during send-in; the incoming fighter arrives under the entry
  lock.
- Win = all three opposing Holobots KO'd.

### Everything else is unchanged
Stamina costs/regeneration, flat meter gains, 4/7 and 7/7 finishers,
time-based defense cooldowns, guard stacks, abilities, and move ranks all
behave exactly as in 1v1 — per fighter.

## 3. Why it's engaging (the matchup web)

| Situation | Rotation answer | Counter-answer |
|---|---|---|
| Opponent banks a full signature | GAMA in (20% max-HP cap eats it) | Hold the signature, chip GAMA down |
| Trap/stack turtle (HARE/SHADOW/TORA) | ACE in — first attack pierces | Re-arm after the pierce is spent |
| Your fighter is gassed | Rotate out to regen | WOLF stays in and punishes at full power |
| Fresh entry just arrived | Pressure it before it builds meter | WAKE enters at full tank with discounted moves |
| You're down to your last bot | KURAI closer — lifesteal below 40% | Burst it through the 30 HP heal budget |
| Opponent rotates constantly | Chains/stacks punish their resets | ERA never resets below 25 meter anyway |

Every existing bend gains a second meaning in team context without a
single new ability. That's the sign the mode is pulling its weight.

## 4. Architecture: a team layer ABOVE the engine

**Do not modify ArenaCombatEngine's 1v1 semantics.** Add a wrapper that
owns rosters and feeds the engine one active fighter per side — the same
adapter discipline used for the card-to-move migration.

```ts
type TeamFighterSlot = {
  fighter: ArenaFighter;        // full persistent state incl. abilityRuntime
  moves: ActionCard[];          // resolved kit
  isKnockedOut: boolean;
};

type TeamBattleSide = {
  slots: [TeamFighterSlot, TeamFighterSlot, TeamFighterSlot];
  activeIndex: 0 | 1 | 2;
  switchCooldownUntil: number;  // timestamps, like defense cooldowns
  entryLockUntil: number;
};

type TeamBattlePhase = 'active' | 'awaiting_send_in' | 'completed';

type TeamBattleCommand =
  | { type: 'use_move' | 'use_signature' }   // existing commands, active fighter
  | { type: 'switch_active'; toIndex: 0 | 1 | 2 }
  | { type: 'send_in'; toIndex: 0 | 1 | 2 }; // during awaiting_send_in only
```

Key mechanics of the wrapper:
- Builds the engine `BattleState` from the two active fighters; after each
  engine resolution, writes the fighters back into their slots.
- Intercepts the engine's `completed` status: if the KO'd side has bench
  remaining, the team phase becomes `awaiting_send_in` instead.
- Applies bench stamina regen on the store's existing 2s tick (all
  non-KO'd benched fighters).
- Applies the retreat rules (drop trap/chain/stacks) on switch-out and the
  entry lock on switch-in.

### PvE (CPU teams)
- New Arena mode alongside tier runs: **3v3 Showdown** per tier — the CPU
  team is the tier's three lineup opponents at once instead of sequential
  rounds.
- CPU rotation policy (data-driven, same style as `selectAICommand`):
  1. Forced send-in: pick the best matchup vs the player's active bend.
  2. Voluntary switch when: active below 25% HP with a healthier bench,
     active gassed with WOLF not on the field, or the player's active is
     hard-countered by a benched bend (small data table of bend matchups).
  3. Otherwise fight with the existing 1v1 AI.
- Entry & rewards: one entry fee at ~2.5x the tier fee, rewards ~3x base
  (it replaces a 3-round run). Settlement reuses `settleArenaBattle` with
  a mode multiplier — small server change, rides the scoped deploy.

### PvP
- Room schema v3 (mode-tagged): each player entry becomes
  `{ team: PvpFighterDoc[3], activeIndex, switchCooldownUntil,
  entryLockUntil }` plus a room-level `phase` for send-ins.
- All commands remain single-writer Firestore transactions through the
  shared engine (existing convergence pattern); `switch_active` and
  `send_in` are new transaction types that only touch the actor's side.
- Send-in sync: room `phase: 'awaiting_send_in'` blocks both sides'
  move transactions; a `sendInDeadline` timestamp lets EITHER client
  commit the auto-pick if the chooser disappears (same self-healing style
  as matchmaking).
- Matchmaking: pool entries gain `mode: '1v1' | '3v3'`; the claim
  transaction only pairs identical modes. `rulesVersion` bumps to 3 for
  3v3 rooms; 1v1 rooms are untouched.

## 5. UI plan

- **Team select (prebattle):** three slots with the existing holobot
  picker; each slot shows the bot's kit summary, ability, and signature.
  Lead order = slot order. Invalid teams (duplicates, unowned) blocked.
- **Battle HUD:** the existing 1v1 HUD for the two active fighters plus
  **bench chips** under each side's HUD — portrait, HP sliver, meter
  sliver, KO cross-out. Tap your own bench chip to switch (shows the
  switch cooldown as a radial/opacity, mirrors the defend CD pattern).
- **Send-in overlay:** on KO, a 5s picker (two cards + countdown) for the
  KO'd side; the other side sees "opponent choosing…".
- **Results:** existing rewards modal + per-fighter damage/KO line; run
  totals section reused as-is.
- Reuse, don't fork: `BattleArenaView` gains a `bench` strip prop;
  `PvpArenaModal` reuses the same bench chip component.

## 6. Delivery phases

| Phase | Scope | Est. |
|---|---|---|
| **A — Team battle core (PvE)** | Team wrapper (switch/retreat/bench regen/KO send-in/win), CPU rotation policy, full engine-level test suite (switch-spam, stall, KO edge cases, bend persistence across switches) | 3–4 d |
| **B — PvE mode + UI** | Team select, bench chips, send-in overlay, 3v3 tier config, entry/reward settlement multiplier (server: one function change + scoped deploy) | 3–4 d |
| **C — PvP convergence** | Room schema v3, mode-gated matchmaking, switch/send-in transactions with deadline self-healing, two-device tests | 4–6 d |
| **D — Balance & polish** | Switch CD / entry lock tuning from device play, CPU matchup table tuning, testing-guide section, telemetry counters | 1–2 d |

Recommended order: ship A+B behind the Arena menu as PvE-only first (it's
independently fun and de-risks the send-in flow), then C.

## 7. Design risks & mitigations

| Risk | Mitigation |
|---|---|
| Switch-spam degenerate play | 10s side cooldown + 1.5s entry lock + retreat costs (trap/chain/stacks lost) |
| Infinite stall by rotation | No bench HP recovery; meter frozen on bench; damage is permanent |
| Send-in desync in PvP | Room phase + deadline timestamp; either client can commit the auto-pick |
| Matches too long | ~3x rewards; meters persist so late-game finishers accelerate; cap match at soft timer with HP% tiebreak (reuse maxTurns hook) |
| GAMA/turtle teams too safe | Already mitigated by offense-only meter; watch telemetry, tune the 20% cap if needed |
| Old clients joining 3v3 rooms | rulesVersion 3 + mode-gated matchmaking (same pattern as v2 gating) |

## 8. Open decisions for Pak

1. **Entry pricing** — 2.5x fee / 3x rewards is a placeholder; call it.
2. **Send-in freeze** — proposed: full freeze for both sides (fair,
   Pokémon-like). Alternative: survivor keeps regenerating stamina only.
3. **Bench meter** — proposed: frozen. Alternative: slow decay (-1/4s) to
   punish benching a charged bot; adds pressure but more rules to read.
4. **Roster minimum** — players with fewer than 3 Holobots: block the mode
   or allow 2v3 underdog entry with a reward bonus?
