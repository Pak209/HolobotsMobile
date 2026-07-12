import React, { useMemo } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import type { ActionCard, BattleAction, BattleState, CardType } from "../../types/arena";
import type { ArenaCardAvailability } from "../../features/arena/arenaCards";
import {
  FINISHER_UNLOCK_SEGMENTS,
  getSpecialMeterSegments,
  SPECIAL_METER_SEGMENTS,
} from "../../features/arena/moveKits";

const CARD_SLOTS = 4;
const battlefieldImage = require("../../../assets/game/BattleField.png");

export type TeamHudChip = {
  index: number;
  name: string;
  hpPct: number;
  meterPct: number;
  isKnockedOut: boolean;
  isActive: boolean;
};

export type TeamHudProps = {
  playerChips: TeamHudChip[];
  opponentChips: TeamHudChip[];
  canSwitchNow: boolean;
  switchSecondsLeft: number;
  entryLocked: boolean;
  onSwitch: (index: number) => void;
  sendIn: { secondsLeft: number; options: TeamHudChip[] } | null;
  opponentChoosing: boolean;
  onSendIn: (index: number) => void;
};

type BattleArenaViewProps = {
  battle: BattleState;
  roundProgress?: {
    currentRound: number;
    totalRounds: number;
  } | null;
  playerCards: ActionCard[];
  playableCardIds: string[];
  cardAvailability: Record<string, ArenaCardAvailability>;
  lastAction: BattleAction | null;
  isAnimating: boolean;
  onCardPlay: (cardId: string) => void;
  onSignaturePlay: () => void;
  /** 3v3 Showdown HUD: bench chips, switching, and the send-in overlay. */
  team?: TeamHudProps | null;
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
      return "FINISHER";
  }
}

