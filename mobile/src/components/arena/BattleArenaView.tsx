import React, { useMemo } from "react";
import { Dimensions, Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { ActionCard, BattleAction, BattleState, CardType } from "../../types/arena";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_SLOTS = 4;
const battlefieldImage = require("../../../assets/game/BattleField.png");

type BattleArenaViewProps = {
  battle: BattleState;
  roundProgress?: {
    currentRound: number;
    totalRounds: number;
  } | null;
  playerCards: ActionCard[];
  playableCardIds: string[];
  selectedCardId: string | null;
  lastAction: BattleAction | null;
  isAnimating: boolean;
  onCardSelect: (cardId: string | null) => void;
  onCardPlay: (cardId: string) => void;
  onDefenseToggle: () => void;
};

function getCardColors(type: CardType) {
  switch (type) {
    case "combo":
      return { accent: "#2fd6ff", glow: "rgba(47, 214, 255, 0.18)" };
    case "strike":
      return { accent: "#ff4d39", glow: "rgba(255, 77, 57, 0.18)" };
    case "defense":
      return { accent: "#2d8fff", glow: "rgba(45, 143, 255, 0.18)" };
    case "finisher":
      return { accent: "#f0bf14", glow: "rgba(240, 191, 20, 0.18)" };
  }
}

function getCardLabel(type: CardType) {
  switch (type) {
    case "combo":
      return "COMBO";
    case "strike":
      return "STRIKE";
    case "defense":
      return "DEFEND";
    case "finisher":
      return "FINISH";
  }
}

function getHealthPercent(current: number, max: number) {
  if (max <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, current / max));
}

function HudBar({
  align = "left",
  color,
  label,
  value,
  percent,
}: {
  align?: "left" | "right";
  color: string;
  label: string;
  percent: number;
  value: string;
}) {
  return (
    <View style={[styles.hudBarBlock, align === "right" ? styles.hudBarBlockRight : null]}>
      <View style={styles.hudBarLabelRow}>
        {align === "left" ? <Text style={styles.hudStatValue}>{value}</Text> : null}
        <Text style={[styles.hudStatLabel, { color }]}>{label}</Text>
        {align === "right" ? <Text style={styles.hudStatValue}>{value}</Text> : null}
      </View>
      <View style={styles.hudBarTrack}>
        <View
          style={[
            styles.hudBarFill,
            {
              backgroundColor: color,
              width: `${Math.max(0, Math.min(100, percent * 100))}%`,
              alignSelf: align === "right" ? "flex-end" : "flex-start",
            },
          ]}
        />
      </View>
    </View>
  );
}

function ArenaCard({
  card,
  disabled,
  isPlayable,
  isSelected,
  onPress,
}: {
  card?: ActionCard;
  disabled: boolean;
  isPlayable: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  if (!card) {
    return (
      <View style={[styles.cardSlot, styles.cardSlotEmpty]}>
        <View style={styles.emptyCardCore} />
      </View>
    );
  }

  const colors = getCardColors(card.type);

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.cardSlot,
        {
          borderColor: colors.accent,
          backgroundColor: colors.glow,
          opacity: isPlayable ? 1 : 0.45,
        },
        isSelected ? styles.cardSlotSelected : null,
      ]}
    >
      <View style={styles.cardCostBadge}>
        <Text style={[styles.cardCostText, { color: colors.accent }]}>{card.staminaCost}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.cardTypeLabel, { color: colors.accent }]}>
        {getCardLabel(card.type)}
      </Text>
      <View style={[styles.cardArtPlaceholder, { borderColor: colors.accent }]}>
        <View style={[styles.cardDiamond, { borderColor: colors.accent }]} />
      </View>
      <Text numberOfLines={2} style={styles.cardName}>
        {card.name}
      </Text>
      <Text style={[styles.cardDamage, { color: colors.accent }]}>
        {card.baseDamage > 0 ? `${card.baseDamage} DMG` : card.type === "defense" ? "BLOCK" : "UTILITY"}
      </Text>
    </Pressable>
  );
}

