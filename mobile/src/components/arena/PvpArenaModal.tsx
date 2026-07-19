import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  BattleArenaView,
  type TeamHudChip,
  type TeamHudProps,
} from "@/components/arena/BattleArenaView";
import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { mergeHolobotRoster } from "@/config/holobots";
import { roomToBattleState } from "@/features/arena/pvpBattle";
import {
  isDocKnockedOut,
  livingBenchIndexes,
  TEAM_SIZE,
} from "@/features/arena/pvpTeamBattle";
import { useRealtimeArena } from "@/hooks/useRealtimeArena";
import type { BattleMode, PlayerRole, PvpFighterDoc, PvpTeamSide } from "@/types/battle-room";
import type { UserHolobot } from "@/types/profile";

type PvpArenaModalProps = {
  onClose: () => void;
  userHolobots: UserHolobot[];
  visible: boolean;
};

export function PvpArenaModal({ onClose, userHolobots, visible }: PvpArenaModalProps) {
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  // Which slot the picker fills: the 1v1 fighter, or a 3v3 team slot.
  const [pickerTarget, setPickerTarget] = useState<"main" | 0 | 1 | 2 | null>(null);
  const [mode, setMode] = useState<BattleMode>("1v1");
  const [teamNames, setTeamNames] = useState<Array<string | null>>([null, null, null]);
  const [joinCode, setJoinCode] = useState("");
  const {
    cancelMatchmaking,
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
  const inLiveBattle = !!room && room.status === "active" && !!myRole && !!myPlayer;

  // Cooldown countdowns need a clock; only tick while a live battle renders.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!inLiveBattle) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [inLiveBattle]);

  // The shared arena view always draws battle.player at the bottom as "you".
  // The room maps p1 -> player FIXED on both clients (so the engine resolves
  // identically everywhere), so p2 flips the fighters for display only.
  const battleState = useMemo(() => {
    if (!room || !myRole) return null;
    const state = roomToBattleState(room);
    return myRole === "p1" ? state : { ...state, player: state.opponent, opponent: state.player };
  }, [myRole, room]);

  const playerCards = myPlayer?.moves ?? [];
  const playableCardIds = useMemo(
    () => playerCards.filter((move) => moveAvailability[move.id]?.playable).map((move) => move.id),
    [moveAvailability, playerCards],
  );

  const docToChip = (side: PvpTeamSide, liveActiveDoc: PvpFighterDoc | null) =>
    side.members.map((member, index): TeamHudChip => {
      // The live players.{role} doc is authoritative for the active slot.
      const shown = index === side.activeIndex && liveActiveDoc ? liveActiveDoc : member;
      return {
        index,
        name: shown.holobotName,
        hpPct: shown.maxHP > 0 ? Math.max(0, shown.currentHP / shown.maxHP) : 0,
        meterPct: Math.max(0, Math.min(1, shown.specialMeter / 100)),
        isKnockedOut: isDocKnockedOut(shown),
        isActive: index === side.activeIndex,
      };
    });

  const teamHud: TeamHudProps | null =
    isTeamRoom && mySide && opponentSide && room
      ? {
          playerChips: docToChip(mySide, myPlayer),
          opponentChips: docToChip(opponentSide, opponent),
          canSwitchNow:
            room.status === "active" &&
            room.phase !== "awaiting_send_in" &&
            nowTick >= (mySide.switchCooldownUntil ?? 0) &&
            nowTick >= (mySide.entryLockUntil ?? 0),
          switchSecondsLeft: Math.max(0, Math.ceil(((mySide.switchCooldownUntil ?? 0) - nowTick) / 1000)),
          entryLocked: nowTick < (mySide.entryLockUntil ?? 0),
          onSwitch: (index) => void handleSwitch(index),
          sendIn: awaitingMySendIn
            ? {
                secondsLeft: Math.max(0, Math.ceil(((room.sendInDeadline ?? nowTick) - nowTick) / 1000)),
                options: livingBenchIndexes(mySide).map((index): TeamHudChip => {
                  const member = mySide.members[index];
                  return {
                    index,
                    name: member.holobotName,
                    hpPct: member.maxHP > 0 ? Math.max(0, member.currentHP / member.maxHP) : 0,
                    meterPct: Math.max(0, Math.min(1, member.specialMeter / 100)),
                    isKnockedOut: false,
                    isActive: false,
                  };
                }),
              }
            : null,
          opponentChoosing: awaitingOpponentSendIn,
          onSendIn: (index) => void handleSendIn(index),
        }
      : null;

  if (inLiveBattle && battleState) {
    // Live battle: the SAME arena battle screen as PvE — the opponent is
    // simply the other pilot. Lobby/waiting/results keep the card layout.
    return (
      <>
        <Modal animationType="fade" presentationStyle="overFullScreen" transparent visible={visible} onRequestClose={handleClose}>
          <View style={styles.battleFull}>
            <View style={styles.battleTopBar}>
              <Text style={styles.battleTopText}>
                {`ROOM ${room!.roomCode} • VS ${opponent?.username || "PILOT"}`}
              </Text>
              <Pressable style={styles.closeChip} onPress={handleClose}>
                <Text style={styles.closeChipText}>X</Text>
              </Pressable>
            </View>
            <BattleArenaView
              battle={battleState}
              roundProgress={null}
              playerCards={playerCards}
              playableCardIds={playableCardIds}
              cardAvailability={moveAvailability}
              lastAction={room!.lastAction ?? null}
              isAnimating={false}
              onCardPlay={(moveId) => void handlePlayMove(moveId)}
              onSignaturePlay={() => void handleSignature()}
              team={teamHud}
            />
          </View>
        </Modal>
      </>
    );
  }

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
                    {isWaiting
                      ? "Waiting for opponent"
                      : isComplete
                        ? room.winner === myRole
                          ? "Victory"
                          : "Defeat"
                        : "Connecting to battle"}
                  </Text>
                </View>

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
  battleFull: {
    backgroundColor: "#05060a",
    flex: 1,
  },
  battleTopBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingBottom: 6,
    paddingTop: 54,
  },
  battleTopText: {
    color: "#f0bf14",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
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
  backdrop: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.84)",
    flex: 1,
    justifyContent: "center",
    padding: 18,
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
