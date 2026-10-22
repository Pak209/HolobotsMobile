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
import { FinisherReadinessChip, HOLOCITY_COMMANDS, HoloCityCommandBar, type HoloCityCommand } from "../HoloCityCommandBar";
import { HudActionStrip, HudRoundPlate } from "../duel/HoloHudArt";
import { finisherReadiness } from "../duel/liveDuelCommands";
import { FighterHud } from "../../screens/DuelPlaybackScreen";
import { HolobotAnimatedCharacter } from "../character/HolobotAnimatedCharacter";
import {
  hasHolobotAnimation,
  resolveHolobotAnimationState,
} from "../character/holobotAnimationAssets";
import { getActionSides, getCompletedVisualStates, type FighterVisualStates } from "./battleVisualStates";

import { ArenaCombatEngine } from "../../features/arena/combatEngine";
import { FINISHER_POLICY, type FinisherPower } from "../../features/arena/finisherPolicy";
/** Real moves only: at most 3 command cards plus the signature (when this battle has one). L7: no empty ghost slots. */
const COMMAND_SLOTS = 3;
/** The HoloCity plate each move type is drawn as (the lite's COMBO is HoloCity's HEAVY). */
const PLATE_ART: Record<CardType, NonNullable<HoloCityCommand["art"]>> = { strike: "strike", combo: "heavy", defense: "defend", finisher: "finisher" };
const fighterState = (fighter: BattleState["player"]) => ({ hp: fighter.currentHP, maxHp: fighter.maxHP, stamina: fighter.stamina, maxStamina: fighter.maxStamina });
/** L5: the Arena stage backdrop (the city park, as in city battles and duels), under a carbon scrim for HUD contrast. */
const ARENA_STAGE = require("../../../assets/battle/holocity-park.jpg");
const STAGE_SCRIM = `${theme.colors.carbon}B8`;
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
  /** PvP: the seat-snapshot levels (pvpFighterLevel), drawn as the fighter cards' LV corner tabs. */
  levels?: { player?: number; rival?: number };
};



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
  levels,
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
    const slots = playerCards.filter(card => card.type !== "finisher").slice(0, COMMAND_SLOTS).map(card => ({ card, signature: false }));
    // A City-issued CPU match has no signature move: no slot at all instead of an empty ghost card.
    if (!battle.hostSnapshot) slots.push({ card: ArenaCombatEngine.buildSignatureCard(battle.player, finisherPower), signature: true });
    return slots;
  }, [playerCards, battle.player, battle.hostSnapshot, finisherPower]);
  const abilitySides = (["player", "opponent"] as const).filter(side => !!battle[side].ability);

  const playerCanAct = playableCardIds.length > 0 && !isAnimating;
  const chainLength = battle.player.comboCounter;
  const playableFinisher = playerCards.find(
    (card) => card?.type === "finisher" && playableCardIds.includes(card.id),
  );
  const finisherReady = !battle.hostSnapshot && finisherAvailability.playable;
  const lastActionDamage = lastAction ? (lastAction.actualDamage ?? lastAction.damageDealt) : 0;
  const playerLevel = levels?.player ?? arenaFighterLevel(hostMatchReply, hostMatchId, "entrant", battle.player.name) ?? hostFighterLevel(undefined, "player", battle.player.name, hostLevelAccount);
  const rivalLevel = levels?.rival ?? arenaFighterLevel(hostMatchReply, hostMatchId, "opponent", battle.opponent.name);
  const deckHint = team?.entryLocked
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
              : "WAITING FOR STAMINA";
  // The strip shows the last action (as the park duel does); before the first one, or while entering, the bay's hint.
  const stripText = lastAction && !team?.entryLocked ? `${lastAction.card.name}${lastActionDamage > 0 ? ` · ${lastActionDamage} DMG` : ""}${getOutcomeLabel(lastAction)}` : deckHint;
  // Each move is drawn as the HoloCity plate of its type; availability, reasons and costs are the engine's, as before.
  const commands: HoloCityCommand[] = visibleCards.map(({ card, signature: isSignature }) => {
    const art = PLATE_ART[card.type];
    const plate = HOLOCITY_COMMANDS.find(command => command.id === art)!;
    const isPlayable = (isSignature ? !battle.hostSnapshot && finisherAvailability.playable : playableCardIds.includes(card.id)) && !team?.entryLocked;
    const reason = isSignature ? (finisherAvailability.playable ? null : finisherAvailability.reason === "stamina" ? `NEED ${finisherAvailability.staminaCost} STA` : finisherAvailability.reason === "special_meter" ? `NEED ${finisherAvailability.syncCost}% SYNC` : "NOT READY") : getAvailabilityLabel(cardAvailability[card.id], card);
    return {
      id: card.id, art, label: plate.label, accent: plate.accent, detail: card.name,
      cost: !isPlayable && reason ? reason : `${card.type === "defense" ? "NEED " : ""}${card.staminaCost} STA`,
      disabled: isAnimating || !isPlayable,
    };
  });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.screenContent, { paddingTop: embedded ? 0 : insets.top, paddingBottom: embedded ? 0 : insets.bottom }]} bounces={false}>
      <View pointerEvents="none" style={styles.backgroundAngles}>
        <Image source={ARENA_STAGE} style={styles.stageBackdrop} resizeMode="cover" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: STAGE_SCRIM }]} />
      </View>

      {/* lite-hud-row-1: the HoloCity fighter cards (round portrait, HP numbers, STA pips, LV corner tab) and the angled
          ROUND counter, shared with the park duel; passives, traps and the CPU bench sit under them. */}
      <View style={styles.topHud}>
        <View style={styles.fighterRow}>
          <FighterHud name={battle.player.name} state={fighterState(battle.player)} level={playerLevel} levelTab />
          {/* No round progress (PvP has none): the room's turn, as the park duel shows TURN; never an invented "OF 3". */}
          {roundProgress ? <HudRoundPlate testID="pvp-round" label="ROUND" value={String(roundProgress.currentRound).padStart(2, "0")} sub={`OF ${roundProgress.totalRounds}`} />
            : <HudRoundPlate testID="pvp-round" label="TURN" value={String(Math.max(1, battle.turnNumber)).padStart(2, "0")} />}
          <FighterHud name={battle.opponent.name} state={fighterState(battle.opponent)} level={rivalLevel} levelTab rival />
        </View>
        <View style={styles.statusRow}>
          {(["player", "opponent"] as const).map(side => {
            const fighter = battle[side], right = side === "opponent";
            return (
              <View key={side} style={[styles.statusSide, right ? styles.statusSideRight : null]}>
                {right && fighter.comboCounter > 0 ? <Text style={[styles.statusChip, styles.comboChip]}>{`COMBO ×${fighter.comboCounter}`}</Text> : null}
                {fighter.ability ? <Text numberOfLines={1} style={styles.statusChip}>{`◈ ${fighter.ability.name.toUpperCase()}`}</Text> : null}
                {fighter.armedDefenseTrap ? (
                  <Text numberOfLines={1} style={[styles.statusChip, styles.trapStatus]}>
                    {`⛨ ${fighter.armedDefenseTrap.name.toUpperCase()}${(fighter.armedDefenseTrap.charges ?? 1) > 1 ? " ×2" : ""}${(fighter.armedDefenseTrap.stackLevel ?? 0) > 0 ? ` ▲${fighter.armedDefenseTrap.stackLevel}` : ""}`}
                  </Text>
                ) : null}
                {right && team ? <BenchChips chips={team.opponentChips} align="right" /> : null}
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.battleStageWrap}>
        <View style={styles.battleStage}>
          <View style={styles.battleFloor}>
            <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 360 180" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
              <Path d="M18 124 L180 65 L342 124 L180 177 Z" fill={theme.plates.navy} fillOpacity={0.72} stroke={theme.colors.border} strokeWidth={1} />
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

      {/* lite-hud-row-1: the HoloCity command block, as the park duel draws it: the last-action strip, the hint line
          (COMBO · SYNC · finisher power · readiness chip) and ONE row of command plates. */}
      <View style={styles.commandDock}>
        <HudActionStrip testID="pvp-action-strip" text={stripText} />
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
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Text numberOfLines={1} style={[styles.switchChipName, { color: slotAccent(false, chip.index) }]}>
                      {chip.isKnockedOut ? `✕ ${chip.name}` : chip.name}
                    </Text>
                    <HostLevelBadge account={hostLevelAccount} name={chip.name} />
                  </View>
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
        <View style={styles.hint}>
          <Text numberOfLines={1} style={styles.hintText}>{`COMBO ×${battle.player.comboCounter} · ${Math.round(battle.player.specialMeter)}% SYNC`}</Text>
          {!battle.hostSnapshot && (["half", "full"] as const).map(power => (
            <Pressable key={power} accessibilityRole="button" accessibilityState={{ selected: finisherPower === power }}
              accessibilityLabel={`${power === "half" ? "Half" : "Full"} strength Finisher`}
              onPress={() => setFinisherPower(power)} style={styles.powerChoice}>
              <Text style={[styles.hintCaption, finisherPower === power ? styles.hintCaptionSelected : null]}>{`${FINISHER_POLICY[power].sync}% · ${FINISHER_POLICY[power].stamina} STA`}</Text>
            </Pressable>
          ))}
          {!battle.hostSnapshot ? <FinisherReadinessChip readiness={finisherReadiness(battle, true)} /> : null}
        </View>
        <HoloCityCommandBar compact commands={commands} onPress={(id) => {
          const slot = visibleCards.find(({ card }) => card.id === id);
          if (!slot) return;
          if (slot.signature) onSignaturePlay(finisherPower);
          else onCardPlay(slot.card.id);
        }} />

        {/* L2: a panel only for a fighter that actually has a passive; none at all for a City-issued CPU match. */}
        {abilitySides.length > 0 ? (
          <View style={styles.abilityDock}>
            {abilitySides.map(side => (
              <Pressable key={side} accessibilityRole="button" accessibilityLabel={`${battle[side].name} passive details`}
                onPress={() => setPassiveDetail(side)} style={styles.abilityPanel}>
                <GameSurfaceFrame accent={side === "player" ? theme.colors.accent : theme.colors.border} />
                <Text numberOfLines={1} style={styles.abilityPanelName}>{battle[side].name} · {battle[side].ability!.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
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
  detailBackdrop: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: theme.plates.overlay },
  detailPanel: { padding: 20, backgroundColor: theme.plates.navy, borderWidth: 1, borderColor: theme.colors.accent },
  detailCopy: { color: theme.colors.text, fontFamily: "HoloBody", fontSize: theme.type.body.fontSize, lineHeight: 20, marginVertical: 10 },
  stageBackdrop: { height: "100%", width: "100%" },
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
  battleStageWrap: { flex: 1, minHeight: 104, maxHeight: 300, marginHorizontal: 12, marginBottom: 6, },
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
    backgroundColor: theme.plates.overlay,
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
  powerChoice: { minHeight: 44, minWidth: 52, paddingHorizontal: 4, justifyContent: "center", alignItems: "center" },
  specialText: { color: theme.colors.warning, fontFamily: "HoloBody", fontSize: 11, fontWeight: "900", textAlign: "right", },
  screen: { backgroundColor: theme.colors.carbon, flex: 1, },
  topHud: { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  fighterRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  statusRow: { flexDirection: "row", gap: 8 },
  statusSide: { flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 4 },
  statusSideRight: { justifyContent: "flex-end" },
  statusChip: { ...theme.type.micro, overflow: "hidden", maxWidth: "100%", backgroundColor: theme.hud.frameFill, borderRadius: theme.radius.sm, color: theme.colors.accent, fontSize: 9, letterSpacing: 0.5, paddingHorizontal: 6, paddingVertical: 3 },
  comboChip: { color: theme.colors.warning },
  trapStatus: { color: theme.colors.text },
  /** The park duel's bottom block (LiveDuelStage: 14 pt side inset, the hint line ≥ 44 pt). */
  commandDock: { flexShrink: 0, marginHorizontal: 14, marginBottom: 8 },
  hint: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, minHeight: 44, marginVertical: 4, paddingLeft: 10, paddingRight: 4, backgroundColor: theme.hud.frameFill, borderRadius: theme.radius.sm },
  hintText: { ...theme.type.micro, flex: 1, color: theme.colors.text, fontSize: 10 },
  hintCaption: { ...theme.type.micro, color: theme.colors.accent, fontSize: 10 },
  hintCaptionSelected: { color: theme.colors.warning },
  vsBadge: { alignItems: "center", backgroundColor: theme.plates.keycap, borderColor: theme.colors.border, borderWidth: 1, height: 30, justifyContent: "center", position: "absolute", top: "48%", width: 34, zIndex: 3, },
  vsText: { color: theme.colors.subtle, fontFamily: "HoloDisplay", fontSize: 14, },
});
