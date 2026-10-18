import { slotAccent, theme } from "@/theme";
import { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hostKnockedOut, type HostVitals } from "@/lib/arenaVitals";

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
import { ArenaTierCard } from "@/components/arena/ArenaTierCard";
import { ArenaControlFrame } from "@/components/arena/ArenaTierFrames";
import { GameSectionLabel, GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";
import type { UserHolobot } from "@/types/profile";

type ArenaPrebattleMenuProps = {
  onStartBattle: (options: {
    selectedHolobot: UserHolobot;
    tier: ArenaTier;
    paymentMethod: "tokens" | "pass";
  }) => void;
  onStart3v3?: (options: {
    teamNames: [string, string, string];
    tier: ArenaTier;
    paymentMethod: "tokens" | "pass";
  }) => void;
  /** When set, 3v3 is shown disabled with this honest line instead of starting (no host admits a team yet). */
  unavailable3v3Copy?: string;
  /** F2 KO guard: the City's HP ledger. A fighter it records at 0 HP cannot start (the City would refuse holobot_ko). */
  hostVitals?: HostVitals | null;
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
      <GameSurfaceFrame strong />
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
  unavailable3v3Copy,
  hostVitals,
  userArenaPasses,
  userHolobots,
  userTokens,
}: ArenaPrebattleMenuProps) {
  const insets = useSafeAreaInsets();
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [selectedTierId, setSelectedTierId] = useState(ARENA_TIERS[0].id);
  // What the picker modal is choosing for: the 1v1 fighter, or a team slot.
  const [pickerTarget, setPickerTarget] = useState<"main" | 0 | 1 | 2 | null>(null);
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
  // In 3v3 the LEAD slot drives the preview; the top bar is hidden there.
  const previewHolobot =
    mode === "3v3" && teamNames[0]
      ? roster.find((holobot) => holobot.name === teamNames[0]) ?? selectedHolobot
      : selectedHolobot;
  const cpuLineup = getTierOpponentLineup(selectedTier, previewHolobot.name);
  const canUseTokens = userTokens >= selectedTier.entryFeeHolos;
  const canUsePass = userArenaPasses > 0;
  const teamComplete = teamNames.every(Boolean) && new Set(teamNames).size === 3;
  // PLACEHOLDER copy. Mirrors the City's holobot_ko rule to spare a refused entry: it disables PAY / USE PASS for a
  // fighter the ledger records at 0 HP. The City still decides admission; an unknown ledger never blocks.
  const selectedKo = mode === "1v1" && hostKnockedOut(hostVitals, selectedHolobot.name.toLowerCase());
  const teamReady = (mode === "1v1" && !selectedKo) || (mode === "3v3" && teamComplete);
  const canField3v3 = roster.length >= 3;
  const threeVThreeOpen = !!onStart3v3 && !unavailable3v3Copy;

  const rosterFor = (name: string | null) =>
    name ? roster.find((holobot) => holobot.name === name) ?? null : null;

  const assignTeamSlot = (slotIndex: number, name: string) => {
    setTeamNames((current) => {
      const next = current.map((existing) => (existing === name ? null : existing));
      next[slotIndex] = name;
      return next;
    });
  };

  const handlePickerSelect = (index: number) => {
    const picked = roster[index];
    if (!picked) {
      setPickerTarget(null);
      return;
    }
    if (pickerTarget === "main") {
      setSelectedHolobotIndex(index);
    } else if (pickerTarget !== null) {
      assignTeamSlot(pickerTarget, picked.name);
    }
    setPickerTarget(null);
  };

  const startPressed = (paymentMethod: "tokens" | "pass") => {
    if (mode === "3v3") {
      if (!teamComplete || !onStart3v3 || !threeVThreeOpen) return;
      onStart3v3({ teamNames: teamNames as [string, string, string], tier: selectedTier, paymentMethod });
      return;
    }
    if (selectedProfileHolobot) {
      onStartBattle({ selectedHolobot: selectedProfileHolobot, tier: selectedTier, paymentMethod });
    }
  };

  return (
    <View style={styles.page}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Text style={styles.eyebrow}>ARENA</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {mode === "1v1" ? (
          <View style={styles.section}>
            <GameSectionLabel label="Holobot" />
            <Pressable onPress={() => setPickerTarget("main")} style={styles.changeHolobotBar}>
              <GameSurfaceFrame strong />
              <Image source={selectedHolobot.imageSource} style={styles.changeHolobotArt} resizeMode="contain" />
              <View style={styles.changeHolobotBody}>
                <Text style={styles.changeHolobotName}>{selectedHolobot.name}</Text>
                <Text style={[styles.changeHolobotMeta, selectedKo && styles.koMeta]}>{selectedKo ? "KO · heal it before entering · Tap to change" : `Lv ${selectedHolobot.level} • Tap to change`}</Text>
              </View>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.section}>
          <GameSectionLabel label="Mode" />
          <View style={styles.modeRow}>
            <Pressable
              onPress={() => setMode("1v1")}
              style={[styles.modeButton, mode === "1v1" && styles.modeButtonActive]}
            >
              <ArenaControlFrame accent={theme.colors.accent} selected={mode === "1v1"} />
              <Text style={[styles.modeButtonText, mode === "1v1" && styles.modeButtonTextActive]}>1V1 RUN</Text>
            </Pressable>
            <Pressable
              disabled={!canField3v3 || !threeVThreeOpen}
              accessibilityState={{ disabled: !canField3v3 || !threeVThreeOpen }}
              onPress={() => setMode("3v3")}
              style={[styles.modeButton, mode === "3v3" && styles.modeButtonActive, (!canField3v3 || !threeVThreeOpen) && styles.modeButtonDisabled]}
            >
              <ArenaControlFrame accent={theme.colors.accent} selected={mode === "3v3"} />
              <Text style={[styles.modeButtonText, mode === "3v3" && styles.modeButtonTextActive]}>3V3 SHOWDOWN</Text>
            </Pressable>
          </View>
          {mode === "3v3" ? (
            <View style={styles.teamRow}>
              {teamNames.map((name, index) => {
                const entry = rosterFor(name);
                return (
                  <Pressable
                    key={index}
                    onPress={() => setPickerTarget(index as 0 | 1 | 2)}
                    style={[styles.teamSlot, name ? styles.teamSlotFilled : null]}
                  >
                    <GameSurfaceFrame accent={name ? slotAccent(false, index) : theme.colors.border} />
                    <Text style={[styles.teamSlotLabel, { color: slotAccent(false, index) }]}>{index === 0 ? "LEAD" : `BENCH ${index}`}</Text>
                    {entry ? (
                      <>
                        <Image source={entry.imageSource} style={styles.teamSlotArt} resizeMode="contain" />
                        <Text numberOfLines={1} style={styles.teamSlotName}>{entry.name}</Text>
                        <Text style={styles.teamSlotMeta}>{`Lv ${entry.level}`}</Text>
                      </>
                    ) : (
                      <View style={styles.teamSlotEmpty}>
                        <Text style={styles.teamSlotPlus}>＋</Text>
                        <Text style={styles.teamSlotName}>TAP TO PICK</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {unavailable3v3Copy ? (
            <Text style={styles.teamHint}>{unavailable3v3Copy}</Text>
          ) : !canField3v3 ? (
            <Text style={styles.teamHint}>Own at least 3 Holobots to enter 3v3 Showdown.</Text>
          ) : null}
        </View>

        <View style={styles.section}>
          <GameSectionLabel label="Arena Tiers" />
          <View style={styles.tierGrid}>
            {ARENA_TIERS.map((tier) => {
              const selected = tier.id === selectedTier.id;
              return (
                <ArenaTierCard
                  compact
                  entryFeeHolos={tier.entryFeeHolos}
                  key={tier.id}
                  label={tier.label}
                  level={tier.opponentLevel}
                  onPress={() => setSelectedTierId(tier.id)}
                  selected={selected}
                  tier={tier.id}
                />
              );
            })}
          </View>

          <View style={styles.paymentRow}>
            <Pressable
              disabled={!canUseTokens || !teamReady}
              onPress={() => startPressed("tokens")}
              style={[styles.actionButton, (!canUseTokens || !teamReady) && styles.actionButtonDisabled]}
            >
              <ArenaControlFrame accent={theme.colors.accent} selected={canUseTokens && teamReady} />
              <View style={[styles.paymentMark, styles.paymentMarkHolos]}>
                <Text style={styles.paymentMarkText}>H</Text>
              </View>
              <View style={styles.actionButtonCopy}>
                <Text style={styles.actionButtonTitle}>PAY HOLOS</Text>
                <Text style={styles.actionButtonMeta}>{`${selectedTier.entryFeeHolos} HOLOS`}</Text>
              </View>
            </Pressable>

            <Pressable
              disabled={!canUsePass || !teamReady}
              onPress={() => startPressed("pass")}
              style={[styles.actionButton, (!canUsePass || !teamReady) && styles.actionButtonDisabled]}
            >
              <ArenaControlFrame accent={theme.colors.accent} selected={canUsePass && teamReady} />
              <View style={[styles.paymentMark, styles.paymentMarkPass]}>
                <Text style={styles.paymentMarkText}>P</Text>
              </View>
              <View style={styles.actionButtonCopy}>
                <Text style={styles.actionButtonTitle}>USE ARENA PASS</Text>
                <Text style={styles.actionButtonMeta}>{`${userArenaPasses} AVAILABLE`}</Text>
              </View>
            </Pressable>
          </View>
        </View>

        <FlipPreviewCard
          lineup={cpuLineup}
          rewards={rewards}
          blueprintAmount={blueprintAmount}
          selectedHolobot={previewHolobot}
        />
      </ScrollView>

      <HolobotPickerModal
        visible={pickerTarget !== null}
        roster={roster}
        selectedIndex={
          pickerTarget === "main" || pickerTarget === null
            ? selectedHolobotIndex
            : roster.findIndex((holobot) => holobot.name === teamNames[pickerTarget])
        }
        onClose={() => setPickerTarget(null)}
        onSelect={handlePickerSelect}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    flex: 1,
    flexDirection: "row",
    gap: 9,
    justifyContent: "center",
    minHeight: 54,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: "relative",
  },
  actionButtonDisabled: {
    opacity: 0.46,
  },
  actionButtonCopy: {
    flex: 1,
    minWidth: 0,
  },
  actionButtonMeta: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 8,
    fontWeight: "800",
    marginTop: 2,
    zIndex: 1,
  },
  actionButtonTitle: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
    zIndex: 1,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  changeHolobotArt: {
    backgroundColor: theme.colors.carbon,
    height: 68,
    width: 68,
  },
  changeHolobotBar: {
    alignItems: "center",
    backgroundColor: "transparent",
    flexDirection: "row",
    gap: 12,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 10,
    position: "relative",
  },
  changeHolobotBody: {
    flex: 1,
  },
  changeHolobotMeta: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    marginTop: 4,
  },
  changeHolobotName: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 20,
    fontWeight: "900",
  },
  emptyCopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
    textAlign: "center",
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    flex: 1,
    justifyContent: "center",
    padding: 32,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 28,
    fontWeight: "900",
  },
  eyebrow: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  header: {
    backgroundColor: theme.colors.carbon,
    borderBottomColor: theme.colors.accent,
    borderBottomWidth: 1,
    paddingBottom: 6,
    paddingHorizontal: 22,
  },
  koMeta: {
    color: theme.colors.danger,
  },
  lineupChip: {
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.border,
    borderWidth: 1,
    flex: 1,
    minHeight: 86,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  lineupName: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
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
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "800",
    marginTop: 4,
  },
  lineupRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  modeButton: {
    backgroundColor: "transparent",
    flex: 1,
    minHeight: 44,
    overflow: "hidden",
    paddingVertical: 10,
    position: "relative",
  },
  modeButtonActive: {
    backgroundColor: "transparent",
  },
  modeButtonDisabled: {
    opacity: 0.4,
  },
  modeButtonText: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
    textAlign: "center",
    zIndex: 1,
  },
  modeButtonTextActive: {
    color: theme.colors.accent,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  teamHint: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    marginTop: 8,
  },
  teamRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  teamSlot: {
    alignItems: "center",
    backgroundColor: "transparent",
    flex: 1,
    minHeight: 108,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 8,
    position: "relative",
  },
  teamSlotArt: {
    height: 48,
    marginTop: 4,
    width: 48,
  },
  teamSlotEmpty: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  teamSlotFilled: {
    borderColor: theme.colors.accent,
  },
  teamSlotLabel: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
  },
  teamSlotMeta: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "700",
    marginTop: 2,
  },
  teamSlotName: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 4,
    textAlign: "center",
  },
  teamSlotPlus: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.header.fontSize,
    fontWeight: "900",
  },
  page: {
    backgroundColor: theme.colors.carbon,
    flex: 1,
  },
  passButton: {
    backgroundColor: "transparent",
  },
  paymentMark: {
    alignItems: "center",
    borderWidth: 2,
    height: 31,
    justifyContent: "center",
    transform: [{ rotate: "45deg" }],
    width: 31,
    zIndex: 1,
  },
  paymentMarkHolos: {
    borderColor: theme.colors.accent,
  },
  paymentMarkPass: {
    borderColor: theme.colors.accent,
  },
  paymentMarkText: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
    transform: [{ rotate: "-45deg" }],
  },
  paymentRow: {
    flexDirection: "row",
    gap: 8,
  },
  previewCard: {
    backgroundColor: "transparent",
    minHeight: 168,
    overflow: "hidden",
    padding: 12,
    position: "relative",
  },
  previewEyebrow: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "900",
  },
  previewHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  previewHeroArt: {
    backgroundColor: theme.colors.carbon,
    height: 64,
    width: 64,
  },
  previewHeroLevel: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  previewHeroMeta: {
    flex: 1,
  },
  previewHeroName: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.header.fontSize,
    fontWeight: "900",
  },
  previewHeroRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 10,
  },
  previewHint: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "700",
  },
  progressFill: {
    backgroundColor: theme.colors.accent,
    height: "100%",
  },
  progressTrack: {
    backgroundColor: theme.colors.graphite,
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
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "800",
  },
  rewardSubcopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    lineHeight: 17,
    marginTop: 6,
  },
  roundsTitle: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
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
    color: theme.colors.carbon,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "900",
  },
  tierCard: {
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.border,
    borderWidth: 2,
    gap: 4,
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: "48%",
  },
  tierCardSelected: {
    borderColor: theme.colors.accent,
  },
  tierFee: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
  },
  tierMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  tierGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    justifyContent: "space-between",
  },
  tierLevel: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "800",
  },
  tierName: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 15,
    fontWeight: "900",
  },
});