export function BattleArenaView({
  battle,
  roundProgress,
  playerCards,
  playableCardIds,
  selectedCardId: _selectedCardId,
  lastAction,
  isAnimating,
  onCardSelect: _onCardSelect,
  onCardPlay,
  onDefenseToggle,
}: BattleArenaViewProps) {
  const visibleCards = useMemo(() => {
    const slots = playerCards.slice(0, CARD_SLOTS);
    while (slots.length < CARD_SLOTS) {
      slots.push(undefined as never);
    }
    return slots;
  }, [playerCards]);

  const playerCanAct = playableCardIds.length > 0 && !isAnimating;
  const playerHealthPercent = getHealthPercent(battle.player.currentHP, battle.player.maxHP);
  const opponentHealthPercent = getHealthPercent(battle.opponent.currentHP, battle.opponent.maxHP);
  const playerStaminaPercent = getHealthPercent(battle.player.stamina, battle.player.maxStamina);
  const opponentStaminaPercent = getHealthPercent(battle.opponent.stamina, battle.opponent.maxStamina);

  return (
    <View style={styles.screen}>
      <View style={styles.backgroundAngles}>
        <View style={styles.angleOne} />
        <View style={styles.angleTwo} />
        <View style={styles.angleThree} />
      </View>

      <View style={styles.topHud}>
        <View style={styles.hudSide}>
          <View style={styles.hudInfoStack}>
            <Text numberOfLines={1} style={styles.hudName}>{battle.player.name}</Text>
            <HudBar
              color="#4bd060"
              label="HP"
              percent={playerHealthPercent}
              value={`${battle.player.currentHP} / ${battle.player.maxHP}`}
            />
            <HudBar
              color="#2db8ff"
              label="STAMINA"
              percent={playerStaminaPercent}
              value={`${battle.player.stamina} / ${battle.player.maxStamina}`}
            />
          </View>
        </View>

        <View style={styles.roundCore}>
          <Text style={styles.roundLabel}>ROUND</Text>
          <Text style={styles.roundValue}>{String(roundProgress?.currentRound ?? 1).padStart(2, "0")}</Text>
          <Text style={styles.roundSubtext}>{`OF ${roundProgress?.totalRounds ?? 3}`}</Text>
        </View>

        <View style={styles.hudSide}>
          <View style={styles.hudInfoStack}>
            <Text numberOfLines={1} style={[styles.hudName, styles.hudNameRight]}>{battle.opponent.name}</Text>
            <HudBar
              align="right"
              color="#ff4538"
              label="HP"
              percent={opponentHealthPercent}
              value={`${battle.opponent.currentHP} / ${battle.opponent.maxHP}`}
            />
            <HudBar
              align="right"
              color="#2db8ff"
              label="STAMINA"
              percent={opponentStaminaPercent}
              value={`${battle.opponent.stamina} / ${battle.opponent.maxStamina}`}
            />
          </View>
        </View>
      </View>

      <View style={styles.arenaLabelFrame}>
        <Text style={styles.arenaLabelText}>BATTLE ARENA</Text>
      </View>

      <View style={styles.battleStageWrap}>
        <View style={styles.battleStage}>
          <View style={styles.battleFloor}>
            <Image source={battlefieldImage} style={styles.battlefieldImage} resizeMode="contain" />
            <View pointerEvents="none" style={styles.fighterOverlay}>
              <View style={[styles.stageFighter, styles.stageFighterLeft]}>
                <Image
                  source={typeof battle.player.avatar === "string" ? { uri: battle.player.avatar } : battle.player.avatar}
                  style={styles.stageFighterImage}
                  resizeMode="contain"
                />
              </View>
              <View style={[styles.stageFighter, styles.stageFighterRight]}>
                <Image
                  source={typeof battle.opponent.avatar === "string" ? { uri: battle.opponent.avatar } : battle.opponent.avatar}
                  style={[styles.stageFighterImage, styles.stageFighterImageMirrored]}
                  resizeMode="contain"
                />
              </View>
            </View>
            <View style={styles.vsBadge}>
              <Text style={styles.vsText}>VS</Text>
            </View>
          </View>
        </View>
      </View>

      {lastAction ? (
        <View style={styles.actionTicker}>
          <Text numberOfLines={1} style={styles.actionTickerText}>
            {`${lastAction.card.name} ${lastAction.damageDealt > 0 ? `• ${lastAction.damageDealt} DMG` : ""}${
              lastAction.perfectDefense ? " • PERFECT" : lastAction.wasCountered ? " • COUNTERED" : ""
            }`}
          </Text>
        </View>
      ) : null}

      <View style={styles.cardBay}>
        <View style={styles.cardBayTopBar}>
          <View style={styles.cardBayEnergyTrack}>
            <View style={[styles.cardBayEnergyFill, { width: `${playerStaminaPercent * 100}%` }]} />
          </View>
          <View style={styles.energyCluster}>
            <Text style={styles.energyIcon}>⚡</Text>
            <Text style={styles.energyText}>{`${battle.player.stamina} / ${battle.player.maxStamina}`}</Text>
          </View>
        </View>
        <View style={styles.cardBayHeader}>
          <Text style={styles.deckHint}>
            {battle.player.isInDefenseMode ? "DEFENSE MODE ACTIVE" : playerCanAct ? "TAP A CARD TO PLAY" : "WAITING FOR ACTION"}
          </Text>
        </View>

        <View style={styles.cardRow}>
          {visibleCards.map((card, index) => {
            const isPlayable = !!card && playableCardIds.includes(card.id);
            return (
              <ArenaCard
                key={card?.id ?? `empty-${index}`}
                card={card}
                disabled={!card || isAnimating || !isPlayable}
                isPlayable={isPlayable}
                isSelected={false}
                onPress={() => {
                  if (card && isPlayable) {
                    onCardPlay(card.id);
                  }
                }}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionTicker: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 2,
    marginHorizontal: 18,
    marginTop: -4,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actionTickerText: {
    color: "#fef1e0",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  angleOne: {
    backgroundColor: "rgba(0,0,0,0.06)",
    height: 74,
    left: -20,
    position: "absolute",
    top: 112,
    transform: [{ skewX: "-35deg" }],
    width: 180,
  },
  angleThree: {
    backgroundColor: "rgba(0,0,0,0.05)",
    height: 64,
    left: 72,
    position: "absolute",
    top: 362,
    transform: [{ skewX: "-35deg" }],
    width: 126,
  },
  angleTwo: {
    backgroundColor: "rgba(255,255,255,0.08)",
    height: 86,
    position: "absolute",
    right: -28,
    top: 20,
    transform: [{ skewX: "-35deg" }],
    width: 184,
  },
  arenaLabelFrame: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 3,
    marginTop: 14,
    minWidth: 174,
    paddingHorizontal: 24,
    paddingVertical: 8,
  },
  arenaLabelText: {
    color: "#f0bf14",
    fontSize: 17,
    fontWeight: "900",
  },
  backgroundAngles: {
    ...StyleSheet.absoluteFillObject,
  },
  battlefieldImage: {
    height: 276,
    width: "100%",
  },
  battleFloor: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    position: "relative",
    width: "100%",
  },
  fighterOverlay: {
    bottom: 104,
    left: 0,
    position: "absolute",
    right: 0,
    top: -8,
    zIndex: 2,
  },
  battleStage: {
    alignItems: "center",
    height: 306,
    position: "relative",
    width: "100%",
  },
  battleStageWrap: {
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: -18,
  },
  stageFighter: {
    alignItems: "center",
    bottom: 0,
    height: 142,
    justifyContent: "flex-end",
    position: "absolute",
    width: "34%",
  },
  stageFighterImage: {
    height: "100%",
    width: "100%",
  },
  stageFighterImageMirrored: {
    transform: [{ scaleX: -1 }],
  },
  stageFighterLeft: {
    left: "9%",
  },
  stageFighterRight: {
    right: "9%",
  },
  cardArtPlaceholder: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    justifyContent: "center",
    marginVertical: 10,
  },
  cardBay: {
    backgroundColor: "#080808",
    borderColor: "#1f1f1f",
    borderWidth: 3,
    marginHorizontal: 18,
    marginTop: 0,
    marginBottom: 14,
    paddingBottom: 10,
    paddingHorizontal: 10,
    paddingTop: 10,
  },
  cardBayEnergyFill: {
    backgroundColor: "#f0bf14",
    height: "100%",
  },
  cardBayEnergyTrack: {
    backgroundColor: "#342d1a",
    flex: 1,
    height: 12,
    overflow: "hidden",
  },
  cardBayHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardBayTopBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
  },
  cardCostBadge: {
    alignItems: "center",
    borderColor: "currentcolor",
    borderRadius: 12,
    borderWidth: 0,
    height: 22,
    justifyContent: "center",
    left: 6,
    position: "absolute",
    top: 6,
    width: 22,
  },
  cardCostText: {
    fontSize: 18,
    fontWeight: "900",
  },
  cardDamage: {
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 2,
  },
  cardName: {
    color: "#fef1e0",
    fontSize: 9,
    fontWeight: "800",
    lineHeight: 11,
    minHeight: 22,
    textAlign: "center",
  },
  cardDiamond: {
    borderColor: "#ffffff",
    borderWidth: 2,
    height: 34,
    transform: [{ rotate: "45deg" }],
    width: 34,
  },
  cardRow: {
    flexDirection: "row",
    gap: 8,
  },
  cardSlot: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 3,
    flex: 1,
    height: 146,
    justifyContent: "flex-start",
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingTop: 12,
  },
  cardSlotEmpty: {
    backgroundColor: "#101010",
    borderColor: "#2b2b2b",
  },
  cardSlotSelected: {
    shadowColor: "#f0bf14",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    transform: [{ translateY: -6 }],
  },
  cardTypeLabel: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
    marginTop: 8,
  },
  deckHint: {
    color: "#9d9580",
    flex: 1,
    fontSize: 9,
    fontWeight: "800",
    paddingLeft: 12,
    textAlign: "right",
  },
  emptyCardCore: {
    backgroundColor: "#171717",
    borderColor: "#282828",
    borderRadius: 10,
    borderWidth: 2,
    height: "82%",
    marginTop: 12,
    width: "72%",
  },
  energyCluster: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  energyIcon: {
    color: "#2db8ff",
    fontSize: 20,
    fontWeight: "900",
  },
  energyText: {
    color: "#2db8ff",
    fontSize: 15,
    fontWeight: "900",
  },
  hudBarBlock: {
    gap: 4,
    width: "100%",
  },
  hudBarBlockRight: {
    alignItems: "flex-end",
  },
  hudBarFill: {
    borderRadius: 3,
    height: "100%",
  },
  hudBarLabelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  hudBarTrack: {
    backgroundColor: "#1c1c1c",
    borderColor: "#0f0f0f",
    borderWidth: 1,
    height: 20,
    overflow: "hidden",
    width: "100%",
  },
  hudName: {
    color: "#fef1e0",
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
  },
  hudNameRight: {
    textAlign: "right",
  },
  hudInfoStack: {
    flex: 1,
    gap: 5,
  },
  hudSide: {
    flex: 1,
    gap: 7,
  },
  hudStatLabel: {
    fontSize: 11,
    fontWeight: "900",
  },
  hudStatValue: {
    color: "#fef1e0",
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
  },
  roundCore: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 3,
    height: 80,
    justifyContent: "center",
    marginHorizontal: 8,
    width: 80,
  },
  roundLabel: {
    color: "#fef1e0",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  roundSubtext: {
    color: "#9d9580",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  roundValue: {
    color: "#fef1e0",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 0,
  },
  screen: {
    backgroundColor: "#f5c40d",
    flex: 1,
    paddingTop: 40,
  },
  topHud: {
    alignItems: "flex-start",
    backgroundColor: "#050606",
    flexDirection: "row",
    marginHorizontal: 0,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  vsBadge: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 3,
    height: 78,
    justifyContent: "center",
    position: "absolute",
    top: "50%",
    transform: [{ translateY: -39 }],
    width: 74,
    zIndex: 3,
  },
  vsText: {
    color: "#f0bf14",
    fontSize: 24,
    fontWeight: "900",
  },
});
