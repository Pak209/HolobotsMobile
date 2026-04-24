import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { HomeCogButton } from "@/components/HomeCogButton";
import { collection, db, limit, onSnapshot, orderBy, query } from "@/config/firebase";
import { computeLeaderboardScore, mapFirestoreToUserProfile } from "@/lib/profile";
import type { UserProfile } from "@/types/profile";

function getPlayerRankName(profile: UserProfile) {
  const highestLevel = Math.max(0, ...(profile.holobots || []).map((holobot) => holobot.level || 0));
  const wins = profile.stats?.wins || 0;
  const score = highestLevel + wins * 0.35 + (profile.prestigeCount || 0) * 8;

  if (score >= 80) return "Legend";
  if (score >= 55) return "Elite";
  if (score >= 30) return "Champion";
  return "Rookie";
}

export function LeaderboardScreen() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const usersQuery = query(collection(db, "users"), orderBy("leaderboardScore", "desc"), limit(10));

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const nextUsers = snapshot.docs.map((docSnapshot) =>
          mapFirestoreToUserProfile(docSnapshot.id, docSnapshot.data() as Record<string, unknown>),
        );

        setUsers(nextUsers);
        setLoading(false);
        setError(null);
      },
      (nextError) => {
        console.error("[Leaderboard] Failed to load users", nextError);
        setError("Could not load leaderboard data.");
        setLoading(false);
      },
    );

    return unsubscribe;
  }, []);

  const leaderboardRows = useMemo(
    () =>
      users
        .map((profile) => ({
          id: profile.id,
          name: profile.username || "Pilot",
          rank: getPlayerRankName(profile),
          score:
            profile.leaderboardScore ??
            computeLeaderboardScore({
              holobots: profile.holobots,
              prestigeCount: profile.prestigeCount,
              seasonSyncPoints: profile.seasonSyncPoints,
              wins: profile.stats?.wins,
            }),
        }))
        .sort((left, right) => right.score - left.score),
    [users],
  );

  return (
    <View style={styles.page}>
      <HomeCogButton />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>PILOT NETWORK</Text>
        <Text style={styles.title}>Leaderboard</Text>
      </View>

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
              <Text style={styles.position}>{`#${index + 1}`}</Text>
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
