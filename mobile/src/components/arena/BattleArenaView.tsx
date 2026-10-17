import { arenaFighterLevel } from "@/lib/bots/arenaFighterLevel";
import { hostFighterLevel, levelBadge } from "@/lib/bots/hostFighterLevel";
import { slotAccent, theme } from "@/theme";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Ellipse, Path } from "react-native-svg";

import type { ActionCard, ArmedDefenseTrap, BattleAction, BattleState, CardType } from "../../types/arena";
import type { ArenaCardAvailability } from "../../features/arena/arenaCards";
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
const arenaMoveIcons: Record<CardType, number> = {
  strike: require("../../../assets/game/arena-moves/strike.png"),
  defense: require("../../../assets/game/arena-moves/defend.png"),
  combo: require("../../../assets/game/arena-moves/combo.png"),
  finisher: require("../../../assets/game/arena-moves/finisher.png"),
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
  /** Verified host account only; never local profile or rival samples. */
  hostLevelAccount?: unknown;
  /** Already-admitted #118 host reply; never a local combat/PvP record. */
  hostMatchReply?: unknown;
  hostMatchId?: string;
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
  /** Parent already supplies safe-area padding (for example, the city rival flow). */
  embedded?: boolean;
};

function getCardColors(type: CardType) {
  switch (type) {
    case "combo":
      return { accent: theme.colors.accent };
    case "strike":
      return { accent: theme.colors.danger };
    case "defense":
      return { accent: theme.colors.blue };
    case "finisher":
      return { accent: theme.colors.warning };
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

  const effect = card.type === "finisher" ? "SIGNATURE" : card.baseDamage > 0 ? `${card.baseDamage} DMG` : card.type === "defense" ? "BLOCK" : "UTILITY";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.name}, ${card.staminaCost} stamina, ${effect}${reasonLabel ? `, ${reasonLabel}` : ""}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.cardSlot, { opacity: isPlayable ? 1 : 0.65 }]}
    >
      <GameSurfaceFrame accent={colors.accent} fill={theme.plates.keycap} />
      <View style={styles.cardHeading}>
        <Text numberOfLines={1} style={[styles.cardTypeLabel, { color: colors.accent }]}>{getCardLabel(card.type)}</Text>
        <Text style={styles.cardCostText}>{card.type === "defense" ? "NEED " : ""}{card.staminaCost} STA</Text>
      </View>
      <View style={styles.cardBody}>
        <Image accessibilityIgnoresInvertColors resizeMode="contain" source={arenaMoveIcons[card.type]} style={[styles.cardMoveIcon, { tintColor: colors.accent }]} />
        <View style={styles.cardCopy}>
          <Text numberOfLines={1} style={styles.cardName}>{card.name}</Text>
          <Text style={[styles.cardDamage, { color: colors.accent }]}>{effect}</Text>
        </View>
      </View>
      <Text numberOfLines={1} style={[styles.cardReasonText, bonusLabel ? { color: theme.colors.warning } : null]}>{reasonLabel ?? bonusLabel ?? (isPlayable ? "READY" : "WAITING")}</Text>
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
            { borderColor: slotAccent(align === "right", chip.index) },
          ]}
        >
          <Text numberOfLines={1} style={[styles.benchChipName, { color: slotAccent(align === "right", chip.index) }]}>
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

function HostLevelBadge({ account, name, issuedLevel }: { account?: unknown; name: string; issuedLevel?: number }) {
  const label = levelBadge(issuedLevel ?? hostFighterLevel(undefined, 'player', name, account));
  return label ? <Text style={{ ...theme.type.micro, fontSize: 14, backgroundColor: theme.colors.carbon, color: theme.colors.text, paddingHorizontal: 4, paddingVertical: 2 }}>{label}</Text> : null;
}

