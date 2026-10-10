# Items dashboard and account inventory — local checkpoint

The dashboard now lists existing account items, chooses a favorite, purchases marketplace stock and uses the existing host effects. V / D-pad Right opens a compact confirmation for a usable favorite; other favorites open Items. No production deployment or Mac rebuild is included.

## Installed source

Unity: `ItemsScreen`, `FavoriteItemHud`, `ItemInventoryAccess`, `ItemInventoryContract`; dashboard/Home navigation, `DesktopAccountSession`, Marketplace landmark routing, `InputBindings.QuickItem`. No scene/prefab/settings saves.
Host: new authenticated `desktopItemsHost`, `desktopItems` transaction logic; export and account-deletion coverage. Contract version `desktop-items-1`. Intent schema: `Schemas/desktop-items-v1.schema.json`.

Read returns canonical marketplace listings/counts/prices, cache pack choices, favorite and confirmed transaction result. Favorite is server-owned per account. Mutations use a stable request ID until confirmed or definitively refused; receipts make retries idempotent and reject reuse for another action. Delayed reads are invalidated by subsequent mutations/account changes. No local ownership, spend, loot roll or effect calculation.

## Existing functionality retained

- Six marketplace items and three Buddy Unit tiers. Light Units remain reward-only.
- Energy Refills restore training energy, **not health**. Experience Boosters use the existing host activation window.
- Cache Check consumes tickets, grants existing rolled loot, records pack history and progress atomically. Retry returns the same reveal.
- Buddy Units remain used through the capture system. Existing battle-earned Unit counts appear on refresh. No new win-drop policy is added.
- Favorite use is unavailable during combat/HoloBall. Compact confirmation restores the exact borrowed pause/modal/input state when closed.

## Verification

Native Unity regression run: 110 passed, zero failures; compact confirmation lifecycle: one passed; earlier landscape/portrait layout probes passed with exact repeat differing pixels zero. These are isolated real UI renders with read-only MOCK account data, not signed-in world Play witnesses. Backend compilation passed; 16 unit/vendor tests and six isolated local-emulator transaction/rules tests passed. Test evidence is beside this file. Final checkpoint after freshness/reveal changes: 105 native tests passed, zero failures and no script compiler errors. The initial sandbox launch stalled in native licensing; the licensed retry recovered and exited successfully. Main was never saved.

## Evidence — media in vault only

- `/Users/pak/HolobotsVault/QA/2026-10-10-items-review-01/PAK_SHEET.png`
- `/Users/pak/HolobotsVault/QA/2026-10-10-items-ui-02/items-1280.jpg` — account inventory and Energy Refill detail, landscape.
- `/Users/pak/HolobotsVault/QA/2026-10-10-items-ui-02/items-720.jpg` — inventory above item detail, portrait.
- `/Users/pak/HolobotsVault/QA/2026-10-10-items-quick-01/quick-confirm.jpg` — compact favorite confirmation, use disabled in witness.

All three review cells inspected. General item concepts were not found; the icon hook is `Resources/HoloUI/Items/<listingId with dots replaced by underscores>`. No invented concept art installed. Marketplace routing is code-only; no new placed shop scene object was asserted.

## Open

Production callable deployment approval; signed-in end-to-end purchase/cache/quick-use and physical pad witness; new Mac package. General concept-sheet location remains requested. Repair/healing items and new battle-win drops are not implemented by this checkpoint; approved SHOP/BETWEEN/ONE needs persistent host health and the repair catalogue, not an Energy Refill rename. No push or deployment performed.
