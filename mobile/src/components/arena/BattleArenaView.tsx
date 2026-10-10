import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ImageStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";

import type { ActionCard, ArmedDefenseTrap, BattleAction, BattleState, CardType } from "../../types/arena";
import type { ArenaCardAvailability } from "../../features/arena/arenaCards";
import {
      SPECIAL_METER_SEGMENTS,
} from "../../features/arena/moveKits";
import { GameSurfaceFrame } from "../ui/GameSurfaceFrame";
import { HolobotAnimatedCharacter } from "../character/HolobotAnimatedCharacter";
import {
  hasHolobotAnimation,
  resolveHolobotAnimationState,
} from "../character/holobotAnimationAssets";
import { getActionSides, getCompletedVisualStates, type FighterVisualStates } from "./battleVisualStates";

import { ArenaCombatEngine } from "../../features/arena/combatEngine";
import { FINISHER_POLICY, type FinisherPower } from "../../features/arena/finisherPolicy";
const CARD_SLOTS = 4;
const battlefieldImage = require("../../../assets/game/BattleField.png");
const arenaMoveIcons: Record<CardType, number> = {
  strike: require("../../../assets/game/arena-moves/strike.png"),
  defense: require("../../../assets/game/arena-moves/defend.png"),
  combo: require("../../../assets/game/arena-moves/combo.png"),
  finisher: require("../../../assets/game/arena-moves/finisher.png"),
};
// Optical centering inside the corner-cut frame (reference: the arena-cards
// prototype spacing) — the frame's art window sits a hair right of true
// center, so the icons shift LEFT to compensate.
const arenaMoveIconOffsets: Record<CardType, Pick<ImageStyle, "transform">> = {
  strike: { transform: [{ translateX: -3 }] },
  defense: { transform: [{ translateX: -2 }] },
  combo: { transform: [{ translateX: -2 }] },
  finisher: { transform: [{ translateX: -2 }, { translateY: 2 }] },
};

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
  onSignaturePlay: (power?: FinisherPower) => void;
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

function getAvailabilityLabel(availability?: ArenaCardAvailability, card?: ActionCard) {
  if (!availability || availability.playable) {
    return null;
  }
  switch (availability.reason) {
    case "inactive": return "BATTLE ENDED";
    case "invalid_target": return "NO LIVE TARGET";
    case "cooldown":
      return `CD ${availability.cooldownTurns ?? "?"}`;
    case "stamina":
      return `NEED ${card?.staminaCost ?? ""} STA`;
    case "combo":
      return "NEEDS COMBO";
    case "special_meter":
      return "NEEDS METER";
    case "opponent_state":
      return "TARGET SAFE";
    case "defense_lock":
      return "LOCKED";
    case "bracing":
      return "BRACING";
    default:
      return null;
  }
}

/** Spells out what the defender's trap did — the outcome used to be silent
    unless it countered, so evades and blocks looked like nothing happened. */
function getOutcomeLabel(action: BattleAction): string {
  if (action.wasCountered) return " • COUNTERED!";
  if (action.perfectDefense || action.outcome === "dodged" || action.outcome === "missed") {
    return " • EVADED!";
  }
  if (action.outcome === "blocked" && action.actionType !== "defense") {
    return " • BLOCKED BY TRAP";
  }
  if (action.actionType === "defense") return " • TRAP ARMED";
  return "";
}

