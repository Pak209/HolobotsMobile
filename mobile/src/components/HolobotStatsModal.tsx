import { hostTierLabel } from "@/components/dashboard/holobotPresentation";
import { HolobotViewer } from "@/components/HolobotViewer";
import { theme } from "@/theme";
import { getAbility } from "@/features/arena/abilities";
import { getSignatureFinisher, SPECIAL_METER_SEGMENTS } from "@/features/arena/moveKits";
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import {
  getExpProgress,
  getHolobotBaseProfile,
  getHolobotRank,
  normalizeUserHolobot,
  type HolobotRosterEntry,
} from "@/config/holobots";
import {
  getDefaultSyncStats,
  getSyncAbilityDefinitions,
  getSyncStatLabel,
  getSyncStatUpgradeCost,
  getTotalSyncInvestment,
  normalizeSyncStats,
  type SyncStatKey,
} from "@/lib/syncProgression";
import type { UserHolobot } from "@/types/profile";
import { ArenaControlFrame } from "@/components/arena/ArenaTierFrames";
import { GameDialogFrame, GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";
import {
  InnateSystemFrame,
  MoveActionFrame,
  MoveRowFrame,
  MoveTelemetryFrame,
} from "@/components/move-lab/MoveLabFrames";

import { BLUEPRINT_TIERS, type UpgradeTierLabel } from "@/lib/minting";

type Props = {
  availableSyncPoints: number;
  blueprintCount: number;
  holobot: HolobotRosterEntry | null;
  ownedHolobot: UserHolobot | null;
  onAssignWildcards?: (amount: number) => void;
  onAscendLegendary?: () => void;
  legendaryBlueprintCount?: number;
  onUseRankSkip?: () => void;
  rankSkipCount?: number;
  onClose: () => void;
  onMint: (tierLabel: UpgradeTierLabel) => void;
  onRankUpgrade: (tierLabel: UpgradeTierLabel) => void;
  onUpgrade: (attribute: "attack" | "defense" | "speed" | "health") => void;
  onUpgradeSync: (stat: SyncStatKey) => void;
  onEquipSyncAbility: (abilityId: string) => void;
  visible: boolean;
  wildcardCount?: number;
};

function getTierColor(label: UpgradeTierLabel) {
  switch (label) {
    case "Common":
      return styles.tierCommon;
    case "Champion":
      return styles.tierChampion;
    case "Rare":
      return styles.tierRare;
    case "Elite":
      return styles.tierElite;
    case "Legendary":
      return styles.tierLegendary;
  }
}

function getTierNumber(label?: string) {
  switch ((label || "").toLowerCase()) {
    case "legendary":
      return 5;
    case "elite":
      return 4;
    case "rare":
      return 3;
    case "champion":
      return 2;
    case "common":
    case "starter":
    case "rookie":
    default:
      return 1;
  }
}

function getTierAccent(label: UpgradeTierLabel) {
  switch (label) {
    case "Common": return theme.colors.blue;
    case "Champion": return theme.colors.success;
    case "Rare": return theme.colors.purple;
    case "Elite": return theme.colors.accent;
    case "Legendary": return theme.colors.orange;
  }
}

function getMintTier(blueprintCount: number) {
  return [...BLUEPRINT_TIERS].reverse().find((tier) => blueprintCount >= tier.required) ?? null;
}

export function HolobotStatsModal({
  availableSyncPoints,
  blueprintCount,
  holobot,
  ownedHolobot,
  onAssignWildcards,
  onAscendLegendary,
  legendaryBlueprintCount = 0,
  onUseRankSkip,
  rankSkipCount = 0,
  onClose,
  onMint,
  onRankUpgrade,
  onUpgrade,
  onUpgradeSync,
  onEquipSyncAbility,
  visible,
  wildcardCount = 0,
}: Props) {
  const [activeTab, setActiveTab] = useState<"stats" | "abilities" | "blueprints">("stats");
  const [innateExpanded, setInnateExpanded] = useState(false);
  const [syncAbilitiesExpanded, setSyncAbilitiesExpanded] = useState(false);
  const [profileFlipped, setProfileFlipped] = useState(false);

  useEffect(() => {
    if (visible) {
      setActiveTab("stats");
      setInnateExpanded(false);
      setSyncAbilitiesExpanded(false);
      setProfileFlipped(false);
    }
  }, [visible]);

  if (!holobot) {
    return null;
  }

  const hostTier = hostTierLabel(ownedHolobot?.rank);
  const normalizedOwnedHolobot = ownedHolobot ? normalizeUserHolobot(ownedHolobot) : null;
  const base = getHolobotBaseProfile(holobot.name);
  const boosts = normalizedOwnedHolobot?.boostedAttributes || {};
  const availablePoints = normalizedOwnedHolobot?.attributePoints || 0;
  const currentRank = normalizedOwnedHolobot?.rank || holobot.rank || getHolobotRank(holobot.level || 1);
  const currentTierNumber = getTierNumber(currentRank);
  const mintTier = getMintTier(blueprintCount);
  const syncStats = normalizeSyncStats(normalizedOwnedHolobot?.syncStats || getDefaultSyncStats());
  const syncAbilities = getSyncAbilityDefinitions(holobot.name);
  const innateAbility = getAbility(holobot.name);
  const signatureFinisher = getSignatureFinisher(holobot.name);
  const unlockedSyncAbilityIds = normalizedOwnedHolobot?.syncAbilityUnlocks || [];
  const equippedSyncAbilityId = normalizedOwnedHolobot?.equippedSyncAbilityId;
  const totalSyncInvestment = getTotalSyncInvestment(syncStats);
  const progress = normalizedOwnedHolobot
    ? getExpProgress(normalizedOwnedHolobot)
    : mintTier
      ? 1
      : Math.min(1, blueprintCount / BLUEPRINT_TIERS[0].required);

  const stats = [
    { baseValue: base.hp, bonus: boosts.health || 0, key: "health" as const, label: "HP", upgrade: "+10 HP" },
    { baseValue: base.attack, bonus: boosts.attack || 0, key: "attack" as const, label: "Attack", upgrade: "+1 ATK" },
    { baseValue: base.defense, bonus: boosts.defense || 0, key: "defense" as const, label: "Defense", upgrade: "+1 DEF" },
    { baseValue: base.speed, bonus: boosts.speed || 0, key: "speed" as const, label: "Speed", upgrade: "+1 SPD" },
  ];
  const syncRows: Array<{ key: SyncStatKey; value: number }> = [
    { key: "power", value: syncStats.power },
    { key: "guard", value: syncStats.guard },
    { key: "tempo", value: syncStats.tempo },
    { key: "focus", value: syncStats.focus },
    { key: "bond", value: syncStats.bond },
  ];
  const career = normalizedOwnedHolobot?.career;
  const careerWorkouts = Math.max(0, Math.floor(career?.workouts || 0));
  const careerSummary =
    careerWorkouts > 0
      ? [
          `${careerWorkouts} workout${careerWorkouts === 1 ? "" : "s"} together`,
          `${((career?.distanceMeters || 0) / 1000).toFixed(1)} km side by side`,
          `${Math.max(1, Math.floor(career?.activeDays || 0))} active day${
            Math.max(1, Math.floor(career?.activeDays || 0)) === 1 ? "" : "s"
          }`,
        ].join(" · ")
      : null;
  const careerSince = career?.firstWorkoutDate ? `Partners since ${career.firstWorkoutDate}` : null;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      {/* The close-on-tap backdrop is a SIBLING behind the card, not a
          wrapper: a Pressable ancestor competes with the ScrollView for
          drag gestures on iOS and the tabs stop scrolling. */}
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close holobot stats"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Pressable
              disabled={activeTab !== "stats" || !careerSummary}
              onPress={() => setProfileFlipped((value) => !value)}
              style={[styles.section, styles.profilePanel]}
            >
              <GameSurfaceFrame accent={theme.colors.accent} strong />
              {profileFlipped && activeTab === "stats" && careerSummary ? (
                <View style={styles.careerFace}>
                  <View style={styles.levelRow}>
                    <Text style={styles.levelText}>CAREER LINK</Text>
                    <Text style={styles.flipHint}>TAP FOR PROFILE ↻</Text>
                  </View>
                  <Text style={styles.careerLead}>{careerSummary}</Text>
                  {careerSince ? <Text style={styles.metaText}>{careerSince}</Text> : null}
                  <View style={styles.careerRail} />
                </View>
              ) : (
                <>
                  <View style={styles.levelRow}>
                    <Text style={styles.levelText}>
                      {normalizedOwnedHolobot ? `LV ${normalizedOwnedHolobot.level || 1}` : "UNMINTED"}
                    </Text>
                    {(!normalizedOwnedHolobot || hostTier) && <View style={[styles.rankBadge, getTierColor((normalizedOwnedHolobot?.rank as UpgradeTierLabel) || "Common")]}>
                      <Text style={styles.rankText}>
                        {normalizedOwnedHolobot ? hostTier : mintTier?.label || "Blueprint"}
                      </Text>
                    </View>}
                  </View>
                  <Text style={styles.nameText}>{holobot.name}</Text>
                  {visible && <HolobotViewer botId={holobot.key} active={visible} style={{ height: 240, width: "100%" }} />}
                  <View style={styles.expRow}>
                    <Text style={styles.mutedLabel}>{normalizedOwnedHolobot ? "XP" : "BLUEPRINTS"}</Text>
                    <Text style={styles.expValue}>
                      {normalizedOwnedHolobot
                        ? `${normalizedOwnedHolobot.experience || 0}/${normalizedOwnedHolobot.nextLevelExp || 100}`
                        : `${blueprintCount}/${mintTier?.required || BLUEPRINT_TIERS[0].required}`}
                    </Text>
                  </View>
                  <View style={styles.expTrack}>
                    <View style={[styles.expFill, { width: `${progress * 100}%` }]} />
                  </View>
                  <View style={styles.profileFooter}>
                    <Text style={styles.metaText}>
                      {normalizedOwnedHolobot
                        ? `${blueprintCount} blueprints available for rank upgrades`
                        : mintTier
                          ? `${mintTier.label} mint unlocked with blueprints`
                          : `Collect ${BLUEPRINT_TIERS[0].required - blueprintCount} more blueprints to mint`}
                    </Text>
                    {activeTab === "stats" && careerSummary ? <Text style={styles.flipHint}>CAREER ↻</Text> : null}
                  </View>
                </>
              )}
            </Pressable>

            <View style={styles.tabRow}>
              <Pressable
                onPress={() => setActiveTab("stats")}
                style={[styles.tabButton, activeTab === "stats" ? styles.tabButtonActive : null]}
              >
                <ArenaControlFrame accent={theme.colors.accent} selected={activeTab === "stats"} />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={[styles.tabButtonText, activeTab === "stats" ? styles.tabButtonTextActive : null]}
                >
                  STATS
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setActiveTab("abilities")}
                style={[styles.tabButton, activeTab === "abilities" ? styles.tabButtonActive : null]}
              >
                <ArenaControlFrame accent={theme.colors.accent} selected={activeTab === "abilities"} />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={[styles.tabButtonText, activeTab === "abilities" ? styles.tabButtonTextActive : null]}
                >
                  ABILITIES
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setActiveTab("blueprints")}
                style={[styles.tabButton, activeTab === "blueprints" ? styles.tabButtonActive : null]}
              >
                <ArenaControlFrame accent={theme.colors.purple} selected={activeTab === "blueprints"} />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                  style={[styles.tabButtonText, activeTab === "blueprints" ? styles.tabButtonTextActive : null]}
                >
                  BLUEPRINTS
                </Text>
              </Pressable>
            </View>

            {activeTab === "stats" ? (
              <>
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>STATS</Text>
                  {stats.map((stat) => (
                    <View key={stat.label} style={styles.statRow}>
                      <MoveRowFrame accent="#8e75ff" />
                      <Text style={styles.statLabel}>{`${stat.label}: ${stat.baseValue}`}</Text>
                      {stat.bonus ? <Text style={styles.statBonus}>{`+${stat.bonus}`}</Text> : null}
                    </View>
                  ))}
                  <Text style={styles.specialText}>{`Special: ${base.specialMove}`}</Text>
                </View>

                {normalizedOwnedHolobot ? (
                  <View style={styles.section}>
                    <View style={styles.boostHeader}>
                      <Text style={styles.sectionTitle}>AVAILABLE BOOSTS</Text>
                      <View style={styles.pointsBadge}>
                        <Text style={styles.pointsText}>{availablePoints}</Text>
                      </View>
                    </View>

                    <View style={styles.boostGrid}>
                      {stats.map((stat) => (
                        <Pressable
                          key={stat.key}
                          disabled={availablePoints <= 0}
                          onPress={() => onUpgrade(stat.key)}
                          style={[styles.boostButton, availablePoints <= 0 ? styles.boostButtonDisabled : null]}
                        >
                          <MoveActionFrame accent={theme.colors.accent} variant="secondary" />
                          <Text style={[styles.boostButtonText, availablePoints <= 0 ? styles.boostButtonTextDisabled : null]}>
                            {stat.upgrade}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle}>AVAILABLE BOOSTS</Text>
                    <Text style={styles.emptyStateText}>
                      Mint this holobot first, then use blueprint rank-ups and level progress to unlock stat boosts.
                    </Text>
                  </View>
                )}
              </>
            ) : activeTab === "abilities" ? (
              normalizedOwnedHolobot ? (
                  <>
                    <View style={styles.section}>
                      <Pressable
                        accessibilityState={{ expanded: innateExpanded }}
                        onPress={() => setInnateExpanded((value) => !value)}
                        style={styles.consoleHeader}
                      >
                        <InnateSystemFrame accent={theme.colors.accent} />
                        <View>
                          <Text style={styles.sectionTitle}>INNATE IDENTITY</Text>
                          <Text style={styles.consoleSummary}>{`${innateAbility.name} • ${signatureFinisher.name}`}</Text>
                        </View>
                        <View style={styles.expandButton}>
                          <Svg height={16} viewBox="0 0 16 16" width={16}>
                            <Path d={innateExpanded ? "M3 10.5 L8 5.5 L13 10.5" : "M3 5.5 L8 10.5 L13 5.5"} fill="none" stroke={theme.colors.accent} strokeWidth={2} />
                          </Svg>
                        </View>
                      </Pressable>
                      {innateExpanded ? (
                        <>
                          <View style={styles.innateRow}>
                            <View style={styles.innateBody}>
                              <Text style={styles.innateName}>{innateAbility.name.toUpperCase()}</Text>
                              <Text style={styles.innateCopy}>{innateAbility.description}</Text>
                            </View>
                            <View style={styles.innateTag}><Text style={styles.innateTagText}>ABILITY</Text></View>
                          </View>
                          <View style={styles.innateRow}>
                            <View style={styles.innateBody}>
                              <Text style={styles.innateName}>{signatureFinisher.name.toUpperCase()}</Text>
                              <Text style={styles.innateCopy}>
                                {`Signature finisher • DMG ${signatureFinisher.baseDamage} • Unlocks at ${SPECIAL_METER_SEGMENTS}/${SPECIAL_METER_SEGMENTS} meter`}
                              </Text>
                            </View>
                            <View style={styles.innateTag}><Text style={styles.innateTagText}>SIGNATURE</Text></View>
                          </View>
                        </>
                      ) : null}
                    </View>

                    <View style={[styles.section, styles.syncConsole]}>
                      <View style={styles.syncConsoleHeader}>
                        <View>
                          <Text style={styles.sectionTitle}>SYNC STATS</Text>
                          <Text style={styles.syncMeta}>{`LEVEL ${normalizedOwnedHolobot.syncLevel || totalSyncInvestment} • ${totalSyncInvestment}/120 INVESTED`}</Text>
                        </View>
                        <View style={styles.pointsBadge}>
                          <Text style={styles.pointsText}>{`${availableSyncPoints} SP`}</Text>
                        </View>
                      </View>
                      <View style={styles.syncStatList}>
                        {syncRows.map((entry) => {
                          const nextCost = getSyncStatUpgradeCost(entry.value);
                          const lockedByCap = entry.value >= 50 || totalSyncInvestment >= 120;
                          const canAfford = availableSyncPoints >= nextCost;
                          const canUpgrade = !lockedByCap && canAfford;

                          return (
                            <View key={entry.key} style={styles.syncStatRow}>
                              <MoveRowFrame accent={theme.colors.purple} />
                              <View style={styles.syncStatCopy}>
                                <Text style={styles.syncStatName}>{getSyncStatLabel(entry.key).toUpperCase()}</Text>
                                <Text style={styles.syncStatValue}>{`LV ${entry.value}  /  NEXT ${nextCost} SP`}</Text>
                              </View>
                              <Pressable
                                disabled={!canUpgrade}
                                onPress={() => onUpgradeSync(entry.key)}
                                style={[styles.syncUpgradeButton, !canUpgrade ? styles.boostButtonDisabled : null]}
                              >
                                <MoveActionFrame accent={theme.colors.purple} variant="equip" />
                                <Text style={[styles.syncUpgradeButtonText, !canUpgrade ? styles.boostButtonTextDisabled : null]}>
                                  {lockedByCap ? "MAX" : "UPGRADE"}
                                </Text>
                              </Pressable>
                            </View>
                          );
                        })}
                      </View>
                    </View>

                    <View style={styles.section}>
                      <Pressable
                        accessibilityState={{ expanded: syncAbilitiesExpanded }}
                        onPress={() => setSyncAbilitiesExpanded((value) => !value)}
                        style={styles.consoleHeader}
                      >
                        <InnateSystemFrame accent={theme.colors.purple} />
                        <View>
                          <Text style={styles.sectionTitle}>SYNC ABILITIES</Text>
                          <Text style={styles.consoleSummary}>
                            {equippedSyncAbilityId
                              ? `${syncAbilities.find((ability) => ability.id === equippedSyncAbilityId)?.name || "Equipped"} installed`
                              : `${unlockedSyncAbilityIds.length}/${syncAbilities.length} unlocked`}
                          </Text>
                        </View>
                        <View style={styles.expandButton}>
                          <Svg height={16} viewBox="0 0 16 16" width={16}>
                            <Path d={syncAbilitiesExpanded ? "M3 10.5 L8 5.5 L13 10.5" : "M3 5.5 L8 10.5 L13 5.5"} fill="none" stroke={theme.colors.purple} strokeWidth={2} />
                          </Svg>
                        </View>
                      </Pressable>
                      {syncAbilitiesExpanded && syncAbilities.length ? (
                        <View style={styles.syncAbilityList}>
                          {syncAbilities.map((ability) => {
                            const unlocked = unlockedSyncAbilityIds.includes(ability.id);
                            return (
                              <View key={ability.id} style={[styles.syncAbilityCard, unlocked ? styles.syncAbilityUnlocked : null]}>
                                <MoveTelemetryFrame accent={equippedSyncAbilityId === ability.id ? theme.colors.accent : unlocked ? theme.colors.success : "#46505d"} />
                                <View style={styles.syncAbilityHeader}>
                                  <Text style={styles.syncAbilityName}>{ability.name}</Text>
                                  <Text style={styles.syncAbilityTier}>{`T${ability.tier}`}</Text>
                                </View>
                                <Text style={styles.syncAbilityRequirement}>
                                  {ability.secondaryStat
                                    ? `${getSyncStatLabel(ability.primaryStat)} ${ability.primaryRequired} • ${getSyncStatLabel(ability.secondaryStat)} ${ability.secondaryRequired}`
                                    : `${getSyncStatLabel(ability.primaryStat)} ${ability.primaryRequired}`}
                                </Text>
                                <Text style={styles.syncAbilityDescription}>{ability.description}</Text>
                                <Pressable
                                  disabled={!unlocked || equippedSyncAbilityId === ability.id}
                                  onPress={() => onEquipSyncAbility(ability.id)}
                                  style={[styles.syncAbilityEquip, !unlocked ? styles.boostButtonDisabled : null]}
                                >
                                  <ArenaControlFrame accent={equippedSyncAbilityId === ability.id ? theme.colors.accent : theme.colors.success} selected={equippedSyncAbilityId === ability.id} />
                                  <Text style={[styles.syncAbilityState, unlocked ? styles.syncAbilityStateUnlocked : null]}>
                                    {equippedSyncAbilityId === ability.id ? "EQUIPPED" : unlocked ? "EQUIP" : "LOCKED"}
                                  </Text>
                                </Pressable>
                              </View>
                            );
                          })}
                        </View>
                      ) : syncAbilitiesExpanded ? (
                        <Text style={styles.emptyStateText}>This holobot does not have Sync Abilities configured yet.</Text>
                      ) : null}
                    </View>
                  </>
              ) : (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>SYNC ABILITIES</Text>
                  <Text style={styles.emptyStateText}>
                    Mint this holobot first to unlock Sync Stats, Sync Abilities, and stat upgrade paths.
                  </Text>
                </View>
              )
            ) : (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {normalizedOwnedHolobot ? "BLUEPRINT RANK UP" : "MINT WITH BLUEPRINTS"}
                </Text>
                <View style={styles.blueprintHeaderRow}>
                  <Text style={styles.blueprintSummary}>{`${holobot.name} blueprints: ${blueprintCount}`}</Text>
                  {onAssignWildcards && wildcardCount > 0 ? (
                    <View style={styles.wildcardChip}>
                      <Text style={styles.wildcardChipLabel}>{`WILD ×${wildcardCount}`}</Text>
                      <Pressable onPress={() => onAssignWildcards(1)} style={styles.wildcardChipButton}>
                        <Text style={styles.wildcardChipButtonText}>+1</Text>
                      </Pressable>
                      <Pressable onPress={() => onAssignWildcards(wildcardCount)} style={styles.wildcardChipButton}>
                        <Text style={styles.wildcardChipButtonText}>ALL</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
                {onAscendLegendary && legendaryBlueprintCount > 0 ? (
                  <View style={[styles.wildcardRow, styles.legendaryRow]}>
                    <View style={styles.wildcardInfo}>
                      <Text style={styles.legendaryTitle}>{`LEGENDARY BLUEPRINT ×${legendaryBlueprintCount}`}</Text>
                      <Text style={styles.wildcardMeta}>
                        {currentTierNumber >= 5
                          ? "Already Legendary — converts to +80 wildcards"
                          : normalizedOwnedHolobot
                            ? "Ascend this Holobot straight to LEGENDARY"
                            : "Mint this Holobot at LEGENDARY rank"}
                      </Text>
                    </View>
                    <Pressable onPress={onAscendLegendary} style={[styles.wildcardButton, styles.legendaryButton]}>
                      <Text style={styles.wildcardButtonText}>ASCEND</Text>
                    </Pressable>
                  </View>
                ) : null}
                {onUseRankSkip && rankSkipCount > 0 && normalizedOwnedHolobot && currentTierNumber < 5 ? (
                  <View style={[styles.wildcardRow, styles.rankSkipRow]}>
                    <View style={styles.wildcardInfo}>
                      <Text style={styles.rankSkipTitle}>{`RANK SKIP ×${rankSkipCount}`}</Text>
                      <Text style={styles.wildcardMeta}>Jump to the next rank — no blueprints needed</Text>
                    </View>
                    <Pressable onPress={onUseRankSkip} style={[styles.wildcardButton, styles.rankSkipButton]}>
                      <Text style={styles.wildcardButtonText}>SKIP</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={styles.tierList}>
                  {BLUEPRINT_TIERS.map((tier) => {
                    const unlocked = blueprintCount >= tier.required;
                    const upgradeBlocked = normalizedOwnedHolobot ? getTierNumber(tier.label) <= currentTierNumber : false;

                    return (
                      <Pressable
                        key={tier.key}
                        disabled={!unlocked || upgradeBlocked}
                        onPress={() => {
                          if (normalizedOwnedHolobot) {
                            onRankUpgrade(tier.label);
                          } else {
                            onMint(tier.label);
                          }
                        }}
                        style={[
                          styles.tierButton,
                          getTierColor(tier.label),
                          (!unlocked || upgradeBlocked) ? styles.tierButtonDisabled : null,
                        ]}
                      >
                        <GameSurfaceFrame accent={getTierAccent(tier.label)} />
                        <View style={styles.tierHeader}>
                          <Text style={styles.tierTitle}>{tier.label}</Text>
                          <Text style={styles.tierMeta}>{`LV ${tier.startLevel}`}</Text>
                        </View>
                        <View style={styles.tierDetailRow}>
                          <Text style={styles.tierCost}>{`${tier.required} blueprints`}</Text>
                          <Text style={styles.tierBonus}>{`+${tier.attributePoints} boosts`}</Text>
                        </View>
                        <Text style={styles.tierAction}>
                          {!unlocked
                            ? `Need ${tier.required - blueprintCount} more`
                            : upgradeBlocked
                              ? "Already unlocked"
                              : normalizedOwnedHolobot
                                ? "Rank Up"
                                : "Mint"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <Text style={styles.closeHint}>TAP OUTSIDE TO CLOSE</Text>
          </ScrollView>
          <View pointerEvents="none" style={[styles.frameMask, styles.frameMaskTop]} />
          <View pointerEvents="none" style={[styles.frameMask, styles.frameMaskBottom]} />
          <View pointerEvents="none" style={[styles.frameMask, styles.frameMaskLeft]} />
          <View pointerEvents="none" style={[styles.frameMask, styles.frameMaskRight]} />
          <GameDialogFrame accent={theme.colors.accent} fill="transparent" />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  blueprintSummary: {
    color: theme.colors.muted,
    flexShrink: 1,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
  },
  blueprintHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
    marginBottom: 12,
  },
  wildcardChip: {
    alignItems: "center",
    backgroundColor: "#141b28",
    borderColor: theme.colors.accent,
    borderRadius: 8,
    borderWidth: 1.5,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  wildcardChipLabel: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  wildcardChipButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    borderRadius: 5,
    justifyContent: "center",
    minWidth: 32,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  wildcardChipButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
  },
  wildcardRow: {
    alignItems: "center",
    backgroundColor: "#141b28",
    borderColor: theme.colors.accent,
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  wildcardInfo: {
    flex: 1,
  },
  wildcardTitle: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  wildcardMeta: {
    color: "#8f9bb0",
    fontFamily: "HoloBody",
    fontSize: 11,
    marginTop: 2,
  },
  wildcardButton: {
    alignItems: "center",
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    justifyContent: "center",
    minWidth: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  wildcardButtonText: {
    color: theme.colors.carbon,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
  },
  legendaryRow: {
    borderColor: "#ff9d00",
  },
  legendaryTitle: {
    color: "#ffb638",
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  legendaryButton: {
    backgroundColor: "#ff9d00",
  },
  rankSkipRow: {
    borderColor: theme.colors.purple,
  },
  rankSkipTitle: {
    color: "#c88bff",
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  rankSkipButton: {
    backgroundColor: theme.colors.purple,
  },
  boostButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: "47%",
    paddingHorizontal: 12,
    position: "relative",
  },
  boostButtonDisabled: {
    borderColor: "#373737",
    opacity: 0.45,
  },
  boostButtonText: {
    color: "#d7dde8",
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "800",
    textAlign: "center",
  },
  boostButtonTextDisabled: {
    color: "#7b7b7b",
  },
  boostGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  boostHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  card: {
    backgroundColor: "transparent",
    flexShrink: 1,
    maxHeight: "88%",
    maxWidth: 410,
    overflow: "hidden",
    position: "relative",
    width: "92%",
  },
  closeHint: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "800",
    letterSpacing: 0.8,
    textAlign: "center",
  },
  emptyStateText: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    lineHeight: 20,
  },
  expFill: {
    backgroundColor: theme.colors.blue,
    borderRadius: 999,
    height: "100%",
  },
  frameMask: {
    backgroundColor: theme.plates.navy,
    position: "absolute",
    zIndex: 8,
  },
  frameMaskBottom: {
    bottom: 0,
    height: 18,
    left: 0,
    right: 0,
  },
  frameMaskLeft: {
    bottom: 16,
    left: 0,
    top: 16,
    width: 16,
  },
  frameMaskRight: {
    bottom: 16,
    right: 0,
    top: 16,
    width: 16,
  },
  frameMaskTop: {
    height: 18,
    left: 0,
    right: 0,
    top: 0,
  },
  expRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  expTrack: {
    backgroundColor: "#394154",
    borderRadius: 999,
    height: 10,
    marginTop: 8,
    overflow: "hidden",
  },
  expValue: {
    color: "#f1efea",
    fontFamily: "HoloDisplay",
    fontSize: 17,
    fontWeight: "700",
  },
  levelRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  levelText: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: 26,
    fontWeight: "900",
  },
  metaText: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    lineHeight: 16,
    marginTop: 8,
  },
  mutedLabel: {
    color: "#f1efea",
    fontFamily: "HoloDisplay",
    fontSize: 20,
    fontWeight: "700",
  },
  innateBody: {
    flex: 1,
    paddingRight: 8,
  },
  innateCopy: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    lineHeight: 17,
    marginTop: 2,
  },
  innateFootnote: {
    color: "#5a616e",
    fontFamily: "HoloBody",
    fontSize: 11,
    marginTop: 8,
  },
  innateName: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  innateRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: 10,
  },
  innateTag: {
    backgroundColor: theme.colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  innateTagText: {
    color: theme.plates.navy,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
  },
  nameText: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.header.fontSize,
    fontWeight: "900",
    marginTop: 8,
  },
  overlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.68)",
    flex: 1,
    justifyContent: "center",
    padding: 18,
  },
  pointsBadge: {
    backgroundColor: "#16345d",
    borderColor: theme.colors.blue,
    borderWidth: 1.5,
    borderRadius: 999,
    minWidth: 42,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  pointsText: {
    color: "#dff7ff",
    fontFamily: "HoloDisplay",
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  rankBadge: {
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rankText: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 15,
    fontWeight: "800",
  },
  scrollContent: {
    gap: 12,
    paddingBottom: 64,
    paddingHorizontal: 22,
    paddingTop: 22,
  },
  section: {
    backgroundColor: "rgba(9, 12, 17, 0.72)",
    borderLeftColor: "#343b48",
    borderLeftWidth: 2,
    padding: 12,
    position: "relative",
  },
  sectionTitle: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 8,
  },
  specialText: {
    borderTopColor: "#3f4659",
    borderTopWidth: 1,
    color: "#42b9ff",
    fontFamily: "HoloDisplay",
    fontSize: 17,
    marginTop: 10,
    paddingTop: 10,
  },
  statBonus: {
    color: "#8e75ff",
    fontFamily: "HoloDisplay",
    fontSize: 17,
    fontWeight: "800",
  },
  statLabel: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 17,
    fontWeight: "700",
  },
  statRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    minHeight: 45,
    paddingHorizontal: 12,
    position: "relative",
  },
  syncAbilityCard: {
    minHeight: 128,
    padding: 14,
    position: "relative",
  },
  syncAbilityDescription: {
    color: "#d7cfb7",
    fontFamily: "HoloBody",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  syncAbilityHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  syncAbilityList: {
    gap: 7,
    marginTop: 10,
  },
  syncAbilityName: {
    color: theme.colors.text,
    flex: 1,
    fontFamily: "HoloBody",
    fontSize: 15,
    fontWeight: "800",
    marginRight: 12,
  },
  syncAbilityRequirement: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    marginTop: 4,
  },
  syncAbilityState: {
    color: "#7f7a68",
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    textAlign: "center",
  },
  syncAbilityStateUnlocked: {
    color: "#66d68d",
  },
  syncAbilityTier: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
  },
  syncAbilityUnlocked: {
  },
  syncAbilityEquip: {
    alignItems: "center",
    alignSelf: "flex-end",
    justifyContent: "center",
    marginTop: 8,
    minHeight: 32,
    minWidth: 92,
    position: "relative",
  },
  syncMeta: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "700",
    letterSpacing: 0.35,
    marginTop: 2,
  },
  syncStatCopy: {
    flex: 1,
    marginRight: 12,
  },
  syncStatList: {
    gap: 2,
    marginTop: 9,
  },
  syncStatName: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "800",
  },
  syncStatRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 54,
    paddingHorizontal: 13,
    position: "relative",
  },
  syncStatAccent: {
    backgroundColor: theme.colors.purple,
    height: 24,
    marginRight: 9,
    width: 3,
  },
  syncStatValue: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    marginTop: 2,
  },
  syncUpgradeButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    justifyContent: "center",
    minWidth: 76,
    paddingHorizontal: 8,
    paddingVertical: 8,
    position: "relative",
  },
  syncUpgradeButtonText: {
    color: "#dceeff",
    fontFamily: "HoloBody",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  tabButton: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 6,
    position: "relative",
  },
  tabButtonActive: {
    backgroundColor: "transparent",
  },
  tabButtonText: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  tabButtonTextActive: {
    color: theme.colors.text,
  },
  tabRow: {
    flexDirection: "row",
    gap: 7,
  },
  consoleHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    overflow: "hidden",
    paddingHorizontal: 12,
    position: "relative",
  },
  consoleSummary: {
    color: "#8f98aa",
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    marginTop: 1,
  },
  expandButton: {
    alignItems: "center",
    backgroundColor: "#10151d",
    borderColor: "#343d4b",
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 34,
    zIndex: 1,
  },
  careerFace: {
    minHeight: 126,
  },
  careerLead: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "800",
    lineHeight: 20,
    marginTop: 12,
  },
  careerRail: {
    backgroundColor: theme.colors.accent,
    height: 3,
    marginTop: 15,
    width: "58%",
  },
  flipHint: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  profileFooter: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  profilePanel: {
    minHeight: 148,
    overflow: "hidden",
  },
  syncConsole: {
    borderLeftColor: theme.colors.purple,
  },
  syncConsoleHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tierAction: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "800",
    marginTop: 4,
    textTransform: "uppercase",
  },
  tierBonus: {
    color: "#fff7da",
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "700",
    marginTop: 2,
  },
  tierButton: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 9,
  },
  tierButtonDisabled: {
    opacity: 0.38,
  },
  tierChampion: {
    backgroundColor: "#1d4d2c",
    borderColor: "#3bb563",
  },
  tierCommon: {
    backgroundColor: "#173a68",
    borderColor: "#4ea0ff",
  },
  tierCost: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "700",
  },
  tierDetailRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
  },
  tierElite: {
    backgroundColor: "#5f4b08",
    borderColor: theme.colors.accent,
  },
  tierHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  tierLegendary: {
    backgroundColor: "#7a3d08",
    borderColor: "#ff9b39",
  },
  tierList: {
    gap: 10,
  },
  tierMeta: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "800",
  },
  tierRare: {
    backgroundColor: "#4b266c",
    borderColor: "#ab67ff",
  },
  tierTitle: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
  },
});
