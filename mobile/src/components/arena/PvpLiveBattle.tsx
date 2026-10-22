import { Pressable, StyleSheet, Text, View } from "react-native";

import { BattleArenaView, type TeamHudProps } from "@/components/arena/BattleArenaView";
import type { FinisherPower } from "@/features/arena/finisherPolicy";
import { pvpFighterLevel, type PvpHostView } from "@/lib/bots/pvpFighterLevel";
import { theme } from "@/theme";
import type { ArenaCardAvailability } from "@/features/arena/arenaCards";
import type { ActionCard, BattleState } from "@/types/arena";
import type { BattleRoom, PlayerRole } from "@/types/battle-room";

/** The live PvP battle body (PvpArenaModal renders it inside its Modal; the offline QA route renders it bare). Presentation
 * of the shared room only: every move and signature goes to the caller's handlers, which call the room transaction.
 * lite-hud-row-1: the seat-snapshot levels ride the HoloCity fighter cards' LV corner tabs (the compact seat strip that
 * repeated both portraits above the fight is gone; the lobby keeps PvpSeatBadges). */
export function PvpLiveBattle({ room, myRole, opponentName, hostView, battle, playerCards, playableCardIds, cardAvailability, team, onClose, onCardPlay, onSignaturePlay }: {
  room: BattleRoom;
  myRole: PlayerRole;
  opponentName: string;
  hostView: PvpHostView | null;
  battle: BattleState;
  playerCards: ActionCard[];
  playableCardIds: string[];
  cardAvailability: Record<string, ArenaCardAvailability>;
  team: TeamHudProps | null;
  onClose: () => void;
  onCardPlay: (moveId: string) => void;
  onSignaturePlay: (power?: FinisherPower) => void;
}) {
  const opponentRole: PlayerRole = myRole === "p1" ? "p2" : "p1";
  // Only the seat snapshot's level (pvpFighterLevel); none → no tab (lite critic L22).
  const levels = {
    player: pvpFighterLevel(hostView, room, myRole, room.players[myRole]?.holobotName),
    rival: pvpFighterLevel(hostView, room, opponentRole, room.players[opponentRole]?.holobotName),
  };
  return (
    <View style={styles.battleFull}>
      <View style={styles.battleTopBar}>
        <Text style={styles.battleTopText}>{`ROOM ${room.roomCode} • VS ${opponentName}`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Leave the PvP battle" hitSlop={5} style={styles.closeChip} onPress={onClose}>
          <Text style={styles.closeChipText}>X</Text>
        </Pressable>
      </View>
      <BattleArenaView
        battle={battle}
        roundProgress={null}
        playerCards={playerCards}
        playableCardIds={playableCardIds}
        cardAvailability={cardAvailability}
        lastAction={room.lastAction ?? null}
        isAnimating={false}
        onCardPlay={onCardPlay}
        onSignaturePlay={onSignaturePlay}
        team={team}
        levels={levels}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  battleFull: { backgroundColor: "#05060a", flex: 1 },
  battleTopBar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14, paddingBottom: 6, paddingTop: 54 },
  battleTopText: { color: theme.colors.accent, fontFamily: "HoloBody", fontSize: theme.type.caption.fontSize, fontWeight: "900", letterSpacing: 1.2 },
  closeChip: { alignItems: "center", backgroundColor: theme.colors.carbon, borderColor: theme.plates.raised, borderWidth: 1, height: 34, justifyContent: "center", width: 34 },
  closeChipText: { color: theme.colors.accent, fontFamily: "HoloDisplay", fontSize: theme.type.label.fontSize, fontWeight: "900" },
});
