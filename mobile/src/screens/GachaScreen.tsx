import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { HomeCogButton } from "@/components/HomeCogButton";
import { PackOpeningAnimation, type GachaRevealItem } from "@/components/gacha/PackOpeningAnimation";
import { useAuth } from "@/contexts/AuthContext";

type PackType = "basic" | "premium" | "elite";

const PACKS = [
  { accent: "#00d9ff", guaranteed: 3, id: "basic" as PackType, name: "Basic Pack", price: 1 },
  { accent: "#9d4edd", guaranteed: 5, id: "premium" as PackType, name: "Premium Pack", price: 3 },
  { accent: "#ff3366", guaranteed: 10, id: "elite" as PackType, name: "Elite Pack", price: 5 },
] as const;

const ITEM_LABELS = [
  "Plasma Cannon",
  "Combat Mask",
  "Core Part",
  "Energy Refill",
  "Arena Pass",
  "EXP Booster",
  "Blueprint Fragment",
  "Void Mask",
] as const;

function randomFrom<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function buildPackRewards(packId: PackType) {
  const countMap = { basic: 3, premium: 5, elite: 10 };
  const total = countMap[packId];

  return Array.from({ length: total }, (_, index) => {
    const rarityRoll = Math.random();
    const rarity =
      packId === "elite"
        ? rarityRoll > 0.72
          ? "legendary"
          : rarityRoll > 0.42
            ? "epic"
            : "rare"
        : packId === "premium"
          ? rarityRoll > 0.84
            ? "legendary"
            : rarityRoll > 0.54
              ? "epic"
              : rarityRoll > 0.2
                ? "rare"
                : "common"
          : rarityRoll > 0.95
            ? "legendary"
            : rarityRoll > 0.74
              ? "epic"
              : rarityRoll > 0.4
                ? "rare"
                : "common";

    return {
      id: `${packId}-${Date.now()}-${index}`,
      label: randomFrom(ITEM_LABELS),
      rarity,
      subtitle: `Drop ${index + 1} of ${total}`,
    } as GachaRevealItem;
  });
}

export function GachaScreen() {
  const { profile, updateProfile } = useAuth();
  const [activePack, setActivePack] = useState<(typeof PACKS)[number] | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const [revealedItems, setRevealedItems] = useState<GachaRevealItem[]>([]);

  const tickets = profile?.gachaTickets || 0;
  const canOpen = useMemo(() => {
    if (!activePack) return false;
    return tickets >= activePack.price;
  }, [activePack, tickets]);

  const openPack = async () => {
    if (!activePack || !profile) return;
    if (tickets < activePack.price) {
      Alert.alert("Not enough tickets", `You need ${activePack.price - tickets} more Gacha Tickets.`);
      return;
    }

    const rewards = buildPackRewards(activePack.id);
    setRevealedItems(rewards);
    setIsOpening(true);

    try {
      await updateProfile({
        gachaTickets: Math.max(0, tickets - activePack.price),
        pack_history: [
          {
            id: `gacha_${activePack.id}_${Date.now()}`,
            items: rewards.map((reward) => ({ name: reward.label, rarity: reward.rarity })),
            openedAt: new Date().toISOString(),
            packId: activePack.id,
          },
          ...(profile.pack_history || []),
        ].slice(0, 50),
      });
    } catch (error) {
      setIsOpening(false);
      Alert.alert("Gacha failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <View style={styles.page}>
      <HomeCogButton />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>SUPPLY DROP</Text>
        <Text style={styles.title}>Gacha</Text>
        <Text style={styles.meta}>{`Tickets ${tickets}`}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {PACKS.map((pack) => {
          const selected = activePack?.id === pack.id;
          return (
            <Pressable
              key={pack.id}
              style={[styles.packCard, { borderColor: pack.accent }, selected && styles.packCardSelected]}
              onPress={() => setActivePack(pack)}
            >
              <View style={[styles.packIconFrame, { borderColor: pack.accent }]}>
                <Text style={[styles.packIconGlyph, { color: pack.accent }]}>
                  {pack.id === "basic" ? "□" : pack.id === "premium" ? "◈" : "★"}
                </Text>
              </View>
              <View style={styles.packBody}>
                <Text style={styles.packTitle}>{pack.name.toUpperCase()}</Text>
                <Text style={styles.packCopy}>{`${pack.guaranteed} ITEMS GUARANTEED`}</Text>
                <Text style={styles.packPrice}>{`${pack.price} GACHA TICKET${pack.price > 1 ? "S" : ""}`}</Text>
              </View>
            </Pressable>
          );
        })}

        <Pressable
          disabled={!activePack || !canOpen || isOpening}
          onPress={() => void openPack()}
          style={[styles.openButton, (!activePack || !canOpen || isOpening) && styles.openButtonDisabled]}
        >
          <Text style={styles.openButtonText}>
            {!activePack ? "SELECT A PACK" : isOpening ? "OPENING..." : `OPEN ${activePack.name.toUpperCase()}`}
          </Text>
        </Pressable>
      </ScrollView>

      <PackOpeningAnimation
        accentColor={activePack?.accent || "#00d9ff"}
        isOpen={isOpening}
        items={revealedItems}
        onComplete={() => {
          setIsOpening(false);
        }}
        packName={activePack?.name || "Pack"}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  header: {
    backgroundColor: "#050606",
    borderBottomColor: "#f0bf14",
    borderBottomWidth: 3,
    paddingBottom: 18,
    paddingHorizontal: 24,
    paddingTop: 94,
  },
  meta: {
    color: "#ddd2b5",
    fontSize: 14,
    marginTop: 8,
  },
  openButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    marginTop: 10,
    minHeight: 58,
    justifyContent: "center",
  },
  openButtonDisabled: {
    opacity: 0.45,
  },
  openButtonText: {
    color: "#050606",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  packBody: {
    flex: 1,
  },
  packCard: {
    backgroundColor: "#090909",
    borderWidth: 3,
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },
  packCardSelected: {
    shadowColor: "#f0bf14",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  packCopy: {
    color: "#ddd2b5",
    fontSize: 14,
    marginTop: 6,
  },
  packIconFrame: {
    alignItems: "center",
    borderWidth: 2,
    height: 74,
    justifyContent: "center",
    width: 74,
  },
  packIconGlyph: {
    fontSize: 28,
    fontWeight: "900",
  },
  packPrice: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 12,
  },
  packTitle: {
    color: "#fef1e0",
    fontSize: 24,
    fontWeight: "900",
  },
  page: {
    backgroundColor: "#2a2a2a",
    flex: 1,
  },
  scrollContent: {
    gap: 14,
    padding: 18,
    paddingBottom: 30,
  },
  title: {
    color: "#fef1e0",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 6,
  },
});
