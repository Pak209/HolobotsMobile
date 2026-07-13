import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { mergeHolobotRoster } from "@/config/holobots";
import { getSpecialMeterSegments, SPECIAL_METER_SEGMENTS } from "@/features/arena/moveKits";
import {
  isDocKnockedOut,
  livingBenchIndexes,
  TEAM_SIZE,
} from "@/features/arena/pvpTeamBattle";
import { useRealtimeArena } from "@/hooks/useRealtimeArena";
import type { ArenaCardAvailability } from "@/features/arena/arenaCards";
import type { ActionCard, CardType } from "@/types/arena";
import type { BattleMode, PlayerRole, PvpFighterDoc } from "@/types/battle-room";
import type { UserHolobot } from "@/types/profile";

type PvpArenaModalProps = {
  onClose: () => void;
  userHolobots: UserHolobot[];
  visible: boolean;
};

function cardColors(type: CardType) {
  switch (type) {
    case "strike":
      return { bg: "#7f1d1d", border: "#ef4444", text: "#fca5a5" };
    case "defense":
      return { bg: "#15365f", border: "#3b82f6", text: "#93c5fd" };
    case "combo":
      return { bg: "#4c1d95", border: "#8b5cf6", text: "#c4b5fd" };
    case "finisher":
      return { bg: "#713f12", border: "#f59e0b", text: "#fcd34d" };
  }
}

function PlayerMeters({ label, player }: { label: string; player: PvpFighterDoc }) {
  const hpPercent = player.maxHP > 0 ? Math.max(0, Math.min(100, (player.currentHP / player.maxHP) * 100)) : 0;
  const staminaPercent = player.maxStamina > 0 ? Math.max(0, Math.min(100, (player.stamina / player.maxStamina) * 100)) : 0;

  return (
    <View style={styles.meterPanel}>
      <View style={styles.meterHeader}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={styles.meterName}>{player.username || "Waiting"}</Text>
      </View>
      <Text style={styles.meterBot}>
        {player.holobotName
          ? `${player.holobotName} Lv ${player.level} • COMBO ×${player.comboCounter}${
              player.armedDefenseTrap
                ? ` • ⛨ ${player.armedDefenseTrap.name.toUpperCase()}${(player.armedDefenseTrap.charges ?? 1) > 1 ? " ×2" : ""}`
                : ""
            }`
          : "No pilot connected"}
      </Text>

      <View style={styles.meterRow}>
        <Text style={styles.meterCaption}>HP</Text>
        <View style={styles.barTrack}>
          <View style={[styles.hpFill, { width: `${hpPercent}%` }]} />
        </View>
        <Text style={styles.meterValue}>{`${player.currentHP}/${player.maxHP}`}</Text>
      </View>

      <View style={styles.meterRow}>
        <Text style={styles.meterCaption}>STA</Text>
        <View style={styles.barTrack}>
          <View style={[styles.staminaFill, { width: `${staminaPercent}%` }]} />
        </View>
        <Text style={styles.meterValue}>{`${player.stamina}/${player.maxStamina}`}</Text>
      </View>

      <View style={styles.meterRow}>
        <Text style={styles.meterCaption}>✦</Text>
        <View style={styles.barTrack}>
          <View style={[styles.specialFill, { width: `${player.specialMeter}%` }]} />
        </View>
        <Text style={styles.meterValue}>
          {`${getSpecialMeterSegments(player.specialMeter)}/${SPECIAL_METER_SEGMENTS}`}
        </Text>
      </View>
    </View>
  );
}

function reasonLabel(availability?: ArenaCardAvailability): string | null {
  if (!availability || availability.playable) return null;
  switch (availability.reason) {
    case "cooldown":
      return `CD ${availability.cooldownTurns ?? "?"}`;
    case "stamina":
      return "LOW STA";
    case "combo":
      return "NEEDS COMBO";
    case "special_meter":
      return "NEEDS METER";
    case "defense_lock":
      return "LOCKED";
    default:
      return "LOCKED";
  }
}

