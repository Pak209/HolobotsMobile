# Contract-Change: Intro Quests (DECISIONS #46) + vendor catalog and Medium/Heavy Buddy Units (DECISIONS #47)

Server lane, HolobotsMobile functions. Spec: Pak, 2026-10-03. Local only; nothing deployed.

> **vendor-1 → vendor-3 (DECISIONS #48, `claude/pilot-wardrobe`).** The vendor schema string is now `vendor-3` on `vendorCatalogHost` and `purchaseBuddyUnit` replies. Nothing below changes in shape, with three additions:
> - a third `vendorId`, `boutique`;
> - a `clothing` listing kind;
> - listing `details` values may be a `string[]` (clothing `tintable`).
>
> vendor-1 was never deployed. Fixture files are renamed `vendor-3_*`. See `Documentation/QA/2026-10-03-pilot-wardrobe/CONTRACT.md`.

Three new callables:
- `introQuestHost` (`intro-quest-1`)
- `vendorCatalogHost` (`vendor-1`)
- `purchaseBuddyUnit` (`vendor-1`)

No existing callable or wire shape changes. Every rejection carries `details.rejectionCode`.

## A. Intro Quests: `introQuestHost`, schema `intro-quest-1`

### Chain and rewards (`functions/src/lib/introQuests.ts`, one data module, producer defaults)

| # | stepId | kind | destinationId | How completion is checked | Holos | Gacha Tickets | Light Buddy Unit |
|---|---|---|---|---|---|---|---|
| 0 | `visit_mission_board` | visit | `mission_board` | client reports arrival | 50 | 0 | 0 |
| 1 | `visit_marketplace` | visit | `marketplace` | client reports arrival | 50 | 1 | 0 |
| 2 | `visit_workshop` | visit | `workshop` | client reports arrival | 75 | 0 | 0 |
| 3 | `capture_buddy` | capture | — | **server-verified**: HARE captured | 100 | 0 | 1 |
| 4 | `win_rival_battle` | rival | — | **server-verified**: `rivalWins` rose since the step became current | 100 | 1 | 0 |
| 5 | `visit_portal` | visit | `portal_neon_forest` | client reports arrival | 75 | 0 | 0 |
| 6 | `chain_complete` | bonus | — | all previous steps claimed | 150 | 1 | 0 |
| | **Total** | | | | **600** | **3** | **1** |

- Holos go to `users/{uid}.holosTokens`, tickets to `gachaTickets`, and the Unit to `buddyUnits.light` (the #44 tier map). A #43 integer inventory is migrated, and a missing field gets the starter Unit, in the same write.
- **capture_buddy (the harbor HARE)** is checked against server-only records:
  - the wild roster: `wildEncounterSessions/{uid}.entries` contains `{holobotId:"hare", availability:"owned", source:"capture"}`, or
  - a captured HARE receipt in `wildEncounterSessions/{uid}/receipts`. This covers capturing a HARE the pilot already owned from another source, which leaves the roster entry's source unchanged. The query is `limit(1)`.

  The client-writable `users/{uid}.holobots` array is **never** trusted. The sessions carry no location field, so "harbor" is presentation only and any captured HARE counts, including one captured before the quest reached this step.
- **win_rival_battle:** when this step becomes current, which is the moment `capture_buddy` is claimed, the server records `rivalWins` as a baseline. The claim passes only once `users/{uid}.rivalWins` (server-only since #43) is above that baseline. Wins from before the step don't count.

### Requests

```jsonc
{ "operation": "status" }
{ "operation": "claim", "stepId": "visit_marketplace", "requestId": "<client id, [A-Za-z0-9_-]{1,128}>", "destinationId": "marketplace" }
```

- `destinationId` is required for visit steps and must equal that step's `destinationId`. Other steps ignore it.
- `requestId`:
  - Generate a new one per claim attempt, and reuse it when you retry that same claim.
  - Retrying with the same `requestId` and `stepId` replays the original ruling: `alreadyProcessed: true`, and nothing is paid.
  - Reusing a `requestId` that was already used for a different step gets `invalid_request`.

### Replies

**`status`:**

```jsonc
{
  "schemaVersion": "intro-quest-1",
  "status": {
    "currentStepId": "visit_marketplace",   // "" when the chain is complete
    "complete": false,
    "steps": [
      { "stepId": "visit_mission_board", "index": 0, "kind": "visit", "destinationId": "mission_board",
        "claimed": true, "claimedAtMs": 1790000000000, "current": false,
        "reward": { "holos": 50, "gachaTickets": 0, "buddyUnitsLight": 0 } }
      // … one entry per step, in order; kind ∈ visit | capture | rival | bonus; destinationId "" for non-visit steps
    ],
    "totalReward": { "holos": 600, "gachaTickets": 3, "buddyUnitsLight": 1 }
  },
  "balances": { "holosTokens": 50, "gachaTickets": 0, "buddyUnits": { "light": 1, "medium": 0, "heavy": 0 } }
}
```

**`claim`:**

```jsonc
{
  "schemaVersion": "intro-quest-1",
  "stepId": "capture_buddy",
  "requestId": "req_capture_buddy",
  "alreadyProcessed": false,                // true on a replay; reward is then the original one
  "reward": { "holos": 100, "gachaTickets": 0, "buddyUnitsLight": 1 },
  "balances": { "holosTokens": 375, "gachaTickets": 2, "buddyUnits": { "light": 1, "medium": 0, "heavy": 0 } },
  "status": { /* as above, after the claim */ }
}
```

`status` never writes. A pilot who has never claimed a step has no state doc and gets the fresh chain.

### Rejections (`HttpsError`, `details.rejectionCode`)

| rejectionCode | HTTPS code | When |
|---|---|---|
| `invalid_request` | `invalid-argument` | malformed body; unknown `stepId`; bad `requestId`; wrong or missing `destinationId` on a visit step; a `requestId` already used for a different step |
| `out_of_order` | `failed-precondition` | the step is not the current step (anything ahead of it, including `chain_complete` early) |
| `already_claimed` | `already-exists` | the step was already claimed with a different `requestId` |
| `not_met` | `failed-precondition` | a verified step (`capture_buddy`, `win_rival_battle`) whose condition isn't met yet; retry once it is |
| `unavailable` | `unavailable` | missing profile; malformed quest state or balances (fails closed) |
| — | `unauthenticated` | not signed in |

Nothing is written on any rejection.

### Storage and security

- The state lives in `introQuests/{uid}`: `{schemaVersion, currentIndex, claims:{[stepId]:{requestId, claimedAtMs, reward}}, stepStartedAtMs, rivalWinsAtStepStart}`. It is a **top-level, server-only** doc.
- `firestore.rules` denies every client read and write, including delete. That's an explicit block plus the default deny, and rules tests cover it.
- **"Missing = fresh" safety:** only an *absent* doc means a fresh chain. A client can't delete or rewrite the doc. Any doc that is present but malformed or inconsistent (for example, claims that don't match `currentIndex`) fails closed as `unavailable`. It is never reset, so no step can be claimed or paid twice.
- `deleteUserAccountV2`, through `deleteUserData`, now deletes `introQuests/{uid}`.

## B. Vendors: `vendorCatalogHost` (read) and `purchaseBuddyUnit`, schema `vendor-1`

### Catalog request and reply

```jsonc
{ "operation": "catalog", "vendorId": "marketplace" }   // or "workshop"
```

```jsonc
{
  "schemaVersion": "vendor-1",
  "vendorId": "marketplace",
  "holosTokens": 420,
  "inventory": { "arenaPasses": 3, "gachaTickets": 0, "energyRefills": 0, "expBoosters": 0, "rankSkips": 0,
                 "wildcardBlueprints": 0, "parts": 1, "buddyUnits": { "light": 2, "medium": 0, "heavy": 0 } },
  "listings": [
    {
      "listingId": "item.arena_pass", "kind": "item", "displayName": "Arena Pass",
      "price": 50, "currency": "holos", "quantity": 1, "owned": 3,
      "affordable": true, "available": true, "availableAtMs": 0,
      "details": {},
      "purchase": { "callable": "purchaseMarketplaceItem", "request": { "itemName": "Arena Pass" } }
    }
    // …
  ]
}
```

- **marketplace:**
  - the 6 items of `MARKETPLACE_ITEM_NAMES`, priced by `getMarketplacePrice`;
  - the 4 boosters of `MARKETPLACE_BOOSTER_PRICES` (`details.packId`, `details.bonusItem`);
  - Medium and Heavy Buddy Units from `BUDDY_UNIT_PRICES_HOLOS` (`details.tierId`, `details.modelKey`).
- **workshop:** the 9 parts of `MARKETPLACE_PART_CATALOG` (`details.rarity`, `details.slot`; `owned` = copies held).
- `affordable` is `holosTokens >= price`.
- `available`/`availableAtMs` only gate the weekly Wildcard pack (`quantity: 5`) during its 7-day cooldown.
- The catalog is a pure read and never writes. A missing or #43-integer `buddyUnits` is *reported* as the inventory the next write will store, and a malformed one is `unavailable`.
- Unknown `vendorId` → `invalid_request` (`invalid-argument`).

### Prices (all from the server modules; Unity must render `price` and never hard-code it)

| Vendor | listingId | price (Holos) | Buy with |
|---|---|---|---|
| marketplace | `item.arena_pass` | 50 | `purchaseMarketplaceItem {itemName:"Arena Pass"}` |
| marketplace | `item.gacha_ticket` | 100 | `purchaseMarketplaceItem {itemName:"Gacha Ticket"}` |
| marketplace | `item.energy_refill` | 200 | `purchaseMarketplaceItem {itemName:"Energy Refill"}` |
| marketplace | `item.exp_booster` | 750 | `purchaseMarketplaceItem {itemName:"EXP Booster"}` |
| marketplace | `item.rank_skip` | 5000 | `purchaseMarketplaceItem {itemName:"Rank Skip"}` |
| marketplace | `item.wildcard_blueprints` | 300 (×5, weekly) | `purchaseMarketplaceItem {itemName:"Wildcard Blueprints"}` |
| marketplace | `booster.common` / `.champion` / `.rare` / `.elite` | 50 / 100 / 200 / 400 | `purchaseMarketplaceBooster {packId}` |
| marketplace | `buddy.medium` | **300** | `purchaseBuddyUnit {tierId:"buddy_medium", requestId}` |
| marketplace | `buddy.heavy` | **1500** | `purchaseBuddyUnit {tierId:"buddy_heavy", requestId}` |
| workshop | `part.combatMask`, `part.reinforcedChassis`, `part.boxerGloves`, `part.energyCore` | 300 (common) | `purchaseMarketplacePart {partId}` |
| workshop | `part.alloyChassis`, `part.plasmaCannon` | 750 (rare) | `purchaseMarketplacePart {partId}` |
| workshop | `part.voidMask`, `part.infernoClaws`, `part.quantumCore` | 1500 (epic) | `purchaseMarketplacePart {partId}` |

Light Buddy Units are not sold. They come from the starter grant, the daily rival win and the intro quest.

### Purchase calls (send `listing.purchase.request` to `listing.purchase.callable`)

| Callable | Request | Response | Errors |
|---|---|---|---|
| `purchaseMarketplaceItem` (existing) | `{itemName}` | `{holosTokens, itemName, price}` | `failed-precondition` "Not enough Holos."; `invalid-argument` "Unknown marketplace item." (also returned for the Wildcard pack inside its cooldown, an existing quirk, so gate it on the listing's `available`) |
| `purchaseMarketplaceBooster` (existing) | `{packId}` | `{granted:{battleCardId, battleCardIds[], godPack, itemName, itemQuantity, part:{name,slot}, parts[]}, holosTokens, price}` | `failed-precondition` "Not enough Holos."; `invalid-argument` "Unknown booster pack." |
| `purchaseMarketplacePart` (existing) | `{partId}` | `{holosTokens, part:{name, rarity, slot}, price}` | `failed-precondition` "Not enough Holos."; `invalid-argument` "Unknown marketplace part." |
| **`purchaseBuddyUnit`** (new) | `{tierId:"buddy_medium"\|"buddy_heavy", requestId}` | `{schemaVersion:"vendor-1", requestId, tierId, price, holosTokens, buddyUnits:{light,medium,heavy}, alreadyProcessed}` | see below |

The three existing callables return no `rejectionCode` and are not idempotent. A retried request can buy twice, as it always could. Only `purchaseBuddyUnit` is guarded by a `requestId`.

**`purchaseBuddyUnit` details:**
- One transaction does three things together: subtracts `price` from `holosTokens`, increments `buddyUnits.<tier>` by 1 (migrating a #43 integer or applying the starter grant first), and creates the receipt `vendorPurchases/{uid}/receipts/{requestId}`.
- Retrying the same `requestId` returns the stored reply with `alreadyProcessed: true`. Nothing is bought twice, even under parallel retries.
- The bought Unit is immediately throwable through `wildEncounterHost` (acquisition-2, `toyId:"buddy_medium"` or `"buddy_heavy"`).

| rejectionCode | HTTPS code | message / when |
|---|---|---|
| `not_enough_holos` | `failed-precondition` | **"Not enough Holos."** (the existing refusal text). Nothing is written and no receipt is created, so the same `requestId` can succeed later. |
| `invalid_request` | `invalid-argument` | bad body; `tierId` not for sale (including `buddy_light`); bad or missing `requestId` |
| `sequence_conflict` | `already-exists` | the `requestId` was already used to buy a different tier |
| `unavailable` | `unavailable` | missing profile, or malformed Holos or inventory |
| — | `unauthenticated` | not signed in |

### Storage and security

- Receipts live at `vendorPurchases/{uid}/receipts/{requestId}`, **top-level and server-only**. Rules deny every client read and write, so a client can't pre-seed or forge a receipt. They sit deliberately outside `users/{uid}/…`, whose subcollections are owner-writable.
- `holosTokens`, `gachaTickets` and `buddyUnits` stay in the protected MapDiff set on `users/{uid}`.
- `deleteUserData` now deletes `vendorPurchases/{uid}`.

## Unity hand-off

1. **Intro quests:** call `introQuestHost`.
   - Render the quest log from `status.steps` (`claimed`, `current`, `reward`) and the HUD from `balances`.
   - When the player reaches a visit step's destination, send `claim {stepId, requestId, destinationId}` using that step's `destinationId` from `status`.
   - For `capture_buddy` and `win_rival_battle`, send `claim` after the capture or win reply arrives. Treat `not_met` as "not yet".
   - Claim `chain_complete` when it becomes current.
   - Keep one `requestId` per claim attempt and resend it on network retry.
   - Show `reward` from the reply. Never compute amounts or order locally.
2. **Vendors:** call `vendorCatalogHost {operation:"catalog", vendorId}` when a vendor UI opens and after every purchase.
   - Render `listings` (`displayName`, `price`, `owned`, `affordable`, `available`/`availableAtMs`) and the `holosTokens`/`inventory` header.
   - To buy, send `listing.purchase.request` to `listing.purchase.callable`. For `purchaseBuddyUnit`, replace the `"<client-generated>"` `requestId` with a fresh id per purchase attempt, reused on retry.
3. **Medium/Heavy Buddy Units:** after `purchaseBuddyUnit`, the reply's `buddyUnits` is authoritative. The new tiers appear in the next `wildEncounterHost` refresh as throwable `buddy_medium` / `buddy_heavy` items.
4. **Schema versions:** `intro-quest-1` (intro quests) and `vendor-1` (catalog and Buddy Unit purchase). The existing purchase callables are unversioned and unchanged.
5. Unity holds no prices, rewards, order or verification logic. It renders replies only.

Fixtures (generated by `functions/scripts/test-intro-quests-vendors-emulator.mjs` after its assertions pass): `fixtures/`.

## Deploy (Pak approves; not run)

Rules first, then the three new functions plus `deleteUserAccountV2`, whose deletion list grew:

```bash
firebase deploy --project holobots-24046 --only firestore:rules
firebase deploy --project holobots-24046 --only functions:introQuestHost,functions:vendorCatalogHost,functions:purchaseBuddyUnit,functions:deleteUserAccountV2
```

The full list is now 36 functions and is in `functions/README.md`. Use it for any whole-codebase redeploy.
