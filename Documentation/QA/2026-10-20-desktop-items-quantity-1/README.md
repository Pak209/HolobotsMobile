# desktop-items-quantity-1: `quantity` on the desktopItemsHost healing buy (desktop-items-2, additive)

Base: main `d4bfdf2`. HolobotsUnity DECISIONS #72.32: Pak approved this second Contract-Change so that healing items can be bought in quantity. It mirrors market-quantity-host-1 ([#175](https://github.com/Pak209/HolobotsMobile/pull/175), `purchaseMarketplaceItem`) for the three healing items, which are bought through `desktopItemsHost`. This change has host code, a schema, a fixture and tests. There is no deploy, no device and no real account. `firestore.rules` is unchanged. It does not stack on #175: no helper is shared, and the two PRs touch different files.

## The contract

A `desktopItemsHost` request `{schemaVersion: "desktop-items-2", operation: "buy", itemId, requestId, quantity}` buys 1 to 99 of one healing item as one purchase. A request without `quantity` is today's one-per-buy request. Its reply, refusals, receipt identity and writes are unchanged byte for byte, so the current clients are unaffected.

| | Legacy (unchanged) | Quantity (new) |
|---|---|---|
| Request | `{schemaVersion, operation: "buy", itemId, requestId}` | the same keys plus `quantity`, and no other key: no `packId`, `holobotId` or `currentHealth` |
| `quantity` | none | an integer from 1 to 99, only for `item.emergency_patch`, `item.repair_kit` or `item.full_restore` |
| Holos spent | unit price | `unitPrice × quantity`, in the same `users/{uid}` update that raises the stock by `quantity` |
| Ledger | one receipt per `requestId` at `itemInventories/{uid}/receipts/{requestId}` | **the same receipt, unchanged in shape.** Its `identity` is the validated request as JSON, so it now includes `quantity` |
| Retry | the same `requestId` replays with `alreadyProcessed: true` | the same. The same id with another item, another quantity or the legacy shape is `sequence_conflict` |
| Cap | none | a healing stock may not pass **999** after the purchase |
| Reply | the inventory snapshot with `result: {kind: "buy", itemId}` | the same snapshot with `result: {kind: "buy", itemId, quantity, unitPrice, price, owned}` |

- **Scope.** `quantity` on any other item, any other operation, or beside `packId`, `holobotId` or `currentHealth` is `invalid_request`. This is the same gate that `currentHealth` already uses.
  - The other items this callable sells are the marketplace stackables (Energy Refill, EXP Booster and so on). Their quantity path is `purchaseMarketplaceItem` in #175. Calling them `not_stackable` here would contradict #175, so this path has no `not_stackable` code.
- **`price` is the total spent; `unitPrice` is the price of one unit.** The new balance is the snapshot's top-level `holosTokens`. `owned` equals the item row's `owned` in the same reply.
- **Two different quantities.** The vendor-3 healing listings are unchanged: `quantity` 1 and the same `purchase.request`. The listing's `quantity` is the units one listing purchase grants. The request's `quantity` is how many units to buy.
- **Onboarding.** A quantity buy counts as one vendor purchase (step 4 to 5), not one per unit.
- **Between battles.** The existing rule still applies: a healing buy during an open zone expedition is `between_battles_only`.
- **Uncapped paths.** Legacy single buys and grants from other sources stay uncapped, as today. Those sources are the genesis kit, the cache Emergency Patch, rank rewards and Workshop crafts.

Refusals are callable errors. As with every `desktopItemsHost` refusal, the error is `failed-precondition`, its message is the code, and `details.rejectionCode` is the code. The host checks in this order and stops at the first refusal. A refusal writes nothing, so the same request can succeed later.

| Order | `rejectionCode` | When | Extra `details` |
|---|---|---|---|
| 1 | `invalid_request` | `quantity` is not an integer 1 to 99, or it appears on another operation or item, or beside `packId`, `holobotId` or `currentHealth`. Also: `requestId` missing or not `^[a-zA-Z0-9_-]{1,128}$`, any unknown key such as a client `price`, or the wrong `schemaVersion` | none |
| 2 | `unavailable` | no profile | none |
| 3 | `sequence_conflict` | the `requestId` was used for another item, quantity or shape. A same-identity retry replays here instead | none |
| 4 | `between_battles_only` | a zone expedition is open | none |
| 5 | `unavailable` | the stored balance or stock is malformed. These are read strictly by the shared `healingStock` reader, where absent or null reads as 0, as it always has | none |
| 6 | `over_cap` | `owned + quantity > 999` | `cap`, `owned`, `maxQuantity` (`999 − owned`, never below 0) |
| 7 | `not_enough_holos` | `holosTokens < unitPrice × quantity` | `price`, `holosTokens`, `shortfall` |

