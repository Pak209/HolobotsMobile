import { useEffect, useMemo, useRef, useState } from "react";

import { PvpLiveBattle } from "@/components/arena/PvpLiveBattle";
import type { TeamHudChip, TeamHudProps } from "@/components/arena/BattleArenaView";
import { ArenaCombatEngine } from "@/features/arena/combatEngine";
import { buildPvpFighterDoc, roomToBattleState } from "@/features/arena/pvpBattle";
import type { ActionCard, BattleAction, BattleState } from "@/types/arena";
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

/** lite-pvp-3d-1: a scripted, already-resolved room action replayed every PERIOD_MS (as qa/ArenaVfx… does), so the 3D
 * stage's attack clip, pack VFX and SKY / BREAK camera beat can be captured. It only writes `lastAction` (and the struck HP)
 * on a local copy of the recorded room; no engine, transaction or listener runs. `by: "p2"` = the rival swings. */
type Beat = { move: "strike" | "combo" | "finisher"; by: "p1" | "p2" };
type Cell = { mid?: boolean; team?: boolean; beat?: Beat };
const CELLS: Record<string, Cell> = {
  PvpBattle: {}, PvpBattleMid: { mid: true }, PvpBattle3v3: { mid: true, team: true },
  PvpBattleBreak: { mid: true, beat: { move: "combo", by: "p1" } },
  PvpBattleSky: { mid: true, beat: { move: "finisher", by: "p1" } },
  PvpBattleRivalStrike: { mid: true, beat: { move: "strike", by: "p2" } },
  PvpBattle3v3Break: { mid: true, team: true, beat: { move: "combo", by: "p1" } },
  PvpBattle3v3Sky: { mid: true, team: true, beat: { move: "finisher", by: "p1" } },
};
const FIRST_MS = 7000, PERIOD_MS = 5000;

function beatCard(battle: BattleState, room: BattleRoom, beat: Beat): ActionCard {
  if (beat.move === "finisher") return ArenaCombatEngine.buildSignatureCard(beat.by === "p1" ? battle.player : battle.opponent, "full");
  const moves = room.players[beat.by].moves;
  return moves.find(move => move.type === beat.move) ?? moves[0];
}
function beatAction(battle: BattleState, card: ActionCard, beat: Beat, n: number): BattleAction {
  const damage = card.type === "finisher" ? 24 : card.type === "combo" ? 16 : 8;
  const actor = beat.by === "p1" ? battle.player : battle.opponent, target = beat.by === "p1" ? battle.opponent : battle.player;
  return { id: `qa-pvp-${n}`, turnNumber: n + 3, actorId: actor.holobotId, actorRole: beat.by === "p1" ? "player" : "opponent", targetId: target.holobotId, card, actionType: card.type,
    timestamp: Date.now(), outcome: "hit", damageDealt: damage, actualDamage: damage, staminaChange: 0, specialMeterChange: 0, wasCountered: false, triggeredCombo: false, perfectDefense: false };
}

export const pvpBattlePreviewScreens = Object.fromEntries(Object.entries(CELLS).map(([name, cell]) => [name, function PvpBattlePreview() {
  const { room: seededRoom } = useMemo(() => {
    const mid = cell.mid ? { stamina: 4, specialMeter: 60, comboCounter: 2 } : {};
    const room: BattleRoom = { ...seated.room, status: "active", players: { p1: seat("p1", "ACE", 21, mid), p2: seat("p2", "KUMA", 12, cell.mid ? { currentHP: 92 } : {}) } };
    return { room };
  }, []);
  const [room, setRoom] = useState(seededRoom);
  const takes = useRef(0);
  useEffect(() => {
    const beat = cell.beat;
    if (!beat) return;
    const fire = () => setRoom(current => {
      const state = roomToBattleState(current);
      const card = beatCard(state, current, beat);
      const action = beatAction(state, card, beat, takes.current);
      takes.current += 1;
      const struck = beat.by === "p1" ? "p2" : "p1";
      const hp = Math.max(1, current.players[struck].currentHP - (action.actualDamage ?? 0));
      console.info("[PvpBattle:take] " + JSON.stringify({ cell: name, take: takes.current, action: action.id, move: card.type, by: beat.by, atMs: Math.round(performance.now()) }));
      return { ...current, turnNumber: action.turnNumber, lastAction: action, players: { ...current.players, [struck]: { ...current.players[struck], currentHP: hp } } };
    });
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => { fire(); interval = setInterval(fire, PERIOD_MS); }, FIRST_MS);
    return () => { clearTimeout(first); if (interval) clearInterval(interval); };
  }, []);
  const battle = useMemo(() => roomToBattleState(room), [room]);
  const availability = useMemo(() => Object.fromEntries(room.players.p1.moves.map(move => [move.id, ArenaCombatEngine.getCardAvailability(battle, "player", move)])), [room, battle]);
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
