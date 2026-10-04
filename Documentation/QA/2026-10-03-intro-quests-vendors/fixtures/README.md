# intro-quest-1 / vendor emulator reply fixtures (DECISIONS #46 / #47; catalog now vendor-3 per #48)

Written by `functions/scripts/test-intro-quests-vendors-emulator.mjs` after the matching assertions passed; not hand-authored. Local demo Firestore emulator, 2026-10-03. No UIDs, tokens or server-only state (the exporter rejects `claims` / `rivalWinsAtStepStart` / `rollSeed`).

- `intro-quest-1_status_fresh.json`: `status` for a pilot who has never claimed a step (no state doc; nothing written).
- `intro-quest-1_claim_capture_buddy.json`: the server-verified HARE capture step: 100 Holos + 1 Light Buddy Unit.
- `intro-quest-1_claim_chain_complete.json`: the bonus step; `status.complete: true`, `currentStepId: ""`.
- `vendor-3_catalog_marketplace.json`, `vendor-3_catalog_workshop.json`: both vendor catalogs for a pilot with 420 Holos (Heavy and Rank Skip not affordable).
- `vendor-3_purchase_buddy_heavy.json`: a Heavy Buddy Unit purchase reply (1500 Holos).
