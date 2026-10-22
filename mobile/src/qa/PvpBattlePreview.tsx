import { useMemo } from "react";

import { PvpLiveBattle } from "@/components/arena/PvpLiveBattle";
import type { TeamHudChip, TeamHudProps } from "@/components/arena/BattleArenaView";
import { ArenaCombatEngine } from "@/features/arena/combatEngine";
import { buildPvpFighterDoc, roomToBattleState } from "@/features/arena/pvpBattle";
import type { BattleRoom, PvpFighterDoc } from "@/types/battle-room";
import type { UserHolobot } from "@/types/profile";
import { pvpFightersFixtures } from "./pvpFightersFixtures";

/**
 * Offline QA routes for the live PvP battle body (holobotsmobile://qa/PvpBattle…), lite-hud-row-1. The recorded
 * pvp-room-fighters-1 room (seated replies, so both LV tabs land) with fighter docs built by the real buildPvpFighterDoc,
 * rendered through the same PvpLiveBattle the modal mounts. No room listener, no transaction, no account.
 */
const seated = pvpFightersFixtures.PvpFightersSeated;
const CARDS = { "combo.chainBurst": 1, "defense.guardUp": 1, "finisher.tacticalOverride": 1, "strike.quickJab": 1, "strike.snapShot": 1 };
const holobot = (name: string, level: number): UserHolobot => ({ name, level, experience: 0, nextLevelExp: 100 });
function seat(role: "p1" | "p2", name: string, level: number, overrides: Partial<PvpFighterDoc> = {}): PvpFighterDoc {
  const fixture = seated.room.players[role];
  return { ...buildPvpFighterDoc(fixture.uid, fixture.username, holobot(name, level), { arena_deck_template_ids: [], battle_cards: CARDS }), ...overrides };
}
const chip = (index: number, name: string, hpPct: number, isActive: boolean, isKnockedOut = false): TeamHudChip => ({ index, name, hpPct, meterPct: 0.3, isActive, isKnockedOut });
const noop = () => { };

type Cell = { mid?: boolean; team?: boolean };
const CELLS: Record<string, Cell> = { PvpBattle: {}, PvpBattleMid: { mid: true }, PvpBattle3v3: { mid: true, team: true } };

export const pvpBattlePreviewScreens = Object.fromEntries(Object.entries(CELLS).map(([name, cell]) => [name, function PvpBattlePreview() {
  const { room, battle, availability } = useMemo(() => {
    const mid = cell.mid ? { stamina: 4, specialMeter: 60, comboCounter: 2 } : {};
    const room: BattleRoom = { ...seated.room, status: "active", players: { p1: seat("p1", "ACE", 21, mid), p2: seat("p2", "KUMA", 12, cell.mid ? { currentHP: 92 } : {}) } };
    const battle = roomToBattleState(room);
    const availability = Object.fromEntries(room.players.p1.moves.map(move => [move.id, ArenaCombatEngine.getCardAvailability(battle, "player", move)]));
    return { room, battle, availability };
  }, []);
  const team: TeamHudProps | null = cell.team ? {
    playerChips: [chip(0, "ACE", 0.62, true), chip(1, "HARE", 1, false), chip(2, "WOLF", 0, false, true)],
    opponentChips: [chip(0, "KUMA", 0.6, true), chip(1, "ERA", 1, false), chip(2, "TORA", 0.8, false)],
    canSwitchNow: true, switchSecondsLeft: 0, entryLocked: false, onSwitch: noop, sendIn: null, opponentChoosing: false, onSendIn: noop,
  } : null;
  const playable = room.players.p1.moves.filter(move => availability[move.id]?.playable).map(move => move.id);
  return <PvpLiveBattle room={room} myRole="p1" opponentName={room.players.p2.username} hostView={seated.view}
    battle={battle} playerCards={room.players.p1.moves} playableCardIds={playable} cardAvailability={availability} team={team}
    onClose={noop} onCardPlay={noop} onSignaturePlay={noop} />;
}]));
