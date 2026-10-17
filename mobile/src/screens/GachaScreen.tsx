import { GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";
import { CompactSectionHeader } from "@/components/navigation/GameSectionChrome";
import { theme } from "@/theme";
import { useMemo, useState } from "react";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { HomeCogButton } from "@/components/HomeCogButton";
import { PackOpeningAnimation, type GachaRevealItem } from "@/components/gacha/PackOpeningAnimation";
import { useAuth } from "@/contexts/AuthContext";
import { openGachaPackAuthoritative } from "@/lib/economyClient";
import { GACHA_PACKS } from "@/lib/gacha";

const PACKS = GACHA_PACKS;
const PACK_ICONS = {
  basic: require("../../assets/game/gacha-packs/basic-pack.png"),
  elite: require("../../assets/game/gacha-packs/elite-pack.png"),
  premium: require("../../assets/game/gacha-packs/premium-pack.png"),
} as const;

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

    setIsOpening(true);

    try {
      // Server rolls the loot; the reveal animates whatever it granted.
      const { items } = await openGachaPackAuthoritative(profile, updateProfile, activePack.id);
      setRevealedItems(items);
    } catch (error) {
      setIsOpening(false);
      Alert.alert("Gacha failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  return (
    <View style={styles.page}>
      <HomeCogButton />
      <CompactSectionHeader eyebrow="SUPPLY DROP" title="Holo Packs" meta={`${tickets} GACHA TICKETS`} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {PACKS.map((pack) => {
          const selected = activePack?.id === pack.id;
          return (
            <Pressable
              key={pack.id}
              style={[styles.packCard, selected && styles.packCardSelected]}
              accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${pack.name}, ${pack.price} tickets`}
              onPress={() => setActivePack(pack)}
            >
              <GameSurfaceFrame accent={selected ? theme.colors.cursor : pack.accent} strong={selected} />
              <View style={[styles.packIconFrame, { borderColor: pack.accent }]}>
                <Image
                  source={PACK_ICONS[pack.id]}
                  resizeMode="contain"
                  style={styles.packIcon}
                />
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
        accentColor={activePack?.accent || theme.colors.accent}
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
  openButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    marginTop: 10,
    minHeight: 58,
    justifyContent: "center",
  },
  openButtonDisabled: {
    opacity: 0.45,
  },
  openButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  packBody: {
    flex: 1,
  },
  packCard: {
    backgroundColor: theme.colors.carbon,
    flexDirection: "row",
    gap: 14,
    padding: 16,
  },
  packCardSelected: {
    shadowColor: theme.colors.accent,
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  packCopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    marginTop: 6,
  },
  packIconFrame: {
    alignItems: "center",
    borderWidth: 0,
    height: 82,
    justifyContent: "center",
    width: 82,
  },
  packIcon: {
    height: 82,
    width: 82,
  },
  packPrice: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "900",
    marginTop: 12,
  },
  packTitle: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 24,
    fontWeight: "900",
  },
  page: {
    backgroundColor: theme.colors.carbon,
    flex: 1,
  },
  scrollContent: {
    gap: 14,
    padding: 18,
    paddingBottom: 30,
  },
});
