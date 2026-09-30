# Desktop account — DECISIONS #41

![Desktop account proof](/Users/pak/HolobotsVault/QA/2026-09-30-desktop-account/review-01/PAK_SHEET.png)

Desktop capture and account management work against the local backend without the phone. Production acceptance remains blocked on deployment and a dedicated account.

Subject inventory: cell 1, email/password sign-in over the town; cell 2, HARE in the world after accepting a toy; cell 3, signed-in roster and travel squad; cell 4, server-supplied blueprint options.

## Installed
Direct Firebase Auth REST client, authenticated callable adapter, runtime session and HoloUI account view live in Assets/Holobots/Shared/Scripts/Runtime/Acquisition/Desktop*.cs. No scene or prefab saves. macOS player boot is automatic; editor witness is explicit. Existing host capture, refusal, ownership, squad and economy rules are preserved. The new read-only desktopAccountSnapshot callable reads the same user document as mobile.

## Verification
| Check | Result |
|---|---|
| Isolated C# transport tests | 20 pass, including account isolation, token renewal and absence of emulator factory in release |
| Actual C# HTTP to Firebase emulators | 10 checkpoints pass |
| Native Unity EditMode | 9/9 pass, including existing squad consumption tests |
| Native Unity Play | Sign-in, HARE toy reaction/capture, rank-up, KUMA mint, squad replacement, next-deploy KUMA and logout pass |
| Companion Firebase SDK | Same account reads Unity's changed roster, blueprint balance and squad; signed-out read denied |
| Repeat screenshots | Accepted pairs have zero changed pixels; wind and water pinned |
| Layout text | Accepted landscape and portrait captures have zero text failures |
| Final editor | Main stopped, clean, 61 roots, zero account witness objects; no scene save |
| Console | No new errors beyond four standing vendor entries |

Native capture uses the existing CaptureWorldSession and remote provider, not a fabricated UI outcome. Test seed capture probability is one for deterministic transaction testing. A separate screenshot encounter shows the host's toy change to 65%; it does not establish a probability distribution test. The actual mobile-rendered app, physical gamepad input and standalone macOS build have not been verified. Unity UI actions used native fields, EventSystem selection and Button invocation.

## Controls and configuration
Open ACCOUNT at the upper right. Enter the same Firebase email/password account; select SIGN IN. Select a bot, then ASSIGN TO SLOT, MINT or RANK UP. Costs and options come from the backend. RETURN TO CITY restores movement and camera; signed-out play stays gated. Existing capture controls remain unchanged. Cancel closes a signed-in account panel; vertical selectable navigation and scroll focus are wired.

Production reads public configuration from Application.persistentDataPath/firebase-desktop.json with apiKey, projectId and region. Never put passwords or tokens there. Tokens live only in memory; restarting requires sign-in. Missing configuration fails closed. Email/password accounts only in this pass; no OAuth, account creation, offline inventory or account merging.

In editor Play, use Holobots > Account > Open unsaved desktop emulator witness. Start local Auth/Functions/Firestore emulators on 9099/5001/8085 under demo-holobots-desktop; build Mobile/functions first. Tools/DesktopAccount/20260930 contains seed-emulator.cjs, test_core.py (--live for real HTTP) and companion-proof.cjs. The dummy test account is desktop@example.test / emulator-only-proof. Never save the witness. Emulator access is compiled out of release builds.

## Open
Production wildEncounterHost returned HTTP 404 on an unauthenticated availability probe. Deployment approval and a dedicated acceptance account are filed in PakOS. No production writes, deployment or pushes performed. Companion SDK visibility proves shared storage, not rendered phone-app acceptance. Full production and physical-input acceptance remain open.

## Evidence
Text proof files are beside this README, including unity-tests.xml, core-proof.txt, live-proof.txt, companion-proof.txt and play-*.json. Media: /Users/pak/HolobotsVault/QA/2026-09-30-desktop-account/. Final sheet: review-01/PAK_SHEET.png. Accepted runs: sign-in-02, encounter-02, rank-before-02, inventory-01, rank-after-01, portrait-01. Failed rank-before-01 is retained and excluded.
