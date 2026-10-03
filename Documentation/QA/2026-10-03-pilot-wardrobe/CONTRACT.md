# Contract-Change: wardrobe-2 appearance recipe; vendor-3 clothing listings (DECISIONS #48)

Server lane, HolobotsMobile functions. Spec: Pak, 2026-10-03 (Unity DECISIONS #48, Phase 3). Stacked on PR #56, which is not merged. Local only; nothing deployed.

The pilot creator is built on the BoZo Anime Pack (a Mixamo humanoid with about 105 modular parts, blendshapes and tinting).
- **Unity:** presentation only.
- **The server owns:** prices, ownership and the saved appearance. Unity sends a recipe, the server validates and stores it, and Unity renders what the server returns.

wardrobe-1 (Astra's local draft) was never deployed and is **replaced**, not migrated. A stored `wardrobe-1` doc fails closed; none exist outside an emulator.

## Data module: `functions/src/lib/wardrobeCatalog.ts` (placeholder ids)

Everything below lives in that one file:
- slots
- free bodies and faces
- slider and colour whitelists
- the size cap
- items

**All ids that start with `ph.` are placeholders** until the BoZo pack audit. `status` reports `catalog.placeholder: true`.

### Slots (PROVISIONAL until the pack audit)

| slot | required | rule |
|---|---|---|
| `hair` | yes | always an item |
| `top` | yes | always an item |
| `bottom` | yes | always an item |
| `footwear` | yes | always an item |
| `gloves` | no | item or `null` (none) |
| `hat` | no | item or `null` (none) |
| `faceAccessory` | no | item or `null` (none) |
| `backAccessory` | no | item or `null` (none) |

The body base and face preset are **not** slots. They are free choices inside the recipe:
- `baseBody` ∈ `ph.body.a`, `ph.body.b`, `ph.body.c`
- `face` ∈ `ph.face.01`, `ph.face.02`, `ph.face.03`, `ph.face.04`

### Whitelists

- **Sliders:** `height, build, headSize, shoulderWidth, legLength, eyeSize, eyeSpacing, noseSize, mouthWidth, jaw, cheek, ear`.
  - Values must be finite numbers in **[-1, 1] inclusive**.
  - Out-of-range, NaN and Infinity values are **rejected** (`invalid_request`), never clamped. Clamping would silently store something other than what the client sent, and a retry with the same `requestId` would then fingerprint differently.
  - A missing key means the default `0`.
- **Colours:** `skin, hair, eyes, primary, secondary, accent`.
  - Values must be strict `#RRGGBB`. Either case is accepted and stored upper-case.
  - A missing channel means its default: skin `#E8B996`, hair `#2B2B2B`, eyes `#3A6EA5`, primary `#1F8FFF`, secondary `#20232A`, accent `#FFC83D`.
- **Size cap:** the encoded recipe (JSON, UTF-8) must be ≤ **4096 bytes**, else `invalid_request`. This is checked before any other validation.

### Items

**Starter items** are free and always usable. They are never sold and never stored as entitlements.

| itemId | slot | displayName | tintable |
|---|---|---|---|
| `ph.hair.short_01` | hair | Short Crop | hair |
| `ph.hair.long_01` | hair | Long Sweep | hair |
| `ph.top.tee_01` | top | Pilot Tee | primary |
| `ph.top.jacket_01` | top | Flight Jacket | primary, secondary |
| `ph.bottom.pants_01` | bottom | Cargo Pants | secondary |
| `ph.bottom.shorts_01` | bottom | Track Shorts | secondary |
| `ph.footwear.sneakers_01` | footwear | Runner Sneakers | accent |
| `ph.footwear.boots_01` | footwear | Field Boots | — |
| `ph.gloves.fingerless_01` | gloves | Fingerless Gloves | secondary |
| `ph.hat.cap_01` | hat | Pilot Cap | primary |
| `ph.faceAccessory.visor_01` | faceAccessory | Clear Visor | accent |
| `ph.backAccessory.pack_01` | backAccessory | Mini Pack | secondary |

**Sold at the new `boutique` vendor.** The price is `MARKETPLACE_PART_PRICES[rarity]` from the existing economy module (common 300, rare 750, epic 1500).

| itemId | slot | displayName | rarity | price (Holos) | tintable |
|---|---|---|---|---|---|
| `ph.hair.mohawk_01` | hair | Neon Mohawk | rare | 750 | hair |
| `ph.hair.twintails_01` | hair | Twin Tails | common | 300 | hair |
| `ph.top.hoodie_01` | top | Circuit Hoodie | common | 300 | primary, accent |
| `ph.top.armor_01` | top | Harbor Armor Vest | epic | 1500 | primary, secondary, accent |
| `ph.bottom.joggers_01` | bottom | Glow Joggers | common | 300 | secondary, accent |
| `ph.bottom.armor_01` | bottom | Plated Greaves | rare | 750 | secondary |
| `ph.footwear.hightops_01` | footwear | Hover High-Tops | rare | 750 | accent |
| `ph.gloves.gauntlets_01` | gloves | Arc Gauntlets | rare | 750 | accent |
| `ph.hat.helmet_01` | hat | Rival Helmet | epic | 1500 | primary, accent |
| `ph.faceAccessory.mask_01` | faceAccessory | Neon Forest Mask | common | 300 | accent |
| `ph.backAccessory.wings_01` | backAccessory | Holo Wings | epic | 1500 | accent |
| `ph.backAccessory.cape_01` | backAccessory | Courier Cape | common | 300 | primary |

I chose `boutique` over `marketplace` so clothing gets its own city vendor and the marketplace's existing listing set stays untouched.

## `wardrobeHost`, schema `wardrobe-2`

Every request carries `schemaVersion: "wardrobe-2"`. A missing or other version gets `invalid_request`.

### Requests

```jsonc
{ "schemaVersion": "wardrobe-2", "operation": "status" }
{ "schemaVersion": "wardrobe-2", "operation": "purchase", "itemId": "ph.hat.helmet_01", "requestId": "<[A-Za-z0-9_-]{1,128}>" }
{ "schemaVersion": "wardrobe-2", "operation": "equip", "requestId": "<id>", "recipe": {
    "schemaVersion": "wardrobe-2",
    "baseBody": "ph.body.b",
    "face": "ph.face.03",
    "parts": { "hair": "ph.hair.long_01", "top": "ph.top.jacket_01", "bottom": "ph.bottom.pants_01", "footwear": "ph.footwear.sneakers_01",
               "gloves": null, "hat": "ph.hat.helmet_01", "faceAccessory": null, "backAccessory": null },
    "sliders": { "height": 0.4, "jaw": -1 },        // optional; missing keys = 0
    "colors":  { "skin": "#C08060", "primary": "#1F8FFF" }   // optional; missing channels = defaults
} }
```

A missing optional slot in `parts` means `null`. Required slots must be present and non-null.

### Replies

**`status`.** It never writes and never grants. With no saved recipe it returns the default starter recipe with `recipeSaved: false`.

```jsonc
{
  "schemaVersion": "wardrobe-2",
  "entitlements": ["ph.hat.helmet_01"],          // owned sold items (sorted)
  "recipe": { /* canonical wardrobe-2 recipe: the saved one, or the default */ },
  "recipeSaved": false,
  "holosTokens": 1500,
  "catalog": {
    "placeholder": true, "source": "placeholder-2026-10-03 (awaiting BoZo Anime Pack audit)",
    "slots": [{ "slot": "hair", "required": true }, /* … */],
    "baseBodies": ["ph.body.a", "ph.body.b", "ph.body.c"],
    "faces": ["ph.face.01", "ph.face.02", "ph.face.03", "ph.face.04"],
    "sliders": { "keys": ["height", /* … */ "ear"], "min": -1, "max": 1, "default": 0 },
    "colors": { "channels": ["skin", /* … */ "accent"], "defaults": { "skin": "#E8B996", /* … */ }, "format": "#RRGGBB" },
    "maxRecipeBytes": 4096,
    "items": [{ "itemId": "ph.hair.short_01", "slot": "hair", "displayName": "Short Crop", "rarity": "starter", "price": 0,
                "starter": true, "vendorId": "", "tintable": ["hair"], "owned": false, "usable": true }, /* … */]
  }
}
```

**`purchase` / `equip`:**

```jsonc
{
  "schemaVersion": "wardrobe-2",
  "operation": "purchase",                        // or "equip"
  "requestId": "p1",
  "alreadyProcessed": false,                      // true on a replay of the same requestId + command
  "purchased": { "itemId": "ph.hat.helmet_01", "price": 1500 },   // null for equip
  "entitlements": ["ph.hat.helmet_01"],
  "recipe": { /* saved recipe (equip) or saved / default (purchase) */ },
  "recipeSaved": true,
  "holosTokens": 0
}
```

The reply recipe is **canonical**:
- every slot is present, in slot order;
- sliders and colours contain only the keys that were set, in whitelist order;
- hex is upper-case.

Render the returned recipe, not the one you sent.

### Rejection codes (`HttpsError`, `details.rejectionCode`)

| rejectionCode | HTTPS code | When |
|---|---|---|
| `invalid_request` | `invalid-argument` | bad or missing `schemaVersion`, operation, `requestId`; `itemId` unknown or a starter item (not for sale); any recipe defect: oversize, unknown key, wrong schema, body or face outside the free set, unknown item, **item in the wrong slot**, required slot missing or null, slider out of [-1, 1] or non-finite, colour not strict `#RRGGBB` |
| `not_owned` | `failed-precondition` | equip with a sold item the pilot doesn't own |
| `already_owned` | `already-exists` | purchase of an owned item with a new `requestId`. No charge, nothing written. |
| `not_enough_holos` | `failed-precondition` | message **"Not enough Holos."** (the existing economy copy). Nothing written, so the same `requestId` can succeed later. |
| `sequence_conflict` | `already-exists` | `requestId` already used for a *different* command (another item, a different recipe, or purchase vs equip) |
| `unavailable` | `unavailable` | missing profile; malformed or wrong-schema wardrobe; malformed Holos (fails closed) |
| — | `unauthenticated` | not signed in |

### Idempotency (receipt fingerprint pattern)

- A purchase or equip runs in one transaction. A purchase writes three things together: `users/{uid}.holosTokens -= price`, `wardrobes/{uid}.entitlements += itemId`, and the receipt `wardrobes/{uid}/receipts/{requestId}` `{fingerprint, reply}`.
- Equip writes the recipe and receipt only. It never touches Holos.
- `fingerprint` = sha256 of the canonical command, so equivalent recipes share one (key order, hex case and an omitted optional slot don't matter).
- A replay with the same fingerprint returns the stored reply with `alreadyProcessed: true` and writes nothing. A different fingerprint gets `sequence_conflict`.
- Rejections write nothing, not even a receipt.

### Storage and data safety

- `wardrobes/{uid}` holds `{schemaVersion:"wardrobe-2", entitlements: string[], recipe: Recipe|null}`. Receipts live at `wardrobes/{uid}/receipts/{requestId}`.
- **`firestore.rules` denies every client read and write of the whole tree.** Astra's draft allowed owner reads; I tightened that so no stored shape becomes a client contract, since `status` returns everything. Rules tests cover it.
- **No reset trap:**
  - Only an *absent* doc means "nothing owned".
  - A present doc that is malformed, has the wrong schema or holds bad entitlements (non-array, non-string, duplicates) fails closed as `unavailable`. It is never treated as empty, so it can't be overwritten by the next purchase.
  - Well-formed entitlement ids that a regenerated catalog no longer lists are **kept**. They can't be equipped until the catalog lists them again.
  - `status` never creates the doc.
- `deleteUserData` (account deletion) recursively deletes `wardrobes/{uid}`, including receipts. A test covers it.

## Vendor catalog: `vendor-3`

`vendorCatalogHost {operation:"catalog", vendorId:"boutique"}` lists every **sold** wardrobe item:

```jsonc
{ "listingId": "clothing.ph.hat.helmet_01", "kind": "clothing", "displayName": "Rival Helmet", "price": 1500, "currency": "holos",
  "quantity": 1, "owned": 0, "affordable": true, "available": true, "availableAtMs": 0,
  "details": { "itemId": "ph.hat.helmet_01", "slot": "hat", "rarity": "epic", "tintable": ["primary", "accent"] },
  "purchase": { "callable": "wardrobeHost", "request": { "schemaVersion": "wardrobe-2", "operation": "purchase", "itemId": "ph.hat.helmet_01", "requestId": "<client-generated>" } } }
```

- When the item is owned: `owned` is `1` and `available` is `false`.
- Starter items are never listed.
- The marketplace and workshop listings are unchanged and contain no clothing.
- **Why vendor-3:**
  - there's a new `vendorId` (`boutique`) and listing `kind` (`clothing`);
  - `details` values may now be `string[]`;
  - `purchaseBuddyUnit` replies share the version string.

  vendor-1 (#56) and vendor-2 (Astra's draft) were never deployed.

## Unity hand-off

1. **Schema versions:** `wardrobe-2` on every `wardrobeHost` request and reply, and `vendor-3` on `vendorCatalogHost` / `purchaseBuddyUnit` replies.
2. **On creator open:** call `wardrobeHost {schemaVersion:"wardrobe-2", operation:"status"}`.
   - Build every picker from `catalog`: slots, bodies, faces, slider keys and range, colour channels and defaults, and items with `usable`/`owned`.
   - Load `recipe` (the default if `recipeSaved: false`).
   - **Don't hard-code any id, price, slot or whitelist.**
3. **Save:** send `equip {recipe, requestId}`, using a fresh `requestId` per save and reusing it on network retry. Render the reply's canonical `recipe`.
   - On `not_owned`, show the item as locked.
   - On `invalid_request`, the client sent something off-whitelist. Treat it as a bug and keep the last server recipe.
4. **Buy:** open the boutique with `vendorCatalogHost {operation:"catalog", vendorId:"boutique"}`. Send `listing.purchase.request` (with a fresh `requestId` replacing `"<client-generated>"`) to `wardrobeHost`. Then refresh `status` and the catalog.
   - `already_owned`: refresh only; nothing was charged.
   - `not_enough_holos`: show "Not enough Holos."
5. Tint each rendered item only through the channels in its `tintable` list.
6. **Placeholder ids:** every `ph.*` id maps to a BoZo part only once the audit lands. Until then Unity can map them to stand-in parts. The ids change in one data-only server update; see below.

## Regenerating the placeholder catalog from the BoZo pack audit

1. Audit the pack. For each modular part, record:
   - its BoZo part id (prefab or mesh name);
   - which slot it fills (confirm or adjust the provisional slot list);
   - its tintable material channels;
   - whether it's a starter or a sold item, with a rarity.

   Also list the body bases, face presets, blendshape names (to map onto the slider keys) and colour channels.
2. Replace the arrays in `functions/src/lib/wardrobeCatalog.ts`:
   - `WARDROBE_SLOTS`, `BASE_BODIES`, `FACES`, `SLIDER_KEYS`, `COLOR_DEFAULTS` and `WARDROBE_ITEMS`;
   - use the BoZo ids instead of `ph.*`;
   - set `WARDROBE_CATALOG_IS_PLACEHOLDER = false` and update `WARDROBE_CATALOG_SOURCE`.

   This can be generated by a script from an audit CSV/JSON. **No code in `lib/wardrobe.ts`, the store or the host changes.**
3. Keep the invariants. The unit test checks them:
   - ≥ 2 starter items per required slot and ≥ 1 per optional slot;
   - sold prices come from `MARKETPLACE_PART_PRICES[rarity]`;
   - unique ids;
   - `tintable` ⊆ colour channels.

   Update the `ph.`-prefix assertion in `test-wardrobe.mjs`.
4. **Migration:** entitlements to ids the new catalog drops are kept but can't be equipped. If a placeholder id was sold before the audit (only possible if this ships first), add an old → new id map, or re-grant those entitlements in a one-off admin script.

## Deploy (Pak approves; not run)

Rules first, then functions:

```bash
firebase deploy --project holobots-24046 --only firestore:rules
firebase deploy --project holobots-24046 --only functions:wardrobeHost,functions:vendorCatalogHost,functions:purchaseBuddyUnit,functions:deleteUserAccountV2
```

PR #56 (`introQuestHost`, `vendorCatalogHost`, `purchaseBuddyUnit`) must be merged first, or deployed in the same run. The full list is now 37 functions and is in `functions/README.md`.
