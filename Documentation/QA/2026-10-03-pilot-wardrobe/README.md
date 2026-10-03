# Pilot wardrobe — local review branch

Base: origin/claude/intro-quests-vendors at 6f725af (PR #56). Branch: codex/pilot-wardrobe. No push or deployment.

## Contract change

`wardrobe-1`: authenticated `wardrobeHost` operations read, purchase, equip. Purchase takes itemId and requestId; equip takes requestId and recipe `{schemaVersion:'wardrobe-1',frame:'pilot-a',parts:{hair,body,jacket,pants,footwear}}`. Mutation replies include entitlements, saved recipe, Holos balance and alreadyProcessed. Request identifiers are account-scoped and shared across operations; a changed command cannot reuse a receipt. Read returns entitlements and recipe. The recipe is canonicalized before hashing. Unknown slots, variants, frames or schemas fail closed.

Vendor catalog advances to `vendor-2`, adding clothing kind with existing economy price constants and wardrobeHost purchase commands. Unity vendor consumers must accept vendor-2 before this branch is deployed; there is no Unity install in this item. Existing creator starter choices remain free. Six previously uninstalled vault variants are the proposed paid catalog, not new geometry. Prices and rarity suggestions await producer review; the backend table is the authority.

Storage: `wardrobes/{uid}` owns entitlements and recipe; its receipts subcollection makes retries atomic with the user Holos update. Client writes are denied, owner reads allowed. Recursive account deletion includes this entire tree. Two purchases of an already-owned permanent item do not charge again. Equip validates both ownership and slot and never charges.

## Verification

TypeScript and shared parity build: PASS. Domain tests: 10/10 (wardrobe plus existing vendor tests). Local Firestore emulator: transaction concurrency, retry, conflict, insufficient balance, equip and recursive deletion PASS. Complete rules suite: 88/88 PASS. Authenticated callable read and anonymous refusal PASS. Rules test: owner read, foreign/anonymous read denial, creation/mutation/deletion/receipt write denial PASS. Initial sandbox startup denied local ports; elevated local-only run passed. Emulator demo project and port 8095; all services stopped afterward. No live account, production Firebase or Unity usage.

## Next integration

Claude reviews after #56 merges. Register the six paid variant textures in Unity only after visual approval; consume entitlements and saved recipe from this host rather than treating them as free starter items. Existing local creator saves need an explicit migration, not silent trust by the backend. No mobile wardrobe screen or production deployment claimed.
