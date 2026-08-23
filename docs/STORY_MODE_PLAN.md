# Holobots Story Mode plan

## 1. Purpose & non-goals

Story Mode is a Power Quest (Game Boy) blend: explore town → talk → robot battle. It is a compact motivation layer around existing Holobots systems, not a full JRPG and not a second game competing with them.

- The overworld is the existing root Vite/Pixi preview (`package.json`: `holobots-overworld-preview`; Pixi scene in `overworld/OverworldScene.ts`, `overworld/TileTypes.ts`, `overworld/Player.ts`; note root `src/App.tsx` is the Figma dashboard preview, not the overworld) hosted in a WebView following `mobile/src/screens/WebSectionScreen.tsx`.
- Story encounters use scripted opponents in the existing `combatEngine.ts`, `arena-battle-store.ts`, and shared `BattleArenaView.tsx`; Slice 1 adds no second combat engine.
- A typed `postMessage` bridge connects the overworld and native app; rewards use validated Firebase paths and are never minted in the WebView.
- Story flags are server-side. Fitness-gated map regions are the differentiator to protect.
- Companion docs: `docs/STORY_BRIDGE_CONTRACT.md` and `docs/ART_STYLE_GUIDE.md`.
- Non-goals: a parallel inventory/economy, bespoke story combat, open-ended quest authoring, or a content-heavy RPG campaign.

## 2. Slice plan

### Slice 0 — prove the WebView boundary and persistence

- Deliver: hosted WebView overworld, typed bridge, one NPC, one door, and one harmless server-side flag.
- Persistent-consequence amendment: talk to the NPC → enter the door → set the flag → reload/return and observe changed dialogue or world state.
- Proof of done: navigation and conversation work, the consequence survives a reload, and the WebView cannot award value.
- Not included: combat, journal, branching dialogue, multiple interiors, fitness gates, or economy rewards.

### Slice 1 — prove the complete product loop

- Deliver: one rival encounter → existing arena battle → validated result → server flag/reward → post-battle scene → one journal entry.
- The rival and resulting world change must make exploration, dialogue, and combat feel like one journey rather than a walking menu between fights.
- Proof of done: explore → talk → battle → persistent consequence/reward completes end to end and is instrumented as a 10–15 minute first chapter.
- Not included: random encounters, custom battle rules, multiple quest branches, a broad reward table, town expansion, or boss content.

### Slice 2 — validate the differentiator before buying content

- Reorder: put the first fitness gate into the proven small map before the expensive town/route/boss and art pass.
- Deliver gate first: a fiction-grounded unlock (for example, activity repairs access) backed by synced fitness state, while some content remains available on low-mobility days.
- Proof of gate: players understand it, make progress through ordinary activity, and return to use the unlocked region.
- Only after that proof: expand to the town, route, boss, and cohesive art pass.
- Not included before validation: multiple towns, free-roaming interiors, large NPC casts, or a continuing content pipeline.

## 3. Retention-loop mapping

Proposed loop: explore → meet character → receive objective → fitness or battle gate → arena encounter → persistent world change → reward → next destination.

- **Evidence:** `mobile/src/lib/energy.ts` resets daily energy, regenerates one per 15 minutes, and grants step-derived energy; Story can give synced activity narrative purpose without creating another stamina system.
- **Evidence:** `mobile/src/lib/dailyMissions.ts` currently rewards login, three arena battles, and opening a booster; Story encounters can reinforce arena participation, but must not become an additional compulsory daily checklist.
- **Evidence:** `mobile/src/lib/arenaEconomy.ts` already defines tiered entry costs, opponents, and settlements; scripted Story fights should teach arena concepts without copying tier payouts or entry-fee pressure.
- **Evidence:** Fitness sync enters through `FitnessScreen.tsx`/`useWorkout`; Story region access can turn activity into visible world progress.
- **Inference:** persistent world changes and journal continuity can strengthen return motivation more than a reward-only encounter.
- **Cannibalization risk:** if Story becomes the easiest source of currency, progression, or fights, it displaces Quests, Training, Arena tiers, fitness, and Gacha instead of connecting them.
- **Cadence rule:** preserve ungated activity and avoid “come back tomorrow” locks; fitness gates should create anticipation, not punishment.

## 4. Explicit CUT / defer list

- Branching dialogue — multiplies flags, writing, QA paths, and continuity before the core loop is proven.
- Side quests — create a content treadmill without testing the main journey.
- Random encounters — add repetition and balancing cost; Slice 1 needs one authored rival.
- Multiple towns or a large route — expensive map/art production before retention evidence.
- Free-roaming interiors — one door transition proves the boundary with far less content.
- Bespoke Story combat mechanics — fracture combat truth and duplicate the existing arena engine.
- Story inventory UI or economy — risks a second game and a WebView trust boundary violation.
- Large reward tables or repeatable farming — create economy leakage and exploit/QA surface.
- Constant-monitoring or daily-only gates — conflict with family-friendly, low-maintenance play.

## 5. Gacha / arena boundary rules

- Story teaches and emotionally contextualizes Arena; PvP remains the separate mastery and ranking loop.
- Scripted opponents may introduce defense traps, switching, finishers, and composition under controlled conditions.
- Story must be completable with earned starters and sensible progression. “Pull a better bot to continue” is prohibited.
- Gacha widens expression or strategy through alternate Holobots, cosmetics, cards, or optional approaches; it is not the Story difficulty valve.
- Allowed bounded rewards after a validated first clear: guaranteed blueprints, cosmetics, journal collectibles, modest currency, and unlocks such as a title, opponent profile, or PvP-ready loadout.
- Slice 0 awards no economic value. Slice 1 uses a small, fixed, server-validated first-clear reward. Slice 2 adds no repeatable payout until economy impact is measured.
- Story rewards must not bypass PvP mastery, materially distort arena power, or make Gacha tickets the sole reason to explore.
- No free-currency faucet: no WebView-authored rewards, no client-selected amounts, no unlimited replay payouts, and no better risk-adjusted farm than the systems Story connects.

## 6. Pre-registered kill condition

> **fewer than ~35% chapter completion or fewer than ~20% voluntary return ⇒ stop investing**

Registered 2026-08-22; immutable — amendments below with timestamps.

- Cohort: a representative group of players who reach and start the instrumented Slice 1 first chapter.
- Window: measure completion of the 10–15 minute chapter and voluntary Story return within seven days after completion.
- Supporting evidence: compare seven-day retention, fitness participation, and arena engagement with comparable players; opening Story alone is not success.
- Diagnose exits: abandonment concentrated in navigation/dialogue, rather than understandable difficulty, is evidence against the connective experience.
- Cheapest early experiment [design-round summary]: ship the single-NPC, single-rival, persistent-change chapter on the small Slice 0 map and instrument starts, completion, and seven-day return before building the route, boss, or art pass.
- Amendment log: none.

## 7. Open questions

- What event qualifies as a voluntary Story return versus a resume or notification-driven open?
- Which exact first-clear reward is meaningful without distorting Arena or Gacha?
- What ordinary-activity threshold makes the first fitness gate motivating and accessible?
- What minimum fields should the Slice 1 journal preserve without becoming a quest system?
- What comparable-player cohort and minimum sample size will Pak accept for the kill-condition decision?
