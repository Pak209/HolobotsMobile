# acquisition-2 emulator reply fixtures (DECISIONS #44)

Written by `functions/scripts/test-wild-encounter-emulator.mjs` after the matching assertions passed; not hand-authored. Local demo Firestore emulator, 2026-10-01. No UIDs, tokens, policy tables, roll secrets or secrets (the exporter rejects them). The acquisition-1 fixtures in `../../2026-09-30-buddy-units/fixtures/` and the acquisition-0 fixtures in `../../2026-09-29-wild-host/fixtures/` are kept as history.

- `added_to_squad.json`, `new_bot.json`, `blueprints.json`: the #40 ownership outcomes from a Heavy throw (always captured); per-tier `buddyUnits`, `captureResult.buddyUnitTier: "buddy_heavy"`, `buddyUnitsSpent: 1`, `rolled: true`, `roll`, `captureChance01: 1`.
- `refused.json`: a Medium throw that refused; the Medium Unit is **spent** (`buddyUnitsSpent: 1`, `toyConsumedId: "buddy_medium"`, `retryGuaranteed: false`) and the encounter stays open.
- `no_buddy_units.json`: a Light throw with 0 Light Units; nothing mutated, `buddyUnitTier: "buddy_light"`, `rolled: false`, `roll: 0`; the `buddy_light` world item has `remaining: 0`, `useAllowed: false` and is absent from `allowedToyIds`.
