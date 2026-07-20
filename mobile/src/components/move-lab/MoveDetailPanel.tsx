import { useEffect, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { SpecializationBranch } from "@/features/arena/moveProgression";
import type { ActionCard, CardType } from "@/types/arena";
import {
  MoveActionFrame,
  MoveCategoryFrame,
  MoveDetailFrame,
  MoveTelemetryFrame,
  MoveTabFrame,
} from "@/components/move-lab/MoveLabFrames";
import { getMoveIcon } from "@/components/move-lab/moveIconRegistry";

const MOVE_ACCENTS: Record<CardType, string> = {
  combo: "#2ce8ef",
  defense: "#3296ff",
  finisher: "#ffc51b",
  strike: "#ff453f",
};

const SLOT_CODES: Record<CardType, string> = {
  combo: "SLOT 03 // CHAIN",
  defense: "SLOT 02 // GUARD",
  finisher: "SLOT 04 // LIMIT",
  strike: "SLOT 01 // IMPACT",
};

type DetailTab = "details" | "upgrade" | "available";

type MoveDetailPanelProps = {
  branchOptions: readonly SpecializationBranch[];
  canUpgrade: boolean;
  currentRank: number;
  equippedBranchName?: string;
  isBusy: boolean;
  move: ActionCard;
  nextRank: number | null;
  onAvailablePress: () => void;
  onTabChange?: (tab: "details" | "upgrade" | "available") => void;
  onPreview: () => void;
  onSelectBranch: (branchId: string) => void;
  onUpgrade: () => void;
  previewRows: string[];
  selectedBranchId: string | null;
  syncPoints: number;
  upgradeCost: number;
};

function RankPips({ accent, rank }: { accent: string; rank: number }) {
  return (
    <View style={styles.pipRow}>
      {[1, 2, 3].map((step) => (
        <View
          key={step}
          style={[styles.pip, rank >= step ? { backgroundColor: accent } : null]}
        />
      ))}
    </View>
  );
}

export function MoveDetailPanel({
  branchOptions,
  canUpgrade,
  currentRank,
  equippedBranchName,
  isBusy,
  move,
  nextRank,
  onAvailablePress,
  onTabChange,
  onPreview,
  onSelectBranch,
  onUpgrade,
  previewRows,
  selectedBranchId,
  syncPoints,
  upgradeCost,
}: MoveDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("details");
  const accent = MOVE_ACCENTS[move.type];

  useEffect(() => {
    setActiveTab("details");
    onTabChange?.("details");
  }, [move.templateId, onTabChange]);

  const selectTab = (tab: DetailTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
    if (tab === "available") {
      onAvailablePress();
    }
  };

  return (
    <View style={[styles.panel, { shadowColor: accent }]}>
      <MoveDetailFrame accent={accent} />
      <View style={styles.categoryBanner}>
        <MoveCategoryFrame accent={accent} />
        <Image
          source={getMoveIcon(move.templateId, move.type)}
          resizeMode="contain"
          style={styles.categoryIcon}
        />
        <View style={[styles.categoryDivider, { backgroundColor: accent }]} />
        <Text style={[styles.category, { color: accent }]}>{move.type.toUpperCase()}</Text>
      </View>

      <View style={styles.topRow}>
        <View style={styles.artColumn}>
          <View style={[styles.artFrame, { borderColor: accent, shadowColor: accent }]}>
            <View style={[styles.artHaloOuter, { borderColor: accent }]} />
            <View style={[styles.artHaloInner, { borderColor: accent }]} />
            <Image
              source={getMoveIcon(move.templateId, move.type)}
              resizeMode="contain"
              style={[styles.art, move.type === "finisher" ? styles.finisherArt : null]}
            />
          </View>
        </View>

        <View style={styles.detailColumn}>
          <View style={styles.titleRow}>
            <View style={styles.titleBody}>
              <Text style={styles.slotCode}>{`COMBAT KIT // ${SLOT_CODES[move.type]}`}</Text>
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                numberOfLines={2}
                style={styles.title}
              >
                {move.name.toUpperCase()}
              </Text>
              <View style={styles.rankLine}>
                <Text style={[styles.rankLabel, { color: accent }]}>
                  {`RANK ${currentRank} / 3`}
                </Text>
                <RankPips accent={accent} rank={currentRank} />
              </View>
            </View>
            <View style={[styles.equippedBadge, { borderColor: accent }]}>
              <View style={[styles.equippedTick, { backgroundColor: accent }]} />
              <Text style={[styles.equippedText, { color: accent }]}>EQUIPPED</Text>
            </View>
          </View>

          <View style={styles.statRow}>
            <MoveTelemetryFrame accent={accent} />
            <View style={[styles.statCell, styles.statCellCompact]}>
              <Text style={styles.statKey}>COST</Text>
              <Text numberOfLines={1} style={styles.statValue}>{move.staminaCost}</Text>
            </View>
            <View style={[styles.statCell, styles.statCellType]}>
              <Text style={styles.statKey}>TYPE</Text>
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.72}
                numberOfLines={1}
                style={styles.statValue}
              >
                {move.type === "defense" ? "TACTICAL" : "PHYSICAL"}
              </Text>
            </View>
            <View style={[styles.statCell, styles.statCellSpeed]}>
              <Text style={styles.statKey}>SPD</Text>
              <Text numberOfLines={1} style={styles.statValue}>
                {move.speedModifier.toFixed(2)}
              </Text>
            </View>
          </View>

          {activeTab === "details" ? (
            <View style={styles.descriptionBlock}>
              <Text style={[styles.descriptionLabel, { color: accent }]}>TACTICAL PROFILE</Text>
              <Text style={styles.description}>{move.description}</Text>
            </View>
          ) : null}

          {activeTab === "upgrade" ? (
            <View style={styles.upgradePreview}>
              {equippedBranchName ? (
                <Text style={[styles.branchTag, { borderColor: accent, color: accent }]}>
                  {equippedBranchName.toUpperCase()}
                </Text>
              ) : null}
              {nextRank === 2 ? (
                <View style={styles.branchRow}>
                  {branchOptions.map((branch) => {
                    const selected = branch.id === selectedBranchId;
                    return (
                      <Pressable
                        key={branch.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        onPress={() => onSelectBranch(branch.id)}
                        style={({ pressed }) => [
                          styles.branchChoice,
                          selected ? { borderColor: accent } : null,
                          pressed ? styles.controlPressed : null,
                        ]}
                      >
                        <Text style={[styles.branchChoiceName, selected ? { color: accent } : null]}>
                          {branch.name.toUpperCase()}
                        </Text>
                        <Text numberOfLines={2} style={styles.branchChoiceDescription}>
                          {branch.description}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {previewRows.map((row) => (
                <Text key={row} style={styles.previewRow}>{row}</Text>
              ))}
              {nextRank === null ? <Text style={styles.maxRank}>MAX RANK</Text> : null}
            </View>
          ) : null}

          {activeTab === "available" ? (
            <Text style={styles.description}>
              Choose an owned move below to replace this combat-kit slot.
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.tabs}>
        {(["details", "upgrade", "available"] as const).map((tab, index) => {
          const selected = activeTab === tab;
          return (
            <Pressable
              key={tab}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => selectTab(tab)}
              style={({ pressed }) => [
                styles.tab,
                selected ? styles.tabActive : null,
                pressed ? styles.controlPressed : null,
              ]}
            >
              <MoveTabFrame
                accent={accent}
                active={selected}
                edge={index === 0 ? "left" : index === 2 ? "right" : "middle"}
              />
              <Text style={[styles.tabText, selected ? styles.tabTextActive : null]}>
                {tab.toUpperCase()}
              </Text>
              {selected ? <View style={[styles.tabIndicator, { backgroundColor: accent }]} /> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canUpgrade }}
          disabled={!canUpgrade}
          onPress={onUpgrade}
          style={({ pressed }) => [
            styles.primaryAction,
            !canUpgrade ? styles.actionDisabled : null,
            pressed ? styles.controlPressed : null,
          ]}
        >
          <MoveActionFrame variant="primary" />
          <Text style={styles.primaryActionTitle}>
            {isBusy ? "UPGRADING…" : nextRank === null ? "MAX RANK" : "UPGRADE"}
          </Text>
          <Text style={styles.primaryActionMeta}>
            {nextRank === null ? "FULLY TUNED" : `${upgradeCost} SP • ${syncPoints} AVAILABLE`}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onPreview}
          style={({ pressed }) => [
            styles.previewAction,
            pressed ? styles.controlPressed : null,
          ]}
        >
          <MoveActionFrame accent={accent} variant="secondary" />
          <Text style={styles.previewActionTitle}>PREVIEW</Text>
          <Text style={styles.previewActionMeta}>MOVE DETAILS</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionDisabled: {
    opacity: 0.42,
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 13,
    paddingTop: 10,
  },
  art: {
    height: "89%",
    width: "89%",
    zIndex: 2,
  },
  artColumn: {
    width: 116,
  },
  artFrame: {
    alignItems: "center",
    aspectRatio: 1,
    backgroundColor: "transparent",
    borderRadius: 58,
    borderWidth: 0,
    justifyContent: "center",
    overflow: "visible",
    shadowOpacity: 0.42,
    shadowRadius: 10,
    shadowOffset: { height: 0, width: 0 },
  },
  artHaloInner: {
    borderRadius: 42,
    borderWidth: 1,
    height: 84,
    opacity: 0.2,
    position: "absolute",
    width: 84,
  },
  artHaloOuter: {
    borderRadius: 54,
    borderWidth: 1,
    height: 108,
    opacity: 0.34,
    position: "absolute",
    width: 108,
  },
  branchChoice: {
    backgroundColor: "#090b0f",
    borderColor: "#343840",
    borderWidth: 1,
    flex: 1,
    minWidth: 96,
    padding: 8,
  },
  branchChoiceDescription: {
    color: "#8e939d",
    fontSize: 9,
    lineHeight: 12,
    marginTop: 3,
  },
  branchChoiceName: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "900",
  },
  branchRow: {
    flexDirection: "row",
    gap: 6,
  },
  branchTag: {
    alignSelf: "flex-start",
    borderWidth: 1,
    fontSize: 9,
    fontWeight: "900",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  category: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  categoryBanner: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "transparent",
    flexDirection: "row",
    gap: 8,
    marginLeft: 12,
    minWidth: 136,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 7,
    position: "relative",
  },
  categoryDivider: {
    height: 20,
    opacity: 0.9,
    width: 2,
  },
  categoryIcon: {
    height: 22,
    width: 22,
  },
  controlPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
  description: {
    color: "#d0d3da",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  descriptionBlock: {
    borderLeftColor: "#353a43",
    borderLeftWidth: 2,
    marginTop: 11,
    paddingLeft: 9,
  },
  descriptionLabel: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.15,
  },
  detailColumn: {
    flex: 1,
    minWidth: 0,
  },
  equippedBadge: {
    alignItems: "center",
    backgroundColor: "#090a0c",
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  equippedTick: {
    height: 5,
    width: 5,
  },
  equippedText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  finisherArt: {
    transform: [{ translateX: 5 }, { translateY: 5 }],
  },
  maxRank: {
    color: "#ffc51b",
    fontSize: 12,
    fontWeight: "900",
  },
  panel: {
    backgroundColor: "transparent",
    paddingHorizontal: 4,
    paddingTop: 8,
    position: "relative",
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  pip: {
    backgroundColor: "#303239",
    height: 8,
    width: 20,
  },
  pipRow: {
    flexDirection: "row",
    gap: 4,
  },
  previewAction: {
    alignItems: "center",
    backgroundColor: "transparent",
    flex: 1,
    justifyContent: "center",
    minHeight: 61,
    overflow: "hidden",
    position: "relative",
  },
  previewActionMeta: {
    color: "#8e939d",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
    zIndex: 1,
  },
  previewActionTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.7,
    zIndex: 1,
  },
  previewRow: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "800",
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: "transparent",
    flex: 1,
    justifyContent: "center",
    minHeight: 61,
    overflow: "hidden",
    position: "relative",
  },
  primaryActionMeta: {
    color: "#302600",
    fontSize: 10,
    fontWeight: "900",
    marginTop: 3,
    zIndex: 1,
  },
  primaryActionTitle: {
    color: "#050606",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.7,
    zIndex: 1,
  },
  rankLabel: {
    fontSize: 11,
    fontWeight: "900",
  },
  rankLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 7,
  },
  slotCode: {
    color: "#7d838f",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.05,
    marginBottom: 4,
  },
  statCell: {
    borderRightColor: "#343840",
    borderRightWidth: 1,
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
    paddingHorizontal: 6,
  },
  statCellCompact: {
    flex: 0.65,
  },
  statCellSpeed: {
    borderRightWidth: 0,
    flex: 0.82,
  },
  statCellType: {
    flex: 1.35,
  },
  statKey: {
    color: "#8e939d",
    fontSize: 9,
    fontWeight: "800",
  },
  statRow: {
    backgroundColor: "transparent",
    flexDirection: "row",
    marginTop: 12,
    paddingVertical: 8,
    position: "relative",
  },
  statValue: {
    color: "#ffffff",
    fontSize: 10.5,
    fontWeight: "900",
    marginTop: 2,
  },
  tab: {
    alignItems: "center",
    backgroundColor: "transparent",
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    overflow: "hidden",
    position: "relative",
  },
  tabActive: {
    backgroundColor: "transparent",
  },
  tabs: {
    backgroundColor: "transparent",
    flexDirection: "row",
    marginHorizontal: 9,
    marginTop: 12,
  },
  tabText: {
    color: "#ffc51b",
    fontSize: 11,
    fontWeight: "900",
    zIndex: 1,
  },
  tabTextActive: {
    color: "#050606",
  },
  tabIndicator: {
    bottom: 3,
    height: 2,
    left: "36%",
    position: "absolute",
    right: "36%",
    zIndex: 1,
  },
  title: {
    color: "#ffffff",
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: 0.8,
    lineHeight: 20,
    textShadowColor: "rgba(255,255,255,0.16)",
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 5,
  },
  titleBody: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  topRow: {
    flexDirection: "row",
    gap: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  upgradePreview: {
    gap: 7,
    marginTop: 10,
  },
});
