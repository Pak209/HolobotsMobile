import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { HomeCogButton } from "@/components/HomeCogButton";
import { CompactSectionHeader } from "@/components/navigation/GameSectionChrome";
import { GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";
import { collection, db, limit, onSnapshot, orderBy, query } from "@/config/firebase";

/** Public projection maintained by the mirrorLeaderboardEntry trigger —
    full /users documents are owner-read-only since the privacy hardening. */
type LeaderboardEntry = {
  id: string;
  username?: string;
  leaderboardScore?: number;
  wins?: number;
  prestigeCount?: number;
  highestHolobotLevel?: number;
};

function getPlayerRankName(entry: LeaderboardEntry) {
  const highestLevel = entry.highestHolobotLevel || 0;
  const wins = entry.wins || 0;
  const score = highestLevel + wins * 0.35 + (entry.prestigeCount || 0) * 8;

  if (score >= 80) return "Legend";
  if (score >= 55) return "Elite";
  if (score >= 30) return "Champion";
  return "Rookie";
}

function getPositionAccent(index: number) {
  if (index === 0) return "#ffc51b";
  if (index === 1) return "#20dff2";
  if (index === 2) return "#b34cff";
  return "#f0bf14";
}

export function LeaderboardScreen() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const leaderboardQuery = query(
      collection(db, "leaderboard"),
      orderBy("leaderboardScore", "desc"),
      limit(10),
    );

    const unsubscribe = onSnapshot(
      leaderboardQuery,
      (snapshot) => {
        setEntries(
          snapshot.docs.map((docSnapshot) => ({
            id: docSnapshot.id,
            ...(docSnapshot.data() as Omit<LeaderboardEntry, "id">),
          })),
        );
        setLoading(false);
        setError(null);
      },
      (nextError) => {
        console.error("[Leaderboard] Failed to load leaderboard", nextError);
        setError("Could not load leaderboard data.");
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  const leaderboardRows = useMemo(
    () =>
      entries
        .map((entry) => ({
          id: entry.id,
          name: entry.username || "Pilot",
          rank: getPlayerRankName(entry),
          score: entry.leaderboardScore ?? 0,
        }))
        .sort((left, right) => right.score - left.score),
    [entries],
  );

  return (
    <View style={styles.page}>
      <HomeCogButton />
      <CompactSectionHeader
        eyebrow="PILOT NETWORK"
        meta="TOP 10 RANKED PILOTS"
        title="Leaderboard"
      />

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color="#f0bf14" size="large" />
          <Text style={styles.helperText}>Loading real pilot data...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {leaderboardRows.map((row, index) => (
            <View key={row.id} style={styles.row}>
              <GameSurfaceFrame accent={getPositionAccent(index)} strong={index < 3} />
              <View style={[styles.positionBadge, { borderColor: getPositionAccent(index) }]}>
                <Text
                  style={[
                    styles.position,
                    styles.positionBadgeText,
                    { color: getPositionAccent(index) },
                  ]}
                >
                  {String(index + 1).padStart(2, "0")}
                </Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.name}>{row.name}</Text>
                <Text style={styles.rank}>{row.rank}</Text>
              </View>
              <Text style={styles.score}>{row.score}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  centerState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  errorText: {
    color: "#fef1e0",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  helperText: {
    color: "#ddd2b5",
    fontSize: 14,
    marginTop: 12,
  },
  name: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  page: {
    backgroundColor: "#f5c40d",
    flex: 1,
  },
  position: {
    fontSize: 14,
    fontWeight: "900",
  },
  positionBadge: {
    alignItems: "center",
    backgroundColor: "#030405",
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    marginRight: 12,
    transform: [{ rotate: "45deg" }],
    width: 38,
  },
  positionBadgeText: {
    transform: [{ rotate: "-45deg" }],
  },
  rank: {
    color: "#ddd2b5",
    fontSize: 13,
    marginTop: 4,
  },
  row: {
    alignItems: "center",
    backgroundColor: "transparent",
    flexDirection: "row",
    minHeight: 72,
    overflow: "hidden",
    paddingHorizontal: 16,
    position: "relative",
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
});
