# Arena Move System — Device Testing Guide

Covers PR #14 (`feat/arena-move-kits`): the card-to-move conversion (plan
Phases 0–3) plus the real-time combat fixes and the marketplace Parts shop
that stacked on the same branch.

## Setup

1. `git checkout feat/arena-move-kits && git pull`
2. Rebuild in Xcode (Debug builds also need Metro running + a JS reload).
3. Optional but recommended — deploy the two new callables so the Move Lab
   uses server authority instead of the client fallback: run the scoped
   deploy command from `functions/README.md` (now **18** functions, adds
   `upgradeHolobotMove` and `saveHolobotCombatKit`). Never run a bare
   `firebase deploy --only functions`.

Until deploy, everything still works via the local fallback path — the same
pattern the marketplace used pre-deploy.

## 1. Battle kit composition

- [ ] Enter any PvE arena tier. The tray shows exactly **four moves in this
      order: STRIKE, DEFEND, COMBO, FINISHER** (red / blue / cyan / gold).
- [ ] The four moves never shuffle, cycle, or change mid-battle.
- [ ] With no Move Lab kit saved, slots come from your saved Inventory deck
      order, then owned cards, then the stock kit (Quick Jab / Guard Up /
      Chain Burst / Tactical Override).

## 2. Special meter and the two finishers

- [ ] The gold gauge above the tray starts at `✦ 0/7` every battle and has a
      small dark tick at the 4/7 position.
- [ ] Below 4/7 the FINISHER slot is dimmed with `NEEDS METER`.
- [ ] At **4/7** the slot lights up. Playing it deals its damage and **empties
      the whole meter** back to 0/7 (early, lower-damage cash-out).
- [ ] At **7/7** a gold button appears on the gauge showing your Holobot's
      signature move name (ACE → "1st Strike", GAMA → "Heavy Leap", …) and
      the hint reads FULL FINISHER READY. It **never fires by itself** — only
      on your tap — and it also empties the meter.
- [ ] The meter charges ONLY from your own landed Strikes and Combos —
      defending, and taking hits, add nothing. (Innate abilities like ERA's
      head start or TORA's defend bonus are the deliberate exceptions.)
- [ ] Pacing: flat gains — every clean strike is +10 meter and every clean
      combo +14 REGARDLESS of level or damage, so 7/7 is always ~10 strikes
      and the 4/7 unlock lands around strike 6. Blocked hits earn half;
      evaded hits earn nothing.
- [ ] Counterplay: if the CPU has a defense trap armed, your finisher (either
      kind) gets blocked/countered like any attack. Try wasting one into a
      trap once, deliberately.

## 3. CPU behavior

- [ ] The CPU acts on its own ~1s rhythm — it attacks even if you do nothing
      (watch its stamina fall and regen).
- [ ] It does NOT dump its finisher the moment 4/7 unlocks: it holds toward
      7/7 unless you're badly hurt (then it cashes early to close).
- [ ] At its own 7/7 it fires its signature — unless your trap is armed, in
      which case it pokes the trap with a cheap strike first.
- [ ] When exhausted it defends to recover rather than sitting idle.

## 3b. Innate Abilities (one per Holobot, always active)

- [ ] In battle, a small cyan `◈ ABILITY NAME` badge sits under each
      fighter's combo counter (yours and the CPU's).
- [ ] In the Move Lab, the identity strip shows the ability name +
      description with an INNATE badge (no equip/upgrade buttons).
- [ ] Spot-check identities in battle:
      - **ERA** starts every battle with the meter already at ~1–2 segments
        (Time Warp, +25 at the opening bell).
      - **ACE**'s first landed hit visibly jumps the meter (+12, once per
        battle — later hits gain only the normal amount).
      - **KURAI** below 40% HP heals 8 on taking a hit, once per battle.
      - **WOLF** while gassed (under 3 stamina) claws back +1 stamina on
        landed hits, at most every 2 battle actions.
      - **TORA** gains meter every time it arms a defense; **HARE** gains a
        chunk whenever a counter/evade trap springs.
- [ ] Abilities never appear in the four kit slots and cost nothing — they
      fire on their own when their condition is met.

## 4. Move Lab (Inventory → MOVE LAB tab)

- [ ] The old Cards tab is gone; MOVE LAB shows: holobot chips, an INNATE
      signature strip (no equip/upgrade buttons on it), your SP balance, and
      the four kit slots with rank pips.
- [ ] **Equip flow**: tap a slot → the REPLACE list shows only moves of that
      category you own (plus stock). Equip one → the slot updates. Force-quit
      and relaunch → the kit persisted. Enter a battle → the tray matches the
      saved kit.
