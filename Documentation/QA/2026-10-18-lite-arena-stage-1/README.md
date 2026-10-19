# lite-arena-stage-1: the CPU Arena round on the park-arena 3D stage

Pak's ruling: the CPU Arena round must look "as close to the 1st upload as possible", meaning the same 3D park-stage duel and HUD as the city rival / park duel.

**Result:** the Arena round now renders `LiveDuelStage`. That is the stage extracted from `CityLiveBattleView`: BotStage `duelPortrait` over `holocity-park.jpg`, FighterHud and the HoloCity command bar. Combat runs through the same store calls as before. Every Arena-only state stays outside the stage. PvP keeps `BattleArenaView`.

Evidence: `~/HolobotsVault/QA/2026-10-18-lite-arena-stage-1/` (`GATE_SHEET.png`, captures, `launch.txt`, `metro.log`, `fps-samples.jsonl.txt`).

## What changed

| File | Change |
|---|---|
| `components/duel/LiveDuelStage.tsx` (new) | The shared stage. Added props: `levels`, `levelTab`, `signature`, `playableIds`, `holdUntilReady`, `chrome`, `active` and the QA metrics hooks. |
| `components/duel/liveDuelCommands.ts` (new) | Command-plate mapping, free of react-native. It only presents availability that the engine or store already decided. |
| `components/city/CityLiveBattleView.tsx` | A thin wrapper with the same props. City behaviour is unchanged: issue-based LV, the GL-ready gate, LEAVE and signature. |
| `screens/DuelPlaybackScreen.tsx` | `FighterHud` gains an optional `levelTab`, the DECISIONS #71 lower-left corner tab. The default is the inline badge, as before. |
| `screens/ArenaScreen.tsx` | The round renders `LiveDuelStage` instead of `BattleArenaView`. See below. |
| `lib/arenaCopy.ts` | `stageCaption: 'HOLOCITY / PARK ARENA'` (PLACEHOLDER until Lex). |
| `qa/ArenaStagePreview.tsx` (new) | Offline cells: `ArenaStageKnownBad`, `ArenaStageRound`, `ArenaStageConfirming` and `ArenaStageReceipt`. |

How Arena wires the stage:

- **Moves:** `onPlay={store.useMove}`, `playableIds={store.getPlayableMoves()…}` and `pending={store.isAnimating}`. This is the same rule as `BattleArenaView`'s `isAnimating || !playableCardIds.includes(id)`.
- **Signature:** `signature={!battle.hostSnapshot}`, so a City-issued match has no signature. `onSignature` stays a no-op, as before.
- **Live loop:** `holdUntilReady={false}`, so the Arena loop is never gated on GL load.
- **Quit:** `onLeave={quit}` and `leaveDisabled={settle sending}`.
- **LV tabs:** `levels` come from `arenaFighterLevel(reply, matchId, 'entrant' | 'opponent', name)`, shown as corner tabs.
- **Cog:** `chrome={{ top: insets.top + 10, right: 60 }}` keeps QUIT clear of the pilot-menu cog (critic finding #1).
- **GL pause:** `active={phase === 'battle' && !quitAsk}`.

## Witness (simulator, offline QA routes, no account)

| # | Cell | Result |
|---|---|---|
| 01 | `ArenaStageKnownBad`: the old flat round | KNOWN BAD, as designed |
| 04 | `ArenaStageRound` after CONTINUE FIGHT | PASS: 3D stage, LV 4 / LV 12 corner tabs, QUIT left of the cog |
| 10 | `Duel`: park duel reference | Same look |
| 02 | `ArenaPolishAdmitted` | PASS, unchanged |
| 03 | `ArenaStageRound` entry (F3 resume) | PASS, unchanged |
| 05 | Idle player KO'd, City unreachable | PASS: "confirming your result" over the paused stage |
| 07 | `ArenaStageConfirming`: one STRIKE KO, too_fast | PASS: "The City is confirming your win…" |
| 09 | `ArenaStageReceipt`: one STRIKE KO, recorded settle | PASS: VICTORY! · CITY RECEIPT |

**fps (simulator software-GL baseline, 402×788 buffer; not a device number):**

| Run | Arena stage | Park duel | Host load avg |
|---|---|---|---|
| Final clean run | 5.9–6.6 fps | 7.7–9.0 fps (median 8.1) | ~9.6 |
| Earlier same-day runs | 7.1–8.2 fps (median 7.5) | 8.0–9.2 fps (median 8.6) | ~6 |

GL load is 1.9–4.8 s for the Arena stage, against 1.6 s for the duel.

## Findings for Pak

1. **The player's input window shrinks under the 3D stage on slow GL.** The store unlocks input with a 350 ms `setTimeout` after every move. GL rendering on the JS thread delays that timer, while the CPU's 950 ms cadence runs on the wall clock.
   - On the simulator, `isAnimating` was true in most 1 s probes, and an idle player is KO'd about 5 s in.
   - The combat rule did not change, but its feel depends on frame time.
   - The physical-iPhone gate (50 fps) is unmeasured.
   - Recommendation: default the Arena stage to the #133 `combo` knobs (msaa0 + halfRes + anim30, 3.9× on the simulator), or hold the CPU loop until `onReady`. Both are Pak's call; neither ships here.
2. **3v3 (#139, dormant):** `ArenaBenchCards` has no home on the 3D stage yet.
3. **PvP** stays on `BattleArenaView` until its own lane.
4. **Less combat information on the stage:** the old flat view showed per-card unavailability reasons and combo / perfect-defense text. The stage shows the last move and its damage. This is presentation only.
