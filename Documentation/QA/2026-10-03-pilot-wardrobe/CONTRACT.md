# Contract-Change: wardrobe-3 BoZo manifest catalog; vendor-3 clothing listings (DECISIONS #48)

Server lane, HolobotsMobile functions. Spec: Pak, 2026-10-03 (Unity DECISIONS #48, Phase 3), plus the producer follow-up on 2026-10-04 that brought the real BoZo Anime Pack manifest. Stacked on PR #56, which is not merged. Local only; nothing deployed.

The pilot creator is built on the BoZo Anime Pack (a Mixamo humanoid with modular parts, blendshapes and tinting).
- **Unity:** presentation only.
- **The server owns:** prices, ownership and the saved appearance. Unity sends a recipe, the server validates and stores it, and Unity renders what the server returns.

**History.**
- wardrobe-1 was Astra's local draft. wardrobe-2 was this PR's first cut, built on provisional `ph.*` placeholder slots.
- Neither was ever deployed. wardrobe-3 **replaces** both rather than migrating them.
- A stored `wardrobe-1` or `wardrobe-2` doc fails closed as `unavailable`. None exist outside an emulator.

## Source of truth: `functions/src/lib/data/bozoWardrobeManifest.json`

The manifest has **120 entries**, one per BoZo runtime prefab (`Outfit.Type`). It is generated from the producer's pack manifest and never hand-typed.

```jsonc
{ "bozoPart": "Top_Overall", "type": "Top", "hides": ["Bottom"], "incompatible": [], "colorChannels": 5 }
```

`functions/src/lib/wardrobeCatalog.ts` derives the whole catalog from that file when the module loads.

**What it derives:**
- **itemId:** `bozoPart` lower-cased, e.g. `top_overall`. `bozoPart` itself is kept exactly as Unity names the prefab.
- **slot:** taken from `type`.
- **display name:** the `bozoPart` minus its type prefix, with camelCase split into words, e.g. `Top_SmartDress` → "Smart Dress". Display copy only; Unity may localise it.
- **starter flag, rarity and price:** applied from the producer decisions (see below).

**Producer decisions,** all validated against the manifest:
- `STARTER_TYPES` and `STARTER_PARTS`
- `RARITY_RULES`
- `PART_OVERRIDES`
- `FACE_LAYERS`

**It throws, and so fails the build and unit tests, when:**
- a `bozoPart` is duplicated, or two parts collide once lower-cased;
- a decision names a part or type the manifest doesn't have;
- a `type` is unknown;
- `colorChannels` is bad;
- `hides`/`incompatible` is not an array, or names an unknown type;
- an item hides its own slot;
- a required slot has no equippable starter;
- a face layer has empty or duplicate options.

`status` reports `catalog.placeholder: false` and `catalog.source`.

### Slots

Thirteen slots, one per BoZo `Outfit.Type`. Optional slots take an item or `null` (none).

| slot | BoZo type | required | items | starters |
|---|---|---|---|---|
| `hairFront` | HairFront | yes | 11 | 11 |
| `hairBack` | HairBack | yes | 19 | 19 |
| `top` | Top | yes | 24 | 3 |
| `bottom` | Bottom | yes, unless the equipped top hides it (then it **must** be null) | 16 | 3 |
| `feet` | Feet | yes | 13 | 2 |
| `gloves` | Gloves | no | 8 | 0 |
| `hat` | Hat | no | 9 | 0 |
| `headAcc` | HeadAcc | no | 4 | 0 |
| `upperFace` | UpperFace | no | 5 | 0 |
| `lowerFace` | LowerFace | no | 3 | 0 |
| `neck` | Neck | no | 1 | 0 |
| `leggings` | Leggings | no | 1 | 0 |
| `socks` | Socks | no | 6 | 1 |

### Hide and incompatibility rule (generalised from the manifest)

`hides` and `incompatible` are read from the manifest; no slot names are hard-coded.
- For every equipped item, each slot in its `hidesSlots` and `incompatibleSlots` **must be `null`**.
- Every other required slot must be filled.

**Today's data:**
- Exactly four tops hide `Bottom`: **Top_Overall, Top_SimpleKimono, Top_SmartDress, Top_Sundress**.
  - While one is equipped, `parts.bottom` must be `null` (or omitted).
  - With any other top, `bottom` is required.
  - Both directions are tested for every hider.
- No entry uses `incompatible` yet. The rule is still exercised by a test that injects one temporarily.
- A future pack audit that adds hiders or incompatibilities needs **no code change**.

### Starter, sold, rarity

**Starter: 39 items.** Free, always usable, never sold, never stored as entitlements.
- every HairFront (11) and every HairBack (19);
- `Top_Tshirt`, `Top_SimpleHoodie`, `Top_TankTop`;
- `Bottom_SimpleShorts`, `Bottom_SkinnyJeans`, `Bottom_BaggyPants`;
- `Feet_SimpleSneakers`, `Feet_AthleticMidTop`;
- `Socks_BasicSocks`.

**Sold: 80 items** at the `boutique` vendor. The price is `MARKETPLACE_PART_PRICES[rarity]` from the existing economy module: common 300, rare 750, epic 1500.

Rarity rules, first match wins:

| rarity | rule | count |
|---|---|---|
| epic | `Top_FullSuit`, `Top_SmartDress`, `Top_Nagagi`, `Top_SimpleKimono`, `Bottom_BasicHakma`, and every HeadAcc | 9 |
| rare | Top whose name contains `Jacket`; Feet whose name contains `Boot`; every Hat; every Gloves; UpperFace whose name contains `Glasses`/`HalfMoon` | 23 |
| common | everything else sold ("basics") | 48 |

> **⚑ Unity to confirm: `UpperFace_RoundGlassesLens`** is **not sellable and not equippable**. The producer believes it's the optional lens sub-part of `UpperFace_RoundGlasses`, which is unconfirmed.
> - It stays in the catalog: `sellable:false`, `equippable:false`, price 0, never listed.
> - Equipping it gets `invalid_request`; buying it gets `invalid_request`.
> - If it turns out to be a standalone item, flip one line in `PART_OVERRIDES` and regenerate.

### Face layers (free choices, whitelisted per layer)

These are not items: nothing is owned or sold. **Required** layers must be one of their options. Optional layers may be `null` or omitted, both meaning none. Option strings are the exact BoZo names, including vendor spellings such as `FaceDetail_Freakles` and `Underlower_ShortSpats`.

| layer | required | options |
|---|---|---|
| `head` | yes | `Head_AnimeYoung`, `Head_BasicHead`, `Head_SharpHead`, `Head_Stern`, `Head_YoungSharpHead` |
| `body` | yes | `Body_AnimeBasic`, `Body_BasicBody`, `Body_StrongBody` |
| `bodyType` | no (null = none) | `BodyType_StylizedLeanBody`, `BodyType_StylizedStrongBody` |
| `eyes` | yes | `Eyes_AnimeBasic`, `Eyes_BasicEyes`, `Eyes_BasicIris` |
| `pupil` | yes | `Pupil_BasicPupil`, `Pupil_Round`, `Pupil_SharpPupil`, `Pupil_StylizedRoundRinged`, `Pupil_HeartPupil`, `Pupil_Square`, `Pupil_StarPupil` |
| `eyeShine` | no (null = none) | `EyeShine_DoubleRound`, `EyeShine_StylizedDoubleShine` |
| `eyeBrows` | yes | `Brows_BasicBrows`, `Brows_PillBrows`, `Brows_ThickBrows`, `Brows_ThinBrows`, `EyeBrows_StylizedBasicBrows`, `EyeBrows_StylizedThickBrows` |
| `eyeLashes` | yes | `EyeLashes_LongLashes`, `EyeLashes_ShortLashes`, `EyeLashes_StylizedLongLashes`, `EyeLashes_StylizedShortLashes` |
| `teeth` | yes | `Teeth_AnimeBasicTeeth`, `Teeth_StylizedBasicTeeth` |
| `makeUpCheeks` | no (null = none) | `MakeUpCheeks_BasicBlush`, `MakeUpCheeks_SimpleBlush` |
| `makeUpEyes` | no (null = none) | `MakeUpEyes_BasicEyeLiner` |
| `makeUpLips` | no (null = none) | `MakeUpLips_BasicLipstick`, `MakeUpLips_SimpleLipstick` |
| `faceDetails` | no (null = none) | `FaceDetail_Freakles`, `FaceDetail_FullFreakles`, `FaceDetails_FrecklesHeavy`, `FaceDetails_FrecklesLight`, `FaceDetails_FrecklesMedium` |
| `faceTexture` | no (null = none) | `FaceTexture_Wrinkles` |
| `underUpper` | yes | `UnderUpper_SimpleUnderShirt`, `UnderUpper_SimpleUnderShirt2`, `UnderUpper_SimpleBra` |
| `underLower` | yes | `UnderLower_SimpleBoxers`, `Underlower_ShortSpats`, `UnderLower_SimplePanties` |

### Shapes (BoZo blendshapes), colours, size cap

- **Shapes:** `recipe.shapes: { <Key>: number }`. These are the real BoZo blendshapes, named `Shape_<Key>` on the pack's meshes (producer relay, 2026-10-04). They replace the guessed slider list from earlier drafts; the `sliders` key no longer exists and is rejected as unknown.
  - **Body** (Body mesh, BodyRig / Body_BasicBodyV2): `Belly, BodyType, ButtSize, Chest, Curvy, Muscle, NeckThickness, WaistSize, Weight`.
  - **Face:** the keys depend on the head (`faceLayers.head`):

    | head | face shape keys |
    |---|---|
    | `Head_BasicHead`, `Head_SharpHead`, `Head_Stern`, `Head_YoungSharpHead` (BSMC_Head + Head_V2 meshes) | `EarAngle, EarsElf, EyeLidHeight, EyesOuterCornersHigh, EyesOuterCornersLow, EyesSquare, IrisSize, LowerBrows, MouthThin, MouthWide, NoseBridgeCurve, NoseTiltDown, NoseTiltUp, NoseWidth, RaiseBrows, Sharpness, Squareness, Stern` |
    | `Head_AnimeYoung` | `EarLength, EyeRoundness, Maturity, MouthWidth, Roundness, Sharpness` |

  - **Accepted face keys are the union over all heads** (23 keys). A key the chosen head doesn't have is harmless, since Unity ignores it, so a head mismatch is **not** rejected.
  - Values are Unity blendshape weights: finite numbers in **[0, 100] inclusive**. Out-of-range, NaN, Infinity and non-numbers are **rejected** (`invalid_request`), never clamped, so that a retry fingerprints identically.
  - Keys are exact and case-sensitive, with no `Shape_` prefix in the recipe. A missing key means `0`.
  - Canonical order: body keys, then face keys.
  - **Out of scope for wardrobe-3:** height and limb proportions. In BoZo these are bone modifiers, not blendshapes.
- **Global colours:** `skin`, `hair`, `eyes`.
  - Values must be strict `#RRGGBB`. Either case is accepted and stored upper-case.
  - Defaults: skin `#E8B996`, hair `#2B2B2B`, eyes `#3A6EA5`.
- **Per-slot colours:** `colors.<slot>` is an array of strict `#RRGGBB`.
  - The slot **must have an item equipped**.
  - The array length must be **≤ that item's `colorChannels`**. Anything beyond is rejected, not truncated.
  - Hex is stored upper-case. An empty array is dropped, meaning the item's own default materials.
  - Channel *i* maps to the item's *i*-th tintable material slot in the BoZo prefab.
  - An item with `colorChannels: 0` (none today) would take no colours.
- **Size cap:** the encoded recipe (JSON, UTF-8) must be ≤ **4096 bytes**, else `invalid_request`. This is checked first.

## `wardrobeHost`, schema `wardrobe-3`

Every request carries `schemaVersion: "wardrobe-3"`. A missing or other version gets `invalid_request`.

### Requests

```jsonc
{ "schemaVersion": "wardrobe-3", "operation": "status" }
{ "schemaVersion": "wardrobe-3", "operation": "purchase", "itemId": "top_fullsuit", "requestId": "<[A-Za-z0-9_-]{1,128}>" }
{ "schemaVersion": "wardrobe-3", "operation": "equip", "requestId": "<id>", "recipe": {
    "schemaVersion": "wardrobe-3",
    "faceLayers": { "head": "Head_SharpHead", "body": "Body_AnimeBasic", "eyes": "Eyes_AnimeBasic", "pupil": "Pupil_BasicPupil",
                    "eyeBrows": "Brows_BasicBrows", "eyeLashes": "EyeLashes_LongLashes", "teeth": "Teeth_AnimeBasicTeeth",
                    "underUpper": "UnderUpper_SimpleUnderShirt", "underLower": "Underlower_ShortSpats",
                    "faceDetails": "FaceDetail_Freakles" },              // optional layers: omit or null = none
    "parts": { "hairFront": "hairfront_asymmetricalfringe", "hairBack": "hairback_casualflow", "top": "top_sundress",
               "bottom": null,                                              // MUST be null: Top_Sundress hides Bottom
               "feet": "feet_athleticmidtop", "socks": "socks_basicsocks" }, // optional slots: omit or null = none
    "shapes":  { "Weight": 40, "Muscle": 100, "Sharpness": 25 },          // optional; BoZo Shape_<Key> weights in [0, 100]; missing = 0
    "colors":  { "skin": "#C08060", "top": ["#1F8FFF", "#000000"] }        // optional; per-slot length <= colorChannels
} }
```

### Replies

**`status`.** It never writes and never grants. With no saved recipe it returns the default recipe with `recipeSaved: false`:
- the first option for each required face layer;
- the first non-hiding starter in manifest order for each required slot, which gives `top_simplehoodie`, `bottom_baggypants`, `feet_athleticmidtop`, `hairfront_asymmetricalfringe`, `hairback_casualflow`.

```jsonc
{
  "schemaVersion": "wardrobe-3",
  "entitlements": ["top_fullsuit"],               // owned sold items (sorted)
  "recipe": { /* canonical wardrobe-3 recipe: the saved one, or the default */ },
  "recipeSaved": false,
  "holosTokens": 1500,
  "catalog": {
    "placeholder": false, "source": "BoZo Anime Pack runtime prefabs (Outfit.Type), manifest 2026-10-03 (120 entries)",
    "slots": [{ "slot": "hairFront", "type": "HairFront", "required": true }, /* … 13 */],
    "faceLayers": [{ "layer": "head", "required": true, "options": ["Head_AnimeYoung", /* … */] }, /* … 16 */],
    "shapes": { "blendshapePrefix": "Shape_", "min": 0, "max": 100, "default": 0,
                "body": ["Belly", /* … 9 */], "face": ["EarAngle", /* … 23, union over heads */],
                "faceByHead": { "Head_AnimeYoung": ["EarLength", /* … */], "Head_BasicHead": [/* … */], /* every head option */ } },
    "colors": { "globalChannels": ["skin", "hair", "eyes"], "defaults": { "skin": "#E8B996", "hair": "#2B2B2B", "eyes": "#3A6EA5" },
                "format": "#RRGGBB", "perSlot": "array of #RRGGBB, length <= the equipped item's colorChannels" },
    "maxRecipeBytes": 4096,
    "items": [{ "itemId": "top_overall", "bozoPart": "Top_Overall", "slot": "top", "type": "Top", "displayName": "Overall",
                "rarity": "common", "price": 300, "starter": false, "sellable": true, "equippable": true, "vendorId": "boutique",
                "colorChannels": 5, "hidesSlots": ["bottom"], "incompatibleSlots": [],
                "owned": false, "usable": false }, /* … 120 */]
  }
}
```

`usable` = `equippable && (starter || owned)`.

**`purchase` / `equip`:**

```jsonc
{
  "schemaVersion": "wardrobe-3",
  "operation": "purchase",                        // or "equip"
  "requestId": "p1",
  "alreadyProcessed": false,                      // true on a replay of the same requestId + command
  "purchased": { "itemId": "top_fullsuit", "price": 1500 },   // null for equip
  "entitlements": ["top_fullsuit"],
  "recipe": { /* saved recipe (equip) or saved / default (purchase) */ },
  "recipeSaved": true,
  "holosTokens": 0
}
```

The reply recipe is **canonical**:
- every face layer and every slot is present (`null` = none), in catalog order;
- shapes contain only the keys that were set, body keys then face keys;
- colours list the global channels first, then slots, in catalog order;
- hex is upper-case.

Render the returned recipe, not the one you sent. Fixtures are in `fixtures/`: `wardrobe-3_status_fresh`, `wardrobe-3_purchase`, `wardrobe-3_equip`, `wardrobe-3_equip_hidden_bottom`, `vendor-3_catalog_boutique`.

### Rejection codes (`HttpsError`, `details.rejectionCode`)

| rejectionCode | HTTPS code | When |
|---|---|---|
| `invalid_request` | `invalid-argument` | Request: bad or missing `schemaVersion`, operation or `requestId`; `itemId` unknown, a starter, or non-sellable (the lens). Recipe defect: oversize; unknown top-level key (including the old `sliders`); wrong schema; unknown face layer; face option off-whitelist; required face layer null or missing; unknown slot; unknown item; **item in the wrong slot**; non-equippable item (the lens); **non-null item in a slot hidden by or incompatible with an equipped item**; required slot empty when not hidden; shape key outside body ∪ face union, weight outside [0, 100] or non-finite; colour key unknown; colour not strict `#RRGGBB`; per-slot colours on an empty slot; **more per-slot colours than `colorChannels`** |
| `not_owned` | `failed-precondition` | equip with a sold item the pilot doesn't own |
| `already_owned` | `already-exists` | purchase of an owned item with a new `requestId`. No charge, nothing written. |
| `not_enough_holos` | `failed-precondition` | message **"Not enough Holos."**. Nothing written, so the same `requestId` can succeed later. |
| `sequence_conflict` | `already-exists` | `requestId` already used for a *different* command |
| `unavailable` | `unavailable` | missing profile; malformed or wrong-schema wardrobe (incl. any `wardrobe-1`/`wardrobe-2` doc); malformed Holos (fails closed) |
| — | `unauthenticated` | not signed in |

### Idempotency (receipt fingerprint pattern)

- A purchase or equip runs in one transaction.
  - **Purchase** writes three things together: `users/{uid}.holosTokens -= price`, `wardrobes/{uid}.entitlements += itemId`, and the receipt `wardrobes/{uid}/receipts/{requestId}` `{fingerprint, reply}`.
  - **Equip** writes the recipe and receipt only. It never touches Holos.
- `fingerprint` = sha256 of the canonical command, so equivalent recipes share one. Key order, hex case and omitted optional slots or layers don't matter.
- A replay with the same fingerprint returns the stored reply with `alreadyProcessed: true` and writes nothing. A different fingerprint gets `sequence_conflict`.
- Rejections write nothing, not even a receipt.

### Storage and data safety

- **Layout:** `wardrobes/{uid}` holds `{schemaVersion:"wardrobe-3", entitlements: string[], recipe: Recipe|null}`. Receipts live at `wardrobes/{uid}/receipts/{requestId}`.
- **`firestore.rules` denies every client read and write of the whole tree.** Rules tests cover it.
- **No reset trap:**
  - Only an *absent* doc means "nothing owned".
  - A present doc that is malformed, has the wrong schema or holds bad entitlements fails closed as `unavailable`. It is never overwritten.
  - Well-formed entitlement ids that a regenerated manifest no longer lists are **kept** but can't be equipped.
  - `status` never creates the doc.
- **Deletion:** `deleteUserData` (account deletion) recursively deletes `wardrobes/{uid}`, including receipts.

## Vendor catalog: `vendor-3`

`vendorCatalogHost {operation:"catalog", vendorId:"boutique"}` lists the **80 sellable** wardrobe items, in manifest order:

```jsonc
{ "listingId": "clothing.top_overall", "kind": "clothing", "displayName": "Overall", "price": 300, "currency": "holos",
  "quantity": 1, "owned": 0, "affordable": true, "available": true, "availableAtMs": 0,
  "details": { "itemId": "top_overall", "bozoPart": "Top_Overall", "slot": "top", "rarity": "common",
               "colorChannels": "5", "hidesSlots": ["bottom"] },
  "purchase": { "callable": "wardrobeHost", "request": { "schemaVersion": "wardrobe-3", "operation": "purchase", "itemId": "top_overall", "requestId": "<client-generated>" } } }
```

- **Value types:** `details` values are strings or string arrays. `colorChannels` is the decimal string of the integer.
- **Owned items:** `owned` is `1` and `available` is `false`.
- **Never listed:** starter items and non-sellable overrides (the lens).
- **Other vendors:** the marketplace and workshop listings are unchanged and contain no clothing.
- **Why vendor-3:**
  - there's a new `vendorId` (`boutique`) and listing `kind` (`clothing`);
  - `details` values may be `string[]`.

  vendor-3 was redefined in place, since it has never been deployed.

## Unity hand-off

1. **Schema versions:**
   - `wardrobe-3` on every `wardrobeHost` request and reply;
   - `vendor-3` on `vendorCatalogHost` / `purchaseBuddyUnit` replies;
   - unchanged and still negotiated: `intro-quest-1`, `rival-battle-1/2`, `desktop-account-1/2`.
2. **Id mapping:**
   - `bozoPart` is the exact BoZo prefab name, so spawn by it.
   - `itemId` is the server key. Send it in `parts` and `purchase`.
   - Face-layer values are exact BoZo names too.
3. **On creator open:** call `wardrobeHost {schemaVersion:"wardrobe-3", operation:"status"}`.
   - Build every picker from `catalog`: slots, faceLayers, shapes (body keys plus `faceByHead[recipe.faceLayers.head]`), colours, and items with `usable`/`owned`/`hidesSlots`.
   - Load `recipe` (the default if `recipeSaved: false`).
   - **Don't hard-code any id, price, slot, layer or whitelist.**
4. **Hide rule in the UI:** when the user picks a top whose `hidesSlots` contains `bottom`, clear `parts.bottom` to `null` and grey out the bottom picker. When they switch to a non-hiding top, require a bottom again: restore the previous bottom or the default. The server enforces this both ways.
5. **Colours:** offer `item.colorChannels` swatches per equipped item. Send `colors.<slot>` with at most that many entries. Clear a slot's colours when its item changes, since channel counts differ.
6. **Save:** send `equip {recipe, requestId}`, using a fresh `requestId` per save and reusing it on network retry. Render the reply's canonical `recipe`.
   - On `not_owned`, show the item as locked.
   - On `invalid_request`, the client sent something off-whitelist. Treat it as a bug and keep the last server recipe.
7. **Buy:** open the boutique with `vendorCatalogHost {operation:"catalog", vendorId:"boutique"}`. Send `listing.purchase.request` (with a fresh `requestId` replacing `"<client-generated>"`) to `wardrobeHost`. Then refresh `status` and the catalog.
   - `already_owned`: refresh only; nothing was charged.
   - `not_enough_holos`: show "Not enough Holos."
8. **⚑ Confirm `UpperFace_RoundGlassesLens`:** is it the lens sub-part of `UpperFace_RoundGlasses` (render it with the glasses), or a standalone item? See the flag above.

## Regenerating the catalog after a new pack audit

1. Replace `functions/src/lib/data/bozoWardrobeManifest.json`, generated from the producer manifest and never hand-edited. Use one entry per runtime prefab: `{bozoPart, type, hides, incompatible, colorChannels}`, with `hides`/`incompatible` listing BoZo **types**.
2. If the producer changes decisions, edit only the decision tables in `wardrobeCatalog.ts`:
   - `WARDROBE_SLOTS` (new types and expected counts)
   - `STARTER_TYPES` and `STARTER_PARTS`
   - `RARITY_RULES`
   - `PART_OVERRIDES`
   - `FACE_LAYERS`
   - `BODY_SHAPE_KEYS` and `FACE_SHAPES_BY_HEAD` (the generator requires exactly one shape list per head option)
   - `WARDROBE_CATALOG_SOURCE`

   No code in `lib/wardrobe.ts`, the store or the host changes.
3. Run `npm run build && npm test` in `functions/`. The generator throws on any inconsistency, and `test-wardrobe.mjs` pins:
   - the counts per type;
   - the starter set;
   - the epic list;
   - the rare and common counts;
   - the hider set.

   Update those pins deliberately.
4. Bump `WARDROBE_SCHEMA` only if the recipe or reply **shape** changes. Pure data changes (new items, prices, hiders) are not a schema change.
5. **Ids are stable:** `itemId` is `bozoPart.toLowerCase()`. A renamed prefab is a new id, and the old entitlement is kept but can't be equipped. Add a one-off admin re-grant if that happens after launch.

## Deploy (Pak approves; not run)

Rules first, then functions:

```bash
firebase deploy --project holobots-24046 --only firestore:rules
firebase deploy --project holobots-24046 --only functions:wardrobeHost,functions:vendorCatalogHost,functions:purchaseBuddyUnit,functions:deleteUserAccountV2
```

PR #56 (`introQuestHost`, `vendorCatalogHost`, `purchaseBuddyUnit`) must be merged first, or deployed in the same run. The full list is 37 functions and is in `functions/README.md`.

## All 120 items (generated from the manifest)

| # | itemId | bozoPart | slot | rarity | price | starter | sold | colorChannels | hides |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `bottom_baggypants` | Bottom_BaggyPants | bottom | starter | 0 | yes |  | 3 |  |
| 2 | `bottom_basichakma` | Bottom_BasicHakma | bottom | epic | 1500 |  | yes | 3 |  |
| 3 | `bottom_beltedpants` | Bottom_BeltedPants | bottom | common | 300 |  | yes | 4 |  |
| 4 | `bottom_beltedshorts` | Bottom_BeltedShorts | bottom | common | 300 |  | yes | 3 |  |
| 5 | `bottom_beltedskort` | Bottom_BeltedSkort | bottom | common | 300 |  | yes | 6 |  |
| 6 | `bottom_cuffedshorts` | Bottom_CuffedShorts | bottom | common | 300 |  | yes | 9 |  |
| 7 | `bottom_dolphinshorts` | Bottom_DolphinShorts | bottom | common | 300 |  | yes | 2 |  |
| 8 | `bottom_longsimpleskirt` | Bottom_LongSimpleSkirt | bottom | common | 300 |  | yes | 2 |  |
| 9 | `bottom_pleatedskirt` | Bottom_PleatedSkirt | bottom | common | 300 |  | yes | 1 |  |
| 10 | `bottom_rippedcapris` | Bottom_RippedCapris | bottom | common | 300 |  | yes | 4 |  |
| 11 | `bottom_shortsimpleskirt` | Bottom_ShortSimpleSkirt | bottom | common | 300 |  | yes | 2 |  |
| 12 | `bottom_simplekhakies` | Bottom_SimpleKhakies | bottom | common | 300 |  | yes | 3 |  |
| 13 | `bottom_simpleshorts` | Bottom_SimpleShorts | bottom | starter | 0 | yes |  | 4 |  |
| 14 | `bottom_simpleskirt` | Bottom_SimpleSkirt | bottom | common | 300 |  | yes | 2 |  |
| 15 | `bottom_skinnyjeans` | Bottom_SkinnyJeans | bottom | starter | 0 | yes |  | 3 |  |
| 16 | `bottom_tightdresspants` | Bottom_TightDressPants | bottom | common | 300 |  | yes | 6 |  |
| 17 | `feet_athleticmidtop` | Feet_AthleticMidTop | feet | starter | 0 | yes |  | 4 |  |
| 18 | `feet_balletflats` | Feet_BalletFlats | feet | common | 300 |  | yes | 3 |  |
| 19 | `feet_classyloafers` | Feet_ClassyLoafers | feet | common | 300 |  | yes | 3 |  |
| 20 | `feet_flowerflipflops` | Feet_FlowerFlipFlops | feet | common | 300 |  | yes | 5 |  |
| 21 | `feet_highlaceshoe` | Feet_HighLaceShoe | feet | common | 300 |  | yes | 5 |  |
| 22 | `feet_officeheels` | Feet_OfficeHeels | feet | common | 300 |  | yes | 2 |  |
| 23 | `feet_officeloafer` | Feet_OfficeLoafer | feet | common | 300 |  | yes | 3 |  |
| 24 | `feet_simpleflipflops` | Feet_SimpleFlipFlops | feet | common | 300 |  | yes | 3 |  |
| 25 | `feet_simplesneakers` | Feet_SimpleSneakers | feet | starter | 0 | yes |  | 3 |  |
| 26 | `feet_sockedballetflats` | Feet_SockedBalletFlats | feet | common | 300 |  | yes | 5 |  |
| 27 | `feet_strappedsandals` | Feet_StrappedSandals | feet | common | 300 |  | yes | 3 |  |
| 28 | `feet_tobisandles` | Feet_TobiSandles | feet | common | 300 |  | yes | 3 |  |
| 29 | `feet_workboots` | Feet_WorkBoots | feet | rare | 750 |  | yes | 4 |  |
| 30 | `gloves_armbands` | Gloves_ArmBands | gloves | rare | 750 |  | yes | 1 |  |
| 31 | `gloves_armwarmers` | Gloves_ArmWarmers | gloves | rare | 750 |  | yes | 9 |  |
| 32 | `gloves_fingerlessgloves` | Gloves_FingerlessGloves | gloves | rare | 750 |  | yes | 2 |  |
| 33 | `gloves_loosebracelets` | Gloves_LooseBracelets | gloves | rare | 750 |  | yes | 3 |  |
| 34 | `gloves_ringedgloves` | Gloves_RingedGloves | gloves | rare | 750 |  | yes | 9 |  |
| 35 | `gloves_simplegloves` | Gloves_SimpleGloves | gloves | rare | 750 |  | yes | 3 |  |
| 36 | `gloves_simplering` | Gloves_SimpleRing | gloves | rare | 750 |  | yes | 3 |  |
| 37 | `gloves_sweatbands` | Gloves_SweatBands | gloves | rare | 750 |  | yes | 2 |  |
| 38 | `hairback_casualflow` | HairBack_CasualFlow | hairBack | starter | 0 | yes |  | 3 |  |
| 39 | `hairback_flare` | HairBack_Flare | hairBack | starter | 0 | yes |  | 3 |  |
| 40 | `hairback_herotie` | HairBack_HeroTie | hairBack | starter | 0 | yes |  | 3 |  |
| 41 | `hairback_longponytail` | HairBack_LongPonyTail | hairBack | starter | 0 | yes |  | 3 |  |
| 42 | `hairback_longstreight` | HairBack_LongStreight | hairBack | starter | 0 | yes |  | 3 |  |
| 43 | `hairback_messyhair` | HairBack_MessyHair | hairBack | starter | 0 | yes |  | 3 |  |
| 44 | `hairback_pineapplecut` | HairBack_PineappleCut | hairBack | starter | 0 | yes |  | 3 |  |
| 45 | `hairback_roundbob` | HairBack_RoundBob | hairBack | starter | 0 | yes |  | 3 |  |
| 46 | `hairback_shortponytail` | HairBack_ShortPonyTail | hairBack | starter | 0 | yes |  | 3 |  |
| 47 | `hairback_shotacut` | HairBack_ShotaCut | hairBack | starter | 0 | yes |  | 3 |  |
| 48 | `hairback_sweaptdreads` | HairBack_SweaptDreads | hairBack | starter | 0 | yes |  | 3 |  |
| 49 | `hairback_tiedbun` | HairBack_TiedBun | hairBack | starter | 0 | yes |  | 3 |  |
| 50 | `hairback_twinbuns` | HairBack_TwinBuns | hairBack | starter | 0 | yes |  | 3 |  |
| 51 | `hairback_twinlongtails` | HairBack_TwinLongTails | hairBack | starter | 0 | yes |  | 3 |  |
| 52 | `hairback_twinshorttails` | HairBack_TwinShortTails | hairBack | starter | 0 | yes |  | 3 |  |
| 53 | `hairback_wildlocks` | HairBack_WildLocks | hairBack | starter | 0 | yes |  | 3 |  |
| 54 | `hairback_wildtail` | HairBack_WildTail | hairBack | starter | 0 | yes |  | 3 |  |
| 55 | `hairback_yokaimane` | HairBack_YokaiMane | hairBack | starter | 0 | yes |  | 3 |  |
| 56 | `hairback_shinryucut` | Hairback_ShinryuCut | hairBack | starter | 0 | yes |  | 3 |  |
| 57 | `hairfront_asymmetricalfringe` | HairFront_AsymmetricalFringe | hairFront | starter | 0 | yes |  | 1 |  |
| 58 | `hairfront_curtainbangs` | HairFront_CurtainBangs | hairFront | starter | 0 | yes |  | 1 |  |
| 59 | `hairfront_emobangs` | HairFront_EmoBangs | hairFront | starter | 0 | yes |  | 1 |  |
| 60 | `hairfront_himecut` | HairFront_HimeCut | hairFront | starter | 0 | yes |  | 1 |  |
| 61 | `hairfront_lynxfringe` | HairFront_LynxFringe | hairFront | starter | 0 | yes |  | 1 |  |
| 62 | `hairfront_messy` | HairFront_Messy | hairFront | starter | 0 | yes |  | 1 |  |
| 63 | `hairfront_minorfringe` | HairFront_MinorFringe | hairFront | starter | 0 | yes |  | 1 |  |
| 64 | `hairfront_shotafringe` | HairFront_ShotaFringe | hairFront | starter | 0 | yes |  | 1 |  |
| 65 | `hairfront_shoujo` | HairFront_Shoujo | hairFront | starter | 0 | yes |  | 1 |  |
| 66 | `hairfront_sideswept` | HairFront_SideSwept | hairFront | starter | 0 | yes |  | 1 |  |
| 67 | `hairfront_sweaptback` | HairFront_SweaptBack | hairFront | starter | 0 | yes |  | 1 |  |
| 68 | `hat_ballcap` | Hat_BallCap | hat | rare | 750 |  | yes | 3 |  |
| 69 | `hat_beanie` | Hat_Beanie | hat | rare | 750 |  | yes | 2 |  |
| 70 | `hat_buckethat` | Hat_BucketHat | hat | rare | 750 |  | yes | 2 |  |
| 71 | `hat_fedora` | Hat_Fedora | hat | rare | 750 |  | yes | 2 |  |
| 72 | `hat_kittywoolie` | Hat_KittyWoolie | hat | rare | 750 |  | yes | 2 |  |
| 73 | `hat_militaryhat` | Hat_MilitaryHat | hat | rare | 750 |  | yes | 3 |  |
| 74 | `hat_newsboycap` | Hat_NewsBoyCap | hat | rare | 750 |  | yes | 3 |  |
| 75 | `hat_summercap` | Hat_SummerCap | hat | rare | 750 |  | yes | 3 |  |
| 76 | `hat_sunhat` | Hat_SunHat | hat | rare | 750 |  | yes | 3 |  |
| 77 | `headacc_alienattena` | HeadAcc_AlienAttena | headAcc | epic | 1500 |  | yes | 2 |  |
| 78 | `headacc_devilhorns` | HeadAcc_DevilHorns | headAcc | epic | 1500 |  | yes | 2 |  |
| 79 | `headacc_flufflesskittyears` | HeadAcc_FlufflessKittyEars | headAcc | epic | 1500 |  | yes | 2 |  |
| 80 | `headacc_kittyears` | HeadAcc_KittyEars | headAcc | epic | 1500 |  | yes | 3 |  |
| 81 | `leggings_stocking` | Leggings_Stocking | leggings | common | 300 |  | yes | 1 |  |
| 82 | `lowerface_sharpbeard` | LowerFace_SharpBeard | lowerFace | common | 300 |  | yes | 1 |  |
| 83 | `lowerface_sharpchin` | LowerFace_SharpChin | lowerFace | common | 300 |  | yes | 1 |  |
| 84 | `lowerface_sharpgoatee` | LowerFace_SharpGoatee | lowerFace | common | 300 |  | yes | 1 |  |
| 85 | `neck_ribbonbow` | Neck_RibbonBow | neck | common | 300 |  | yes | 1 |  |
| 86 | `socks_anklesocks` | Socks_AnkleSocks | socks | common | 300 |  | yes | 1 |  |
| 87 | `socks_basicsocks` | Socks_BasicSocks | socks | starter | 0 | yes |  | 1 |  |
| 88 | `socks_kneehighs` | Socks_KneeHighs | socks | common | 300 |  | yes | 1 |  |
| 89 | `socks_stripedkneehighs` | Socks_StripedKneeHighs | socks | common | 300 |  | yes | 1 |  |
| 90 | `socks_thighhigh` | Socks_ThighHigh | socks | common | 300 |  | yes | 1 |  |
| 91 | `socks_thighhighsturrips` | Socks_ThighHighSturrips | socks | common | 300 |  | yes | 1 |  |
| 92 | `top_comfycartagan` | Top_ComfyCartagan | top | common | 300 |  | yes | 3 |  |
| 93 | `top_dressshirt` | Top_DressShirt | top | common | 300 |  | yes | 3 |  |
| 94 | `top_fullsuit` | Top_FullSuit | top | epic | 1500 |  | yes | 6 |  |
| 95 | `top_hardjacket` | Top_HardJacket | top | rare | 750 |  | yes | 5 |  |
| 96 | `top_nagagi` | Top_Nagagi | top | epic | 1500 |  | yes | 2 |  |
| 97 | `top_openhoodie` | Top_OpenHoodie | top | common | 300 |  | yes | 5 |  |
| 98 | `top_overall` | Top_Overall | top | common | 300 |  | yes | 5 | bottom |
| 99 | `top_schoolboyjacket` | Top_SchoolBoyJacket | top | rare | 750 |  | yes | 3 |  |
| 100 | `top_sefuku` | Top_Sefuku | top | common | 300 |  | yes | 5 |  |
| 101 | `top_shortsleevedressshirt` | Top_ShortSleeveDressShirt | top | common | 300 |  | yes | 3 |  |
| 102 | `top_shortsleevesefuku` | Top_ShortSleeveSefuku | top | common | 300 |  | yes | 5 |  |
| 103 | `top_shortsleevesweatervest` | Top_ShortSleeveSweaterVest | top | common | 300 |  | yes | 5 |  |
| 104 | `top_simplebandeau` | Top_SimpleBandeau | top | common | 300 |  | yes | 2 |  |
| 105 | `top_simplehoodie` | Top_SimpleHoodie | top | starter | 0 | yes |  | 2 |  |
| 106 | `top_simplekimono` | Top_SimpleKimono | top | epic | 1500 |  | yes | 6 | bottom |
| 107 | `top_simplesweater` | Top_SimpleSweater | top | common | 300 |  | yes | 2 |  |
| 108 | `top_simplesweatervest` | Top_SimpleSweaterVest | top | common | 300 |  | yes | 5 |  |
| 109 | `top_sleevelessdressshirt` | Top_SleevelessDressShirt | top | common | 300 |  | yes | 3 |  |
| 110 | `top_smartdress` | Top_SmartDress | top | epic | 1500 |  | yes | 5 | bottom |
| 111 | `top_straplesstubetop` | Top_StraplessTubeTop | top | common | 300 |  | yes | 2 |  |
| 112 | `top_sundress` | Top_Sundress | top | common | 300 |  | yes | 5 | bottom |
| 113 | `top_tanktop` | Top_TankTop | top | starter | 0 | yes |  | 2 |  |
| 114 | `top_thickhenslay` | Top_ThickHenslay | top | common | 300 |  | yes | 3 |  |
| 115 | `top_tshirt` | Top_Tshirt | top | starter | 0 | yes |  | 2 |  |
| 116 | `upperface_medicaleyepatch` | UpperFace_MedicalEyePatch | upperFace | common | 300 |  | yes | 2 |  |
| 117 | `upperface_roundglasses` | UpperFace_RoundGlasses | upperFace | rare | 750 |  | yes | 3 |  |
| 118 | `upperface_roundglasseslens` | UpperFace_RoundGlassesLens | upperFace | rare | 0 |  | **no** (not equippable) | 3 |  |
| 119 | `upperface_simpleglasses` | UpperFace_SimpleGlasses | upperFace | rare | 750 |  | yes | 3 |  |
| 120 | `upperface_simplehalfmoon` | UpperFace_SimpleHalfMoon | upperFace | rare | 750 |  | yes | 3 |  |
