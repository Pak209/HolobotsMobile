import { itemIcons, type ItemIconId } from "../../../assets/items";
export { itemIcons, ITEM_ICON_COUNT } from "../../../assets/items";

const aliases: Record<string, ItemIconId> = {
  "item.gacha_ticket": "item_holo_pack", "gacha ticket": "item_holo_pack", "holo pack": "item_holo_pack",
  "item.exp_booster": "item_training_booster", "exp booster": "item_training_booster",
  "item.wildcard_blueprints": "item_blueprint_fragment", "wildcard blueprints": "item_blueprint_fragment",
  "legendary blueprint": "item_blueprint_fragment", "blueprint": "item_blueprint_fragment",
  "arena pass": "item.arena_pass", "rank skip": "item.rank_skip", "energy refill": "item_energy_refill",
  "emergency patch": "item_emergency_patch", "repair kit": "item_emergency_patch", "full restore": "item_emergency_patch",
  "item.repair_kit": "item_emergency_patch", "item.full_restore": "item_emergency_patch",
};
/** Supports the host listing id and Unity's mixed dot/underscore filenames. */
export function getItemIcon(idOrName: string): number | null {
  const id = idOrName.trim();
  const aliasKey = id.toLowerCase();
  const key = Object.prototype.hasOwnProperty.call(aliases, aliasKey) ? aliases[aliasKey] : id;
  if (Object.prototype.hasOwnProperty.call(itemIcons, key)) return itemIcons[key as ItemIconId];
  const underscoreKey = key.replace(/\./g, "_");
  if (Object.prototype.hasOwnProperty.call(itemIcons, underscoreKey)) return itemIcons[underscoreKey as ItemIconId];
  const caseMatch = Object.keys(itemIcons).find(candidate => candidate.toLowerCase() === key.toLowerCase());
  return caseMatch ? itemIcons[caseMatch as ItemIconId] : null;
}
