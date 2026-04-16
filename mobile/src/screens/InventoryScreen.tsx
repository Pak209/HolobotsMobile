import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { HomeCogButton } from "@/components/HomeCogButton";
import { gameAssets, getMarketplaceItemImageSource, getPartImageSource } from "@/config/gameAssets";
import { getExpProgress, mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";

const tabs = ["Holobots", "Parts", "Items", "Blueprints"] as const;
type InventoryTab = (typeof tabs)[number];

export function InventoryScreen() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<InventoryTab>("Holobots");
  const roster = mergeHolobotRoster(profile?.holobots).filter((holobot) => holobot.owned);
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

  const renderHolobots = () =>
    roster.map((holobot, index) => (
      <View key={`${holobot.key}:${index}`} style={styles.holobotCard}>
        <Image source={holobot.imageSource} style={styles.holobotImage} resizeMode="contain" />
        <View style={styles.holobotContent}>
          <Text style={styles.holobotName}>{holobot.name}</Text>
          <Text style={styles.holobotMeta}>{`Level ${holobot.level} • EXP ${holobot.experience}/${holobot.nextLevelExp}`}</Text>
          <View style={styles.expTrack}>
            <View style={[styles.expFill, { width: `${getExpProgress(holobot) * 100}%` }]} />
          </View>
        </View>
      </View>
    ));

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
      <HomeCogButton />
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>LOADOUT</Text>
        <Text style={styles.headerTitle}>Inventory</Text>
        <Text style={styles.headerMeta}>
          {`Parts ${profile?.parts?.length || 0} • Items ${items.length} • Blueprints ${blueprints.length}`}
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
        {activeTab === "Blueprints" ? renderList(blueprints) : null}
      </ScrollView>
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
  holobotContent: {
    flex: 1,
    justifyContent: "center",
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
  simpleRow: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 18,
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
