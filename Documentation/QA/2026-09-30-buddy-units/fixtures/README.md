# acquisition-1 emulator reply fixtures (DECISIONS #43)

Written by `functions/scripts/test-wild-encounter-emulator.mjs` after the matching assertions passed; not hand-authored. Local demo Firestore emulator, 2026-09-30. No UIDs, tokens, policy tables or secrets. The acquisition-0 fixtures in `../../2026-09-29-wild-host/fixtures/` are kept as history.

- `added_to_squad.json`, `new_bot.json`, `blueprints.json`: the #40 ownership outcomes, now with top-level `buddyUnits` and `captureResult.buddyUnitsSpent: 1`.
- `refused.json`: refusal; `buddyUnits` unchanged, `buddyUnitsSpent: 0`.
- `no_buddy_units.json`: capture attempted with 0 Units; nothing mutated, buddy_unit item `remaining: 0`, `useAllowed: false`, `allowedToyIds: []`.
