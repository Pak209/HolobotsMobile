# W7 — mobile-city-hub-1

The native City hub presents six districts, eight host-served citizen pilots, story gates, workshop healing/crafting, and a playable citizen duel followed by a 3D replay. It shares the Carbon/cyan HUD tokens and the six slot-ring colors with W5.

## Source and navigation

Layout coordinates are read from the existing Unity QA export `HolobotsUnity/Documentation/QA/2026-09-22-layout-calls/context.json`. The map is a schematic X/Z projection (north is +Z), with widened labels and separate presentation slots for citizen pins. It does not claim a navigable or current 3D terrain export.

| Pin | Unity export anchor | X / Z metres | Destination |
|---|---|---:|---|
| Plaza | `anchors.SyncTower_disc` | 0 / 10 | Home / squad |
| Vendor | `anchors.Market` | 100 / -55 | Existing Marketplace |
| Workshop | `anchors_extra.minimapLandmarks.WORKSHOP` | -135 / 0 | Native heal / craft panel |
| Arena | `anchors.ArenaFoundation` | -22 / -55 | Existing Arena entry |
| Harbor | `anchors.Marina gangway` | -48 / -164.4 | Existing Quests |
| Port | `anchors_extra.minimapLandmarks.PORTAL TERMINAL` | 0 / 115 | Citizen rival list |
| HoloZone | `anchors_extra.minimapLandmarks.RESEARCH GARDEN` | 120 / 80 | Existing Overworld |

Arena is locked until `storyFlags.arenaGatheringSeen === true`; HoloZone is hidden until `holoZonesArcBuilt === true`. Unknown/corrupt flags stay locked. No client writes story progression. Device-local hours 06:00–18:59 use the day tint; 19:00–05:59 use night. The screen refreshes the time on focus and foreground as well as each minute.

## Host integration

