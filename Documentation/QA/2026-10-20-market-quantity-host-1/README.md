# market-quantity-host-1: `quantity` on purchaseMarketplaceItem (marketplace-item-purchase-1)

Base: main `d4bfdf2`. HolobotsUnity DECISIONS #72.26 (UI plan P3, approved; Phase B ships one item per confirm first). Host code, schema, fixture and tests. No deploy, no device, no real account. `firestore.rules` is unchanged.

## The contract

A `purchaseMarketplaceItem` request that carries `quantity` buys 1 to 99 of one stackable item as one purchase. A request without `quantity` is the legacy single purchase. Its reply, refusals and writes are unchanged byte for byte, so the mobile apps are unaffected.

| | Legacy (unchanged) | Quantity (new) |
|---|---|---|
| Request | `{itemName}` | `{itemName, quantity, requestId}`, and no other key |
| `quantity` | none | integer 1 to 99. Above 1 only for stackables |
| Holos spent | unit price | `unitPrice × quantity`, in the same update that adds `quantity` to the counter |
| Ledger | none | one server-only entry at `vendorPurchases/{uid}/marketplaceItems/{requestId}` |
| Retry | buys again | same `requestId` replays the stored reply with `alreadyProcessed: true`. The same id for another item or quantity is `sequence_conflict` |
| Cap | none | a stackable's counter may not pass **999** after the purchase |
| Reply | `{holosTokens, itemName, price}` | `{schemaVersion, requestId, itemName, quantity, unitPrice, price, holosTokens, owned, alreadyProcessed}` |

- **Stackables:** Arena Pass, Gacha Ticket, Energy Refill, EXP Booster and Rank Skip.
- **Not stackable:** the weekly Wildcard pack ("Wildcard Blueprints"). It takes quantity 1 only, grants 5 units and keeps the 7-day cooldown.
- **`price` is the total spent; `unitPrice` is the price of one unit.** For quantity 1 they are equal, as in the legacy reply.
- **Two different quantities.** The vendor-3 listing's own `quantity` is the units one purchase grants: 1 for every stackable, 5 for the Wildcard pack. The request's `quantity` is how many purchases of that listing to make.
- **Onboarding:** a quantity purchase counts as one vendor purchase (step 4 to 5), not one per unit.

Refusals are callable errors. Clients key on `details.rejectionCode`. The English text is a host fallback, and Lex owns the lines the player sees. The host checks in this order and stops at the first refusal. A refusal writes nothing, so the same request can succeed later.

| Order | `rejectionCode` | HTTPS | When | Extra `details` |
|---|---|---|---|---|
| 1 | `invalid_request` | invalid-argument | no `itemName`; `quantity` not an integer 1 to 99; `requestId` missing or not `^[a-zA-Z0-9_-]{1,128}$`; any other key, such as a client `price` | none |
| 2 | `unavailable` | not-found | no profile | none |
| 3 | `sequence_conflict` | failed-precondition | the `requestId` was already used for another item or quantity | none |
| 4 | `unknown_item` | invalid-argument | not a marketplace single item | none |
| 5 | `not_stackable` | invalid-argument | Wildcard pack with quantity above 1 | none |
| 6 | `unavailable` | failed-precondition | the stored balance, counter or pack time is malformed. These are read strictly and never coerced | none |
| 7 | `on_cooldown` | invalid-argument | Wildcard pack inside its 7 days. The message is the legacy "Unknown marketplace item." | none |
| 8 | `over_cap` | failed-precondition | `owned + quantity > 999` | `cap`, `owned`, `maxQuantity` (`999 − owned`, never below 0) |
| 9 | `not_enough_holos` | failed-precondition | `holosTokens < unitPrice × quantity` | `price`, `holosTokens`, `shortfall` |

`over_cap` comes before `not_enough_holos`, because a purchase the pilot cannot hold does not need funds. `shortfall` is the host's number for the plan's "Need N more" line.

## Files

- `Schemas/marketplace-item-purchase-1.json` (new): `definitions` request, reply, refusalDetails, receipt (the ledger entry), stackableItemName.
- `functions/src/lib/marketplaceQuantity.ts` (new, pure): the rule.
- `functions/src/economy/marketplaceQuantityStore.ts` (new): the transaction.
- `functions/src/economy/purchaseMarketplaceItem.ts`: a branch on `quantity`. The legacy body is untouched.
- `functions/src/lib/marketplaceRefusals.ts`:
  - new `QUANTITY_REFUSALS` table and three new codes;
  - `refusalError(r, extra = {})`, where legacy callers pass nothing, so `details` stays exactly `{rejectionCode}`;
  - the legacy `REFUSALS` table and its pin are unchanged.
- Frozen fixture `functions/scripts/fixtures/marketplace-item-purchase-1/cases.json`: 7 accepted cases (one of them a replay) and 20 refusals. Its generator is `functions/scripts/generate-marketplace-item-purchase-fixture.mjs`.
- Tests:
  - `functions/scripts/test-marketplace-quantity.mjs` (11 tests, in `npm test`);
  - `functions/scripts/test-marketplace-quantity-emulator.mjs` (8 tests, in `npm run test:emulator`);
  - `rules-tests/tests/marketplace-quantity.test.ts` (1 test).

