import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, Image } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { HomeCogButton } from "@/components/HomeCogButton";
import { getMarketplaceItemImageSource, getPartImageSource } from "@/config/gameAssets";
import { useAuth } from "@/contexts/AuthContext";

const tabs = ["Items", "Parts", "Booster Packs"] as const;
type MarketplaceTab = (typeof tabs)[number];

const itemDescriptions: Record<string, string> = {
  "Arena Pass": "Grants entry to one arena battle without costing HOLOS tokens.",
  "Async Battle Ticket": "Launches an async arena match while you are away.",
  Blueprint: "Used to unlock or progress Holobot blueprint assembly.",
  "Energy Refill": "Instantly restores your daily energy to full.",
  "EXP Booster": "Doubles experience gained from battles for 24 hours.",
  "Gacha Ticket": "Can be used for one pull in the Gacha system.",
  "Rank Skip": "Skip to the next rank instantly.",
};

function HolosMark() {
  return (
    <Svg width={34} height={34} viewBox="0 0 34 34">
      <Circle cx={17} cy={17} r={13} stroke="#00e3ff" strokeWidth={3.5} fill="none" />
      <Circle cx={17} cy={17} r={6} fill="#07080d" />
    </Svg>
  );
}

const marketplaceBoosterPacks = [
  {
    accent: "#17d9ff",
    description: "Guaranteed 1 Blueprint + 1 Part + 1 Item + 1 Battle Card with standard drop rates.",
    guaranteed: 4,
    icon: "□",
    id: "common",
    name: "Common Rank Booster",
    price: 50,
    subtitle: "STANDARD DROP RATES",
  },
  {
    accent: "#2f87ff",
    description: "Guaranteed 1 Blueprint + 1 Part + 1 Item + 1 Battle Card with improved drop rates.",
    guaranteed: 4,
    icon: "⬡",
    id: "champion",
    name: "Champion Rank Booster",
    price: 100,
    subtitle: "IMPROVED DROP RATES",
  },
  {
    accent: "#ae4cff",
    description: "Guaranteed 1 Blueprint + 1 Part + 1 Item + 1 Battle Card with enhanced rare-plus chances.",
    guaranteed: 4,
    icon: "✦",
    id: "rare",
    name: "Rare Rank Booster",
    price: 200,
    subtitle: "ENHANCED RARE+ CHANCES",
  },
  {
    accent: "#ff3b7d",
    description: "Guaranteed 1 Blueprint + 1 Part + 1 Item + 1 Battle Card with premium drop rates.",
    guaranteed: 4,
    icon: "★",
    id: "elite",
    name: "Elite Rank Booster",
    price: 400,
    subtitle: "PREMIUM DROP RATES",
  },
] as const;

const boosterBlueprintPool = ["ACE", "KUMA", "SHADOW", "ERA", "HARE", "TORA"] as const;
const boosterPartPool = [
  { name: "Combat Mask", slot: "head" },
  { name: "Void Mask", slot: "head" },
  { name: "Torso Part", slot: "torso" },
  { name: "Plasma Cannon", slot: "arms" },
  { name: "Boxer Gloves", slot: "arms" },
  { name: "Core Part", slot: "core" },
] as const;
const boosterItemAwardMap = {
  champion: "Gacha Ticket",
  common: "Arena Pass",
  elite: "EXP Booster",
  rare: "Energy Refill",
} as const;

function randomFromList<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

