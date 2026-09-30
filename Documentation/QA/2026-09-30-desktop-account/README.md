# Desktop account — DECISIONS #41

## Current checkpoint
Off-editor source staged, not installed in Unity yet. Claude holds the editor. iOS embedding is paused and unnecessary for this path.

The actual C# client signed in and performed capture, squad replacement, mint and rank-up through local Firebase Auth/Functions/Firestore emulators. The companion Firebase JavaScript SDK read the changed account and denied a signed-out read. This is not a rendered desktop or phone-app acceptance claim.

| Proof | Result |
|---|---|
| REST/session fake HTTP | 19 assertions pass: account isolation, late responses, token renewal, error sanitization |
| Actual C# -> emulator callables | 10 checkpoints pass: sign-in, inventory, HARE declaration/capture/withdrawal, squad, mint/rank, refusal, sign-out |
| Companion SDK | Same account sees HARE level11, hare blueprints30, KUMA/HARE squad; signed-out read denied |
| Cold Unity assembly | Compilation passes without editor use; source staged outside Assets |
| Backend TypeScript | functions build passes |
| Production availability | Unauthenticated POST wildEncounterHost returns HTTP404; no production writes |
| Unity visuals / controls | NOT RUN; editor claim pending |

Emulator seed deliberately gives HARE capture probability1, owned ACE, hare40 and kuma5 blueprints. This tests authority transport and persistence, not capture probability distribution. Dummy email/password exist only in the isolated test scripts, not real credentials. No phone process participates in the C# flow. Companion SDK proof is a separate authenticated client, not a screenshot of the phone app.

## Implementation and remaining editor steps

Staged `Tools/DesktopAccount/20260930/`: direct REST client, host command adapter, runtime account session and existing-HoloUI account/inventory/squad/blueprint view. Installer requires an ASTRA ledger claim and refuses nonidentical destination files. Runtime auto-bootstrap is macOS-only, editor bootstrap is explicit. No scene/prefab change required. One read-only backend snapshot callable supplies existing fields and server tiers; existing spending callables are unchanged.

Before landing: acquire editor, reload Main; install scripts/metas; recompile; create account components through a Holobots proof/menu tool; configure loopback only for unsaved editor proof; verify signed-out gate, field focus/cursor, close/back/input restoration, host encounter -> toy/capture -> outcome, squad next-deploy, tier refusal/success, account switch, bright/dark/resolution capture. Save no witness or local configuration to scene. Evidence media goes to the vault. UI is not look-approved merely because it compiles.

Known: production callables need deployment; production test login is not available. Shipping tokens are memory-only, so sign-in is required each launch. No OAuth, anonymous/offline play, new-account provisioning, merge of different accounts or local rewards. Same-account linking is sign-in to the same UID, with refresh on focus and after mutations.

## Reproduce off-editor

Use a demo-only Firebase emulator configuration with auth9099/functions5001/firestore8085. Build Mobile/functions. `seed-emulator.cjs` seeds local emulator data only. `test_core.py` runs simulated transport checks; `test_core.py --live` runs actual C# requests. `companion-proof.cjs` uses Mobile's installed Firebase JS SDK. Unity's bundled .NET SDK and shipped Newtonsoft assembly are used; no package install.

See CONTRACT.md and proof text alongside this README. No screenshots yet; no Unity scene was opened by this lane.
