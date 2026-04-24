import { useMemo, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { HolobotStatsModal } from "@/components/HolobotStatsModal";
import { HomeCogButton } from "@/components/HomeCogButton";
import { gameAssets, getMarketplaceItemImageSource, getPartImageSource } from "@/config/gameAssets";
import { BATTLE_CARD_TEMPLATES, STARTER_DECK_BALANCED_IDS } from "@/lib/battleCards/catalog";
import {
  calculateExperience,
  getExpProgress,
  getHolobotRank,
  mergeHolobotRoster,
  normalizeUserHolobot,
} from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { canUpgradeSyncStat, upgradeSyncStat, type SyncStatKey } from "@/lib/syncProgression";
import type { UserHolobot } from "@/types/profile";

const tabs = ["Holobots", "Parts", "Items", "Cards"] as const;
type InventoryTab = (typeof tabs)[number];
const MAX_DECK_SIZE = STARTER_DECK_BALANCED_IDS.length;
const CARD_TYPE_FILTERS = [
  { label: "All Types", value: "all" },
  { label: "Strike", value: "strike" },
  { label: "Combo", value: "combo" },
  { label: "Defend", value: "defense" },
  { label: "Finisher", value: "finisher" },
] as const;
const CARD_TIER_FILTERS = [
  { label: "All Tiers", value: "all" },
  { label: "Tier 1", value: "1" },
  { label: "Tier 2", value: "2" },
  { label: "Tier 3", value: "3" },
  { label: "Tier 4", value: "4" },
] as const;
const CARD_EQUIP_FILTERS = [
  { label: "All Cards", value: "all" },
  { label: "Equipped", value: "equipped" },
  { label: "Not Equipped", value: "unequipped" },
] as const;

const BLUEPRINT_TIERS = [
  { attributePoints: 10, label: "Common", required: 5, startLevel: 1 },
  { attributePoints: 10, label: "Champion", required: 10, startLevel: 11 },
  { attributePoints: 20, label: "Rare", required: 20, startLevel: 21 },
  { attributePoints: 30, label: "Elite", required: 40, startLevel: 31 },
  { attributePoints: 40, label: "Legendary", required: 80, startLevel: 41 },
] as const;

type UpgradeTierLabel = (typeof BLUEPRINT_TIERS)[number]["label"];
type CardTypeFilter = (typeof CARD_TYPE_FILTERS)[number]["value"];
type CardTierFilter = (typeof CARD_TIER_FILTERS)[number]["value"];
type CardEquipFilter = (typeof CARD_EQUIP_FILTERS)[number]["value"];

function getTierByLabel(label: UpgradeTierLabel) {
  return BLUEPRINT_TIERS.find((tier) => tier.label === label);
}

export function InventoryScreen() {
  const { profile, updateProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<InventoryTab>("Holobots");
  const [selectedHolobotKey, setSelectedHolobotKey] = useState<string | null>(null);
  const [isCardFilterOpen, setIsCardFilterOpen] = useState(false);
  const [cardTypeFilter, setCardTypeFilter] = useState<CardTypeFilter>("all");
  const [cardTierFilter, setCardTierFilter] = useState<CardTierFilter>("all");
  const [cardEquipFilter, setCardEquipFilter] = useState<CardEquipFilter>("all");
  const roster = mergeHolobotRoster(profile?.holobots);
  const selectedRosterHolobot = useMemo(
    () => roster.find((holobot) => holobot.key === selectedHolobotKey) || null,
    [roster, selectedHolobotKey],
  );
  const selectedOwnedHolobot = useMemo(
    () =>
      selectedRosterHolobot
        ? profile?.holobots?.find(
            (holobot) => holobot.name.toUpperCase() === selectedRosterHolobot.name.toUpperCase(),
          ) || null
        : null,
    [profile?.holobots, selectedRosterHolobot],
  );
  const parts = (profile?.parts || []).reduce<Array<{ image: number | null; name: string; quantity: number; rarity?: string; slot?: string }>>(
    (acc, rawPart, index) => {
      const name = String((rawPart as { name?: string }).name || `Part ${index + 1}`);
      const slot = String((rawPart as { slot?: string }).slot || "");
      const existing = acc.find((entry) => entry.name === name && entry.slot === slot);

      if (existing) {
        existing.quantity += 1;
        return acc;
      }

      acc.push({
        image: getPartImageSource(name, slot),
        name,
        quantity: 1,
        rarity: slot ? `${slot.toUpperCase()} PART` : "PART",
        slot,
      });
      return acc;
    },
    [],
  );
  const items = [
    { image: getMarketplaceItemImageSource("Arena Pass"), name: "Arena Pass", quantity: profile?.arena_passes || 0 },
    { image: getMarketplaceItemImageSource("Gacha Ticket"), name: "Gacha Ticket", quantity: profile?.gachaTickets || 0 },
    { image: getMarketplaceItemImageSource("Energy Refill"), name: "Energy Refill", quantity: profile?.energy_refills || 0 },
    { image: getMarketplaceItemImageSource("EXP Booster"), name: "EXP Booster", quantity: profile?.exp_boosters || 0 },
    { image: getMarketplaceItemImageSource("Rank Skip"), name: "Rank Skip", quantity: profile?.rank_skips || 0 },
    { image: getMarketplaceItemImageSource("Async Battle Ticket"), name: "Async Battle Ticket", quantity: profile?.async_battle_tickets || 0 },
  ].filter((entry) => entry.quantity > 0);
  const blueprints = Object.entries(profile?.blueprints || {})
    .map(([name, quantity]) => ({
      image: gameAssets.blueprint,
      name: name.toUpperCase(),
      quantity,
      rarity: "BLUEPRINT",
    }))
    .filter((entry) => entry.quantity > 0);
  const battleCardCollection = useMemo(
    () =>
      Object.entries(profile?.battle_cards || {})
        .filter(([, quantity]) => quantity > 0)
        .map(([templateId, quantity]) => {
          const template = BATTLE_CARD_TEMPLATES[templateId];

          return {
            battleTier: template?.battleTier,
            description: template?.description || "Battle card",
            name: template?.name || templateId,
            quantity,
            rarity: template?.rarity || "common",
            staminaCost: template?.staminaCost || 0,
            templateId,
            type: template?.type || "strike",
          };
        })
        .sort((left, right) => {
          const tierDelta = (left.battleTier || 0) - (right.battleTier || 0);
          if (tierDelta !== 0) return tierDelta;
          return left.name.localeCompare(right.name);
        }),
    [profile?.battle_cards],
  );
  const activeDeck = useMemo(
    () =>
      (profile?.arena_deck_template_ids?.length
        ? profile.arena_deck_template_ids
        : STARTER_DECK_BALANCED_IDS.filter((templateId) => (profile?.battle_cards?.[templateId] || 0) > 0)
      ).map((templateId, index) => {
        const template = BATTLE_CARD_TEMPLATES[templateId];

        return {
          key: `${templateId}:${index}`,
          name: template?.name || templateId,
          rarity: template?.rarity || "common",
          staminaCost: template?.staminaCost || 0,
          templateId,
          type: template?.type || "strike",
        };
      }),
    [profile?.arena_deck_template_ids, profile?.battle_cards],
  );
  const filteredBattleCardCollection = useMemo(
    () =>
      battleCardCollection.filter((card) => {
        const equippedCopies = activeDeck.filter((entry) => entry.templateId === card.templateId).length;
        const matchesType = cardTypeFilter === "all" || card.type === cardTypeFilter;
        const matchesTier = cardTierFilter === "all" || String(card.battleTier || "") === cardTierFilter;
        const matchesEquip =
          cardEquipFilter === "all" ||
          (cardEquipFilter === "equipped" ? equippedCopies > 0 : equippedCopies === 0);

        return matchesType && matchesTier && matchesEquip;
      }),
    [activeDeck, battleCardCollection, cardEquipFilter, cardTierFilter, cardTypeFilter],
  );
  const activeCardFilterCount = [cardTypeFilter, cardTierFilter, cardEquipFilter].filter((value) => value !== "all").length;

  const renderHolobots = () =>
    roster.map((holobot, index) => {
      const blueprintCount = profile?.blueprints?.[holobot.key] || 0;
      const progress = holobot.owned ? getExpProgress(holobot) : Math.min(1, blueprintCount / 5);

      return (
        <Pressable
          key={`${holobot.key}:${index}`}
          style={[styles.holobotCard, !holobot.owned ? styles.holobotCardLocked : null]}
          onPress={() => setSelectedHolobotKey(holobot.key)}
        >
          <Image source={holobot.imageSource} style={styles.holobotImage} resizeMode="contain" />
          <View style={styles.holobotContent}>
            <View style={styles.holobotHeaderRow}>
              <Text style={styles.holobotName}>{holobot.name}</Text>
              {!holobot.owned ? <Text style={styles.holobotStatus}>UNMINTED</Text> : null}
            </View>
            <Text style={styles.holobotMeta}>
              {holobot.owned
                ? `Level ${holobot.level} • EXP ${holobot.experience}/${holobot.nextLevelExp}`
                : `${blueprintCount} blueprints collected`}
            </Text>
            <View style={styles.expTrack}>
              <View style={[styles.expFill, { width: `${progress * 100}%` }]} />
            </View>
          </View>
        </Pressable>
      );
    });

  const handleUpgradeStat = async (attribute: "attack" | "defense" | "speed" | "health") => {
    if (!profile?.holobots || !selectedOwnedHolobot) {
      return;
    }

    const normalizedTarget = normalizeUserHolobot(selectedOwnedHolobot);
    if ((normalizedTarget.attributePoints || 0) <= 0) {
      Alert.alert("No Boosts Available", "This Holobot has no attribute points available to spend.");
      return;
    }

    const updatedHolobots: UserHolobot[] = profile.holobots.map((holobot) => {
      if (holobot.name.toUpperCase() !== normalizedTarget.name.toUpperCase()) {
        return holobot;
      }

      const boosts = { ...(normalizedTarget.boostedAttributes || {}) };
      if (attribute === "health") {
        boosts.health = (boosts.health || 0) + 10;
      } else {
        boosts[attribute] = (boosts[attribute] || 0) + 1;
      }

      return {
        ...normalizedTarget,
        attributePoints: Math.max(0, (normalizedTarget.attributePoints || 0) - 1),
        boostedAttributes: boosts,
      };
    });

    try {
      await updateProfile({ holobots: updatedHolobots });
    } catch (error) {
      Alert.alert("Upgrade failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleUpgradeSyncStat = async (stat: SyncStatKey) => {
    if (!profile || !selectedOwnedHolobot) {
      return;
    }

    const upgradeCheck = canUpgradeSyncStat(profile, selectedOwnedHolobot, stat);
    if (!upgradeCheck.canUpgrade) {
      Alert.alert("Sync Upgrade Locked", upgradeCheck.reason || "This Sync Stat cannot be upgraded yet.");
      return;
    }

    try {
      const result = upgradeSyncStat(profile, selectedOwnedHolobot.name, stat);
      await updateProfile({
        holobots: result.profile.holobots,
        syncPoints: result.profile.syncPoints,
      });
    } catch (error) {
      Alert.alert("Sync Upgrade Failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleMintHolobot = async (tierLabel: UpgradeTierLabel) => {
    if (!profile || !selectedRosterHolobot) {
      return;
    }

    const tier = getTierByLabel(tierLabel);
    if (!tier) {
      return;
    }

    const currentBlueprints = profile.blueprints?.[selectedRosterHolobot.key] || 0;
    if (currentBlueprints < tier.required) {
      Alert.alert("Not Enough Blueprints", `You need ${tier.required} blueprints to mint ${selectedRosterHolobot.name}.`);
      return;
    }

    const nextHolobot: UserHolobot = {
      attributePoints: tier.attributePoints,
      boostedAttributes: {},
      experience: 0,
      level: tier.startLevel,
      name: selectedRosterHolobot.name,
      nextLevelExp: calculateExperience(tier.startLevel + 1),
      rank: getHolobotRank(tier.startLevel),
    };

    const nextBlueprints = {
      ...(profile.blueprints || {}),
      [selectedRosterHolobot.key]: currentBlueprints - tier.required,
    };

    try {
      await updateProfile({
        blueprints: nextBlueprints,
        holobots: [...(profile.holobots || []), nextHolobot],
      });
      Alert.alert("Holobot Minted", `${selectedRosterHolobot.name} joined your roster at Level ${tier.startLevel}.`);
    } catch (error) {
      Alert.alert("Mint failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleRankUpgrade = async (tierLabel: UpgradeTierLabel) => {
    if (!profile?.holobots || !selectedOwnedHolobot || !selectedRosterHolobot) {
      return;
    }

    const tier = getTierByLabel(tierLabel);
    if (!tier) {
      return;
    }

    const currentBlueprints = profile.blueprints?.[selectedRosterHolobot.key] || 0;
    if (currentBlueprints < tier.required) {
      Alert.alert("Not Enough Blueprints", `You need ${tier.required} blueprints to upgrade to ${tier.label}.`);
      return;
    }

    if (tier.startLevel <= (selectedOwnedHolobot.level || 1)) {
      Alert.alert("Tier Already Reached", `${selectedRosterHolobot.name} is already at this rank or higher.`);
      return;
    }

    const normalizedTarget = normalizeUserHolobot(selectedOwnedHolobot);
    const nextBlueprints = {
      ...(profile.blueprints || {}),
      [selectedRosterHolobot.key]: currentBlueprints - tier.required,
    };
    const updatedHolobots = profile.holobots.map((holobot) => {
      if (holobot.name.toUpperCase() !== normalizedTarget.name.toUpperCase()) {
        return holobot;
      }

      return {
        ...normalizedTarget,
        attributePoints: (normalizedTarget.attributePoints || 0) + tier.attributePoints,
        experience: 0,
        level: tier.startLevel,
        nextLevelExp: calculateExperience(tier.startLevel + 1),
        rank: getHolobotRank(tier.startLevel),
      };
    });

    try {
      await updateProfile({
        blueprints: nextBlueprints,
        holobots: updatedHolobots,
      });
      Alert.alert("Holobot Upgraded", `${selectedRosterHolobot.name} advanced to ${tier.label} rank at Level ${tier.startLevel}.`);
    } catch (error) {
      Alert.alert("Upgrade failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleEquipCard = async (templateId: string) => {
    if (!profile) {
      return;
    }

    const ownedCopies = profile.battle_cards?.[templateId] || 0;
    const equippedCopies = activeDeck.filter((card) => card.templateId === templateId).length;
    const nextDeck = profile.arena_deck_template_ids?.length
      ? [...profile.arena_deck_template_ids]
      : STARTER_DECK_BALANCED_IDS.filter((id) => (profile.battle_cards?.[id] || 0) > 0);

    if (nextDeck.length >= MAX_DECK_SIZE) {
      Alert.alert("Deck Full", `Your active deck can only hold ${MAX_DECK_SIZE} cards.`);
      return;
    }

    if (equippedCopies >= ownedCopies) {
      Alert.alert("No Extra Copies", "You need another copy of this battle card to equip more of it.");
      return;
    }

    try {
      await updateProfile({
        arena_deck_template_ids: [...nextDeck, templateId],
      });
    } catch (error) {
      Alert.alert("Equip failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleUnequipCard = async (deckIndex: number) => {
    if (!profile) {
      return;
    }

    const nextDeck = profile.arena_deck_template_ids?.length
      ? [...profile.arena_deck_template_ids]
      : STARTER_DECK_BALANCED_IDS.filter((id) => (profile.battle_cards?.[id] || 0) > 0);

    nextDeck.splice(deckIndex, 1);

    try {
      await updateProfile({
        arena_deck_template_ids: nextDeck,
      });
    } catch (error) {
      Alert.alert("Unequip failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const renderCardsTab = () => (
    <View style={styles.cardsTab}>
      <View style={styles.deckPanel}>
        <View style={styles.deckPanelHeader}>
          <View style={styles.deckPanelHeaderBody}>
            <Text style={styles.deckPanelTitle}>ACTIVE DECK</Text>
            <Text style={styles.deckPanelMeta}>{`${activeDeck.length}/${MAX_DECK_SIZE} cards equipped`}</Text>
          </View>
          <Pressable style={styles.filterButton} onPress={() => setIsCardFilterOpen(true)}>
            <Svg width={20} height={20} viewBox="0 0 24 24">
              <Path
                d="M4 4h16v2.172a2 2 0 0 1-.586 1.414L15 12v7l-6 2v-8.5L4.52 7.572A2 2 0 0 1 4 6.227z"
                fill="none"
                stroke="#f0bf14"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </Svg>
            <Text style={styles.filterButtonText}>
              {activeCardFilterCount > 0 ? `FILTERS ${activeCardFilterCount}` : "FILTER"}
            </Text>
          </Pressable>
        </View>
        <View style={styles.deckList}>
          {activeDeck.map((card, index) => (
            <Pressable key={card.key} style={[styles.cardRow, styles.cardRowActive]} onPress={() => void handleUnequipCard(index)}>
              <View style={styles.cardRowBody}>
                <Text style={styles.cardRowTitle}>{card.name.toUpperCase()}</Text>
                <Text style={styles.cardRowMeta}>{`${card.type.toUpperCase()} • ${card.rarity.toUpperCase()} • COST ${card.staminaCost}`}</Text>
              </View>
              <Text style={styles.cardRowAction}>REMOVE</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.deckPanel}>
        <Text style={styles.deckPanelTitle}>CARD COLLECTION</Text>
        <Text style={styles.deckPanelMeta}>
          {`${filteredBattleCardCollection.length}/${battleCardCollection.length} cards shown`}
        </Text>
        <View style={styles.deckList}>
          {filteredBattleCardCollection.length ? filteredBattleCardCollection.map((card) => {
            const equippedCopies = activeDeck.filter((entry) => entry.templateId === card.templateId).length;
            const canEquip = equippedCopies < card.quantity && activeDeck.length < MAX_DECK_SIZE;

            return (
              <Pressable
                key={card.templateId}
                style={styles.cardRow}
                onPress={() => {
                  if (canEquip) {
                    void handleEquipCard(card.templateId);
                  }
                }}
              >
                <View style={styles.cardRowBody}>
                  <Text style={styles.cardRowTitle}>{card.name.toUpperCase()}</Text>
                  <Text style={styles.cardRowMeta}>
                    {`${card.type.toUpperCase()} • ${card.rarity.toUpperCase()} • COST ${card.staminaCost}`}
                  </Text>
                  <Text style={styles.cardRowSubmeta}>
                    {`Owned ${card.quantity} • Equipped ${equippedCopies}${card.battleTier ? ` • Tier ${card.battleTier}` : ""}`}
                  </Text>
                </View>
                <Text style={[styles.cardRowAction, !canEquip ? styles.cardRowActionDisabled : null]}>
                  {canEquip ? "EQUIP" : "FULL"}
                </Text>
              </Pressable>
            );
          }) : <Text style={styles.emptyFilterState}>No battle cards match this filter setup.</Text>}
        </View>
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={isCardFilterOpen}
        onRequestClose={() => setIsCardFilterOpen(false)}
      >
        <Pressable style={styles.filterModalBackdrop} onPress={() => setIsCardFilterOpen(false)}>
          <Pressable style={styles.filterModalCard} onPress={() => {}}>
            <Text style={styles.filterModalEyebrow}>CARD FILTER</Text>
            <Text style={styles.filterModalTitle}>Battle Card Filters</Text>

            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>TYPE</Text>
              <View style={styles.filterChipRow}>
                {CARD_TYPE_FILTERS.map((filter) => (
                  <Pressable
                    key={filter.value}
                    style={[styles.filterChip, cardTypeFilter === filter.value ? styles.filterChipActive : null]}
                    onPress={() => setCardTypeFilter(filter.value)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        cardTypeFilter === filter.value ? styles.filterChipTextActive : null,
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>TIER</Text>
              <View style={styles.filterChipRow}>
                {CARD_TIER_FILTERS.map((filter) => (
                  <Pressable
                    key={filter.value}
                    style={[styles.filterChip, cardTierFilter === filter.value ? styles.filterChipActive : null]}
                    onPress={() => setCardTierFilter(filter.value)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        cardTierFilter === filter.value ? styles.filterChipTextActive : null,
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.filterSection}>
              <Text style={styles.filterSectionTitle}>EQUIPPED</Text>
              <View style={styles.filterChipRow}>
                {CARD_EQUIP_FILTERS.map((filter) => (
                  <Pressable
                    key={filter.value}
                    style={[styles.filterChip, cardEquipFilter === filter.value ? styles.filterChipActive : null]}
                    onPress={() => setCardEquipFilter(filter.value)}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        cardEquipFilter === filter.value ? styles.filterChipTextActive : null,
                      ]}
                    >
                      {filter.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.filterActionRow}>
              <Pressable
                style={styles.filterSecondaryButton}
                onPress={() => {
                  setCardTypeFilter("all");
                  setCardTierFilter("all");
                  setCardEquipFilter("all");
                }}
              >
                <Text style={styles.filterSecondaryButtonText}>CLEAR</Text>
              </Pressable>
              <Pressable style={styles.filterPrimaryButton} onPress={() => setIsCardFilterOpen(false)}>
                <Text style={styles.filterPrimaryButtonText}>DONE</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );

  const renderList = (entries: Array<{ image?: number | null; name: string; quantity: number; rarity?: string }>) =>
    entries.map((entry, index) => (
      <View key={`${entry.name}:${index}`} style={styles.assetRow}>
        <View style={styles.assetLeft}>
          <View style={styles.assetImageFrame}>
            {entry.image ? <Image source={entry.image} style={styles.assetImage} resizeMode="contain" /> : null}
          </View>
          <View style={styles.assetBody}>
            <Text style={styles.simpleName}>{entry.name}</Text>
            {entry.rarity ? <Text style={styles.simpleMeta}>{entry.rarity}</Text> : null}
          </View>
        </View>
        <Text style={styles.simpleQty}>{`x${entry.quantity}`}</Text>
      </View>
    ));

  return (
    <View style={styles.page}>
      <HomeCogButton showStats={false} />
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>LOADOUT</Text>
        <Text style={styles.headerTitle}>Inventory</Text>
        <Text style={styles.headerMeta}>
          {`Parts ${profile?.parts?.length || 0} • Items ${items.length} • Cards ${battleCardCollection.length}`}
        </Text>
      </View>

      <View style={styles.tabRow}>
        {tabs.map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={[styles.tabButton, activeTab === tab ? styles.tabButtonActive : null]}
          >
            <Text style={[styles.tabButtonText, activeTab === tab ? styles.tabButtonTextActive : null]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {activeTab === "Holobots" ? renderHolobots() : null}
        {activeTab === "Parts" ? renderList(parts) : null}
        {activeTab === "Items" ? renderList(items) : null}
        {activeTab === "Cards" ? renderCardsTab() : null}
      </ScrollView>

      <HolobotStatsModal
        availableSyncPoints={profile?.syncPoints || 0}
        blueprintCount={selectedRosterHolobot ? profile?.blueprints?.[selectedRosterHolobot.key] || 0 : 0}
        holobot={selectedRosterHolobot}
        ownedHolobot={selectedOwnedHolobot}
        visible={!!selectedRosterHolobot}
        onClose={() => setSelectedHolobotKey(null)}
        onMint={handleMintHolobot}
        onRankUpgrade={handleRankUpgrade}
        onUpgrade={handleUpgradeStat}
        onUpgradeSync={handleUpgradeSyncStat}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  assetBody: {
    flex: 1,
    justifyContent: "center",
  },
  assetImage: {
    height: 72,
    width: 72,
  },
  assetImageFrame: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#7a6412",
    borderWidth: 1,
    height: 84,
    justifyContent: "center",
    width: 84,
  },
  assetLeft: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 14,
    minWidth: 0,
  },
  assetRow: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
  },
  cardRow: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#7a6412",
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 14,
  },
  cardRowAction: {
    color: "#f0bf14",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  cardRowActionDisabled: {
    color: "#7b6c3e",
  },
  cardRowActive: {
    borderColor: "#f0bf14",
  },
  cardRowBody: {
    flex: 1,
    minWidth: 0,
  },
  cardRowMeta: {
    color: "#ddd2b5",
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
  },
  cardRowSubmeta: {
    color: "#9a916f",
    fontSize: 11,
    lineHeight: 15,
    marginTop: 5,
  },
  cardRowTitle: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "800",
  },
  cardsTab: {
    gap: 14,
  },
  deckPanelHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 12,
  },
  deckPanelHeaderBody: {
    flex: 1,
    minWidth: 0,
  },
  deckList: {
    gap: 10,
  },
  deckPanel: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    padding: 14,
  },
  deckPanelMeta: {
    color: "#ddd2b5",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  deckPanelTitle: {
    color: "#f0bf14",
    fontSize: 18,
    fontWeight: "900",
  },
  emptyFilterState: {
    color: "#ddd2b5",
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 8,
    textAlign: "center",
  },
  expFill: {
    backgroundColor: "#f0bf14",
    height: "100%",
    width: "62%",
  },
  filterActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
  },
  filterButton: {
    alignItems: "center",
    borderColor: "#f0bf14",
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  filterButtonText: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  filterChip: {
    borderColor: "#7a6412",
    borderWidth: 1,
    minWidth: 92,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  filterChipActive: {
    backgroundColor: "#f0bf14",
    borderColor: "#f0bf14",
  },
  filterChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  filterChipText: {
    color: "#ddd2b5",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  filterChipTextActive: {
    color: "#050606",
  },
  filterModalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.78)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  filterModalCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 3,
    maxWidth: 420,
    padding: 18,
    width: "100%",
  },
  filterModalEyebrow: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  filterModalTitle: {
    color: "#fef1e0",
    fontSize: 30,
    fontWeight: "900",
    marginTop: 6,
  },
  filterPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    flex: 1,
    justifyContent: "center",
    paddingVertical: 13,
  },
  filterPrimaryButtonText: {
    color: "#050606",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  filterSecondaryButton: {
    alignItems: "center",
    borderColor: "#7a6412",
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    paddingVertical: 13,
  },
  filterSecondaryButtonText: {
    color: "#ddd2b5",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  filterSection: {
    borderColor: "#f0bf14",
    borderWidth: 1,
    marginTop: 16,
    padding: 14,
  },
  filterSectionTitle: {
    color: "#f0bf14",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  expTrack: {
    backgroundColor: "#413822",
    height: 8,
    marginTop: 12,
    width: "100%",
  },
  header: {
    backgroundColor: "#050606",
    borderBottomColor: "#f0bf14",
    borderBottomWidth: 3,
    paddingBottom: 18,
    paddingHorizontal: 24,
    paddingTop: 94,
  },
  headerEyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  headerTitle: {
    color: "#fef1e0",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 6,
  },
  headerMeta: {
    color: "#ddd2b5",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  holobotCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 14,
    padding: 14,
  },
  holobotCardLocked: {
    opacity: 0.95,
  },
  holobotContent: {
    flex: 1,
    justifyContent: "center",
  },
  holobotHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  holobotImage: {
    backgroundColor: "#1a1a1a",
    height: 98,
    width: 98,
  },
  holobotMeta: {
    color: "#ddd2b5",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  holobotName: {
    color: "#fef1e0",
    fontSize: 22,
    fontWeight: "800",
  },
  holobotStatus: {
    color: "#f0bf14",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  page: {
    backgroundColor: "#f5c40d",
    flex: 1,
  },
  scrollContent: {
    gap: 14,
    padding: 20,
    paddingBottom: 40,
  },
  simpleMeta: {
    color: "#ddd2b5",
    fontSize: 13,
    marginTop: 6,
  },
  simpleName: {
    color: "#fef1e0",
    fontSize: 20,
    fontWeight: "800",
  },
  simpleQty: {
    color: "#f0bf14",
    fontSize: 24,
    fontWeight: "900",
  },
  tabButton: {
    borderColor: "#7a6412",
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12,
  },
  tabButtonActive: {
    backgroundColor: "#050606",
    borderColor: "#050606",
  },
  tabButtonText: {
    color: "#3f3104",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  tabButtonTextActive: {
    color: "#fef1e0",
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
});