export function MarketplaceScreen() {
  const { profile, updateProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<MarketplaceTab>("Items");
  const [pendingPurchaseId, setPendingPurchaseId] = useState<string | null>(null);
  const items = [
    { name: "Arena Pass", quantity: profile?.arena_passes || 0 },
    { name: "Gacha Ticket", quantity: profile?.gachaTickets || 0 },
    { name: "Energy Refill", quantity: profile?.energy_refills || 0 },
    { name: "EXP Booster", quantity: profile?.exp_boosters || 0 },
    { name: "Rank Skip", quantity: profile?.rank_skips || 0 },
    { name: "Async Battle Ticket", quantity: profile?.async_battle_tickets || 0 },
    { name: "Blueprint", quantity: Object.values(profile?.blueprints || {}).reduce((sum, qty) => sum + Number(qty || 0), 0) },
  ];
  const parts = useMemo(() => {
    const grouped = new Map<string, { description: string; image: ReturnType<typeof getPartImageSource>; name: string; quantity: number }>();

    for (const [index, part] of (profile?.parts || []).entries()) {
      const name = String((part as { name?: string }).name || `Part ${index + 1}`);
      const slot = String((part as { slot?: string }).slot || "");
      const key = `${name}:${slot}`;
      const existing = grouped.get(key);

      if (existing) {
        existing.quantity += 1;
        continue;
      }

      grouped.set(key, {
        description: slot ? `${slot.toUpperCase()} equipment part` : "Holobot equipment part",
        image: getPartImageSource(name, slot),
        name,
        quantity: 1,
      });
    }

    return Array.from(grouped.values());
  }, [profile?.parts]);

  const purchaseItem = async (itemName: string) => {
    if (!profile) {
      Alert.alert("Sign in required", "Please sign in before making a purchase.");
      return;
    }

    const price = Number(getMarketplacePrice(itemName));
    if ((profile.holosTokens || 0) < price) {
      Alert.alert("Not enough Holos", `You need ${price - (profile.holosTokens || 0)} more Holos.`);
      return;
    }

    const updates: Parameters<typeof updateProfile>[0] = {
      holosTokens: (profile.holosTokens || 0) - price,
    };

    switch (itemName) {
      case "Arena Pass":
        updates.arena_passes = (profile.arena_passes || 0) + 1;
        break;
      case "Gacha Ticket":
        updates.gachaTickets = (profile.gachaTickets || 0) + 1;
        break;
      case "Energy Refill":
        updates.energy_refills = (profile.energy_refills || 0) + 1;
        break;
      case "EXP Booster":
        updates.exp_boosters = (profile.exp_boosters || 0) + 1;
        break;
      case "Rank Skip":
        updates.rank_skips = (profile.rank_skips || 0) + 1;
        break;
      case "Async Battle Ticket":
        updates.async_battle_tickets = (profile.async_battle_tickets || 0) + 1;
        break;
      case "Blueprint": {
        const chosenHolobot = randomFromList(boosterBlueprintPool);
        updates.blueprints = {
          ...(profile.blueprints || {}),
          [chosenHolobot]: ((profile.blueprints || {})[chosenHolobot] || 0) + 1,
        };
        break;
      }
    }

    try {
      setPendingPurchaseId(itemName);
      await updateProfile(updates);
      Alert.alert("Purchase complete", `${itemName} has been added to your account.`);
    } catch (error) {
      Alert.alert("Purchase failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPendingPurchaseId(null);
    }
  };

  const purchaseBoosterPack = async (packId: (typeof marketplaceBoosterPacks)[number]["id"]) => {
    if (!profile) {
      Alert.alert("Sign in required", "Please sign in before making a purchase.");
      return;
    }

    const pack = marketplaceBoosterPacks.find((entry) => entry.id === packId);
    if (!pack) {
      return;
    }

    if ((profile.holosTokens || 0) < pack.price) {
      Alert.alert("Not enough Holos", `You need ${pack.price - (profile.holosTokens || 0)} more Holos.`);
      return;
    }

    const blueprintHolobot = randomFromList(boosterBlueprintPool);
    const grantedPart = randomFromList(boosterPartPool);
    const grantedItem = boosterItemAwardMap[pack.id];
    const packHistory = Array.isArray(profile.pack_history) ? profile.pack_history : [];

    const updates: Parameters<typeof updateProfile>[0] = {
      blueprints: {
        ...(profile.blueprints || {}),
        [blueprintHolobot]: ((profile.blueprints || {})[blueprintHolobot] || 0) + 1,
      },
      holosTokens: (profile.holosTokens || 0) - pack.price,
      pack_history: [
        {
          id: `marketplace_${pack.id}_${Date.now()}`,
          items: [
            { name: blueprintHolobot, quantity: 1, type: "blueprint" },
            { name: grantedPart.name, quantity: 1, slot: grantedPart.slot, type: "part" },
            { name: grantedItem, quantity: 1, type: "item" },
            { name: "Battle Card Reward", quantity: 1, type: "battle_card" },
          ],
          openedAt: new Date().toISOString(),
          packId: pack.id,
        },
        ...packHistory,
      ].slice(0, 50),
      parts: [...(profile.parts || []), { name: grantedPart.name, slot: grantedPart.slot }],
    };

    if (grantedItem === "Arena Pass") updates.arena_passes = (profile.arena_passes || 0) + 1;
    if (grantedItem === "Gacha Ticket") updates.gachaTickets = (profile.gachaTickets || 0) + 1;
    if (grantedItem === "Energy Refill") updates.energy_refills = (profile.energy_refills || 0) + 1;
    if (grantedItem === "EXP Booster") updates.exp_boosters = (profile.exp_boosters || 0) + 1;

    try {
      setPendingPurchaseId(pack.id);
      await updateProfile(updates);
      Alert.alert(
        "Booster purchased",
        `${pack.name} opened.\n\nBlueprint: ${blueprintHolobot}\nPart: ${grantedPart.name}\nItem: ${grantedItem}`,
      );
    } catch (error) {
      Alert.alert("Purchase failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setPendingPurchaseId(null);
    }
  };

  const renderContent = () => {
    if (activeTab === "Items") {
      return items.map((item) => {
        const affordable = (profile?.holosTokens || 0) >= Number(getMarketplacePrice(item.name));
        return (
          <View key={item.name} style={styles.itemCard}>
            <View style={styles.itemIconFrame}>
              <Image source={getMarketplaceItemImageSource(item.name)} style={styles.itemIcon} resizeMode="contain" />
            </View>
            <View style={styles.itemBody}>
              <Text style={styles.itemTitle}>{item.name.toUpperCase()}</Text>
              <View style={styles.itemDivider} />
              <Text style={styles.itemCopy}>{itemDescriptions[item.name] || "Usable in the Holobots mobile game."}</Text>
            </View>
            <View style={styles.itemActions}>
              <View style={styles.qtyBox}>
                <View style={styles.priceRow}>
                  <Text style={styles.qtyValue}>{getMarketplacePrice(item.name)}</Text>
                  <HolosMark />
                </View>
              </View>
              <Pressable
                onPress={() => void purchaseItem(item.name)}
                disabled={!affordable || pendingPurchaseId === item.name}
                style={[styles.useButton, (!affordable || pendingPurchaseId === item.name) ? styles.useButtonDisabled : null]}
              >
                <Text style={[styles.useButtonText, (!affordable || pendingPurchaseId === item.name) ? styles.useButtonTextDisabled : null]}>
                  {pendingPurchaseId === item.name ? "..." : "BUY"}
                </Text>
              </Pressable>
            </View>
          </View>
        );
      });
    }

    if (activeTab === "Parts") {
      return parts.map((part, index) => (
        <View key={`${part.name}:${index}`} style={styles.itemCard}>
          <View style={styles.itemIconFrame}>
            {part.image ? <Image source={part.image} style={styles.itemIcon} resizeMode="contain" /> : null}
          </View>
          <View style={styles.itemBody}>
            <Text style={styles.itemTitle}>{part.name.toUpperCase()}</Text>
            <View style={styles.itemDivider} />
            <Text style={styles.itemCopy}>{part.description}</Text>
          </View>
          <View style={styles.itemActions}>
            <View style={styles.qtyBox}>
              <Text style={styles.qtyLabel}>QTY:</Text>
              <Text style={styles.qtyValue}>{`x${part.quantity}`}</Text>
            </View>
          </View>
        </View>
      ));
    }

    if (activeTab === "Booster Packs") {
      return (
        <View style={styles.packsSection}>
          <Text style={styles.packsTitle}>SELECT BOOSTER PACK</Text>
          <Text style={styles.packsSubtitle}>Choose your boost pack and unlock blueprints, parts, items, and battle cards.</Text>
          {marketplaceBoosterPacks.map((pack) => {
            const canAfford = (profile?.holosTokens || 0) >= pack.price;

            return (
              <Pressable key={pack.id} style={[styles.packCard, { borderColor: pack.accent }]}>
                <View style={[styles.packIconFrame, { borderColor: pack.accent }]}>
                  <Text style={[styles.packIconGlyph, { color: pack.accent }]}>{pack.icon}</Text>
                </View>
                <View style={styles.packBody}>
                  <Text style={styles.packTitle}>{pack.name.toUpperCase()}</Text>
                  <Text style={styles.packGuaranteed}>{`${pack.guaranteed} ITEMS GUARANTEED`}</Text>
                  <Text style={styles.packSubtitleLine}>{pack.subtitle}</Text>
                  <Text style={styles.packDescription}>{pack.description}</Text>
                  <View style={styles.packPriceRow}>
                    <HolosMark />
                    <Text style={styles.packPrice}>{pack.price.toLocaleString()}</Text>
                  </View>
                </View>
                <View style={styles.packRight}>
                  <View style={styles.packChevronWrap}>
                    <Text style={[styles.packChevron, { color: pack.accent }]}>›</Text>
                  </View>
                  <Pressable
                    onPress={() => void purchaseBoosterPack(pack.id)}
                    disabled={!canAfford || pendingPurchaseId === pack.id}
                    style={[styles.packBuyButton, (!canAfford || pendingPurchaseId === pack.id) ? styles.useButtonDisabled : null]}
                  >
                    <Text style={[styles.packBuyText, (!canAfford || pendingPurchaseId === pack.id) ? styles.useButtonTextDisabled : null]}>
                      {pendingPurchaseId === pack.id ? "..." : canAfford ? "BUY" : "NEED MORE"}
                    </Text>
                  </Pressable>
                </View>
              </Pressable>
            );
          })}
        </View>
      );
    }

    return null;
  };

  return (
    <View style={styles.page}>
      <HomeCogButton />
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>SHOP</Text>
        <Text style={styles.headerTitle}>Marketplace</Text>
        <Text style={styles.headerMeta}>
          {`Holos ${profile?.holosTokens || 0} • Tickets ${profile?.gachaTickets || 0} • Parts ${parts.length}`}
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
        {renderContent()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  page: {
    backgroundColor: "#f5c40d",
    flex: 1,
  },
  itemActions: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
    marginLeft: 4,
    minHeight: 112,
    width: 96,
  },
  itemBody: {
    flex: 1,
    justifyContent: "center",
    minWidth: 140,
    paddingRight: 8,
  },
  itemCard: {
    backgroundColor: "#07080d",
    borderColor: "#f0bf14",
    borderWidth: 4,
    flexDirection: "row",
    gap: 10,
    minHeight: 146,
    padding: 12,
  },
  itemCopy: {
    color: "#aeb6c3",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  itemDivider: {
    backgroundColor: "#344057",
    height: 4,
    marginTop: 8,
    width: "96%",
  },
  itemIcon: {
    height: 72,
    width: 72,
  },
  itemIconFrame: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#7b6312",
    borderWidth: 1,
    height: 84,
    justifyContent: "center",
    width: 84,
  },
  itemTitle: {
    color: "#fef1e0",
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 18,
  },
  packBody: {
    flex: 1,
    gap: 6,
    justifyContent: "center",
    minWidth: 0,
  },
  packBuyButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 34,
    minWidth: 92,
    paddingHorizontal: 10,
  },
  packBuyText: {
    color: "#050606",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  packCard: {
    backgroundColor: "#07080d",
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 4,
    borderTopWidth: 4,
    flexDirection: "row",
    gap: 16,
    minHeight: 150,
    padding: 18,
  },
  packChevron: {
    fontSize: 32,
    fontWeight: "700",
    lineHeight: 32,
  },
  packChevronWrap: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    width: 28,
  },
  packDescription: {
    color: "#8e98aa",
    fontSize: 12,
    lineHeight: 17,
  },
  packGuaranteed: {
    color: "#c8cfdb",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  packIconFrame: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderWidth: 2,
    height: 88,
    justifyContent: "center",
    marginTop: 2,
    width: 88,
  },
  packIconGlyph: {
    fontSize: 38,
    fontWeight: "900",
    lineHeight: 38,
  },
  packPrice: {
    color: "#f0bf14",
    fontSize: 18,
    fontWeight: "900",
  },
  packPriceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  packRight: {
    alignItems: "flex-end",
    gap: 8,
    justifyContent: "center",
    paddingLeft: 4,
    width: 98,
  },
  packsSection: {
    gap: 16,
  },
  packsSubtitle: {
    color: "#8e98aa",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  packSubtitleLine: {
    color: "#aeb6c3",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  packsTitle: {
    color: "#fef1e0",
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 1,
  },
  packTitle: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 22,
  },
  price: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
  },
  qtyBox: {
    alignItems: "center",
    borderColor: "#00d9ff",
    borderWidth: 2,
    minWidth: 92,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  qtyLabel: {
    color: "#9ca4b0",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 2,
  },
  qtyValue: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "900",
  },
  priceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  scrollContent: {
    gap: 14,
    padding: 20,
    paddingBottom: 40,
  },
  simpleCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    gap: 18,
    padding: 18,
  },
  simpleCardFooter: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
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
  useButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 8,
    minHeight: 34,
    minWidth: 92,
    paddingHorizontal: 10,
  },
  useButtonDisabled: {
    backgroundColor: "#8c7612",
  },
  useButtonText: {
    color: "#050606",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  useButtonTextDisabled: {
    color: "#1c1805",
  },
});

function getMarketplacePrice(itemName: string) {
  const normalized = itemName.trim().toLowerCase();

  if (normalized.includes("energy")) return "200";
  if (normalized.includes("exp")) return "750";
  if (normalized.includes("rank")) return "5000";
  if (normalized.includes("arena")) return "50";
  if (normalized.includes("gacha")) return "100";
  if (normalized.includes("async")) return "125";
  if (normalized.includes("blueprint")) return "300";

  return "100";
}
