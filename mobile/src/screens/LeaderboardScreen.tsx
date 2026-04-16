import { ScrollView, StyleSheet, Text, View } from "react-native";

import { HomeCogButton } from "@/components/HomeCogButton";
import { useAuth } from "@/contexts/AuthContext";

function getPlayerRankName(wins: number, highestLevel: number) {
  const score = wins * 2 + highestLevel;
  if (score >= 120) return "Legend";
  if (score >= 80) return "Elite";
  if (score >= 40) return "Champion";
  return "Rookie";
}

export function LeaderboardScreen() {
  const { profile } = useAuth();
  const highestLevel = Math.max(1, ...(profile?.holobots || []).map((holobot) => holobot.level || 1));
  const wins = profile?.stats?.wins || 0;
  const rankName = getPlayerRankName(wins, highestLevel);

  const leaderboardRows = [
    { name: profile?.username || "You", rank: rankName, score: wins * 100 + highestLevel * 10 },
    { name: "Pilot Nova", rank: "Legend", score: 8840 },
    { name: "ToraCore", rank: "Elite", score: 7710 },
    { name: "KumaByte", rank: "Champion", score: 6420 },
    { name: "SyncShade", rank: "Champion", score: 5930 },
  ].sort((a, b) => b.score - a.score);

  return (
    <View style={styles.page}>
      <HomeCogButton />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PILOT NETWORK</Text>
        <Text style={styles.title}>Leaderboard</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {leaderboardRows.map((row, index) => (
          <View key={`${row.name}:${index}`} style={styles.row}>
            <Text style={styles.position}>{`#${index + 1}`}</Text>
            <View style={styles.rowBody}>
              <Text style={styles.name}>{row.name}</Text>
              <Text style={styles.rank}>{row.rank}</Text>
            </View>
            <Text style={styles.score}>{row.score}</Text>
          </View>
        ))}
      </ScrollView>
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
  name: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  page: {
    backgroundColor: "#2a2a2a",
    flex: 1,
  },
  position: {
    color: "#f0bf14",
    fontSize: 18,
    fontWeight: "900",
    width: 44,
  },
  rank: {
    color: "#ddd2b5",
    fontSize: 13,
    marginTop: 4,
  },
  row: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    minHeight: 72,
    paddingHorizontal: 16,
  },
  rowBody: {
    flex: 1,
  },
  score: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  scrollContent: {
    gap: 12,
    padding: 18,
    paddingBottom: 28,
  },
  title: {
    color: "#fef1e0",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 6,
  },
});