`over_cap` comes before `not_enough_holos`, as in #175. The `over_cap` and `not_enough_holos` details use the same keys as #175. The differences from #175 come from this callable's existing conventions:

- every refusal is `failed-precondition` with the code as its message;
- `alreadyProcessed` is present only on a replay;
- `requestId` is not echoed in the reply;
- `unknown_item`, `not_stackable` and `on_cooldown` cannot occur on this path.

## Files

- `Schemas/desktop-items-2.json` (new on the Mobile side). It is HolobotsUnity `Schemas/desktop-items-v2.schema.json` plus:
  - `$id`, a description, the `quantity` property and one `allOf` rule;
  - `$defs`: `healingItemId`, `quantity`, `quantityBuyResult`, `quantityBuyReply`, `quantityRefusalDetails` and `receipt`.
  - Every request the old file accepted, the new file still accepts. The diff only adds lines.
- `functions/src/lib/repairItems.ts`:
  - `HEALING_QUANTITY_MIN/MAX` (1/99) and `HEALING_STACK_CAP` (999);
  - `healingQuantityPurchase`, the pure rule;
  - `RepairError` gains an optional `extra`.
- `functions/src/lib/desktopItems.ts`:
  - `validateItemCommand` accepts `quantity` behind the gate;
  - `applyItemCommand` gets a quantity `buy` branch, and the legacy branch is untouched;
  - `ItemError` gains an optional `extra`.
- `functions/src/vendors/desktopItemsHost.ts`: the callable copies `ItemError.extra` into `details` beside `rejectionCode`. Legacy errors have no `extra`, so their `details` stay exactly `{rejectionCode}`. The transaction is unchanged.
- **Frozen fixture:** `functions/scripts/fixtures/desktop-items-2-quantity/cases.json`, written by `functions/scripts/generate-desktop-items-quantity-fixture.mjs`.
  - It holds 7 accepted cases (one of them a replay) and 31 refusals, plus 8 `legacyCases` without `quantity`.
  - Each reply is stored as a digest: `schemaVersion`, `holosTokens`, `result`, the bought item's row and, on a replay, `alreadyProcessed`. Each reply also carries `replySha256` over the whole reply, so the rest of the snapshot is pinned without being copied into every case.
- **Tests:**
  - `functions/scripts/test-desktop-items-quantity.mjs`: 10 tests, in `npm test`;
  - `functions/scripts/test-desktop-items-quantity-emulator.mjs`: 8 tests, in `npm run test:emulator`;
  - `rules-tests/tests/desktop-items-receipts.test.ts`: 1 test. It shows that clients cannot read or write `itemInventories/{uid}` or its receipts. The catch-all deny already covered this path; until now no rules-tests file did.

## Unity-side mirror (client lane later; this lane changes no Unity file)

- **Schema:** replace HolobotsUnity `Schemas/desktop-items-v2.schema.json` with Mobile `Schemas/desktop-items-2.json` verbatim, keeping the Unity filename. The commit is a `Contract-Change:` commit, as for `currentHealth` (`26a528520`).
- **Fixture:** copy it verbatim to HolobotsUnity `Schemas/fixtures/desktop-items-2-quantity.fixture.json`.
- **Request field: `quantity` (int, 1 to 99) on a healing `buy`.**
  - `Holobots.Dashboard.ItemInventoryContract.Intent(...)` gains `int? quantity = null`. It writes `"quantity"` only when the operation is `"buy"`, the `itemId` is a healing id and the value is 1 to 99, and never beside `packId`, `holobotId` or `currentHealth`.
  - `VendorCatalogContract.Purchase(listing, requestId, quantity)`, the carrier #175 names, adds `"quantity"` to a `desktopItemsHost` healing listing's request. Without a quantity it keeps today's request.
  - `ItemInventoryContract.SameAction` must also compare `quantity`. A retry has to send the same quantity under the same `requestId`, or the host answers `sequence_conflict`.
- **Constants beside it, mirrored from the schema:**
  - `QuantityMin = 1`, `QuantityMax = 99`, `StackCap = 999`;
  - `HealingItemIds`, from `$defs.healingItemId`.
- **Reply reader:** `ItemInventoryContract.Valid` is unchanged, because the snapshot shape is the same. A quantity reply's `result` is read as `{kind: "buy", itemId, quantity, unitPrice, price, owned}` and fails closed on anything else.
- **Refusal reader:** reads `over_cap {cap, owned, maxQuantity}` and `not_enough_holos {price, holosTokens, shortfall}`. These are the same keys as the #175 reader. The status here is always `failed-precondition`.
- **QA fake host:** the `buy` case in `QaLocalItemHost.cs` answers the same shape. It charges price × quantity, enforces the cap and returns the extra numbers.
- **Stepper limit is display only.** The stepper's max is `min(99, 999 − owned)`. The host still refuses anything past it.

## Deploy surface (HELD: Pak's word, through the producer)