function BattleCard({
  card,
  availability,
  onPlay,
}: {
  card: ActionCard;
  availability?: ArenaCardAvailability;
  onPlay: (moveId: string) => void;
}) {
  const colors = cardColors(card.type);
  const disabled = availability ? !availability.playable : false;

  return (
    <Pressable
      disabled={disabled}
      onPress={() => onPlay(card.id)}
      style={[styles.battleCard, { backgroundColor: colors.bg, borderColor: colors.border, opacity: disabled ? 0.45 : 1 }]}
    >
      <View style={styles.cardCost}>
        <Text style={styles.cardCostText}>{card.staminaCost}</Text>
      </View>
      <Text style={[styles.cardType, { color: colors.text }]}>{card.type === "defense" ? "DEFEND" : card.type.toUpperCase()}</Text>
      <Text numberOfLines={2} style={styles.cardName}>{card.name}</Text>
      {card.baseDamage > 0 ? <Text style={styles.cardDamage}>{card.baseDamage} DMG</Text> : <Text style={styles.cardDamage}>BLOCK</Text>}
      <Text style={styles.cardPlay}>{disabled ? (reasonLabel(availability) ?? "LOCKED") : "PLAY"}</Text>
    </Pressable>
  );
}

function TeamDock({
  side,
  activeDoc,
  label,
  switchReadyAt,
  onSwitch,
  disabled,
}: {
  side: { members: PvpFighterDoc[]; activeIndex: number };
  activeDoc: PvpFighterDoc | null;
  label: string;
  switchReadyAt?: number;
  onSwitch?: (index: number) => void;
  disabled?: boolean;
}) {
  const now = Date.now();
  const coolingDown = switchReadyAt !== undefined && now < switchReadyAt;

  return (
    <View style={styles.teamDock}>
      <Text style={styles.teamDockLabel}>
        {label}
        {coolingDown ? ` • CD ${Math.max(1, Math.ceil((switchReadyAt! - now) / 1000))}s` : ""}
      </Text>
      <View style={styles.teamDockRow}>
        {side.members.map((member, index) => {
          const isActive = index === side.activeIndex;
          // The live doc is authoritative for the active slot.
          const shown = isActive && activeDoc ? activeDoc : member;
          const down = isDocKnockedOut(shown);
          const tappable = !!onSwitch && !disabled && !isActive && !down && !coolingDown;
          const hpPct = Math.max(0, Math.min(1, shown.currentHP / Math.max(1, shown.maxHP)));

          return (
            <Pressable
              key={index}
              disabled={!tappable}
              onPress={() => onSwitch?.(index)}
              style={[
                styles.teamDockChip,
                isActive ? styles.teamDockChipActive : null,
                down ? styles.teamDockChipKo : null,
                tappable ? styles.teamDockChipReady : null,
              ]}
            >
              <Text numberOfLines={1} style={styles.teamDockChipName}>
                {down ? `✕ ${shown.holobotName}` : shown.holobotName}
              </Text>
              <View style={styles.teamDockBar}>
                <View style={[styles.teamDockHp, { width: `${Math.round(hpPct * 100)}%` }]} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function PvpArenaModal({ onClose, userHolobots, visible }: PvpArenaModalProps) {
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  // Which slot the picker fills: the 1v1 fighter, or a 3v3 team slot.
  const [pickerTarget, setPickerTarget] = useState<"main" | 0 | 1 | 2 | null>(null);
  const [mode, setMode] = useState<BattleMode>("1v1");
  const [teamNames, setTeamNames] = useState<Array<string | null>>([null, null, null]);
  const [joinCode, setJoinCode] = useState("");
  const {
    cancelMatchmaking,
    canFireSignature,
    createRoom,
    enterMatchmaking,
    error,
    joinRoom,
    leaveRoom,
    loading,
    matchmakingStatus,
    moveAvailability,
    myRole,
    opponentRole,
    playMove,
    room,
    sendIn,
    switchActive,
    useSignature: fireSignature,
  } = useRealtimeArena();

  const roster = useMemo(
    () => mergeHolobotRoster(userHolobots).filter((holobot) => holobot.owned),
    [userHolobots],
  );
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];
  const canField3v3 = roster.length >= TEAM_SIZE;
  const teamComplete = teamNames.every(Boolean) && new Set(teamNames).size === TEAM_SIZE;
  const lineupReady = mode === "3v3" ? teamComplete : !!selectedHolobot;

  useEffect(() => {
    if (error) {
      Alert.alert("PvP Sync", error);
    }
  }, [error]);

  useEffect(() => {
    if (!visible) {
      setJoinCode("");
      void leaveRoom();
    }
  }, [leaveRoom, visible]);

  const lineupNames = (): string[] => {
    if (mode === "3v3") {
      if (!teamComplete) {
        throw new Error("Pick three different Holobots for 3v3.");
      }
      return teamNames as string[];
    }
    if (!selectedHolobot) {
      throw new Error("Choose a Holobot before entering PvP.");
    }
    return [selectedHolobot.name];
  };

  const handleClose = async () => {
    await leaveRoom();
    onClose();
  };

  const handleCreateRoom = async () => {
    try {
      await createRoom(lineupNames(), mode);
    } catch (createError: any) {
      Alert.alert("Create Room Failed", createError.message || "Unable to create a room.");
    }
  };

  const handleJoinRoom = async () => {
    try {
      if (!joinCode.trim()) {
        Alert.alert("Room Code Needed", "Enter a room code to join a private PVP arena.");
        return;
      }
      await joinRoom(joinCode.trim().toUpperCase(), lineupNames());
    } catch (joinError: any) {
      Alert.alert("Join Room Failed", joinError.message || "Unable to join the room.");
    }
  };

  const handleQuickMatch = async () => {
    try {
      await enterMatchmaking(lineupNames(), mode);
    } catch (matchError: any) {
      Alert.alert("Quick Match Failed", matchError.message || "Unable to enter matchmaking.");
    }
  };

  const handleSwitch = async (index: number) => {
    try {
      await switchActive(index);
    } catch (switchError: any) {
      Alert.alert("Switch Locked", switchError.message || "You cannot switch right now.");
    }
  };

  const handleSendIn = async (index: number) => {
    try {
      await sendIn(index);
    } catch (sendInError: any) {
      Alert.alert("Send-In", sendInError.message || "That Holobot cannot be sent in.");
    }
  };

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

  const handlePlayMove = async (moveId: string) => {
    try {
      await playMove(moveId);
    } catch (playError: any) {
      Alert.alert("Move Locked", playError.message || "That move cannot be used yet.");
    }
  };

  const handleSignature = async () => {
    try {
      await fireSignature();
    } catch (signatureError: any) {
      Alert.alert("Signature Not Ready", signatureError.message || "Charge the special meter to 7/7 first.");
    }
  };

  const myPlayer = room && myRole ? room.players[myRole] : null;
  const opponent = room && opponentRole ? room.players[opponentRole as PlayerRole] : null;
  const isWaiting = room?.status === "waiting";
  const isComplete = room?.status === "completed";
  const isTeamRoom = room?.mode === "3v3" && !!room.teams;
  const mySide = isTeamRoom && myRole ? room!.teams![myRole] : null;
  const opponentSide = isTeamRoom && opponentRole ? room!.teams![opponentRole as PlayerRole] : null;
  const awaitingMySendIn =
    isTeamRoom && room?.phase === "awaiting_send_in" && room.pendingSendInRole === myRole;
  const awaitingOpponentSendIn =
    isTeamRoom && room?.phase === "awaiting_send_in" && room.pendingSendInRole !== myRole;
  const switchReadyAt = mySide?.switchCooldownUntil ?? 0;

  return (
    <>
      <Modal animationType="fade" presentationStyle="overFullScreen" transparent visible={visible} onRequestClose={handleClose}>
        <View style={styles.backdrop}>
          <View style={[styles.card, room && styles.battleShell]}>
            <View style={styles.topRow}>
              <View>
                <Text style={styles.eyebrow}>PVP ARENA</Text>
                <Text style={styles.title}>{room ? "Synced Battle" : "Battle Other Pilots"}</Text>
              </View>
              <Pressable style={styles.closeChip} onPress={handleClose}>
                <Text style={styles.closeChipText}>X</Text>
              </Pressable>
            </View>

            {!room ? (
              <>
                <View style={styles.modeRow}>
                  {(["1v1", "3v3"] as const).map((candidate) => (
                    <Pressable
                      key={candidate}
                      disabled={candidate === "3v3" && !canField3v3}
                      onPress={() => setMode(candidate)}
                      style={[
                        styles.modeButton,
                        mode === candidate ? styles.modeButtonActive : null,
                        candidate === "3v3" && !canField3v3 ? styles.modeButtonDisabled : null,
                      ]}
                    >
                      <Text style={[styles.modeButtonText, mode === candidate ? styles.modeButtonTextActive : null]}>
                        {candidate === "1v1" ? "1V1 DUEL" : "3V3 SHOWDOWN"}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {mode === "3v3" ? (
                  <View style={styles.teamRow}>
                    {teamNames.map((name, index) => {
                      const entry = name ? roster.find((holobot) => holobot.name === name) ?? null : null;
                      return (
                        <Pressable
                          key={index}
                          onPress={() => setPickerTarget(index as 0 | 1 | 2)}
                          style={[styles.teamSlot, name ? styles.teamSlotFilled : null]}
                        >
                          <Text style={styles.teamSlotLabel}>{index === 0 ? "LEAD" : `BENCH ${index}`}</Text>
                          {entry ? (
                            <>
                              <Image source={entry.imageSource} style={styles.teamSlotArt} resizeMode="contain" />
                              <Text numberOfLines={1} style={styles.teamSlotName}>{entry.name}</Text>
                            </>
                          ) : (
                            <Text style={styles.teamSlotName}>TAP TO PICK</Text>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : selectedHolobot ? (
                  <Pressable onPress={() => setPickerTarget("main")} style={styles.holobotBar}>
                    <Image source={selectedHolobot.imageSource} style={styles.holobotArt} resizeMode="contain" />
                    <View style={styles.holobotBody}>
                      <Text style={styles.holobotName}>{selectedHolobot.name}</Text>
                      <Text style={styles.holobotMeta}>{`Lv ${selectedHolobot.level} - Tap to change Holobot`}</Text>
                    </View>
                  </Pressable>
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyTitle}>No Holobots Ready</Text>
                    <Text style={styles.emptyCopy}>Own at least one Holobot before entering live Arena battles.</Text>
                  </View>
                )}

                <View style={styles.optionColumn}>
                  <Pressable disabled={!lineupReady || loading || matchmakingStatus === "searching"} onPress={handleQuickMatch} style={[styles.optionCard, (!lineupReady || loading) && styles.optionCardDisabled]}>
                    <Text style={styles.optionTitle}>Quick Match</Text>
                    <Text style={styles.optionCopy}>
                      {matchmakingStatus === "searching" ? "Searching for another pilot..." : "Sync with the next pilot looking for a live battle."}
                    </Text>
                  </Pressable>

                  {matchmakingStatus === "searching" ? (
                    <Pressable onPress={cancelMatchmaking} style={styles.cancelButton}>
                      <Text style={styles.cancelButtonText}>CANCEL SEARCH</Text>
                    </Pressable>
                  ) : null}

                  <View style={styles.optionCard}>
                    <Text style={styles.optionTitle}>Join Room</Text>
                    <Text style={styles.optionCopy}>Use a room code from another pilot to jump straight into a private battle.</Text>
                    <View style={styles.joinRow}>
                      <TextInput
                        autoCapitalize="characters"
                        maxLength={6}
                        onChangeText={(value) => setJoinCode(value.toUpperCase())}
                        placeholder="ROOM CODE"
                        placeholderTextColor="#9c927b"
                        style={styles.codeInput}
                        value={joinCode}
                      />
                      <Pressable disabled={!lineupReady || loading} onPress={handleJoinRoom} style={[styles.inlineButton, (!lineupReady || loading) && styles.optionCardDisabled]}>
                        <Text style={styles.inlineButtonText}>JOIN</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.optionCard}>
                    <Text style={styles.optionTitle}>Friend Battle</Text>
                    <Text style={styles.optionCopy}>Create a synced room code and send it to a friend for a direct challenge.</Text>
                    <Pressable disabled={!lineupReady || loading} onPress={handleCreateRoom} style={[styles.createButton, (!lineupReady || loading) && styles.optionCardDisabled]}>
                      {loading ? <ActivityIndicator color="#050606" /> : <Text style={styles.inlineButtonText}>CREATE ROOM</Text>}
                    </Pressable>
                  </View>
                </View>
              </>
            ) : (
              <>
                <View style={styles.roomBanner}>
                  <Text style={styles.roomBannerText}>ROOM {room.roomCode}</Text>
                  <Text style={styles.roomBannerSub}>
                    {isWaiting ? "Waiting for opponent" : isComplete ? (room.winner === myRole ? "Victory" : "Defeat") : "Both devices render this shared Firebase battle state"}
                  </Text>
                </View>

                {opponent ? <PlayerMeters label="OPPONENT" player={opponent} /> : null}
                {isTeamRoom && opponentSide ? (
                  <TeamDock side={opponentSide} activeDoc={opponent} label="THEIR SQUAD" />
                ) : null}
                {myPlayer ? <PlayerMeters label="YOU" player={myPlayer} /> : null}
                {isTeamRoom && mySide && myPlayer ? (
                  <TeamDock
                    side={mySide}
                    activeDoc={myPlayer}
                    label="YOUR SQUAD — TAP TO SWITCH"
                    switchReadyAt={switchReadyAt}
                    onSwitch={(index) => void handleSwitch(index)}
                    disabled={room.status !== "active" || room.phase === "awaiting_send_in"}
                  />
                ) : null}

                {awaitingMySendIn && mySide ? (
                  <View style={styles.sendInPanel}>
                    <Text style={styles.sendInTitle}>HOLOBOT DOWN — SEND IN YOUR NEXT FIGHTER</Text>
                    <View style={styles.sendInRow}>
                      {livingBenchIndexes(mySide).map((index) => {
                        const member = mySide.members[index];
                        return (
                          <Pressable key={index} onPress={() => void handleSendIn(index)} style={styles.sendInOption}>
                            <Text style={styles.sendInName}>{member.holobotName}</Text>
                            <Text style={styles.sendInMeta}>
                              {`HP ${Math.max(0, Math.round((member.currentHP / Math.max(1, member.maxHP)) * 100))}%`}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                {awaitingOpponentSendIn ? (
                  <View style={styles.sendInBanner}>
                    <Text style={styles.sendInBannerText}>OPPONENT IS SENDING IN THEIR NEXT HOLOBOT…</Text>
                  </View>
                ) : null}

                <View style={styles.logPanel}>
                  <Text style={styles.logTitle}>BATTLE LOG</Text>
                  {(room.battleLog || []).slice(-4).reverse().map((entry) => (
                    <Text key={`${entry.timestamp}-${entry.message}`} style={styles.logLine}>
                      {entry.message}
                    </Text>
                  ))}
                  {!room.battleLog.length ? <Text style={styles.logEmpty}>Battle feed will appear here.</Text> : null}
                </View>

                {myPlayer && room.status === "active" && room.phase !== "awaiting_send_in" ? (
                  <View style={styles.handPanel}>
                    <Text style={styles.handTitle}>YOUR MOVES</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.handScroll}>
                      {myPlayer.moves.map((move) => (
                        <BattleCard
                          key={move.id}
                          card={move}
                          availability={moveAvailability[move.id]}
                          onPlay={handlePlayMove}
                        />
                      ))}
                    </ScrollView>
                    {canFireSignature ? (
                      <Pressable onPress={() => void handleSignature()} style={styles.signatureButton}>
                        <Text style={styles.signatureButtonText}>
                          {`✦ ${(myPlayer.signatureFinisher?.name || "SIGNATURE").toUpperCase()}`}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}

                {isWaiting ? (
                  <View style={styles.waitingPanel}>
                    <ActivityIndicator color="#17d9ff" />
                    <Text style={styles.waitingText}>Share code {room.roomCode} with your friend.</Text>
                  </View>
                ) : null}
              </>
            )}
          </View>
        </View>
      </Modal>

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
    </>
  );
}

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  modeButton: {
    borderColor: "#3a3f4b",
    borderWidth: 1.5,
    flex: 1,
    paddingVertical: 9,
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
  teamRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  teamSlot: {
    alignItems: "center",
    backgroundColor: "#0b0d13",
    borderColor: "#3a3f4b",
    borderWidth: 1.5,
    flex: 1,
    minHeight: 92,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  teamSlotFilled: {
    borderColor: "#17d9ff",
  },
  teamSlotLabel: {
    color: "#f0bf14",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  teamSlotArt: {
    height: 40,
    marginTop: 4,
    width: 40,
  },
  teamSlotName: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
    marginTop: 4,
    textAlign: "center",
  },
  teamDock: {
    marginTop: 6,
  },
  teamDockLabel: {
    color: "#8b93a1",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  teamDockRow: {
    flexDirection: "row",
    gap: 6,
  },
  teamDockChip: {
    backgroundColor: "#0b0d13",
    borderColor: "#3a3f4b",
    borderWidth: 1.5,
    flex: 1,
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  teamDockChipActive: {
    borderColor: "#f0bf14",
  },
  teamDockChipKo: {
    opacity: 0.35,
  },
  teamDockChipReady: {
    borderColor: "#17d9ff",
  },
  teamDockChipName: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  teamDockBar: {
    backgroundColor: "#252525",
    height: 4,
    overflow: "hidden",
  },
  teamDockHp: {
    backgroundColor: "#4bd060",
    height: "100%",
  },
  sendInPanel: {
    backgroundColor: "#160b0b",
    borderColor: "#ef4444",
    borderWidth: 2,
    marginTop: 8,
    padding: 10,
  },
  sendInTitle: {
    color: "#fca5a5",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    textAlign: "center",
  },
  sendInRow: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 8,
  },
  sendInOption: {
    alignItems: "center",
    backgroundColor: "#0b0d13",
    borderColor: "#17d9ff",
    borderWidth: 1.5,
    minWidth: 96,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  sendInName: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900",
  },
  sendInMeta: {
    color: "#8b93a1",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  sendInBanner: {
    backgroundColor: "#101218",
    borderColor: "#3a3f4b",
    borderWidth: 1,
    marginTop: 8,
    paddingVertical: 8,
  },
  sendInBannerText: {
    color: "#b7bdc9",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textAlign: "center",
  },
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.84)",
    flex: 1,
    justifyContent: "center",
    padding: 18,
  },
  barTrack: {
    backgroundColor: "#252525",
    borderColor: "#363636",
    borderWidth: 1,
    flex: 1,
    height: 12,
    overflow: "hidden",
  },
  battleCard: {
    borderRadius: 8,
    borderWidth: 2,
    height: 128,
    padding: 8,
    width: 92,
  },
  battleShell: {
    maxWidth: 520,
  },
  cancelButton: {
    alignItems: "center",
    borderColor: "#ef4444",
    borderWidth: 1,
    padding: 12,
  },
  cancelButtonText: {
    color: "#fca5a5",
    fontSize: 13,
    fontWeight: "900",
  },
  card: {
    backgroundColor: "#111111",
    borderColor: "#f0bf14",
    borderWidth: 3,
    maxWidth: 430,
    padding: 18,
    width: "100%",
  },
  cardCost: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  cardCostText: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
  },
  cardDamage: {
    color: "#fef1e0",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 8,
    textAlign: "center",
  },
  cardName: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
    minHeight: 34,
    textAlign: "center",
  },
  cardPlay: {
    color: "#f0bf14",
    fontSize: 10,
    fontWeight: "900",
    marginTop: "auto",
    textAlign: "center",
  },
  cardType: {
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 6,
    marginTop: 4,
    textAlign: "center",
  },
  closeChip: {
    alignItems: "center",
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  closeChipText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
  },
  codeInput: {
    backgroundColor: "#050606",
    borderColor: "#4f4220",
    borderWidth: 1,
    color: "#fef1e0",
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    height: 46,
    letterSpacing: 1.2,
    paddingHorizontal: 14,
  },
  createButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    justifyContent: "center",
    marginTop: 12,
    minHeight: 46,
  },
  emptyCopy: {
    color: "#b6a98a",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  emptyState: {
    backgroundColor: "#050606",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    marginTop: 18,
    padding: 16,
  },
  emptyTitle: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  eyebrow: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.6,
  },
  signatureButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    borderRadius: 6,
    marginTop: 10,
    paddingVertical: 10,
  },
  signatureButtonText: {
    color: "#050606",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  handPanel: {
    marginTop: 12,
  },
  handScroll: {
    gap: 10,
    paddingVertical: 8,
  },
  handTitle: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  holobotArt: {
    backgroundColor: "#050606",
    height: 68,
    width: 68,
  },
  holobotBar: {
    alignItems: "center",
    backgroundColor: "#090909",
    borderColor: "#f0bf14",
    borderWidth: 2,
    flexDirection: "row",
    gap: 12,
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  holobotBody: {
    flex: 1,
  },
  holobotMeta: {
    color: "#ddd2b5",
    fontSize: 12,
    marginTop: 4,
  },
  holobotName: {
    color: "#fef1e0",
    fontSize: 20,
    fontWeight: "900",
  },
  hpFill: {
    backgroundColor: "#ef4444",
    height: "100%",
  },
  inlineButton: {
    alignItems: "center",
    backgroundColor: "#f0bf14",
    justifyContent: "center",
    minWidth: 92,
    paddingHorizontal: 14,
  },
  inlineButtonText: {
    color: "#050606",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  joinRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  logEmpty: {
    color: "#777",
    fontSize: 12,
    fontStyle: "italic",
  },
  logLine: {
    color: "#d5cbb2",
    fontSize: 12,
    lineHeight: 17,
  },
  logPanel: {
    backgroundColor: "#050606",
    borderColor: "#272727",
    borderWidth: 1,
    marginTop: 10,
    maxHeight: 92,
    padding: 10,
  },
  logTitle: {
    color: "#17d9ff",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 6,
  },
  meterBot: {
    color: "#d5cbb2",
    fontSize: 12,
    marginBottom: 8,
  },
  meterCaption: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: "900",
    width: 34,
  },
  meterHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  meterLabel: {
    color: "#f0bf14",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  meterName: {
    color: "#fef1e0",
    fontSize: 14,
    fontWeight: "900",
  },
  meterPanel: {
    backgroundColor: "#090909",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  meterRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 6,
  },
  meterValue: {
    color: "#fef1e0",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "right",
    width: 62,
  },
  optionCard: {
    backgroundColor: "#090909",
    borderColor: "#2a2a2a",
    borderWidth: 1,
    padding: 14,
  },
  optionCardDisabled: {
    opacity: 0.45,
  },
  optionColumn: {
    gap: 12,
    marginTop: 18,
  },
  optionCopy: {
    color: "#c3bba6",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  optionTitle: {
    color: "#fef1e0",
    fontSize: 18,
    fontWeight: "900",
  },
  roomBanner: {
    backgroundColor: "#050606",
    borderColor: "#f0bf14",
    borderWidth: 1,
    marginTop: 14,
    padding: 10,
  },
  roomBannerSub: {
    color: "#c3bba6",
    fontSize: 12,
    marginTop: 2,
  },
  roomBannerText: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  specialFill: {
    backgroundColor: "#17d9ff",
    height: "100%",
  },
  staminaFill: {
    backgroundColor: "#f0bf14",
    height: "100%",
  },
  title: {
    color: "#fef1e0",
    fontSize: 28,
    fontWeight: "900",
    marginTop: 6,
  },
  topRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  waitingPanel: {
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  waitingText: {
    color: "#d5cbb2",
    fontSize: 13,
    fontWeight: "800",
  },
});
