import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  ARENA_TIERS,
  getArenaBlueprintAmount,
  getArenaPotentialRewards,
  getTierOpponentLineup,
  type ArenaTier,
} from "@/config/arenaConfig";
import {
  getExpProgress,
  getHolobotFullImageSource,
  mergeHolobotRoster,
  type HolobotRosterEntry,
} from "@/config/holobots";
import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import type { UserHolobot } from "@/types/profile";

type ArenaPrebattleMenuProps = {
  onStartBattle: (options: {
    selectedHolobot: UserHolobot;
    tier: ArenaTier;
    paymentMethod: "tokens" | "pass";
  }) => void;
  onStart3v3: (options: {
    teamNames: [string, string, string];
    tier: ArenaTier;
    paymentMethod: "tokens" | "pass";
  }) => void;
  userArenaPasses: number;
  userHolobots: UserHolobot[];
  userTokens: number;
};

function FlipPreviewCard({
  lineup,
  rewards,
  blueprintAmount,
  selectedHolobot,
}: {
  lineup: string[];
  rewards: ReturnType<typeof getArenaPotentialRewards>;
  blueprintAmount: number;
  selectedHolobot: HolobotRosterEntry;
}) {
  const [showBack, setShowBack] = useState(false);

  return (
    <Pressable onPress={() => setShowBack((value) => !value)} style={styles.previewCard}>
      {!showBack ? (
        <>
          <View style={styles.previewHeader}>
            <Text style={styles.previewEyebrow}>Battle Preview</Text>
            <Text style={styles.previewHint}>Tap to flip</Text>
          </View>
          <View style={styles.previewHeroRow}>
            <Image source={selectedHolobot.imageSource} style={styles.previewHeroArt} resizeMode="contain" />
            <View style={styles.previewHeroMeta}>
              <Text style={styles.previewHeroName}>{selectedHolobot.name}</Text>
              <Text style={styles.previewHeroLevel}>{`Lv ${selectedHolobot.level}`}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${getExpProgress(selectedHolobot) * 100}%` }]} />
              </View>
            </View>
          </View>
          <Text style={styles.roundsTitle}>Tier Gauntlet</Text>
          <View style={styles.lineupRow}>
            {lineup.map((name, index) => (
              <View key={`${name}:${index}`} style={styles.lineupChip}>
                <Image source={getHolobotFullImageSource(name)} style={styles.lineupPortrait} resizeMode="contain" />
                <Text style={styles.lineupRound}>{`R${index + 1}`}</Text>
                <Text style={styles.lineupName}>{name}</Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <>
          <View style={styles.previewHeader}>
            <Text style={styles.previewEyebrow}>Projected Rewards</Text>
            <Text style={styles.previewHint}>Tap to flip back</Text>
          </View>
          <View style={styles.rewardColumn}>
            <Text style={styles.rewardLine}>{`EXP +${rewards.exp}`}</Text>
            <Text style={styles.rewardLine}>{`Sync Points +${rewards.syncPoints}`}</Text>
            <Text style={styles.rewardLine}>{`Holos +${rewards.holos || 0}`}</Text>
            <Text style={styles.rewardLine}>{`Blueprints +${blueprintAmount}`}</Text>
            <Text style={styles.rewardSubcopy}>
              Three consecutive rounds. Win the gauntlet to lock in the full payout.
            </Text>
          </View>
        </>
      )}
    </Pressable>
  );
}

export function ArenaPrebattleMenu({
  onStartBattle,
  onStart3v3,
  userArenaPasses,
  userHolobots,
  userTokens,
}: ArenaPrebattleMenuProps) {
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [selectedTierId, setSelectedTierId] = useState(ARENA_TIERS[0].id);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [mode, setMode] = useState<"1v1" | "3v3">("1v1");
  const [teamNames, setTeamNames] = useState<Array<string | null>>([null, null, null]);
  const roster = useMemo(
    () => mergeHolobotRoster(userHolobots, "full").filter((holobot) => holobot.owned),
    [userHolobots],
  );
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const selectedTier = ARENA_TIERS.find((tier) => tier.id === selectedTierId) ?? ARENA_TIERS[0];

  if (!selectedHolobot) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No Holobots Ready</Text>
        <Text style={styles.emptyCopy}>You need at least one owned Holobot before entering the Arena.</Text>
      </View>
    );
  }

  const selectedProfileHolobot =
    userHolobots.find((holobot) => holobot.name.toUpperCase() === selectedHolobot.name) ??
    userHolobots[0];
  const rewards = getArenaPotentialRewards(selectedTier);
  const blueprintAmount = getArenaBlueprintAmount(selectedTier);
  const cpuLineup = getTierOpponentLineup(selectedTier, selectedHolobot.name);
  const canUseTokens = userTokens >= selectedTier.entryFeeHolos;
  const canUsePass = userArenaPasses > 0;
  const teamComplete = teamNames.every(Boolean) && new Set(teamNames).size === 3;
  const teamReady = mode === "1v1" || teamComplete;
  const canField3v3 = roster.length >= 3;

  const assignTeamSlot = (slotIndex: number) => {
    const name = selectedHolobot.name;
    setTeamNames((current) => {
      const next = current.map((existing) => (existing === name ? null : existing));
      next[slotIndex] = name;
      return next;
    });
  };

  const startPressed = (paymentMethod: "tokens" | "pass") => {
    if (mode === "3v3") {
      if (!teamComplete) return;
      onStart3v3({ teamNames: teamNames as [string, string, string], tier: selectedTier, paymentMethod });
      return;
    }
    if (selectedProfileHolobot) {
      onStartBattle({ selectedHolobot: selectedProfileHolobot, tier: selectedTier, paymentMethod });
    }
  };

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>ARENA</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Holobot</Text>
          <Pressable onPress={() => setIsPickerOpen(true)} style={styles.changeHolobotBar}>
            <Image source={selectedHolobot.imageSource} style={styles.changeHolobotArt} resizeMode="contain" />
            <View style={styles.changeHolobotBody}>
              <Text style={styles.changeHolobotName}>{selectedHolobot.name}</Text>
              <Text style={styles.changeHolobotMeta}>{`Lv ${selectedHolobot.level} • Tap to change`}</Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Mode</Text>
          <View style={styles.modeRow}>
            <Pressable
              onPress={() => setMode("1v1")}
              style={[styles.modeButton, mode === "1v1" && styles.modeButtonActive]}
            >
              <Text style={[styles.modeButtonText, mode === "1v1" && styles.modeButtonTextActive]}>1V1 RUN</Text>
            </Pressable>
            <Pressable
              disabled={!canField3v3}
              onPress={() => setMode("3v3")}
              style={[styles.modeButton, mode === "3v3" && styles.modeButtonActive, !canField3v3 && styles.modeButtonDisabled]}
            >
              <Text style={[styles.modeButtonText, mode === "3v3" && styles.modeButtonTextActive]}>3V3 SHOWDOWN</Text>
            </Pressable>
          </View>
          {mode === "3v3" ? (
            <>
              <Text style={styles.teamHint}>
                Pick a Holobot above, then tap a slot to assign it. Lead fights first.
              </Text>
              <View style={styles.teamRow}>
                {teamNames.map((name, index) => (
                  <Pressable key={index} onPress={() => assignTeamSlot(index)} style={[styles.teamSlot, name ? styles.teamSlotFilled : null]}>
                    <Text style={styles.teamSlotLabel}>{index === 0 ? "LEAD" : `BENCH ${index}`}</Text>
                    <Text style={styles.teamSlotName}>{name ?? "TAP TO SET"}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
          {!canField3v3 ? (
            <Text style={styles.teamHint}>Own at least 3 Holobots to enter 3v3 Showdown.</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Arena Tiers</Text>
          <View style={styles.tierGrid}>
            {ARENA_TIERS.map((tier) => {
              const selected = tier.id === selectedTier.id;
              return (
                <Pressable
                  key={tier.id}
                  onPress={() => setSelectedTierId(tier.id)}
                  style={[styles.tierCard, selected && styles.tierCardSelected]}
                >
                  <Text style={styles.tierName}>{tier.label}</Text>
                  <Text style={styles.tierLevel}>{`Lv ${tier.opponentLevel}`}</Text>
                  <Text style={styles.tierCopy}>{tier.rewardLabel}</Text>
                  <Text style={styles.tierFee}>{`${tier.entryFeeHolos} Holos`}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.actionRow}>
            <Pressable
              disabled={!canUseTokens || !teamReady}
              onPress={() => startPressed("tokens")}
              style={[styles.actionButton, (!canUseTokens || !teamReady) && styles.actionButtonDisabled]}
            >
              <Text style={styles.actionButtonTitle}>Pay Holos</Text>
              <Text style={styles.actionButtonMeta}>{`${selectedTier.entryFeeHolos} Holos`}</Text>
            </Pressable>

            <Pressable
              disabled={!canUsePass || !teamReady}
              onPress={() => startPressed("pass")}
              style={[styles.actionButton, styles.passButton, (!canUsePass || !teamReady) && styles.actionButtonDisabled]}
            >
              <Text style={styles.actionButtonTitle}>Use Arena Pass</Text>
              <Text style={styles.actionButtonMeta}>{`${userArenaPasses} available`}</Text>
            </Pressable>
          </View>
        </View>

        <FlipPreviewCard
          lineup={cpuLineup}
          rewards={rewards}
          blueprintAmount={blueprintAmount}
          selectedHolobot={selectedHolobot}
        />
      </ScrollView>

      <HolobotPickerModal
        visible={isPickerOpen}
        roster={roster}
        selectedIndex={selectedHolobotIndex}
        onClose={() => setIsPickerOpen(false)}
        onSelect={(index) => {
          setSelectedHolobotIndex(index);
          setIsPickerOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    backgroundColor: "#f0bf14",
    flex: 1,
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionButtonDisabled: {
    backgroundColor: "#6b5c1e",
    opacity: 0.55,
  },
  actionButtonMeta: {
    color: "#050606",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
  },
  actionButtonTitle: {
    color: "#050606",
    fontSize: 15,
    fontWeight: "900",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  changeHolobotArt: {
    backgroundColor: "#111111",
    height: 68,
    width: 68,
  },
  changeHolobotBar: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  changeHolobotBody: {
    flex: 1,
  },
  changeHolobotMeta: {
    color: "#ddd2b5",
    fontSize: 12,
    marginTop: 4,
  },
  changeHolobotName: {
    color: "#fef1e0",
    fontSize: 20,
    fontWeight: "900",
  },
  emptyCopy: {
    color: "#ddd2b5",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    textAlign: "center",
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: "#050606",
    flex: 1,
    justifyContent: "center",
    padding: 32,
  },
  emptyTitle: {
    color: "#fef1e0",
    fontSize: 28,
    fontWeight: "900",
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
    paddingBottom: 6,
    paddingHorizontal: 22,
    paddingTop: 72,
  },
  lineupChip: {
    alignItems: "center",
    backgroundColor: "#101010",
    borderColor: "#a68311",
    borderWidth: 1,
    flex: 1,
    minHeight: 100,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  lineupName: {
    color: "#fef1e0",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 4,
    textAlign: "center",
  },
  lineupPortrait: {
    height: 42,
    width: 42,
  },
  lineupRound: {
    color: "#f0bf14",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
  },
  lineupRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  modeButton: {
    borderColor: "#3a3f4b",
    borderWidth: 1.5,
    flex: 1,
    paddingVertical: 10,
  },
  modeButtonActive: {
    backgroundColor: "#f0bf14",
    borderColor: "#f0bf14",
  },
  modeButtonDisabled: {
    opacity: 0.4,
  },
  modeButtonText: {
    color: "#b7bdc9",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textAlign: "center",
  },
  modeButtonTextActive: {
    color: "#07080d",
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  teamHint: {
    color: "#8b93a1",
    fontSize: 12,
    marginTop: 8,
  },
  teamRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  teamSlot: {
    borderColor: "#3a3f4b",
    borderWidth: 1.5,
    flex: 1,
    padding: 10,
  },
  teamSlotFilled: {
    borderColor: "#17d9ff",
  },
  teamSlotLabel: {
    color: "#f0bf14",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  teamSlotName: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  page: {
    backgroundColor: "#f5c40d",
    flex: 1,
  },
  passButton: {
    backgroundColor: "#fef1e0",
  },
  previewCard: {
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    minHeight: 188,
    padding: 12,
  },
  previewEyebrow: {
    color: "#fef1e0",
    fontSize: 16,
    fontWeight: "900",
  },
  previewHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  previewHeroArt: {
    backgroundColor: "#111111",
    height: 82,
    width: 82,
  },
  previewHeroLevel: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  previewHeroMeta: {
    flex: 1,
  },
  previewHeroName: {
    color: "#fef1e0",
    fontSize: 22,
    fontWeight: "900",
  },
  previewHeroRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  previewHint: {
    color: "#9ca3af",
    fontSize: 10,
    fontWeight: "700",
  },
  progressFill: {
    backgroundColor: "#f0bf14",
    height: "100%",
  },
  progressTrack: {
    backgroundColor: "#423f31",
    height: 8,
    marginTop: 10,
    overflow: "hidden",
    width: "100%",
  },
  rewardColumn: {
    gap: 8,
    justifyContent: "center",
    marginTop: 14,
  },
  rewardLine: {
    color: "#fef1e0",
    fontSize: 16,
    fontWeight: "800",
  },
  rewardSubcopy: {
    color: "#ddd2b5",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  roundsTitle: {
    color: "#ddd2b5",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 10,
  },
  scrollContent: {
    gap: 10,
    padding: 14,
    paddingBottom: 14,
    paddingTop: 10,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    color: "#050606",
    fontSize: 16,
    fontWeight: "900",
  },
  tierCard: {
    backgroundColor: "#090909",
    borderColor: "#a68311",
    borderWidth: 2,
    gap: 4,
    minHeight: 122,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: "48%",
  },
  tierCardSelected: {
    borderColor: "#f0bf14",
  },
  tierCopy: {
    color: "#ddd2b5",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  tierFee: {
    color: "#f0bf14",
    fontSize: 13,
    fontWeight: "900",
    marginTop: "auto",
  },
  tierGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  tierLevel: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  tierName: {
    color: "#fef1e0",
    fontSize: 17,
    fontWeight: "900",
  },
});
