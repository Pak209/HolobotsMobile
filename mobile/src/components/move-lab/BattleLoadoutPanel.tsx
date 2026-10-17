import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import {
  BattleLoadoutFrame,
  EquippedMoveFrame,
  InnateSystemFrame,
} from "@/components/move-lab/MoveLabFrames";
import { getMoveIcon } from "@/components/move-lab/moveIconRegistry";
import type { ActionCard, CardType } from "@/types/arena";

const ACCENTS: Record<CardType, string> = {
  combo: "#25e5ec",
  defense: "#3296ff",
  finisher: "#ffc51b",
  strike: "#ff403b",
};

const CLASS_LABELS: Record<CardType, string> = {
  combo: "COMBO",
  defense: "DEFEND",
  finisher: "FINISHER",
  strike: "STRIKE",
};

const RANK_ROMAN = ["0", "I", "II", "III"] as const;

type BattleLoadoutPanelProps = {
  abilityDescription: string;
  abilityName: string;
  moves: ActionCard[];
  onSelectMove: (index: number) => void;
  rankOf: (templateId: string) => number;
  selectedIndex: number;
  signatureDamage: number;
  signatureName: string;
  syncAbilityDescription?: string;
  syncAbilityName?: string;
};

function InnateRow({
  description,
  icon,
  label,
  name,
  badge = "INNATE",
}: {
  description: string;
  icon: ReturnType<typeof getMoveIcon>;
  label: string;
  name: string;
  badge?: string;
}) {
  return (
    <View style={styles.innateRow}>
      <InnateSystemFrame accent="#20e7ee" />
      <View style={styles.innateIconFrame}>
        <View style={styles.innateIconRing} />
        <Image
          source={icon}
          resizeMode="contain"
          style={[styles.innateIcon, { tintColor: "#20e7ee" }]}
        />
      </View>
      <View style={styles.innateCopy}>
        <Text style={styles.innateLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.innateName}>{name.toUpperCase()}</Text>
        <Text numberOfLines={2} style={styles.innateDescription}>{description}</Text>
      </View>
      <View style={styles.innateBadge}>
        <Text style={styles.innateBadgeText}>{badge}</Text>
      </View>
    </View>
  );
}