/** One-line plain-language summary of what an armed trap will do. */
function describeTrap(trap: ArmedDefenseTrap): string {
  const parts: string[] = [];
  if (trap.evadeChance >= 1) {
    parts.push("evades the next hit");
  } else {
    if (trap.damageReduction > 0) parts.push(`blocks ${Math.round(trap.damageReduction * 100)}%`);
    if (trap.evadeChance > 0) parts.push(`${Math.round(trap.evadeChance * 100)}% evade`);
  }
  if (trap.counterDamageMultiplier > 0) {
    parts.push(`counters for ${Math.round(trap.counterDamageMultiplier * 100)}%`);
  }
  if ((trap.charges ?? 1) > 1) parts.push(`${trap.charges} hits`);
  return `Next incoming attack: ${parts.join(" · ") || "absorbed"}.`;
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
  bonusLabel,
  onPress,
}: {
  card?: ActionCard;
  disabled: boolean;
  isPlayable: boolean;
  reasonLabel: string | null;
  bonusLabel?: string | null;
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
          opacity: isPlayable ? 1 : 0.78,
        },
      ]}
    >
      <Svg
        height="100%"
        pointerEvents="none"
        preserveAspectRatio="none"
        style={styles.cardFrame}
        viewBox="0 0 100 146"
        width="100%"
      >
        <Path
          d="M16 1 H86 L99 14 V132 L86 145 H14 L1 132 V22 L16 7 Z"
          fill={colors.glow}
          stroke={colors.accent}
          strokeLinejoin="miter"
          strokeWidth="3"
        />
        <Path
          d="M17 7 H82 L93 18 V127 L82 138 H18 L7 127 V29 L17 19 Z"
          fill="rgba(5, 6, 6, 0.86)"
          stroke={colors.accent}
          strokeOpacity="0.42"
          strokeWidth="1"
        />
        <Path
          d="M7 36 H28 L37 27 V7 M29 36 L37 28"
          fill="none"
          stroke={colors.accent}
          strokeOpacity="0.8"
          strokeWidth="1.5"
        />
        <Path
          d="M14 141 H39 M61 141 H84 M91 21 V48 M4 95 V125"
          fill="none"
          stroke={colors.accent}
          strokeOpacity="0.65"
          strokeWidth="1.2"
        />
      </Svg>
      <View style={styles.cardCostBadge}>
        <Text style={[styles.cardCostText, { color: colors.accent }]}>{`${card.type === "defense" ? "NEED " : ""}${card.staminaCost} STA`}</Text>
      </View>
      <Text numberOfLines={1} style={[styles.cardTypeLabel, { color: colors.accent }]}>
        {getCardLabel(card.type)}
      </Text>
      <View style={styles.cardArtPlaceholder}>
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          source={arenaMoveIcons[card.type]}
          style={[styles.cardMoveIcon, arenaMoveIconOffsets[card.type], { tintColor: colors.accent }]}
        />
      </View>
      <Text numberOfLines={2} style={styles.cardName}>
        {card.name}
      </Text>
      <Text style={[styles.cardDamage, { color: colors.accent }]}>
        {card.type === "finisher" ? "SIGNATURE" : card.baseDamage > 0 ? `${card.baseDamage} DMG` : card.type === "defense" ? "BLOCK" : "UTILITY"}
      </Text>
      {reasonLabel ? (
        <View style={styles.cardReasonBadge}>
          <Text style={styles.cardReasonText}>{reasonLabel}</Text>
        </View>
      ) : bonusLabel ? (
        <View style={styles.cardBonusBadge}>
          <Text style={styles.cardBonusText}>{bonusLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Display-only roster strip (the CPU side); the player's tappable switch
    dock lives in the card bay. */
function BenchChips({ chips, align }: { chips: TeamHudChip[]; align: "left" | "right" }) {
  return (
    <View style={[styles.benchRow, align === "right" ? styles.benchRowRight : null]}>
      {chips.map((chip) => (
        <View
          key={chip.index}
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
        </View>
      ))}
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
  const [transientVisualStates, setTransientVisualStates] = useState<FighterVisualStates>({
    player: "idle",
    opponent: "idle",
  });
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [passiveDetail, setPassiveDetail] = useState<"player" | "opponent" | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setReduceMotion(value); });
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { live = false; listener.remove(); };
  }, []);
  const playerLunge = useRef(new Animated.Value(0)).current;
  const opponentLunge = useRef(new Animated.Value(0)).current;
  const playerFlash = useRef(new Animated.Value(0)).current;
  const opponentFlash = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    playerLunge.stopAnimation();
    opponentLunge.stopAnimation();
    playerFlash.stopAnimation();
    opponentFlash.stopAnimation();
    playerLunge.setValue(0);
    opponentLunge.setValue(0);
    playerFlash.setValue(0);
    opponentFlash.setValue(0);
    setTransientVisualStates({ player: "idle", opponent: "idle" });
  }, [battle.battleId, opponentFlash, opponentLunge, playerFlash, playerLunge]);

  useEffect(() => {
    if (!lastAction || reduceMotion) return;

    const { attacker, damaged } = getActionSides(lastAction, battle);
    setTransientVisualStates({
      player: damaged === "player" ? "hit" : attacker === "player" ? "attackBasic" : "idle",
      opponent: damaged === "opponent" ? "hit" : attacker === "opponent" ? "attackBasic" : "idle",
    });

    const lunge = attacker === "player" ? playerLunge : opponentLunge;
    const lungeDistance = attacker === "player" ? 12 : -12;
    lunge.stopAnimation();
    lunge.setValue(0);
    Animated.sequence([
      Animated.timing(lunge, { duration: 100, toValue: lungeDistance, useNativeDriver: true }),
      Animated.timing(lunge, { duration: 150, toValue: 0, useNativeDriver: true }),
    ]).start();

    if (damaged) {
      const flash = damaged === "player" ? playerFlash : opponentFlash;
      flash.stopAnimation();
      flash.setValue(0);
      Animated.sequence([
        Animated.timing(flash, { duration: 65, toValue: 0.55, useNativeDriver: true }),
        Animated.timing(flash, { duration: 125, toValue: 0, useNativeDriver: true }),
      ]).start();
    }

    const resetTimer = setTimeout(
      () => setTransientVisualStates({ player: "idle", opponent: "idle" }),
      350,
    );
    return () => {
      clearTimeout(resetTimer);
      lunge.stopAnimation();
      lunge.setValue(0);
      if (damaged) {
        const flash = damaged === "player" ? playerFlash : opponentFlash;
        flash.stopAnimation();
        flash.setValue(0);
      }
    };
  }, [lastAction?.id, battle.battleId, opponentFlash, opponentLunge, playerFlash, playerLunge, reduceMotion]);

  const [finisherPower, setFinisherPower] = useState<FinisherPower>("half");
  const finisherAvailability = ArenaCombatEngine.getSignatureAvailability(battle, "player", finisherPower);
  const visualStates = getCompletedVisualStates(battle) ?? transientVisualStates;
  const visibleCards = useMemo(() => {
    const slots = playerCards.filter(card => card.type !== "finisher").slice(0, CARD_SLOTS - 1);
    while (slots.length < CARD_SLOTS - 1) slots.push(undefined as never);
    slots.push(ArenaCombatEngine.buildSignatureCard(battle.player, finisherPower));
    return slots;
  }, [playerCards, battle.player, finisherPower]);

  const playerCanAct = playableCardIds.length > 0 && !isAnimating;
  const chainLength = battle.player.comboCounter;
  const playableFinisher = playerCards.find(
    (card) => card?.type === "finisher" && playableCardIds.includes(card.id),
  );
  const playerHealthPercent = getHealthPercent(battle.player.currentHP, battle.player.maxHP);
  const opponentHealthPercent = getHealthPercent(battle.opponent.currentHP, battle.opponent.maxHP);
  const playerStaminaPercent = getHealthPercent(battle.player.stamina, battle.player.maxStamina);
  const opponentStaminaPercent = getHealthPercent(battle.opponent.stamina, battle.opponent.maxStamina);
  const playerSpecialPercent = getHealthPercent(battle.player.specialMeter, 100);
  const finisherReady = finisherAvailability.playable;
  const lastActionDamage = lastAction ? (lastAction.actualDamage ?? lastAction.damageDealt) : 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
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
            {/* Player switch controls live down in the card bay where the
                thumb already is; only the CPU's roster stays up here. */}
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
        <View style={[styles.battleStage, { height: Math.max(140, Math.min(240, windowHeight - insets.top - insets.bottom - (team ? 510 : 460))) }]}>
          <View style={styles.battleFloor}>
            <Image source={battlefieldImage} style={styles.battlefieldImage} resizeMode="contain" />
            <View pointerEvents="none" style={styles.fighterOverlay}>
              <Animated.View
                style={[styles.stageFighter, styles.stageFighterLeft, { transform: [{ translateX: playerLunge }] }]}
              >
                <Image
                  source={typeof battle.player.avatar === "string" ? { uri: battle.player.avatar } : battle.player.avatar}
                  style={styles.stageFighterImage}
                  resizeMode="contain"
                />
                {hasHolobotAnimation(battle.player.name, "arena") ? (
                  <HolobotAnimatedCharacter
                    animationState={resolveHolobotAnimationState(battle.player.name, "arena", visualStates.player)}
                    context="arena"
                    holobotId={battle.player.name}
                    staticFallback={typeof battle.player.avatar === "string" ? { uri: battle.player.avatar } : battle.player.avatar}
                    style={StyleSheet.absoluteFill}
                  />
                ) : null}
                <Animated.Image
                  resizeMode="contain"
                  source={typeof battle.player.avatar === "string" ? { uri: battle.player.avatar } : battle.player.avatar}
                  style={[
                    StyleSheet.absoluteFill,
                    { opacity: playerFlash, tintColor: "#ff4d39" },
                  ]}
                />
              </Animated.View>
              <Animated.View
                style={[styles.stageFighter, styles.stageFighterRight, { transform: [{ translateX: opponentLunge }] }]}
              >
                <Image
                  source={typeof battle.opponent.avatar === "string" ? { uri: battle.opponent.avatar } : battle.opponent.avatar}
                  style={[styles.stageFighterImage, styles.stageFighterImageMirrored]}
                  resizeMode="contain"
                />
                {hasHolobotAnimation(battle.opponent.name, "arena") ? (
                  <HolobotAnimatedCharacter
                    animationState={resolveHolobotAnimationState(battle.opponent.name, "arena", visualStates.opponent)}
                    context="arena"
                    holobotId={battle.opponent.name}
                    staticFallback={typeof battle.opponent.avatar === "string" ? { uri: battle.opponent.avatar } : battle.opponent.avatar}
                    style={[StyleSheet.absoluteFill, styles.stageFighterImageMirrored]}
                  />
                ) : null}
                <Animated.Image
                  resizeMode="contain"
                  source={typeof battle.opponent.avatar === "string" ? { uri: battle.opponent.avatar } : battle.opponent.avatar}
                  style={[
                    StyleSheet.absoluteFill,
                    styles.stageFighterImageMirrored,
                    { opacity: opponentFlash, tintColor: "#ff4d39" },
                  ]}
                />
              </Animated.View>
            </View>
            <View style={styles.vsBadge}>
              <Text style={styles.vsText}>VS</Text>
            </View>
          </View>
        </View>
      </View>

      {lastAction ? (
        <View style={styles.actionTicker}>
          <GameSurfaceFrame accent="#f0bf14" />
          <Text numberOfLines={1} style={styles.actionTickerText}>
            {`${lastAction.card.name} ${lastActionDamage > 0 ? `• ${lastActionDamage} DMG` : ""}${getOutcomeLabel(
              lastAction,
            )}`}
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
        <GameSurfaceFrame accent="#f0bf14" strong />
        {team ? (
          <View style={styles.switchDock}>
            {team.playerChips.map((chip) => {
              const pressable = team.canSwitchNow && !chip.isActive && !chip.isKnockedOut;
              return (
                <Pressable
                  key={chip.index}
                  disabled={!pressable}
                  onPress={() => team.onSwitch(chip.index)}
                  style={[
                    styles.switchChip,
                    chip.isActive ? styles.switchChipActive : null,
                    chip.isKnockedOut ? styles.switchChipKo : null,
                    pressable ? styles.switchChipReady : null,
                  ]}
                >
                  <Text numberOfLines={1} style={styles.switchChipName}>
                    {chip.isKnockedOut ? `✕ ${chip.name}` : chip.name}
                  </Text>
                  <View style={styles.benchBarTrack}>
                    <View style={[styles.benchHpFill, { width: `${Math.round(chip.hpPct * 100)}%` }]} />
                  </View>
                  <Text style={[styles.switchChipMeta, pressable ? styles.switchChipMetaReady : null]}>
                    {chip.isActive
                      ? "ACTIVE"
                      : chip.isKnockedOut
                        ? "DOWN"
                        : team.canSwitchNow
                          ? "TAP TO SWITCH"
                          : `CD ${team.switchSecondsLeft}s`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={styles.cardBayTopBar}>
          <View style={styles.specialGaugeTrack}>
            <View style={[styles.specialGaugeFill, { width: `${playerSpecialPercent * 100}%` }]} />
            <View
              style={[
                styles.specialGaugeUnlockTick,
                { left: `${FINISHER_POLICY.half.sync}%` },
              ]}
            />
          </View>
          <View style={styles.specialCluster}>
            {(["half", "full"] as const).map(power => (
              <Pressable key={power} accessibilityRole="button" accessibilityState={{ selected: finisherPower === power }}
                accessibilityLabel={`${power === "half" ? "Half" : "Full"} strength Finisher`}
                onPress={() => setFinisherPower(power)} style={[styles.powerChoice, finisherPower === power ? styles.powerChoiceSelected : null]}>
                <Text style={styles.specialText}>{`${FINISHER_POLICY[power].sync}% · ${FINISHER_POLICY[power].stamina} STA`}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.cardBayHeader}>
          <Text style={styles.deckHint}>
            {team?.entryLocked
              ? "ENTERING THE ARENA…"
              : battle.player.armedDefenseTrap
              ? "DEFENSE TRAP ARMED"
              : finisherReady
                ? "FINISHER READY — TAP THE GOLD COMMAND"
                : playableFinisher && chainLength >= 1
                  ? `CHAIN ×${chainLength} LIVE — FINISHER CASHES IT (DEFENDING DROPS IT)`
                  : playerCanAct
                    ? "TAP A MOVE TO FIGHT"
                    : "WAITING FOR STAMINA"}
          </Text>
        </View>

        <View style={styles.cardRow}>
          {visibleCards.map((card, index) => {
            const isSignature = index === CARD_SLOTS - 1;
            const isPlayable = !!card && (isSignature ? finisherAvailability.playable : playableCardIds.includes(card.id)) && !team?.entryLocked;
            return (
              <ArenaCard
                key={card?.id ?? `empty-${index}`}
                card={card}
                disabled={!card || isAnimating || !isPlayable}
                isPlayable={isPlayable}
                reasonLabel={isSignature ? (finisherAvailability.playable ? null : finisherAvailability.reason === "stamina" ? `NEED ${finisherAvailability.staminaCost} STA` : finisherAvailability.reason === "special_meter" ? `NEED ${finisherAvailability.syncCost}% SYNC` : "NOT READY") : card ? getAvailabilityLabel(cardAvailability[card.id], card) : null}
                bonusLabel={
                  card?.type === "finisher" && isPlayable && chainLength >= 1
                    ? `CHAIN ENDER ×${chainLength}`
                    : null
                }
                onPress={() => {
                  if (card && isPlayable) {
                    if (isSignature) onSignaturePlay(finisherPower);
                    else onCardPlay(card.id);
                  }
                }}
              />
            );
          })}
        </View>

        <View style={styles.abilityDock}>
          {(["player", "opponent"] as const).map(side => (
            <Pressable key={side} accessibilityRole="button" accessibilityLabel={`${battle[side].name} passive details`}
              onPress={() => setPassiveDetail(side)} style={styles.abilityPanel}>
              <GameSurfaceFrame accent={side === "player" ? "#17d9ff" : "#596273"} />
              <Text numberOfLines={1} style={styles.abilityPanelName}>{battle[side].name} · {battle[side].ability?.name ?? "Combat routine"}</Text>
            </Pressable>
          ))}
        </View>
        <Modal visible={passiveDetail !== null} transparent animationType={reduceMotion ? "none" : "fade"} onRequestClose={() => setPassiveDetail(null)}>
          <View style={styles.detailBackdrop}><View style={styles.detailPanel}>
            <Text style={styles.abilityPanelName}>{passiveDetail ? battle[passiveDetail].ability?.name : ""}</Text>
            <Text style={styles.detailCopy}>{passiveDetail ? battle[passiveDetail].ability?.description : ""}</Text>
            <Text style={styles.detailCopy}>{passiveDetail && battle[passiveDetail].armedDefenseTrap ? describeTrap(battle[passiveDetail].armedDefenseTrap!) : ""}</Text>
            <Pressable onPress={() => setPassiveDetail(null)} style={styles.powerChoice} accessibilityRole="button"><Text style={styles.specialText}>CLOSE</Text></Pressable>
          </View></View>
        </Modal>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  detailBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.75)" },
  detailPanel: { padding: 20, backgroundColor: "#10161c", borderWidth: 1, borderColor: "#17d9ff" },
  detailCopy: { color: "#fef1e0", fontSize: 14, lineHeight: 20, marginVertical: 10 },
  actionTicker: {
    alignItems: "center",
    marginHorizontal: 18,
    marginTop: -4,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 12,
    position: "relative",
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
    height: "100%",
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
    bottom: 40,
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
    marginTop: 6,
    marginBottom: 0,
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
    flex: 1,
    justifyContent: "center",
    marginBottom: 5,
    marginTop: 3,
    width: "100%",
  },
  cardMoveIcon: {
    height: 28,
    width: 54,
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
  abilityDock: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  abilityPanel: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 11,
    paddingVertical: 9,
    position: "relative",
  },
  abilityPanelEyebrow: {
    color: "#6b7280",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  abilityPanelName: {
    color: "#2fd9e9",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginTop: 3,
  },
  abilityPanelCopy: {
    color: "#9aa1ad",
    fontSize: 9,
    lineHeight: 13,
    marginTop: 3,
  },
  abilityPanelTrapName: {
    color: "#f0bf14",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginTop: 6,
  },
  cardBonusBadge: {
    backgroundColor: "#f0bf14",
    borderRadius: 4,
    bottom: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: "absolute",
  },
  cardBonusText: {
    color: "#050606",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  switchDock: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  switchChip: {
    backgroundColor: "#0b0d13",
    borderColor: "#3a3f4b",
    borderWidth: 1.5,
    flex: 1,
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  switchChipActive: {
    borderColor: "#f0bf14",
  },
  switchChipKo: {
    opacity: 0.35,
  },
  switchChipReady: {
    borderColor: "#17d9ff",
  },
  switchChipName: {
    color: "#ffffff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  switchChipMeta: {
    color: "#5a5f6b",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  switchChipMetaReady: {
    color: "#17d9ff",
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
    marginHorizontal: 18,
    marginTop: 0,
    marginBottom: 14,
    paddingBottom: 13,
    paddingHorizontal: 12,
    paddingTop: 13,
    position: "relative",
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
    width: 65,
  },
  abilityBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#0b0d13",
    borderRadius: 4,
    color: "#2fd9e9",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginTop: 3,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  abilityBadgeRight: {
    alignSelf: "flex-end",
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
  // The HUD stack can overflow the black band onto the yellow page, where
  // the old gold-on-yellow active state disappeared — the counter sits on
  // its own dark chip so it reads on any background.
  comboCounter: {
    alignSelf: "flex-start",
    backgroundColor: "#0b0d13",
    borderRadius: 4,
    color: "#8f8f86",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 3,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  comboCounterActive: {
    color: "#f0bf14",
  },
  comboCounterRight: {
    alignSelf: "flex-end",
    textAlign: "right",
  },
  cardCostText: {
    fontSize: 10,
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
  powerChoice: { minHeight: 44, minWidth: 88, paddingHorizontal: 6, justifyContent: "center", opacity: 0.55 },
  powerChoiceSelected: { opacity: 1, borderBottomWidth: 2, borderBottomColor: "#f0bf14" },
  cardRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  cardSlot: {
    alignItems: "center",
    flexBasis: "48%",
    flexGrow: 1,
    height: 112,
    justifyContent: "flex-start",
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingTop: 12,
  },
  cardFrame: {
    ...StyleSheet.absoluteFillObject,
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
    gap: 2,
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
    gap: 4,
    minHeight: 11,
  },
  hudBarTrack: {
    backgroundColor: "#1c1c1c",
    borderColor: "#0f0f0f",
    borderWidth: 1,
    height: 15,
    overflow: "hidden",
    width: "100%",
  },
  hudName: {
    color: "#fef1e0",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.3,
    marginBottom: 1,
  },
  hudNameRight: {
    textAlign: "right",
  },
  hudInfoStack: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  hudSide: {
    flex: 1,
    minWidth: 0,
  },
  hudStatLabel: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  hudStatValue: {
    color: "#fef1e0",
    flex: 1,
    fontSize: 8,
    fontWeight: "900",
  },
  roundCore: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 2,
    height: 62,
    justifyContent: "center",
    marginHorizontal: 4,
    width: 58,
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
    fontSize: 22,
    fontWeight: "900",
    marginTop: 0,
  },
  screen: {
    backgroundColor: "#10161c",
    flex: 1,
    paddingTop: 40,
  },
  topHud: {
    alignItems: "flex-start",
    backgroundColor: "#050606",
    flexDirection: "row",
    marginHorizontal: 0,
    paddingHorizontal: 8,
    paddingVertical: 8,
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
