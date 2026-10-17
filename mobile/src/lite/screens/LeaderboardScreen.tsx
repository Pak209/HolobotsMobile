import { theme } from "@/lite/theme";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { HomeCogButton } from "@/lite/components/HomeCogButton";
import { CompactSectionHeader } from "@/lite/components/navigation/GameSectionChrome";
import { GameSurfaceFrame } from "@/lite/components/ui/GameSurfaceFrame";
import { collection, db, limit, onSnapshot, orderBy, query } from "@/config/firebase";

/** Public projection maintained by the mirrorLeaderboardEntry trigger —
    full /users documents are owner-read-only since the privacy hardening. */
export type LeaderboardEntry = {
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
  if (index === 0) return theme.colors.warning;
  if (index === 1) return theme.colors.accent;
  if (index === 2) return theme.colors.purple;
  return theme.colors.accent;
}

export function LeaderboardScreen({ previewEntries }: { previewEntries?: LeaderboardEntry[] } = {}) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (previewEntries) { setEntries(previewEntries); setLoading(false); return; }
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
  }, [previewEntries]);

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
          <ActivityIndicator color={theme.colors.accent} size="large" />
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
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "700",
    textAlign: "center",
  },
  helperText: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    marginTop: 12,
  },
  name: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
  },
  page: {
    backgroundColor: theme.colors.carbon,
    flex: 1,
  },
  position: {
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "900",
  },
  positionBadge: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
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
    color: theme.colors.muted,
    fontFamily: "HoloBody",
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
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
  },
  scrollContent: {
    gap: 12,
    padding: 18,
    paddingBottom: 28,
  },
});
