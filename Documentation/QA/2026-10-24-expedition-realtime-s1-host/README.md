# Expedition real-time S1 host — review and producer handoff

Source: `functions/src/holozone/expedition.ts`, `expeditionStore.ts`, `holoZoneHost.ts`, shared fight issue types, and `Schemas/zone-run-6.json`. Unity's `Schemas/zone-run-6.json` and `Schemas/duel-receipt-2.json` are byte-identical to the Mobile copies. This is host code and contract only; no Unity scene or Player build was touched.

## Wire and rulings

- `HOLOZONE_EXPEDITION_REALTIME=1` **and** `HOLOCITY_FIGHT_REPLAY=1` issue new runs as `zone-run-6`; both default off. A new issue declares `duelInputs: "duel-inputs-2"`. While the flag is on, an older issue gets `client_update_required`; an already-issued zone-run-3/4 run keeps its resolver behavior.
- `engage` pins one `fightIssue` (existing duel-rules-3/4/5 + duel-inputs-2 shape) under `pendingFight {fightId, sectorId, issuedAtMs, settleByMs, ambush:"none"}` and spends the existing 10 energy, down to zero. The CPU is the WOLF kit/profile/body stand-in; sector threat levels follow the pinned squad mean plus `[-2,0,+2]`, clamped to 1–99. The S1 HP scale is 19. The run view carries each bot's `staminaPm` (0–1000); `serverNowMs` is host-authored.
- `fight_settle {fightId,inputLog}` uses the same host replay verifier as rival battles, **outside** the Firestore transaction. Only its verified `duel-receipt-2` supplies winner, HP, and STA. A win clears the sector. A loss or draw wipes: protected haul stays, the rest is lost, and the squad is KO'd. HP carries exactly; travel recovers 250 STA, safe-room entry restores 1000.
- `flee {fightId}` is free, with one 50% private-seed roll per fight (producer tuning candidate). Success returns to the uncleared sector; failure keeps the exact issue active. `resume {fightId}` after a disconnect counts as that same single flee attempt. A failed flee never applies the old proposed 25% HP penalty. A further `flee` refuses `flee_already_attempted`; `resume` reopens the same issue and renews its 240-second settle window after expiry. A late settle refuses `fight_expired`. Pending fights refuse movement, healing, extraction, and other operations as `fight_pending`.
- Readiness-start and CPU SYNC use existing `HOLOCITY_READINESS_START`; Battle IQ learning uses existing `HOLOCITY_BATTLE_IQ`. Both remain default off. No auto-send or autobattle path is in zone-run-6. The legacy resolver remains reachable only by previously issued runs.
- The existing `duel-receipt-2` schema's `battleId` pattern was additively widened to allow `ef_` as well as `rb_`. No receipt fields or sim hashes changed. The mirrored JSON files match byte for byte.

Requests/replies are pinned in `functions/scripts/fixtures/zone-run-6/realtime.json` (issue, two moves, engage, settle) and validated by the new pure suite. Refusals remain callable errors. `zone-run-6` is built from the merged zone-run-4 baseline; the open signatures pilot zone-run-5 must be reconciled before activation.

## Cold sizing

Sheet: `/Users/pak/HolobotsVault/QA/2026-10-24-expedition-realtime-s1-host/COLD_SHEET.png`. Representative LV10 ACE/KUMA/SHADOW versus the WOLF stand-in, 100 paired seeds per band, Champion input policy. S1 median encounter lengths were 32.7/41.5/41.5 seconds (bands 1/2/3), in the requested 30–50-second median interval. Production-seed cross-check medians were 33.4/41.8/48.9 seconds. P90 was 50.2/55.1/58.7 seconds, and the proxy squad won all 100 seeds in each band. This is a cold CPU policy check, not human feel or a full run-chain balance pass. Pak should tune difficulty after the editor witness.

## Verification

- `npm run build` / `check:shared`: pass.
- Full functions unit suite: 628 passed, 1 existing skip (includes 9 S1 pure tests).
- Throwaway emulator S1 tests: 3 passed (flag/capability, durable verified settle/idempotency, tamper refusal).
- Broader zone emulator: 29/30 passed. The unchanged `test-zone-expedition-emulator.mjs:91` rules fixture expects a permitted `presenceOptOut` update; it fails `PERMISSION_DENIED` under current main's rules, also when isolated. S1 does not edit those rules or that fixture.

## Producer's Unity/editor steps

1. Mirror `zone-run-6` requests and replies in `ZoneExpeditionClient`, including strict `pendingFight`, `staminaPm`, `fightIssue`, `fightReceipt`, `encounterResult`, `serverNowMs`, and the new refusals. Keep the legacy zone-run-3/4 route for old runs.
2. Bind `engage` and `fight_settle` to the existing `FightPresentSession` and `FightInputRecorder`; use the issued WOLF fighter as a visual stand-in. `resume` invokes the host's flee decision before restoring the pinned duel. Do not derive win, HP, STA, or flee odds in Unity.
3. Wire the expedition session into the production Neon Forest sector trigger and fight camera. In a clean in-memory scene, witness clear, loss/wipe, flee success/failure, disconnect/resume, `fight_pending`, `fight_expired`, tampered-log refusal, and a zero-energy entered fight. Capture the WOLF stand-in look for Pak.
4. Reconcile the open zone-run-5 signatures contract, run native EditMode/PlayMode and layout gates, and obtain Pak's flag/deploy decision. Host and Unity flags remain off until then.

No deploy, live account, editor operation, or scene save was performed in this lane.
