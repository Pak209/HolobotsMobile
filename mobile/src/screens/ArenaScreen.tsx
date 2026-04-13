import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { HomeCogButton } from "@/components/HomeCogButton";
import { mergeHolobotRoster } from "@/config/holobots";
import { useAuth } from "@/contexts/AuthContext";

const featuredOpponents = [
  { difficulty: "Tier 1", name: "Neon Scrapper", reward: "10 Arena Tokens" },
  { difficulty: "Tier 2", name: "Volt Specter", reward: "20 Arena Tokens" },
  { difficulty: "Tier 3", name: "Iron Regent", reward: "35 Arena Tokens" },
];

export function ArenaScreen() {
  const { profile } = useAuth();
  const featuredHolobot = mergeHolobotRoster(profile?.holobots).find((holobot) => holobot.owned) || mergeHolobotRoster(profile?.holobots)[0];

  return (
    <View style={styles.page}>
      <HomeCogButton />
      <View style={styles.header}>
        <Text style={styles.headerEyebrow}>BATTLE</Text>
        <Text style={styles.headerTitle}>Arena V2</Text>
        <Text style={styles.headerCopy}>
          Native arena support is now staged here so iOS and Android can share one mobile-first battle entry.
        </Text>
        <Text style={styles.headerMeta}>
          {`Passes ${profile?.arena_passes || 0} • Sync ${profile?.syncPoints || 0} • W ${profile?.stats?.wins || 0} / L ${profile?.stats?.losses || 0}`}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Image source={{ uri: featuredHolobot.imageUrl }} style={styles.heroImage} resizeMode="contain" />
          <View style={styles.heroBody}>
            <Text style={styles.heroTitle}>{featuredHolobot.name}</Text>
            <Text style={styles.heroMeta}>{`Selected pilot unit • Level ${featuredHolobot.level}`}</Text>
            <Text style={styles.heroCopy}>
              Enter ranked fights, spend Arena Passes, and track your streak rewards from here.
            </Text>
          </View>
        </View>

        {featuredOpponents.map((opponent) => (
          <View key={opponent.name} style={styles.opponentCard}>
            <View>
              <Text style={styles.opponentTier}>{opponent.difficulty}</Text>
              <Text style={styles.opponentName}>{opponent.name}</Text>
              <Text style={styles.opponentReward}>{opponent.reward}</Text>
            </View>
            <Pressable style={styles.enterButton}>
              <Text style={styles.enterButtonText}>ENTER</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  enterButton: {
    backgroundColor: "#f0bf14",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  enterButtonText: {
    color: "#050606",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  header: {
    backgroundColor: "#050606",
    borderBottomColor: "#f0bf14",
    borderBottomWidth: 3,
    paddingBottom: 18,
    paddingHorizontal: 24,
    paddingTop: 94,
  },
  headerCopy: {
    color: "#ddd2b5",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
  },
  headerEyebrow: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  headerMeta: {
    color: "#ddd2b5",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  headerTitle: {
    color: "#fef1e0",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 6,
  },
  heroBody: {
    flex: 1,
  },
  heroCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 14,
    padding: 14,
  },
  heroCopy: {
    color: "#ddd2b5",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
  },
  heroImage: {
    backgroundColor: "#1a1a1a",
    height: 124,
    width: 124,
  },
  heroMeta: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  heroTitle: {
    color: "#fef1e0",
    fontSize: 24,
    fontWeight: "900",
  },
  opponentCard: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 18,
  },
  opponentName: {
    color: "#fef1e0",
    fontSize: 20,
    fontWeight: "800",
    marginTop: 4,
  },
  opponentReward: {
    color: "#ddd2b5",
    fontSize: 13,
    marginTop: 6,
  },
  opponentTier: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
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
});