## Unity-side mirror (client lane later; this lane changes no Unity file)

- **Schema:** copy `Schemas/marketplace-item-purchase-1.json` verbatim to HolobotsUnity `Schemas/marketplace-item-purchase-1.json`.
- **Fixture:** copy the fixture verbatim to HolobotsUnity `Schemas/fixtures/marketplace-item-purchase-1.fixture.json`.
- **Request field: `quantity` (int, 1 to 99) plus `requestId`** on the `purchaseMarketplaceItem` request. The carrier is `Holobots.Dashboard.VendorCatalogContract.Purchase(JObject listing, string requestId, int quantity)`. For a `purchaseMarketplaceItem` listing it returns the listing's own request with `"quantity"` and `"requestId"` added. Without a quantity it keeps today's `{itemName}`.
- **Constants beside it, mirrored from the schema:**
  - `QuantitySchema = "marketplace-item-purchase-1"`;
  - `QuantityMin = 1`, `QuantityMax = 99`, `StackCap = 999`;
  - `StackableItemNames`, from `definitions.stackableItemName`.
- **Reply validator:** reads `{schemaVersion, requestId, itemName, quantity, unitPrice, price, holosTokens, owned, alreadyProcessed}` and fails closed on anything else.
- **Refusal reader:** reads `over_cap {cap, owned, maxQuantity}` and `not_enough_holos {price, holosTokens, shortfall}`.
- **QA fake host:** the `purchaseMarketplaceItem` case in `QaLocalItemHost.cs` answers the same shape.
- **Stepper limit is display only.** The stepper's max is `min(99, 999 − owned)`. The host still refuses anything past it.

## Deploy surface (HELD: Pak's word, through the producer)

The only function whose behaviour changes is **purchaseMarketplaceItem**. `purchaseMarketplaceBooster` and `purchaseMarketplacePart` import the edited `marketplaceRefusals.ts`, but their output is the same, so they do not need a redeploy. `deleteUserAccount` already removes `vendorPurchases/{uid}` recursively, and the rules already deny `vendorPurchases/{uid}/{document=**}`. Neither needs a deploy.

```
firebase deploy --project holobots-24046 --only functions:purchaseMarketplaceItem
```

## Evidence

- `npm run build`: shared parity is in sync and tsc is clean.
- **`npm test`:** 375 tests, 374 pass, 0 fail, 1 skipped. Base main had 364 tests: 363 pass, 1 skipped. The 11 new tests all pass.
- **`npm run test:emulator`** (Firestore emulator 1.19.8, run on a scratch port): 231 tests, 230 pass, 1 fail. The 8 new tests all pass.
  - The 1 failure is already on base main (223 tests, 222 pass, the same 1 fail): `test-onboarding-emulator.mjs` "repair advances 5 → 6" expects 120 HP and gets 144. That test predates the #72.1 KO-heal floor (40 of 160 HP starts from the 64 HP floor, and 64 + 80 = 144). It is not touched here.
  - The run rewrote `Documentation/QA/2026-10-01-buddy-unit-tiers/fixtures/`. That folder was reverted and is not in this PR.
- **rules-tests (vitest under the emulator):** 23 files, 117 tests, all pass, including the new ledger-deny test.
- **Fixture:** every case is replayed through Firestore, and the reply, the `users/{uid}` write and the ledger entry match it byte for byte. For a refusal, the same error comes back and nothing is written. The fixture can be regenerated from the host code with a byte-identical result, which a test checks.
- **Known-bads the schema refuses:**
  - replies: quantity 100 or 0, an extra field, a stackable `owned` of 1000, a Wildcard quantity of 2, the wrong schemaVersion, a missing `owned`;
  - requests: a client `price`, Wildcard ×2, no `requestId`, the legacy `{itemName}` shape;
  - refusal details: `over_cap` without `maxQuantity`, `not_enough_holos` with `cap`, `not_stackable` with numbers, an unknown code.
- **Mutation control:** with `price = unitPrice` in place of `unitPrice × quantity`, 3 of the 11 unit tests fail. With it restored, all 11 pass.
- **Double tap:** the same quantity request sent twice at once buys once. There is one debit and one ledger entry, and the second reply is the replay.

## HELD and open (Pak's word)

1. **Deploy:** the command above.
2. **The cap value 999 is this lane's pick.** It is an economy number, so the tune lane or Pak confirms it. It applies only to the quantity path. Legacy single buys and grants from other sources (boosters, gacha, quests) stay uncapped, as today. Making it a true inventory cap everywhere is a separate rule change.
3. **Premise gap:** P3 names "kits, patches" as the stackables. On the host, those healing items (Emergency Patch, Repair Kit, Full Restore) are bought through `desktopItemsHost` `{schemaVersion: "desktop-items-2", operation: "buy"}`, not `purchaseMarketplaceItem`. This lane changed only the callable that was approved. Quantity for kits and patches needs its own desktop-items Contract-Change.
4. **The catalog does not say what is stackable.** vendor-3 listings carry no stackable flag or max, so until a separate approval the Unity client mirrors the schema's stackable list and cap. One option is an additive `maxQuantity` on each `purchaseMarketplaceItem` listing (vendor-3; Unity's `ValidListing` already tolerates extra keys).