The gathering contract is [HolobotsMobile PR #80](https://github.com/Pak209/HolobotsMobile/pull/80), inspected and exercised at `6379b765abb20452690a61c97408197d53395982`. That dependency is still open; this mobile lane does not merge or deploy it.

- Explicit “Join the gathering” calls `arenaGatheringHost({schemaVersion:"arena-gathering-1"})`. The host sets the seen flag and supplies all eight identities, bot assignments and ring colors. No fictional roster is substituted on a failed request.
- Citizen admission calls `rivalBattleHost({schemaVersion:"rival-battle-3",operation:"issue",storySchema:"arena-gathering-1",rivalId:citizenId})`.
- The first issued player travel-squad bot fights the one assigned citizen bot using the existing mobile `ArenaCombatEngine` and its four-move kit. Health/attack/defense/speed/special come from admission, with distinct side-prefixed IDs for mirror matches. Version-1 command profiles must match the supported seven-stamina presentation. This is mobile CPU combat under the existing client-observed-outcome trust boundary; it is not a server combat replay or Unity physics simulation.
- Completion settles the admitted battle ID with the observed win/loss and the actual fielded bot. Wins wait for the existing 20-second host minimum. Unknown settlement outcomes retry the same battle ID. Cooldown refusals use host `retryAfterMs`; first confirmed settlement uses a conservative local five-minute countdown. Replayed receipts do not restart the countdown.
- The actual host has no `rounds` field. Only observed mobile attack resolutions become W6 `DuelRound` cues. Playback says “CLIENT TRACE · HOST SETTLEMENT”; reward values come from settlement, never the engine’s preview rewards.
- Workshop calls the existing `workshopHealHost` / `workshopCraftHost` with schema `healing-workshop-1`. The two recipes mirror `functions/src/lib/healingRecipes.ts`: Repair Kit costs one Emergency Patch + three Blueprint Fragments; Full Restore costs one Repair Kit + five fragments. The host checks stock, activity locks and grants. Receipt IDs persist in AsyncStorage before mutation and survive sheet dismissal/app restart.
- Requests have a 15-second UI deadline and check the authenticated UID before and after the call. Rival issuance has no idempotency key in the existing host contract, so a timed-out issue is never automatically retried. An unconfirmed admission can remain open until the host’s two-hour expiry; a future host request-id/resume contract would close this gap.

## Verification

The [shared final QA report](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/README.md) contains the integrated build, bundle and native-performance evidence. The [final screenshot gallery](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots) includes the native captures reviewed for this lane:

- [Day](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/CityDay.png), [night](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/CityNight.png), [locked Arena](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/CityLocked.png), and [unlocked HoloZone](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/CityZones.png).
- [Citizen roster](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/CityRivals.png), [workshop](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/CityWorkshop.png), [rival entry](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/RivalEntry.png), and [local combat HUD](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/CityBattle.png).
- [Real-host-shape result without a trace](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/DuelReceipt.png), plus synthetic [round 1](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/DuelRound1.png), [round 2](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/DuelRound2.png), [round 3](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/DuelRound3.png), and [recorded result](../../../../../Documentation/QA/2026-10-14-mobile-holocity-lite/screenshots/Duel.png).

The final city captures show the expected gates, distinct day/night tint, visible district and action labels, and contained combat controls. The citizen list scrolls; its eighth row continues below the initial viewport. These screenshots are offline fixtures and do not prove production host availability.

`npm run typecheck` passes. The four targeted city unit files pass **17 tests**: exact schema/palette, malformed/duplicate roster rejection, story gates, source geography, local time boundaries, session isolation, bounded calls, workshop request identity across restarts, mirror-match IDs and actual damage-to-replay mapping.

`cityHost.integration.test.ts` is opt-in and ran against a loopback-only Firestore emulator, **3/3 passed in 2.97 seconds** (2.46 seconds test time). It uses the real #80 callable/store code, a `demo-holocity-lite-city` project and a generated throwaway account. It verifies:

1. A real gathering reply parses and opens only the correct gate.
2. All eight assigned citizens issue correctly; host stats drive an actual engine strike, then real loss settlement/replay/cooldown replies pass the mobile adapters and W6 normalization. Each qualifying test loss returns 25 Holos; duplicate settlement grants nothing twice. This is controlled-clock emulator evidence, not a played production session.
3. Actual workshop heal/craft callables return valid receipts; a repeated craft request consumes ingredients only once.

The throwaway integration account and its ledgers were deleted after the run. [Captured host replies](host80-mobile-replies.json) contain demo data only. [The existing #80 emulator regression log](host80-emulator.txt) passed **13/13 tests in 26.33 seconds**, including story-rule protection. Expected permission-denied lines are the negative rules cases, not failures. The emulator was shut down after verification.

Reproduce after building an isolated checkout/archive of #80 under the clone and starting Firestore on loopback:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:18095 \
GCLOUD_PROJECT=demo-holocity-lite-city \
HOLOCITY_TEST_HOST_ROOT="$PWD/../.work/host80/functions" \
npm run test -- src/lib/__tests__/cityHost.integration.test.ts
```

Offline screenshot fixtures are `cityHubFixtures.day`, `.night`, `.locked`, `.zones`, `.rivals`, and `.workshop`. `CityRivalCombatPreview` exercises real local card play and forwards its observed trace to the 3D replay; it is labeled offline with no rewards and makes no host calls.

The map adds **zero raster assets** and no dependencies. Shared release bundle bytes, simulator frame rates and screenshots are measured by the integration lane; they must not be inferred from this source-size observation.

**HELD:** live gathering/citizen admission requires #80 to be reviewed, merged and separately deployed with its rules under future authorization. No deployment, production account, Pak game account or merge was used tonight. Simulator/UI proof is collected in the shared PR evidence.

## Recorded replay presentation fixture

`mobile/src/qa/duelFixture.ts` adds the explicitly synthetic `holocity-duel-preview-1` format for the portrait ACE/WOLF replay. It is not the `rivalBattleHost` schema and never calls a host or grants rewards. The three authored records are ACE Skybreaker hit for 9, WOLF Low Roundhouse evaded, and ACE Meteor Hammer hit for 21. The receipt contains full before/after HP and stamina snapshots, exact animation takes, command costs, three-round count, and the final win. The viewer only applies recorded snapshots at the impact cue (900 ms within each 3,200 ms round); it never rolls combat, subtracts damage, or derives the winner from zero HP. `duelPlayback.test.ts` passes **16 tests**, covering hit/miss/evade/guard cues, malformed snapshots, catalog cost parity, timing, immutability, and no invented winner. A regression feeds the captured #80 emulator issue/settlement directly through the normalizer and verifies result-only behavior, plus a separately labeled client-trace path.

Actual #80 host replies still contain no rounds, so a host-only receipt remains result-only. The existing City rival CPU engine's observed action trace is supplied separately and labeled `CLIENT TRACE · HOST SETTLEMENT`; the offline engine preview has its own no-rewards label. The City component memoizes replay inputs and stops its admission countdown once a receipt arrives, so an early loss cannot restart the replay every second.

The portrait command aliases use the Unity `BotMoveWireTool.Clips` order; ACE uses the named signature half of `ACEMoveWireTool.Clips`. `FleetMixarImportTool` explicitly substitutes SupermanPunch for WOLF RushElbow and DiveKick for GAMA LowSweep. All choices exist in the bundled manifest, and every bot has three distinct command takes. Existing `AttackBasic` / `AttackSignature` aliases retain their previous animator mappings (ACE remains JabCross / Skybreaker); exact receipt clip names take precedence over all aliases.

| Bot | Strike | Heavy | Finisher |
|---|---|---|---|
| ACE | Skybreaker | CometCross | MeteorHammer |
| WOLF | StepCross | LowRoundhouse | SupermanPunch |
| KUMA | PawSwipe | DoubleHammer | ShoulderCheck |
| KEN | PalmBreaker | CrossElbow | CrownDrop |
| TSUIN | TwinCut | TurningEdge | LeapCleave |
| HARE | SnapKick | HopKnee | DoubleHeel |
| SHADOW | DrawCut | DiagonalCut | PassingThrust |
| WAKE | ForearmCounter | DrivePunch | AnchorSlam |
| TORA | TigerPalm | RakeCombo | PounceCrush |
| GAMA | PalmFlick | WhipKick | DiveKick |
| KURAI | CrossSlash | LowPass | RisingEdge |
| ERA | WingShear | TalonKick | DivingEdge |

## HARE locomotion correction

The bundled HARE Idle/Walk/Run tracks omitted the hip quarter-turn already documented in Unity `Assets/Holobots/Shared/Editor/QA/FleetMixarImportTool.cs`, `RepairHareLocomotionAxes()`. The native screenshot showed the idle character lying backward. Inspection of the compressed glTF confirms an identity `HARE_Armature` parent and the affected `Hips.quaternion` tracks. At 0.12 seconds, Idle's head-to-hips vector was `(0.1163, 0.0086, -0.4094)` metres; premultiplying the hip keys by +90° X yields `(0.1163, 0.4095, 0.0087)`. The opposite rotation puts the head below the hips.

`repairHareLocomotion.ts` ports that narrow correction to both native and web loader paths. It clones only HARE's Idle/Walk/Run clips, changes only their hip quaternion keys, and skips already-corrected tracks. It does not rotate the model root or any attack take. Two tests load the actual compressed HARE GLB and verify all three locomotion poses become upright, attacks stay unchanged, input tracks stay immutable, and applying the repair twice has no effect. The native capture lane verifies final presentation separately.

A follow-up [fleet idle pose scan](fleet-idle-poses.json) sampled all 12 actual compressed GLBs at 0.12 seconds with the loader repair. Every declared idle has its head above its hips: +Y ranges from 0.1374 m (ACE) to 0.6250 m (TORA); corrected HARE is 0.4095 m. These are mesh/skeleton measurements, not simulator FPS or visible-frame proof.