- [ ] **Upgrade flow**: select a move → UPGRADE shows the SP cost
      (rank 1: 25, rank 2: 60, rank 3: 120) and a concrete preview
      (`DMG 12 → 14`, `COST 2 → 1`, `SPD` for defense/Counter). Buy rank 1 →
      SP balance drops, pips update.
- [ ] **Rank 2 branch**: upgrading to rank 2 requires picking one of two
      branches (e.g. Strike: Pressure = cost −1 vs Power = +20% damage). The
      button stays disabled until a branch is chosen.
- [ ] Upgraded values appear in battle (the move's cost/damage on the tray
      card reflects the rank).
- [ ] Guardrails: a cost-1 move with a cost-reduction branch stays at cost 1;
      rank 3 is MAX RANK.
- [ ] With SP below the cost, the button is disabled.
- [ ] (Post-deploy) watch the function logs while upgrading — you should see
      `upgradeHolobotMove` / `saveHolobotCombatKit` invocations, and a
      double-tap or stale retry gets rejected with a clear message.

## 5. Marketplace Parts (regression — server already deployed)

- [ ] Parts tab groups HEAD / TORSO / ARMS / CORE, cheapest first; epic
      prices fit their frames.
- [ ] Buying debits Holos, bumps OWNED ×N, and the part appears for equipping.

## 6. Combat regressions (should all still hold)

- [ ] Stamina: +1 every ~2s for both fighters, cap 7; no free stamina from
      spamming cheap moves.
- [ ] Defense: arming a trap locks only *further* defense plays; attacking
      drops your own guard; trap cooldown (CD n) counts *your own* plays.
- [ ] No soft-locks: whatever both fighters do, the battle keeps moving.
- [ ] Combo counters under both stamina bars build on clean strikes, break on
      blocked ones, and cash out through combo cards and the finisher.
- [ ] A non-lethal finisher does NOT end the battle; results screen shows the
      correct VICTORY/DEFEAT; tier runs advance rounds; rewards settle
      (server-authoritative).

## 7. Realtime PvP (two devices — converged rules)

Both devices must run this build (older apps are version-gated out of new
rooms and matchmaking with a clear message).

- [ ] Quick Match / room code / friend battle still connect two devices.
- [ ] Both fighters enter with their own **Move Lab kit** (one move per
      category, ranks applied) — not random hands. Check an upgraded move
      shows its upgraded damage/cost on both screens.
- [ ] Combat behaves exactly like PvE: same damage math, defense
      traps/counters, combo chains (shown next to each pilot's name), the
      4/7 kit finisher that consumes the meter, and the 7/7 gold signature
      button with your Holobot's move name.
- [ ] Abilities fire in PvP: an ERA player starts the match with meter
      already charged; ACE's first hit visibly jumps its meter.
- [ ] **The original desync symptom stays gone**: HP, stamina, meters, moves
      played, and the battle log stay identical on both screens all match.
- [ ] Move buttons show the same disabled reasons as PvE (LOW STA, NEEDS
      METER, CD n), and an illegal tap is rejected with a readable message.
- [ ] A KO shows Victory on one device and Defeat on the other.

## 8. Phase 6 cleanup checks

- [ ] Inventory header reads `Parts N • Items N • Moves N` (no "Cards").
- [ ] Marketplace booster copy says "1 Part + 1 Item + 1 Move unlock", and
      opening one reports "Move unlocked: <move name>" — buying boosters is
      now how you acquire new moves for the Move Lab.
- [ ] Buy a booster, then open the Move Lab: the granted move appears in the
      matching category's REPLACE list.
- [ ] No card/deck/hand language anywhere in Arena, Inventory, or PvP.

## Known deferred (by design)
- Specialization respec (30 SP) — not yet exposed in UI.
- Duplicate move-unlock copies (battle_cards counts above 1) have no combat
  effect; converting extras into SP/compensation is an open economy
  decision.
- PvP anti-tamper: kits/ranks come from the player's own server-validated
  profile, but room writes are still client-authored (participant-gated by
  rules). Full server-side move validation remains the SECURITY_AUDIT C4
  follow-up.

## If something looks wrong

Most useful details: which Holobot, its Move Lab kit + ranks, the meter
segment count when it happened, and whether the CPU or you acted last.
Balance tuning knobs all live in one place each: rank modifiers
(`moveKits.ts`), SP costs and branches (`moveProgression.ts`), meter gains
(`combatEngine.getMeterGainForDamage`), AI cadence
(`arena-battle-store.ts`).
