# Rules4 CPU chase-stall policy correction

The host CPU now observes the existing self chase tag, exactly as the C# twin does. A free, still-tagged CPU in Retreat whose BREAK has ended chooses a legal stationary guard when no other press is planned. The existing core clears the tag; the normal guard window lasts through the issued raise + perfect-guard timings. There are no core/rule/schema, damage, reward, random-draw or flag changes.

Known-bad first: W4 LV1 Champion CPU seeds TORA/HARE 93, KUMA/SHADOW 23 and TORA/SHADOW 45 all reproduced their recorded 5,400-tick timeout hashes. Final policy results are KO at 2,035 / 1,791 / 1,834 ticks. Test-only negative controls mask the new observation and still reproduce the old timeouts. Chase-off controls are unchanged. Separate fixtures preserve 5,660 full C#/TS tick hashes; established vectors were not regenerated.

`npm run build` and `npm run test:fight-sim3` passed (158 tests, including 16 new tests). `npm test` also registers `test-fight-cpu-stall.mjs`. The matching Unity cold runner verifies 16 scenarios/bouts. Full C#/TS comparison of all 48 established core/chase/CPU fixtures matched every one of 35,819 full tick hashes. A 7,280-bout bounded sample had no new timeouts; all 3,640 rules3 hashes remained unchanged, while 594/3,640 rules4 hashes changed as expected from the policy. Guard tick share moved 11.8259% → 11.9142%; the first candidate's one-tick guard flashes were removed before finalization.

Full measurements, source pins, limitations and reproduction commands live in HolobotsUnity `Documentation/QA/2026-10-23-astra-rules4-cpu-stall-fix/README.md`. Evidence: `/Users/pak/HolobotsVault/QA/2026-10-23-astra-rules4-cpu-stall-fix/`. Source pin for this host run: `cdf6318d961c532f43d9428e75c00154b5b4f8ad`.

No deploy. `HOLOCITY_FIGHT_CHASE` remains off. Chase onboarding must ship with rules4 (DECISIONS #72.74); native/editor witness remains with the producer. All other holds remain.
