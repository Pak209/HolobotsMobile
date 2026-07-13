import { useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { HolobotStatsModal } from "@/components/HolobotStatsModal";
import { HomeCogButton } from "@/components/HomeCogButton";
import { MoveLabPanel } from "@/components/MoveLabPanel";
import { gameAssets, getMarketplaceItemImageSource, getPartImageSource } from "@/config/gameAssets";
import { getExpProgress, mergeHolobotRoster, normalizeUserHolobot } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { assignWildcardBlueprintsAuthoritative } from "@/lib/genesisClient";
import { redeemLegendaryBlueprintAuthoritative } from "@/lib/progressionClient";
import { getTierByLabel, type UpgradeTierLabel } from "@/lib/minting";
import {
  mintHolobotAuthoritative,
  upgradeHolobotRankAuthoritative,
  upgradeSyncStatAuthoritative,
} from "@/lib/progressionClient";
import { canUpgradeSyncStat, type SyncStatKey } from "@/lib/syncProgression";
import type { UserHolobot } from "@/types/profile";

const tabs = ["Holobots", "Parts", "Items", "Move Lab"] as const;
type InventoryTab = (typeof tabs)[number];
export function InventoryScreen() {
  const { profile, updateProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<InventoryTab>("Holobots");
  const [selectedHolobotKey, setSelectedHolobotKey] = useState<string | null>(null);
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
    { image: getMarketplaceItemImageSource("Wildcard Blueprints"), name: "Wildcard Blueprints", quantity: profile?.wildcardBlueprints || 0 },
    { image: getMarketplaceItemImageSource("Legendary Blueprint"), name: "Legendary Blueprint", quantity: profile?.legendaryBlueprints || 0 },
  ].filter((entry) => entry.quantity > 0);
  const blueprints = Object.entries(profile?.blueprints || {})
    .map(([name, quantity]) => ({
      image: gameAssets.blueprint,
      name: name.toUpperCase(),
      quantity,
      rarity: "BLUEPRINT",
    }))
    .filter((entry) => entry.quantity > 0);
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
      await upgradeSyncStatAuthoritative(profile, updateProfile, selectedOwnedHolobot.name, stat);
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

    try {
      await mintHolobotAuthoritative(profile, updateProfile, selectedRosterHolobot.name, tierLabel);
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

    try {
      await upgradeHolobotRankAuthoritative(profile, updateProfile, selectedRosterHolobot.name, tierLabel);
      Alert.alert("Holobot Upgraded", `${selectedRosterHolobot.name} advanced to ${tier.label} rank at Level ${tier.startLevel}.`);
    } catch (error) {
      Alert.alert("Upgrade failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleAssignWildcards = async (amount: number) => {
    if (!profile || !selectedRosterHolobot) {
      return;
    }

    try {
      const { remaining } = await assignWildcardBlueprintsAuthoritative(
        profile,
        updateProfile,
        selectedRosterHolobot.name,
        amount,
      );
      Alert.alert(
        "Wildcards Assigned",
        `+${amount} blueprints for ${selectedRosterHolobot.name}. Wildcards left: ${remaining}.`,
      );
    } catch (error) {
      Alert.alert("Assign failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleAscendLegendary = async () => {
    if (!profile || !selectedRosterHolobot) {
      return;
    }

    try {
      const result = await redeemLegendaryBlueprintAuthoritative(selectedRosterHolobot.name);
      Alert.alert(
        "LEGENDARY ASCENSION",
        result.outcome === "converted"
          ? `${selectedRosterHolobot.name} is already Legendary — converted to +${result.wildcards} Wildcard Blueprints.`
          : result.outcome === "minted"
            ? `${selectedRosterHolobot.name} joins your roster at LEGENDARY rank!`
            : `${selectedRosterHolobot.name} ascended to LEGENDARY rank!`,
      );
    } catch (error) {
      Alert.alert("Ascension failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

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
          {`Parts ${profile?.parts?.length || 0} • Items ${items.length} • Moves ${Object.keys(profile?.battle_cards || {}).length}`}
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
        {activeTab === "Move Lab" ? <MoveLabPanel /> : null}
      </ScrollView>

      <HolobotStatsModal
        availableSyncPoints={profile?.syncPoints || 0}
        blueprintCount={selectedRosterHolobot ? profile?.blueprints?.[selectedRosterHolobot.key] || 0 : 0}
        holobot={selectedRosterHolobot}
        ownedHolobot={selectedOwnedHolobot}
        visible={!!selectedRosterHolobot}
        wildcardCount={profile?.wildcardBlueprints || 0}
        legendaryBlueprintCount={profile?.legendaryBlueprints || 0}
        onAssignWildcards={(amount) => void handleAssignWildcards(amount)}
        onAscendLegendary={() => void handleAscendLegendary()}
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
  expFill: {
    backgroundColor: "#f0bf14",
    height: "100%",
    width: "62%",
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