export function BattleLoadoutPanel({
  abilityDescription,
  abilityName,
  moves,
  onSelectMove,
  rankOf,
  selectedIndex,
  signatureDamage,
  signatureName,
  syncAbilityDescription,
  syncAbilityName,
}: BattleLoadoutPanelProps) {
  const [innatesExpanded, setInnatesExpanded] = useState(false);

  return (
    <View style={[styles.panel, innatesExpanded ? styles.panelExpanded : styles.panelCollapsed]}>
      <BattleLoadoutFrame />
      <View style={styles.headingRow}>
        <Text style={styles.heading}>BATTLE LOADOUT</Text>
        <View style={styles.headingRail} />
        <Pressable
          accessibilityLabel={`${innatesExpanded ? "Collapse" : "Expand"} innate systems`}
          accessibilityRole="button"
          accessibilityState={{ expanded: innatesExpanded }}
          onPress={() => setInnatesExpanded((value) => !value)}
          style={({ pressed }) => [
            styles.innateToggle,
            pressed ? styles.moveCardPressed : null,
          ]}
        >
          <Text style={styles.headingMeta}>
            {innatesExpanded ? "HIDE INNATES" : "SHOW INNATES"}
          </Text>
          <Svg height={16} viewBox="0 0 16 16" width={16}>
            <Path
              d={innatesExpanded ? "M3 10.5 L8 5.5 L13 10.5" : "M3 5.5 L8 10.5 L13 5.5"}
              fill="none"
              stroke="#f4c719"
              strokeLinecap="square"
              strokeLinejoin="miter"
              strokeWidth={2}
            />
          </Svg>
        </Pressable>
      </View>

      {innatesExpanded ? (
        <View style={styles.innateStack}>
          <InnateRow
            description={`DMG ${signatureDamage} • Activates at 7/7 meter`}
            icon={getMoveIcon("strike.powerDrive", "strike")}
            label="FINISHER"
            name={signatureName}
          />
          <InnateRow
            description={abilityDescription}
            icon={getMoveIcon("strike.quickJab", "strike")}
            label="ABILITY"
            name={abilityName}
          />
          {syncAbilityName ? (
            <InnateRow
              badge="SYNC"
              description={syncAbilityDescription || "Equipped Sync Ability"}
              icon={getMoveIcon("combo.chainBurst", "combo")}
              label="SYNC ABILITY"
              name={syncAbilityName}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.movesHeading}>
        <View style={styles.movesRail} />
        <Text style={styles.movesHeadingText}>EQUIPPED MOVES</Text>
        <View style={styles.movesRail} />
      </View>

      <View style={styles.moveRail}>
        {moves.map((move, index) => {
          const accent = ACCENTS[move.type];
          const rank = Math.max(0, Math.min(3, rankOf(move.templateId)));
          const selected = index === selectedIndex;
          return (
            <Pressable
              accessibilityLabel={`Edit equipped ${move.name}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={move.templateId}
              onPress={() => onSelectMove(index)}
              style={({ pressed }) => [
                styles.moveCard,
                pressed ? styles.moveCardPressed : null,
              ]}
            >
              <EquippedMoveFrame accent={accent} active={selected} />
              <View style={styles.moveHeader}>
                <View style={[styles.moveDot, { backgroundColor: accent }]} />
                <Text numberOfLines={1} style={[styles.moveClass, { color: accent }]}>
                  {CLASS_LABELS[move.type]}
                </Text>
              </View>
              <Image
                source={getMoveIcon(move.templateId, move.type)}
                resizeMode="contain"
                style={styles.moveIcon}
              />
              <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={2} style={styles.moveName}>
                {move.name.toUpperCase()}
              </Text>
              <View style={styles.rankLine}>
                <Text style={[styles.rankText, { color: accent }]}>
                  {`RANK ${RANK_ROMAN[rank]}`}
                </Text>
                <View style={styles.pips}>
                  {[1, 2, 3].map((step) => (
                    <View
                      key={step}
                      style={[
                        styles.pip,
                        rank >= step ? { backgroundColor: accent } : null,
                      ]}
                    />
                  ))}
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    color: "#f4c719",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.15,
  },
  headingMeta: {
    color: "#656d80",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  headingRail: {
    backgroundColor: "#27303a",
    flex: 1,
    height: 1,
    marginHorizontal: 8,
  },
  headingRow: {
    alignItems: "center",
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  innateBadge: {
    backgroundColor: "#20e7ee",
    marginRight: 9,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  innateBadgeText: {
    color: "#011113",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  innateCopy: {
    flex: 1,
    minWidth: 0,
  },
  innateDescription: {
    color: "#9098a8",
    fontSize: 9,
    lineHeight: 12,
    marginTop: 2,
  },
  innateIcon: {
    height: 51,
    width: 51,
  },
  innateIconFrame: {
    alignItems: "center",
    height: 58,
    justifyContent: "center",
    marginLeft: 7,
    width: 58,
  },
  innateIconRing: {
    borderColor: "#20e7ee",
    borderRadius: 27,
    borderWidth: 1,
    height: 54,
    opacity: 0.45,
    position: "absolute",
    width: 54,
  },
  innateLabel: {
    color: "#20e7ee",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  innateName: {
    color: "#eef1f7",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.2,
    marginTop: 1,
  },
  innateRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    height: 70,
  },
  innateStack: {
    gap: 5,
    marginHorizontal: 16,
    marginTop: 7,
  },
  innateToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minHeight: 28,
    paddingLeft: 5,
  },
  moveCard: {
    alignItems: "center",
    flex: 1,
    height: 132,
    minWidth: 0,
    paddingHorizontal: 5,
    paddingTop: 8,
  },
  moveCardPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
  moveClass: {
    flexShrink: 1,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.55,
  },
  moveDot: {
    borderRadius: 2,
    height: 4,
    width: 4,
  },
  moveHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    width: "100%",
  },
  moveIcon: {
    height: 55,
    marginTop: 2,
    width: 55,
  },
  moveName: {
    color: "#edf0f5",
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 11,
    minHeight: 22,
    textAlign: "center",
    width: "100%",
  },
  moveRail: {
    flexDirection: "row",
    gap: 4,
    marginHorizontal: 7,
  },
  movesHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    marginHorizontal: 16,
    marginTop: 6,
  },
  movesHeadingText: {
    color: "#7d8596",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.9,
  },
  movesRail: {
    backgroundColor: "#313844",
    flex: 1,
    height: 1,
  },
  panel: {
    position: "relative",
  },
  panelCollapsed: {
    height: 188,
  },
  panelExpanded: {
    height: 310,
  },
  pip: {
    backgroundColor: "#242a34",
    height: 4,
    width: 8,
  },
  pips: {
    flexDirection: "row",
    gap: 2,
  },
  rankLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    marginTop: 3,
  },
  rankText: {
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.25,
  },
});
