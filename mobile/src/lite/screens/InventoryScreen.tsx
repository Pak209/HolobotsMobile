import { useIsFocused } from "@react-navigation/native";
import { HolobotRosterCard } from "@/lite/components/HolobotRosterCard";
import { theme } from "@/lite/theme";
import { useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { HolobotStatsModal } from "@/lite/components/HolobotStatsModal";
import { HomeCogButton } from "@/lite/components/HomeCogButton";
import { MoveLabPanel } from "@/lite/components/MoveLabPanel";
import {
  AngularPageTabs,
  CompactSectionHeader,
} from "@/lite/components/navigation/GameSectionChrome";
import { GameSurfaceFrame } from "@/lite/components/ui/GameSurfaceFrame";
import { ArenaControlFrame } from "@/lite/components/arena/ArenaTierFrames";
import { gameAssets, getMarketplaceItemImageSource, getPartImageSource } from "@/lite/config/gameAssets";
import { getExpProgress, mergeHolobotRoster, normalizeUserHolobot } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";
import { assignWildcardBlueprintsAuthoritative } from "@/lib/genesisClient";
import {
  boostHolobotAttributeAuthoritative,
  redeemLegendaryBlueprintAuthoritative,
  useExpBoosterAuthoritative,
  useRankSkipAuthoritative,
} from "@/lib/progressionClient";
import { describePartBoosts } from "@/lib/partStats";
import { getTierByLabel, type UpgradeTierLabel } from "@/lib/minting";
import {
  mintHolobotAuthoritative,
  upgradeHolobotRankAuthoritative,
  upgradeSyncStatAuthoritative,
} from "@/lib/progressionClient";
import { canUpgradeSyncStat, type SyncStatKey } from "@/lib/syncProgression";

const tabs = ["Holobots", "Parts", "Items", "Move Lab"] as const;
type InventoryTab = (typeof tabs)[number];
export function InventoryScreen() {
  const { profile, updateProfile } = useAuth();
  const focused = useIsFocused();
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

      const boostLabel = describePartBoosts(rawPart as { name?: string; slot?: string; rarity?: string });
      acc.push({
        image: getPartImageSource(name, slot),
        name,
        quantity: 1,
        rarity: `${slot ? `${slot.toUpperCase()} PART` : "PART"}${boostLabel ? ` · ${boostLabel}` : ""}`,
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
  const renderHolobots = () => roster.map((holobot, index) => (
    <HolobotRosterCard
      key={holobot.key}
      holobot={holobot}
      slot={index}
      live={focused && index === 0 && selectedHolobotKey === null}
      blueprintCount={profile?.blueprints?.[holobot.key] || 0}
      onPress={() => setSelectedHolobotKey(holobot.key)}
    />
  ));

  const handleUpgradeStat = async (attribute: "attack" | "defense" | "special" | "health" | "speed") => {
    if (!profile?.holobots || !selectedOwnedHolobot) {
      return;
    }

    const normalizedTarget = normalizeUserHolobot(selectedOwnedHolobot);
    if ((normalizedTarget.attributePoints || 0) <= 0) {
      Alert.alert("No Boosts Available", "This Holobot has no attribute points available to spend.");
      return;
    }

    // Server-authoritative (DECISIONS #53-2, #72.78 SPECIAL +1 / HP +3): the boostHolobotAttribute
    // callable applies the same math (lib/progression applyAttributeBoost);
    // the profile listener redraws from the confirmed write.
    try {
      await boostHolobotAttributeAuthoritative(normalizedTarget.name, attribute);
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

  const handleEquipSyncAbility = async (abilityId: string) => {
    if (!profile?.holobots || !selectedOwnedHolobot) return;
    const normalized = normalizeUserHolobot(selectedOwnedHolobot);
    if (!(normalized.syncAbilityUnlocks || []).includes(abilityId)) {
      Alert.alert("Sync Ability Locked", "Meet the listed Sync Stat requirements before equipping this ability.");
      return;
    }
    try {
      await updateProfile({
        holobots: profile.holobots.map((entry) =>
          entry.name.toUpperCase() === normalized.name.toUpperCase()
            ? { ...entry, equippedSyncAbilityId: abilityId }
            : entry,
        ),
      });
    } catch (error) {
      Alert.alert("Equip failed", error instanceof Error ? error.message : "Please try again.");
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

  const handleUseRankSkip = async () => {
    if (!profile || !selectedRosterHolobot) {
      return;
    }

    try {
      const { nextTierLabel } = await useRankSkipAuthoritative(selectedRosterHolobot.name);
      Alert.alert("Rank Skip Used", `${selectedRosterHolobot.name} jumped to ${nextTierLabel} rank!`);
    } catch (error) {
      Alert.alert("Rank Skip failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const handleActivateExpBooster = async () => {
    try {
      const { activeUntil } = await useExpBoosterAuthoritative();
      const hours = Math.round((activeUntil - Date.now()) / (60 * 60 * 1000));
      Alert.alert("EXP Booster Active", `Arena EXP is DOUBLED for the next ${hours} hours.`);
    } catch (error) {
      Alert.alert("Activation failed", error instanceof Error ? error.message : "Please try again.");
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

  const expBoosterActive = Number(profile?.expBoosterActiveUntil || 0) > Date.now();
  const expBoosterHoursLeft = Math.max(
    1,
    Math.ceil((Number(profile?.expBoosterActiveUntil || 0) - Date.now()) / (60 * 60 * 1000)),
  );

  const renderList = (entries: Array<{ image?: number | null; name: string; quantity: number; rarity?: string }>) =>
    entries.map((entry, index) => (
      <View key={`${entry.name}:${index}`} style={styles.assetRow}>
        <GameSurfaceFrame accent={entry.rarity?.includes("EPIC") ? theme.colors.purple : entry.rarity ? theme.colors.accent : theme.colors.accent} />
        <View style={styles.assetLeft}>
          <View style={styles.assetImageFrame}>
            <ArenaControlFrame accent={entry.rarity ? theme.colors.accent : theme.colors.accent} />
            {entry.image ? <Image source={entry.image} style={styles.assetImage} resizeMode="contain" /> : null}
          </View>
          <View style={styles.assetBody}>
            <Text style={styles.simpleName}>{entry.name}</Text>
            {entry.rarity ? <Text style={styles.simpleMeta}>{entry.rarity}</Text> : null}
            {entry.name === "EXP Booster" && expBoosterActive ? (
              <Text style={styles.boosterActiveText}>{`2× ARENA EXP · ${expBoosterHoursLeft}h left`}</Text>
            ) : null}
          </View>
        </View>
        {entry.name === "EXP Booster" && !expBoosterActive ? (
          <Pressable onPress={() => void handleActivateExpBooster()} style={styles.useItemButton}>
            <ArenaControlFrame accent={theme.colors.accent} selected />
            <Text style={styles.useItemButtonText}>ACTIVATE</Text>
          </Pressable>
        ) : null}
        <Text style={styles.simpleQty}>{`x${entry.quantity}`}</Text>
      </View>
    ));

  return (
    <View style={styles.page}>
      <HomeCogButton showStats={false} />
      <CompactSectionHeader
        eyebrow="LOADOUT"
        meta={`Parts ${profile?.parts?.length || 0} • Items ${items.length} • Moves ${Object.keys(profile?.battle_cards || {}).length}`}
        title="Inventory"
      />

      <AngularPageTabs activeTab={activeTab} onChange={setActiveTab} tabs={tabs} />

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
        rankSkipCount={profile?.rank_skips || 0}
        onAssignWildcards={(amount) => void handleAssignWildcards(amount)}
        onUseRankSkip={() => void handleUseRankSkip()}
        onAscendLegendary={() => void handleAscendLegendary()}
        onClose={() => setSelectedHolobotKey(null)}
        onMint={handleMintHolobot}
        onRankUpgrade={handleRankUpgrade}
        onUpgrade={handleUpgradeStat}
        onUpgradeSync={handleUpgradeSyncStat}
        onEquipSyncAbility={(abilityId) => void handleEquipSyncAbility(abilityId)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  boosterActiveText: {
    color: theme.colors.success,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "800",
    marginTop: 3,
  },
  useItemButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    justifyContent: "center",
    marginRight: 12,
    minHeight: 36,
    paddingHorizontal: 12,
    position: "relative",
  },
  useItemButtonText: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
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
    backgroundColor: "transparent",
    height: 84,
    justifyContent: "center",
    width: 84,
    position: "relative",
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
    backgroundColor: "transparent",
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
    position: "relative",
  },
  page: {
    backgroundColor: theme.colors.carbon,
    flex: 1,
  },
  scrollContent: {
    gap: 14,
    padding: 20,
    paddingBottom: 40,
  },
  simpleMeta: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 13,
    marginTop: 6,
  },
  simpleName: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 20,
    fontWeight: "800",
  },
  simpleQty: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: 24,
    fontWeight: "900",
  },
});
