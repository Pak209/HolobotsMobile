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
import { buildRealtimeHolobotStats, useRealtimeArena } from "@/hooks/useRealtimeArena";
import type { BattleRoomPlayer, CardType, PlayerRole, RealtimeActionCard } from "@/types/battle-room";
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

function PlayerMeters({ label, player }: { label: string; player: BattleRoomPlayer }) {
  const hpPercent = player.maxHealth > 0 ? Math.max(0, Math.min(100, (player.health / player.maxHealth) * 100)) : 0;
  const staminaPercent = player.maxStamina > 0 ? Math.max(0, Math.min(100, (player.stamina / player.maxStamina) * 100)) : 0;

  return (
    <View style={styles.meterPanel}>
      <View style={styles.meterHeader}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={styles.meterName}>{player.username || "Waiting"}</Text>
      </View>
      <Text style={styles.meterBot}>{player.holobot?.name ? `${player.holobot.name} Lv ${player.holobot.level}` : "No pilot connected"}</Text>

      <View style={styles.meterRow}>
        <Text style={styles.meterCaption}>HP</Text>
        <View style={styles.barTrack}>
          <View style={[styles.hpFill, { width: `${hpPercent}%` }]} />
        </View>
        <Text style={styles.meterValue}>{`${player.health}/${player.maxHealth}`}</Text>
      </View>

      <View style={styles.meterRow}>
        <Text style={styles.meterCaption}>STA</Text>
        <View style={styles.barTrack}>
          <View style={[styles.staminaFill, { width: `${staminaPercent}%` }]} />
        </View>
        <Text style={styles.meterValue}>{`${player.stamina}/${player.maxStamina}`}</Text>
      </View>

      <View style={styles.meterRow}>
        <Text style={styles.meterCaption}>SP</Text>
        <View style={styles.barTrack}>
          <View style={[styles.specialFill, { width: `${player.specialMeter}%` }]} />
        </View>
        <Text style={styles.meterValue}>{`${player.specialMeter}%`}</Text>
      </View>
    </View>
  );
}

function BattleCard({
  card,
  disabled,
  onPlay,
}: {
  card: RealtimeActionCard;
  disabled: boolean;
  onPlay: (cardId: string) => void;
}) {
  const colors = cardColors(card.type);

  return (
    <Pressable
      disabled={disabled}
      onPress={() => onPlay(card.id)}
      style={[styles.battleCard, { backgroundColor: colors.bg, borderColor: colors.border, opacity: disabled ? 0.45 : 1 }]}
    >
      <View style={styles.cardCost}>
        <Text style={styles.cardCostText}>{card.staminaCost}</Text>
      </View>
      <Text style={[styles.cardType, { color: colors.text }]}>{card.type.toUpperCase()}</Text>
      <Text numberOfLines={2} style={styles.cardName}>{card.name}</Text>
      {card.baseDamage ? <Text style={styles.cardDamage}>{card.baseDamage} DMG</Text> : <Text style={styles.cardDamage}>+STA</Text>}
      <Text style={styles.cardPlay}>{disabled ? "LOCKED" : "PLAY"}</Text>
    </Pressable>
  );
}

export function PvpArenaModal({ onClose, userHolobots, visible }: PvpArenaModalProps) {
  const [selectedHolobotIndex, setSelectedHolobotIndex] = useState(0);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
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
    myRole,
    opponentRole,
    playCard,
    room,
  } = useRealtimeArena();

  const roster = useMemo(
    () => mergeHolobotRoster(userHolobots).filter((holobot) => holobot.owned),
    [userHolobots],
  );
  const selectedHolobot = roster[selectedHolobotIndex] ?? roster[0];

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

  const selectedStats = () => {
    if (!selectedHolobot) {
      throw new Error("Choose a Holobot before entering PvP.");
    }
    return buildRealtimeHolobotStats(selectedHolobot);
  };

  const handleClose = async () => {
    await leaveRoom();
    onClose();
  };

  const handleCreateRoom = async () => {
    try {
      await createRoom(selectedStats());
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
      await joinRoom(joinCode.trim().toUpperCase(), selectedStats());
    } catch (joinError: any) {
      Alert.alert("Join Room Failed", joinError.message || "Unable to join the room.");
    }
  };

  const handleQuickMatch = async () => {
    try {
      await enterMatchmaking(selectedStats());
    } catch (matchError: any) {
      Alert.alert("Quick Match Failed", matchError.message || "Unable to enter matchmaking.");
    }
  };

  const handlePlayCard = async (cardId: string) => {
    try {
      await playCard(cardId);
    } catch (playError: any) {
      Alert.alert("Card Locked", playError.message || "That card cannot be played yet.");
    }
  };

  const myPlayer = room && myRole ? room.players[myRole] : null;
  const opponent = room && opponentRole ? room.players[opponentRole as PlayerRole] : null;
  const isWaiting = room?.status === "waiting";
  const isComplete = room?.status === "completed";

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
                {selectedHolobot ? (
                  <Pressable onPress={() => setIsPickerOpen(true)} style={styles.holobotBar}>
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
                  <Pressable disabled={!selectedHolobot || loading || matchmakingStatus === "searching"} onPress={handleQuickMatch} style={[styles.optionCard, (!selectedHolobot || loading) && styles.optionCardDisabled]}>
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
                      <Pressable disabled={!selectedHolobot || loading} onPress={handleJoinRoom} style={[styles.inlineButton, (!selectedHolobot || loading) && styles.optionCardDisabled]}>
                        <Text style={styles.inlineButtonText}>JOIN</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.optionCard}>
                    <Text style={styles.optionTitle}>Friend Battle</Text>
                    <Text style={styles.optionCopy}>Create a synced room code and send it to a friend for a direct challenge.</Text>
                    <Pressable disabled={!selectedHolobot || loading} onPress={handleCreateRoom} style={[styles.createButton, (!selectedHolobot || loading) && styles.optionCardDisabled]}>
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
                {myPlayer ? <PlayerMeters label="YOU" player={myPlayer} /> : null}

                <View style={styles.logPanel}>
                  <Text style={styles.logTitle}>BATTLE LOG</Text>
                  {(room.battleLog || []).slice(-4).reverse().map((entry) => (
                    <Text key={`${entry.timestamp}-${entry.message}`} style={styles.logLine}>
                      {entry.message}
                    </Text>
                  ))}
                  {!room.battleLog.length ? <Text style={styles.logEmpty}>Battle feed will appear here.</Text> : null}
                </View>

                {myPlayer && room.status === "active" ? (
                  <View style={styles.handPanel}>
                    <Text style={styles.handTitle}>YOUR HAND</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.handScroll}>
                      {myPlayer.hand.map((card) => (
                        <BattleCard
                          key={card.id}
                          card={card}
                          disabled={myPlayer.stamina < card.staminaCost || (card.type === "finisher" && myPlayer.specialMeter < 100)}
                          onPlay={handlePlayCard}
                        />
                      ))}
                    </ScrollView>
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
        visible={isPickerOpen}
        roster={roster}
        selectedIndex={selectedHolobotIndex}
        onClose={() => setIsPickerOpen(false)}
        onSelect={(index) => {
          setSelectedHolobotIndex(index);
          setIsPickerOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