export function BattleArenaView({
  battle,
  hostLevelAccount,
  hostMatchReply,
  hostMatchId,
  roundProgress,
  playerCards,
  playableCardIds,
  cardAvailability,
  lastAction,
  isAnimating,
  onCardPlay,
  onSignaturePlay,
  team,
  embedded = false,
}: BattleArenaViewProps) {
  const [transientVisualStates, setTransientVisualStates] = useState<FighterVisualStates>({
    player: "idle",
    opponent: "idle",
  });
  const insets = useSafeAreaInsets();
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
    slots.push(battle.hostSnapshot ? undefined as never : ArenaCombatEngine.buildSignatureCard(battle.player, finisherPower));
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
  const finisherReady = !battle.hostSnapshot && finisherAvailability.playable;
  const lastActionDamage = lastAction ? (lastAction.actualDamage ?? lastAction.damageDealt) : 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.screenContent, { paddingTop: embedded ? 0 : insets.top, paddingBottom: embedded ? 0 : insets.bottom }]} bounces={false}>
      <View style={styles.backgroundAngles}>
        <View style={styles.angleOne} />
        <View style={styles.angleTwo} />
        <View style={styles.angleThree} />
      </View>

      <View style={styles.topHud}>
        <View style={styles.hudSide}>
          <View style={styles.hudInfoStack}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Text numberOfLines={1} style={styles.hudName}>{battle.player.name}</Text><HostLevelBadge account={hostLevelAccount} name={battle.player.name} issuedLevel={arenaFighterLevel(hostMatchReply, hostMatchId, "entrant", battle.player.name)} /></View>
            <HudBar
              color={theme.colors.success}
              label="HP"
              percent={playerHealthPercent}
              value={`${battle.player.currentHP} / ${battle.player.maxHP}`}
            />
            <HudBar
              color={theme.colors.accent}
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
            <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4 }}><Text numberOfLines={1} style={[styles.hudName, styles.hudNameRight]}>{battle.opponent.name}</Text><HostLevelBadge name={battle.opponent.name} issuedLevel={arenaFighterLevel(hostMatchReply, hostMatchId, "opponent", battle.opponent.name)} /></View>
            <HudBar
              align="right"
              color={theme.colors.danger}
              label="HP"
              percent={opponentHealthPercent}
              value={`${battle.opponent.currentHP} / ${battle.opponent.maxHP}`}
            />
            <HudBar
              align="right"
              color={theme.colors.accent}
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
            <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 360 180" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
              <Path d="M18 124 L180 65 L342 124 L180 177 Z" fill={theme.plates.navy} stroke={theme.colors.border} strokeWidth={1} />
              <Path d="M58 138 L220 79 M99 151 L261 94 M139 164 L301 109 M58 109 L220 164 M99 94 L261 151 M139 79 L301 138" fill="none" stroke={theme.colors.border} strokeOpacity={0.5} strokeWidth={0.7} />
              <Path d="M18 124 L180 177 L342 124 M18 130 L180 183 L342 130" fill="none" stroke={theme.colors.accent} strokeOpacity={0.5} strokeWidth={1} />
              <Ellipse cx={100} cy={126} rx={42} ry={15} fill="none" stroke={slotAccent(false, team?.playerChips.find(chip => chip.isActive)?.index ?? 0)} strokeWidth={2} />
              <Ellipse cx={260} cy={126} rx={42} ry={15} fill="none" stroke={slotAccent(true, team?.opponentChips.find(chip => chip.isActive)?.index ?? 0)} strokeWidth={2} />
            </Svg>
            <View pointerEvents="none" style={styles.fighterOverlay}>
              <Animated.View
                style={[styles.stageFighter, styles.stageFighterLeft, { transform: [{ translateX: playerLunge }] }]}
              >
                {hasHolobotAnimation(battle.player.name, "arena") ? (
                  <HolobotAnimatedCharacter
                    animationState={resolveHolobotAnimationState(battle.player.name, "arena", visualStates.player)}
                    context="arena"
                    holobotId={battle.player.name}
                    staticFallback={typeof battle.player.avatar === "string" ? { uri: battle.player.avatar } : battle.player.avatar}
                    style={StyleSheet.absoluteFill}
                  />
                ) : (
                  <Image
                    source={typeof battle.player.avatar === "string" ? { uri: battle.player.avatar } : battle.player.avatar}
                    style={styles.stageFighterImage}
                    resizeMode="contain"
                  />
                )}
                <Animated.Image
                  resizeMode="contain"
                  source={typeof battle.player.avatar === "string" ? { uri: battle.player.avatar } : battle.player.avatar}
                  style={[
                    StyleSheet.absoluteFill,
                    { opacity: playerFlash, tintColor: theme.colors.danger },
                  ]}
                />
              </Animated.View>
              <Animated.View
                style={[styles.stageFighter, styles.stageFighterRight, { transform: [{ translateX: opponentLunge }] }]}
              >
                {hasHolobotAnimation(battle.opponent.name, "arena") ? (
                  <HolobotAnimatedCharacter
                    animationState={resolveHolobotAnimationState(battle.opponent.name, "arena", visualStates.opponent)}
                    context="arena"
                    holobotId={battle.opponent.name}
                    staticFallback={typeof battle.opponent.avatar === "string" ? { uri: battle.opponent.avatar } : battle.opponent.avatar}
                    style={[StyleSheet.absoluteFill, styles.stageFighterImageMirrored]}
                  />
                ) : (
                  <Image
                    source={typeof battle.opponent.avatar === "string" ? { uri: battle.opponent.avatar } : battle.opponent.avatar}
                    style={[styles.stageFighterImage, styles.stageFighterImageMirrored]}
                    resizeMode="contain"
                  />
                )}
                <Animated.Image
                  resizeMode="contain"
                  source={typeof battle.opponent.avatar === "string" ? { uri: battle.opponent.avatar } : battle.opponent.avatar}
                  style={[
                    StyleSheet.absoluteFill,
                    styles.stageFighterImageMirrored,
                    { opacity: opponentFlash, tintColor: theme.colors.danger },
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
          <GameSurfaceFrame accent={theme.colors.accent} />
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
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Text style={styles.sendInName}>{chip.name}</Text><HostLevelBadge account={hostLevelAccount} name={chip.name} /></View>
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
        <GameSurfaceFrame accent={theme.colors.accent} strong />
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
                    { borderColor: slotAccent(false, chip.index) },
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>                  <Text numberOfLines={1} style={[styles.switchChipName, { color: slotAccent(false, chip.index) }]}>
                    {chip.isKnockedOut ? `✕ ${chip.name}` : chip.name}
                  </Text><HostLevelBadge account={hostLevelAccount} name={chip.name} /></View>
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
          <View style={styles.specialGaugeGroup}>
            <Text style={styles.meterLabel}>{Math.round(battle.player.specialMeter)}% SYNC</Text>
          <View style={styles.specialGaugeTrack}>
            <View style={[styles.specialGaugeFill, { width: `${playerSpecialPercent * 100}%` }]} />
            <View
              style={[
                styles.specialGaugeUnlockTick,
                { left: `${FINISHER_POLICY.half.sync}%` },
              ]}
            />
          </View>
          </View>
          <View style={styles.specialCluster}>
            {!battle.hostSnapshot && (["half", "full"] as const).map(power => (
              <Pressable key={power} accessibilityRole="button" accessibilityState={{ selected: finisherPower === power }}
                accessibilityLabel={`${power === "half" ? "Half" : "Full"} strength Finisher`}
                onPress={() => setFinisherPower(power)} style={[styles.powerChoice, finisherPower === power ? styles.powerChoiceSelected : null]}>
                <Text style={styles.specialText}>{`${FINISHER_POLICY[power].sync}% · ${FINISHER_POLICY[power].stamina} STA`}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.cardBayHeader}>
          <Text numberOfLines={1} style={styles.deckHint}>
            {team?.entryLocked
              ? "ENTERING THE ARENA…"
              : isAnimating
                ? "RESOLVING MOVE…"
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
            const isPlayable = !!card && (isSignature ? !battle.hostSnapshot && finisherAvailability.playable : playableCardIds.includes(card.id)) && !team?.entryLocked;
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
              disabled={!!battle.hostSnapshot} onPress={() => setPassiveDetail(side)} style={styles.abilityPanel}>
              <GameSurfaceFrame accent={side === "player" ? theme.colors.accent : theme.colors.border} />
              <Text numberOfLines={1} style={styles.abilityPanelName}>{battle[side].name} · {battle[side].ability?.name ?? (battle.hostSnapshot ? "EXTRAS UNAVAILABLE" : "Combat routine")}</Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenContent: { flexGrow: 1 },
  cardHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 4 },
  cardBody: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardCopy: { flex: 1, minWidth: 0 },
  specialGaugeGroup: { flex: 1, gap: 5 },
  meterLabel: { ...theme.type.micro, color: theme.colors.warning },
  detailBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.75)" },
  detailPanel: { padding: 20, backgroundColor: theme.plates.navy, borderWidth: 1, borderColor: theme.colors.accent },
  detailCopy: { color: theme.colors.text, fontFamily: "HoloBody", fontSize: theme.type.body.fontSize, lineHeight: 20, marginVertical: 10 },
  actionTicker: { alignItems: "center", marginHorizontal: 12, marginBottom: 6, minHeight: 28, justifyContent: "center", paddingHorizontal: 8, position: "relative", },
  actionTickerText: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
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
  battleFloor: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    position: "relative",
    width: "100%",
  },
  fighterOverlay: { bottom: "22%", left: 0, position: "absolute", right: 0, top: 0, zIndex: 2, },
  battleStage: { flex: 1, alignItems: "center", minHeight: 104, position: "relative", width: "100%", },
  battleStageWrap: { flex: 1, minHeight: 104, maxHeight: 240, marginHorizontal: 12, marginBottom: 6, },
  stageFighter: { alignItems: "center", bottom: 0, height: "100%", maxHeight: 160, justifyContent: "flex-end", position: "absolute", width: "34%", },
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
  cardMoveIcon: { height: 28, width: 28, },
  benchBarTrack: { backgroundColor: theme.plates.keycap, height: 3, marginTop: 3, overflow: "hidden", },
  benchChip: { backgroundColor: theme.plates.navy, borderColor: theme.colors.border, borderWidth: 1, minWidth: 0, flex: 1, padding: 3, },
  benchChipActive: {
    borderColor: theme.colors.accent,
  },
  benchChipKo: {
    opacity: 0.35,
  },
  benchChipName: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  benchHpFill: { backgroundColor: theme.colors.success, height: "100%", },
  abilityDock: { flexDirection: "row", gap: 8, marginTop: 8, },
  abilityPanel: { flex: 1, minHeight: 44, paddingHorizontal: 8, paddingVertical: 6, justifyContent: "center", position: "relative", },
  abilityPanelName: { color: theme.colors.accent, fontFamily: "HoloBody", fontSize: 10, },
  switchDock: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  switchChip: {
    backgroundColor: theme.plates.navy,
    borderColor: theme.colors.border,
    borderWidth: 1.5,
    flex: 1,
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  switchChipActive: {
    borderColor: theme.colors.accent,
  },
  switchChipKo: {
    opacity: 0.35,
  },
  switchChipReady: {
    borderColor: theme.colors.accent,
  },
  switchChipName: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  switchChipMeta: { color: theme.colors.muted, fontFamily: "HoloBody", fontSize: 9, letterSpacing: 0.4, },
  switchChipMetaReady: {
    color: theme.colors.accent,
  },
  benchMeterFill: {
    backgroundColor: theme.colors.accent,
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
    backgroundColor: theme.plates.navy,
    borderColor: theme.colors.accent,
    borderWidth: 1.5,
    marginHorizontal: 14,
    marginTop: 8,
    paddingVertical: 8,
  },
  sendInBannerText: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  sendInCard: {
    backgroundColor: theme.plates.navy,
    borderColor: theme.colors.accent,
    borderWidth: 2,
    padding: 18,
    width: "86%",
  },
  sendInEyebrow: {
    color: theme.colors.danger,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  sendInMeta: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "700",
    marginTop: 4,
  },
  sendInName: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: "900",
  },
  sendInOption: {
    borderColor: theme.colors.accent,
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
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "900",
    marginTop: 4,
  },
  cardBay: { flexShrink: 0, marginHorizontal: 12, marginBottom: 8, padding: 10, position: "relative", },
  cardBayHeader: { alignItems: "center", flexDirection: "row", marginBottom: 6, minHeight: 14, },
  cardBayTopBar: { alignItems: "center", flexDirection: "row", gap: 10, marginBottom: 4, },
  abilityBadge: {
    alignSelf: "flex-start",
    backgroundColor: theme.plates.navy,
    borderRadius: 4,
    color: theme.colors.accent,
    fontFamily: "HoloBody",
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
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  // Combo state retains its own plate beside the HP/stamina telemetry.
  comboCounter: {
    alignSelf: "flex-start",
    backgroundColor: theme.plates.navy,
    borderRadius: 4,
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: theme.type.micro.fontSize,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 3,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  comboCounterActive: {
    color: theme.colors.accent,
  },
  comboCounterRight: {
    alignSelf: "flex-end",
    textAlign: "right",
  },
  cardCostText: { fontFamily: "HoloBody", fontSize: 10, color: theme.colors.muted, },
  cardDamage: { fontFamily: "HoloBody", fontSize: 10, lineHeight: 14, },
  cardName: { color: theme.colors.text, fontFamily: "HoloDisplay", fontSize: 16, lineHeight: 19, },
  cardReasonText: { color: theme.colors.muted, fontFamily: "HoloBody", fontSize: 9, lineHeight: 12, letterSpacing: 0.3, },
  powerChoice: { minHeight: 44, minWidth: 78, paddingHorizontal: 4, justifyContent: "center", opacity: 0.55, },
  powerChoiceSelected: { opacity: 1, borderBottomWidth: 2, borderBottomColor: theme.colors.accent },
  cardRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, },
  cardSlot: { flexBasis: "48%", flexGrow: 1, minWidth: 0, minHeight: 88, paddingHorizontal: 9, paddingVertical: 7, gap: 3, },
  cardSlotEmpty: {
    backgroundColor: theme.colors.carbon,
    borderColor: theme.colors.carbon,
  },
  cardTypeLabel: { fontFamily: "HoloBody", fontSize: 10, fontWeight: "900", letterSpacing: 0.7, },
  deckHint: { color: theme.colors.muted, flex: 1, fontFamily: "HoloBody", fontSize: 9, letterSpacing: 0.2, },
  emptyCardCore: {
    backgroundColor: theme.colors.carbon,
    borderColor: "#282828",
    borderRadius: 10,
    borderWidth: 2,
    height: "82%",
    marginTop: 12,
    width: "72%",
  },
  specialCluster: { alignItems: "center", flexDirection: "row", gap: 4, },
  specialGaugeFill: { backgroundColor: theme.colors.warning, height: "100%", },
  specialGaugeTrack: { backgroundColor: theme.plates.keycap, height: 8, overflow: "hidden", },
  specialGaugeUnlockTick: {
    backgroundColor: theme.plates.navy,
    bottom: 0,
    position: "absolute",
    top: 0,
    width: 2,
  },
  specialText: { color: theme.colors.warning, fontFamily: "HoloBody", fontSize: 11, fontWeight: "900", textAlign: "right", },
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
  hudBarTrack: { backgroundColor: theme.plates.keycap, height: 8, overflow: "hidden", width: "100%", },
  hudName: { color: theme.colors.text, fontFamily: "HoloDisplay", fontSize: 17, letterSpacing: 0.4, marginBottom: 2, },
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
  hudStatLabel: { fontFamily: "HoloBody", fontSize: 9, letterSpacing: 0.35, },
  hudStatValue: { color: theme.colors.text, flex: 1, fontFamily: "HoloBody", fontSize: 9, },
  roundCore: { alignItems: "center", backgroundColor: theme.plates.navy, borderColor: theme.colors.border, borderWidth: 1, height: 60, justifyContent: "center", marginHorizontal: 8, width: 54, },
  roundLabel: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  roundSubtext: { color: theme.colors.muted, fontFamily: "HoloBody", fontSize: 8, letterSpacing: 0.8, },
  roundValue: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.header.fontSize,
    fontWeight: "900",
    marginTop: 0,
  },
  screen: { backgroundColor: theme.colors.carbon, flex: 1, },
  topHud: { alignItems: "flex-start", flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, },
  vsBadge: { alignItems: "center", backgroundColor: theme.plates.keycap, borderColor: theme.colors.border, borderWidth: 1, height: 30, justifyContent: "center", position: "absolute", top: "48%", width: 34, zIndex: 3, },
  vsText: { color: theme.colors.subtle, fontFamily: "HoloDisplay", fontSize: 14, },
});