The only function whose behaviour changes is **desktopItemsHost**.

- Other hosts import the edited `repairItems.ts`: `workshopCraftHost`, `workshopHealHost`, `duelHealingHost`, the vendor catalog and the zone/expedition code. They never call `healingQuantityPurchase`, and they still build `{rejectionCode}` themselves, so their output is the same and they need no redeploy.
- `deleteUserAccount` already removes `itemInventories/{uid}` recursively, and the rules already deny the path. Neither needs a deploy.

```
firebase deploy --project holobots-24046 --only functions:desktopItemsHost
```

## Evidence

- **`npm run build`:** shared parity is in sync and tsc is clean.
- **`npm test`:** 374 tests, 373 pass, 0 fail, 1 skipped. Base main had 364 tests: 363 pass, 1 skipped. The 10 new tests all pass.
- **`npm run test:emulator`** (Firestore emulator, run on a scratch port with a scratch config of the same shape): 231 tests, 230 pass, 1 fail. The 8 new tests all pass.
  - The 1 failure is already on base main and is the same one #175 reports: `test-onboarding-emulator.mjs` "repair advances 5 → 6" expects 120 HP and gets 144, because of the #72.1 KO-heal floor. It is not touched here.
  - The run rewrote `Documentation/QA/2026-10-01-buddy-unit-tiers/fixtures/`. That folder was reverted and is not in this PR.
- **rules-tests (vitest under the emulator):** 23 files, 117 tests, all pass. Base had 22 files and 116 tests.
- **Legacy parity against a build of main `d4bfdf2`:** 1112 legacy requests (no `quantity`) were run through both builds' `validateItemCommand` + `applyItemCommand`. They covered every operation, 11 item ids, 4 extra-key shapes and 8 profiles (poor, at or above 999, malformed, no stocks).
  - Every result was identical: replies, writes, receipt identity, and the callable's error code and details. 351 were accepted.
  - The only normalisation is the cache reward ids, which embed `Date.now()` on main too.
  - The 8 frozen `legacyCases` were also recomputed with main's build and all match.
- **Fixture:**
  - Every case is replayed through Firestore. The reply digest and `replySha256`, the `users/{uid}` write and the receipt match it.
  - For a refusal, the same error comes back and nothing is written.
  - Regenerating from the host code gives a byte-identical file, which a test checks.
- **Known-bads the schema refuses:**
  - requests: a non-healing item, another operation, quantity 0 / 100 / 2.5 / `"5"` / null, `holobotId` / `packId` / `currentHealth` beside `quantity`, a client `price`;
  - results: quantity 100 or 0, an extra field, `owned` 1000, a non-healing item, the legacy `{kind, itemId}` result, a missing `owned`;
  - refusal details: `over_cap` without `maxQuantity`, `not_enough_holos` with `cap` or without `shortfall`, `invalid_request` with numbers, an unknown code.
- **Mutation control:** with `price = unitPrice` in place of `unitPrice × quantity`, 4 of the 10 unit tests fail. With it restored, all 10 pass.
- **Double tap:** the same quantity request sent twice at once buys once. There is one debit and one receipt, and the second reply is the replay.

## HELD and open (Pak's word)

1. **Deploy:** the command above.
2. **The cap value 999 is the same pick as #175.** It is an economy number, so the tune lane or Pak confirms it. It applies only to the quantity path.
3. **Design choice for the producer:** `quantity` on a non-healing `desktopItemsHost` buy is `invalid_request`, not `not_stackable`. Those items buy in quantity through #175's `purchaseMarketplaceItem`.
4. **The catalog does not say what is stackable,** as in #175. The vendor-3 healing listings carry no stackable flag or max, so the Unity client mirrors the schema's `healingItemId` list and the cap. The same additive `maxQuantity` option applies.

## Noticed, not changed

- Several tests that exercise `desktopItemsHost` are not in `npm test` or `npm run test:emulator` on main:
  - `test-desktop-items.mjs`, `test-desktop-items-emulator.mjs`, `test-healing-*-emulator.mjs`, `test-rival-health-emulator.mjs`, `test-arena-match-emulator.mjs`;
  - `test-zone-expedition*-emulator.mjs`, which only runs under `test:zone:emulator`.
- They were run here anyway:
  - `test-desktop-items.mjs`: 10 of 11 pass, the same as on main. The one failure, "repair uses owned squad target...", expects `currentHealth` on a `use` to throw, which healing-items-2 made valid.
  - The 12 emulator files: 92 of 94 pass. The 2 failures are the rules checks in `test-desktop-items-emulator.mjs`, which hard-code port 18080; the new rules-tests file covers that path.
- A malformed `buddyUnits` makes the catalog throw `VendorError`, which `desktopItemsHost` does not map, so it surfaces as an internal error. This happens on main for every operation, and it is unchanged here.