function getAvailabilityLabel(availability?: ArenaCardAvailability) {
  if (!availability || availability.playable) {
    return null;
  }
  switch (availability.reason) {
    case "cooldown":
      return `CD ${availability.cooldownTurns ?? "?"}`;
    case "stamina":
      return "LOW STA";
    case "combo":
      return "NEEDS COMBO";
    case "special_meter":
      return "NEEDS METER";
    case "opponent_state":
      return "TARGET SAFE";
    case "defense_lock":
      return "LOCKED";
    default:
      return null;
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
  reasonLabel,
  onPress,
}: {
  card?: ActionCard;
  disabled: boolean;
  isPlayable: boolean;
  reasonLabel: string | null;
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
      {reasonLabel ? (
        <View style={styles.cardReasonBadge}>
          <Text style={styles.cardReasonText}>{reasonLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function BenchChips({
  chips,
  align,
  onPress,
  pressableWhen,
}: {
  chips: TeamHudChip[];
  align: "left" | "right";
  onPress?: (index: number) => void;
  pressableWhen?: (chip: TeamHudChip) => boolean;
}) {
  return (
    <View style={[styles.benchRow, align === "right" ? styles.benchRowRight : null]}>
      {chips.map((chip) => {
        const pressable = Boolean(onPress && pressableWhen?.(chip));
        return (
          <Pressable
            key={chip.index}
            disabled={!pressable}
            onPress={() => onPress?.(chip.index)}
            style={[
              styles.benchChip,
              chip.isActive ? styles.benchChipActive : null,
              chip.isKnockedOut ? styles.benchChipKo : null,
            ]}
          >
            <Text numberOfLines={1} style={styles.benchChipName}>
              {chip.isKnockedOut ? `✕ ${chip.name}` : chip.name}
            </Text>
            <View style={styles.benchBarTrack}>
              <View style={[styles.benchHpFill, { width: `${Math.round(chip.hpPct * 100)}%` }]} />
            </View>
            <View style={styles.benchBarTrack}>
              <View style={[styles.benchMeterFill, { width: `${Math.round(chip.meterPct * 100)}%` }]} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function BattleArenaView({
  battle,
  roundProgress,
  playerCards,
  playableCardIds,
  cardAvailability,
  lastAction,
  isAnimating,
  onCardPlay,
  onSignaturePlay,
  team,
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
  const playerSpecialPercent = getHealthPercent(battle.player.specialMeter, 100);
  const finisherReady = battle.player.specialMeter >= 100;
  const lastActionDamage = lastAction ? (lastAction.actualDamage ?? lastAction.damageDealt) : 0;

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
            <Text
              style={[
                styles.comboCounter,
                battle.player.comboCounter > 0 ? styles.comboCounterActive : null,
              ]}
            >
              {`COMBO ×${battle.player.comboCounter}`}
            </Text>
            {battle.player.ability ? (
              <Text numberOfLines={1} style={styles.abilityBadge}>
                {`◈ ${battle.player.ability.name.toUpperCase()}`}
              </Text>
            ) : null}
            {battle.player.armedDefenseTrap ? (
              <View style={styles.trapChip}>
                <Text numberOfLines={1} style={styles.trapChipText}>
                  {`⛨ ${battle.player.armedDefenseTrap.name.toUpperCase()}${(battle.player.armedDefenseTrap.charges ?? 1) > 1 ? " ×2" : ""}${(battle.player.armedDefenseTrap.stackLevel ?? 0) > 0 ? ` ▲${battle.player.armedDefenseTrap.stackLevel}` : ""}`}
                </Text>
              </View>
            ) : null}
            {team ? (
              <>
                <BenchChips
                  chips={team.playerChips}
                  align="left"
                  onPress={team.onSwitch}
                  pressableWhen={(chip) => team.canSwitchNow && !chip.isActive && !chip.isKnockedOut}
                />
                {!team.canSwitchNow && team.switchSecondsLeft > 0 ? (
                  <Text style={styles.benchLockHint}>{`SWITCH CD ${team.switchSecondsLeft}s`}</Text>
                ) : null}
              </>
            ) : null}
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
            <Text
              style={[
                styles.comboCounter,
                styles.comboCounterRight,
                battle.opponent.comboCounter > 0 ? styles.comboCounterActive : null,
              ]}
            >
              {`COMBO ×${battle.opponent.comboCounter}`}
            </Text>
            {battle.opponent.ability ? (
              <Text numberOfLines={1} style={[styles.abilityBadge, styles.abilityBadgeRight]}>
                {`◈ ${battle.opponent.ability.name.toUpperCase()}`}
              </Text>
            ) : null}
            {battle.opponent.armedDefenseTrap ? (
              <View style={[styles.trapChip, styles.trapChipRight]}>
                <Text numberOfLines={1} style={styles.trapChipText}>
                  {`⛨ ${battle.opponent.armedDefenseTrap.name.toUpperCase()}${(battle.opponent.armedDefenseTrap.charges ?? 1) > 1 ? " ×2" : ""}${(battle.opponent.armedDefenseTrap.stackLevel ?? 0) > 0 ? ` ▲${battle.opponent.armedDefenseTrap.stackLevel}` : ""}`}
                </Text>
              </View>
            ) : null}
            {team ? <BenchChips chips={team.opponentChips} align="right" /> : null}
          </View>
        </View>
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
            {`${lastAction.card.name} ${lastActionDamage > 0 ? `• ${lastActionDamage} DMG` : ""}${
              lastAction.perfectDefense ? " • PERFECT" : lastAction.wasCountered ? " • COUNTERED" : ""
            }`}
          </Text>
        </View>
      ) : null}

      {team?.sendIn ? (
        <View style={styles.sendInOverlay}>
          <View style={styles.sendInCard}>
            <Text style={styles.sendInEyebrow}>HOLOBOT DOWN</Text>
            <Text style={styles.sendInTitle}>{`Send in your next fighter (${Math.max(0, team.sendIn.secondsLeft)}s)`}</Text>
            <View style={styles.sendInRow}>
              {team.sendIn.options.map((chip) => (
                <Pressable key={chip.index} onPress={() => team.onSendIn(chip.index)} style={styles.sendInOption}>
                  <Text style={styles.sendInName}>{chip.name}</Text>
                  <View style={styles.benchBarTrack}>
                    <View style={[styles.benchHpFill, { width: `${Math.round(chip.hpPct * 100)}%` }]} />
                  </View>
                  <Text style={styles.sendInMeta}>{`HP ${Math.round(chip.hpPct * 100)}%`}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {team?.opponentChoosing ? (
        <View style={styles.sendInBanner}>
          <Text style={styles.sendInBannerText}>OPPONENT SENDING IN THE NEXT HOLOBOT…</Text>
        </View>
      ) : null}

      <View style={styles.cardBay}>
        <View style={styles.cardBayTopBar}>
          <View style={styles.specialGaugeTrack}>
            <View style={[styles.specialGaugeFill, { width: `${playerSpecialPercent * 100}%` }]} />
            <View
              style={[
                styles.specialGaugeUnlockTick,
                { left: `${(FINISHER_UNLOCK_SEGMENTS / SPECIAL_METER_SEGMENTS) * 100}%` },
              ]}
            />
          </View>
          {finisherReady ? (
            <Pressable
              disabled={isAnimating}
              onPress={onSignaturePlay}
              style={[styles.signatureButton, isAnimating ? styles.signatureButtonDisabled : null]}
            >
              <Text numberOfLines={1} style={styles.signatureButtonText}>
                {`✦ ${(battle.player.signatureFinisher?.name || "SIGNATURE").toUpperCase()}`}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.specialCluster}>
              <Text style={styles.specialIcon}>{"✦"}</Text>
              <Text style={styles.specialText}>
                {`${getSpecialMeterSegments(battle.player.specialMeter)}/${SPECIAL_METER_SEGMENTS}`}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.cardBayHeader}>
          <Text style={styles.deckHint}>
            {team?.entryLocked
              ? "ENTERING THE ARENA…"
              : battle.player.armedDefenseTrap
              ? "DEFENSE TRAP ARMED"
              : finisherReady
                ? "FULL FINISHER READY — TAP THE GOLD BUTTON"
                : playerCanAct
                  ? "TAP A MOVE TO FIGHT"
                  : "WAITING FOR STAMINA"}
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
                reasonLabel={card ? getAvailabilityLabel(cardAvailability[card.id]) : null}
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
  benchBarTrack: {
    backgroundColor: "#1a1d26",
    height: 4,
    marginTop: 3,
    overflow: "hidden",
  },
  benchChip: {
    backgroundColor: "#0b0d13",
    borderColor: "#3a3f4b",
    borderWidth: 1.5,
    minWidth: 64,
    padding: 5,
  },
  benchChipActive: {
    borderColor: "#f0bf14",
  },
  benchChipKo: {
    opacity: 0.35,
  },
  benchChipName: {
    color: "#ffffff",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  benchHpFill: {
    backgroundColor: "#4bd060",
    height: "100%",
  },
  benchLockHint: {
    color: "#5a5a52",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 2,
  },
  benchMeterFill: {
    backgroundColor: "#f0bf14",
    height: "100%",
  },
  benchRow: {
    flexDirection: "row",
    gap: 5,
    marginTop: 5,
  },
  benchRowRight: {
    justifyContent: "flex-end",
  },
  sendInBanner: {
    alignItems: "center",
    backgroundColor: "#0b0d13",
    borderColor: "#f0bf14",
    borderWidth: 1.5,
    marginHorizontal: 14,
    marginTop: 8,
    paddingVertical: 8,
  },
  sendInBannerText: {
    color: "#f0bf14",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  sendInCard: {
    backgroundColor: "#0b0d13",
    borderColor: "#f0bf14",
    borderWidth: 2,
    padding: 18,
    width: "86%",
  },
  sendInEyebrow: {
    color: "#ff4538",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  sendInMeta: {
    color: "#8b93a1",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
  },
  sendInName: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900",
  },
  sendInOption: {
    borderColor: "#17d9ff",
    borderWidth: 1.5,
    flex: 1,
    padding: 10,
  },
  sendInOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.82)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 55,
  },
  sendInRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  sendInTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    marginTop: 4,
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
  abilityBadge: {
    color: "#2fb9c9",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  abilityBadgeRight: {
    textAlign: "right",
  },
  trapChip: {
    alignSelf: "flex-start",
    backgroundColor: "#123a6b",
    borderColor: "#2d8fff",
    borderWidth: 1.5,
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  trapChipRight: {
    alignSelf: "flex-end",
  },
  trapChipText: {
    color: "#9cd0ff",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  comboCounter: {
    color: "#5a5a52",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 2,
  },
  comboCounterActive: {
    color: "#f0bf14",
  },
  comboCounterRight: {
    textAlign: "right",
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
  cardReasonBadge: {
    backgroundColor: "rgba(5, 6, 6, 0.85)",
    borderColor: "rgba(255,255,255,0.16)",
    borderRadius: 4,
    borderWidth: 1,
    bottom: 4,
    left: 4,
    paddingVertical: 2,
    position: "absolute",
    right: 4,
  },
  cardReasonText: {
    color: "#d1d5db",
    fontSize: 8,
    fontWeight: "700",
    textAlign: "center",
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
  signatureButton: {
    backgroundColor: "#f0bf14",
    borderColor: "#07080d",
    borderWidth: 2,
    maxWidth: 190,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  signatureButtonDisabled: {
    opacity: 0.55,
  },
  signatureButtonText: {
    color: "#07080d",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1,
  },
  specialCluster: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  specialGaugeFill: {
    backgroundColor: "#f0bf14",
    height: "100%",
  },
  specialGaugeTrack: {
    backgroundColor: "#342d1a",
    flex: 1,
    height: 12,
    overflow: "hidden",
  },
  specialGaugeUnlockTick: {
    backgroundColor: "#07080d",
    bottom: 0,
    position: "absolute",
    top: 0,
    width: 2,
  },
  specialIcon: {
    color: "#f0bf14",
    fontSize: 20,
    fontWeight: "900",
  },
  specialText: {
    color: "#f0bf14",
    fontSize: 15,
    fontWeight: "900",
    minWidth: 52,
    textAlign: "right",
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
