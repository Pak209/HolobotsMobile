import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getHolobotFullImageSource, getHolobotHeadshotImageSource } from "@/config/holobots";
import { CityLiveBattleView } from "./CityLiveBattleView";
import { ArenaCombatEngine } from "@/lite/features/arena/combatEngine";
import { getAbility } from "@/features/arena/abilities";
import { getSignatureFinisher, resolveCombatKit } from "@/features/arena/moveKits";
import { publishRivalCooldown, publishRivalStatus } from "@/lite/hooks/useRivalStatus";
import { cityActionMessage, cityRivalCooldownEnd, record, type ArenaCitizen } from "@/lib/cityHub";
import { CITY_GATHERING_FIXTURE } from "@/lite/lib/cityHubFixtures";
import { CITY_LIVE_DUEL_HOLD, issueCityRival, settleCityRival } from "@/lite/lib/cityHubClient";
import { cityBattleRounds, cityCombatantFighter, readCityRivalIssue, type CityRivalIssue } from "@/lite/lib/cityRivalBattle";
import { DuelPlaybackScreen } from "@/lite/screens/DuelPlaybackScreen";
import type { BattleState } from "@/lite/types/arena";
import { theme } from "@/lite/theme";

const kit = resolveCombatKit({ idPrefix: "city" });
const moves = [...kit.slots];

function previewIssue(rival: ArenaCitizen): CityRivalIssue {
  const bot = { holobotId: "ace", level: 2, maxHealth: 150, attack: 38, defense: 22, speed: 20, intelligence: 18, commandRules: { version: 1, maxStamina: 7, staminaRegen: 0.5 } };
  const raw = { schemaVersion: "rival-battle-3", battleId: "rb_000000000000000000000000", expiresAtMs: Date.now() + 7_200_000, playerCombatants: [bot], encounter: { encounterId: "rb_000000000000000000000000", seed: 1, opponentPilot: { pilotId: rival.citizenId }, opponentSquad: [{ ...bot, holobotId: rival.holobotId, attack: 31, defense: 18 }] } };
  return readCityRivalIssue(raw, rival.citizenId, rival.holobotId);
}
export function CityRivalCombatPreview({ onClose }: { onClose: () => void }) {
  return <CityRivalBattle uid="offline-city-preview" rival={CITY_GATHERING_FIXTURE.roster[0]} onClose={onClose} preview initialCombat />;
}

/** An isolated battle avoids leaking rival outcomes into ArenaScreen's settlement store. */
export function CityRivalBattle({ uid, rival, onClose, preview = false, initialCombat = false, accountSnapshot }: { accountSnapshot?: unknown; uid: string; rival: ArenaCitizen; onClose: () => void; preview?: boolean; initialCombat?: boolean }) {
  const insets = useSafeAreaInsets();
  const [hostPreview, setHostPreview] = useState(false);
  const [issue, setIssue] = useState<CityRivalIssue | null>(null);
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [receipt, setReceipt] = useState<Record<string, unknown> | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issueAttempted, setIssueAttempted] = useState(false);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const busy = useRef(false);
  const alive = useRef(true);
  const receivedAt = useRef(0);
  const actionLockedUntil = useRef(0);
  const lastAi = useRef(0);
  const lastRegen = useRef(0);
  const observed = useRef<BattleState | null>(null);
  const appActive = useRef(AppState.currentState === "active");
  const settlementAttempted = useRef(false);
  const settlementOutcome = useRef<boolean | null>(null);

  function commit(next: BattleState) { observed.current = next; setBattle(next); }
  function enterBattle(admitted: CityRivalIssue) {
    const player = cityCombatantFighter(admitted.player, "player", uid);
    const opponent = cityCombatantFighter(admitted.opponent, "rival", uid);
    for (const fighter of [player, opponent]) {
      fighter.avatar = getHolobotFullImageSource(fighter.name);
      fighter.ability = getAbility(fighter.name);
      fighter.signatureFinisher = getSignatureFinisher(fighter.name);
    }
    receivedAt.current = lastAi.current = lastRegen.current = Date.now();
    setIssue(admitted);
    commit(ArenaCombatEngine.initializeBattle(player, opponent, { battleType: "pve", allowPlayerControl: true, potentialRewards: { exp: 0, syncPoints: 0 } }));
  }
  useEffect(() => { if (preview && initialCombat && !observed.current) enterBattle(previewIssue(rival)); }, [preview, initialCombat]);
  useEffect(() => {
    alive.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      appActive.current = state === "active";
      lastAi.current = lastRegen.current = Date.now();
    });
    return () => { alive.current = false; subscription.remove(); };
  }, []);

  async function start() {
    if (preview) { enterBattle(previewIssue(rival)); return; }
    if (busy.current || issueAttempted) return;
    busy.current = true; setPending(true); setIssueAttempted(true); setMessage(null);
    let raw: unknown;
    try {
      raw = await issueCityRival(uid, rival);
      const admitted = readCityRivalIssue(raw, rival.citizenId, rival.holobotId);
      if (!alive.current) return;
      enterBattle(admitted);
    } catch (error) {
      const cooldownEnd = cityRivalCooldownEnd(error, Date.now());
      if (cooldownEnd !== null) publishRivalCooldown(uid, rival.citizenId, cooldownEnd);
      // A verified issuance that cannot be played must be closed without a win/XP claim.
      const rawId = record(raw)?.battleId;
      if (typeof rawId === "string" && /^rb_[a-f0-9]{24}$/.test(rawId)) {
        try { await settleCityRival(uid, rawId, false, []); }
        catch { /* Keep the original compatibility error; admission expires server-side. */ }
      }
      if (alive.current) setMessage(cityActionMessage(error));
    } finally { busy.current = false; if (alive.current) setPending(false); }
  }

  function play(moveId: string) {
    const current = observed.current;
    if (!current || current.status !== "active" || Date.now() < actionLockedUntil.current || !appActive.current) return;
    const move = moves.find((candidate) => candidate.id === moveId); if (!move) return;
    const next = ArenaCombatEngine.resolveAction(current, move, current.player.holobotId);
    if (next !== current) { actionLockedUntil.current = Date.now() + 350; commit(next); }
  }
  function signature(power?: "half" | "full") {
    const current = observed.current;
    if (!current || current.status !== "active" || Date.now() < actionLockedUntil.current || !appActive.current) return;
    const next = ArenaCombatEngine.resolveSignatureFinisher(current, current.player.holobotId, power);
    if (next !== current) { actionLockedUntil.current = Date.now() + 350; commit(next); }
  }
  useEffect(() => {
    if (!issue || receipt) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setWaitSeconds(Math.max(0, Math.ceil((receivedAt.current + 20_000 - now) / 1000)));
      let current = observed.current;
      if (!appActive.current || !current || current.status !== "active" || busy.current) return;
      if (now >= issue.expiresAtMs) { commit({ ...current, status: "abandoned" }); setMessage("This battle admission has expired. Return to the city and challenge again."); return; }
      if (now - lastRegen.current >= 2000) { current = ArenaCombatEngine.regenerateStamina(current); lastRegen.current = now; commit(current); }
      if (now - lastAi.current >= 950 && now >= actionLockedUntil.current) {
        const command = ArenaCombatEngine.selectAICommand(current, moves); lastAi.current = now;
        if (command) {
          const next = command.kind === "signature" ? ArenaCombatEngine.resolveSignatureFinisher(current, current.opponent.holobotId) : ArenaCombatEngine.resolveAction(current, command.card, current.opponent.holobotId);
          if (next !== current) { actionLockedUntil.current = now + 350; commit(next); }
        }
      }
    }, 180);
    return () => clearInterval(timer);
  }, [issue, receipt]);

  async function settle(didWin: boolean) {
    if (!issue || busy.current || receipt) return;
    if (preview) { settlementAttempted.current = true; setReceipt({ battleId: "offline-city-duel", didWin }); return; }
    busy.current = true; settlementAttempted.current = true; settlementOutcome.current = didWin; setPending(true); setMessage(null);
    try {
      const confirmed = await settleCityRival(uid, issue.battleId, didWin, observed.current?.actionHistory.length ? [issue.player.holobotId] : []);
      // The host reply has no settledAtMs. Do not restart an observed clock on receipt replay.
      if (confirmed.alreadyProcessed === false) publishRivalCooldown(uid, rival.citizenId, Date.now() + 300_000);
      publishRivalStatus(uid, confirmed.status);
      if (alive.current) setReceipt(confirmed);
    } catch (error) { if (alive.current) setMessage(cityActionMessage(error)); }
    finally { busy.current = false; if (alive.current) setPending(false); }
  }
  useEffect(() => {
    if (!battle || battle.status !== "completed" || settlementAttempted.current || receipt) return;
    const result = ArenaCombatEngine.checkWinCondition(battle);
    const didWin = result.winnerId === battle.player.holobotId;
    if (preview || !didWin || Date.now() >= receivedAt.current + 20_000) void settle(didWin);
  }, [battle, receipt, waitSeconds]);

  function forfeit() {
    if (preview) { onClose(); return; }
    Alert.alert("Leave this duel?", "Leaving records a loss with the rival host.", [
      { text: "Keep battling", style: "cancel" },
      { text: "Forfeit", style: "destructive", onPress: () => { if (observed.current) commit({ ...observed.current, status: "abandoned" }); void settle(false); } },
    ]);
  }
  const replayReceipt = useMemo(() => ({ issue: issue?.raw, settlement: receipt }), [issue, receipt]);
  const replayRounds = useMemo(() => cityBattleRounds(battle?.actionHistory ?? []), [battle?.actionHistory]);
  if (__DEV__ && preview && hostPreview && process.env.EXPO_PUBLIC_HOLOCITY_RECEIPT_QA === "1") {
    const fixture = require("@/lite/qa/fixtures/duel-receipt-1.json");
    return <DuelPlaybackScreen fixture receipt={fixture.receipt} onClose={onClose} />;
  }
  if (receipt && issue) return <DuelPlaybackScreen accountSnapshot={accountSnapshot} fixture={preview} receipt={preview ? replayReceipt : receipt} liveIssue={preview ? undefined : issue.raw} rounds={preview ? replayRounds : undefined} attackerBotId={issue.player.holobotId} defenderBotId={issue.opponent.holobotId} onClose={onClose} />;

  if (battle?.status === "active") return <CityLiveBattleView accountSnapshot={accountSnapshot} hostIssue={issue?.raw} battle={battle} moves={moves} onPlay={play} onSignature={signature} onLeave={forfeit} pending={pending} preview={preview} />;

  return <View style={[styles.screen, styles.center, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
    <Text style={styles.label}>CITY RIVAL CHALLENGE</Text>
    <View style={[styles.ring, { borderColor: rival.ringColor }]}><Image source={getHolobotHeadshotImageSource(rival.holobotId)} style={styles.portrait} /></View>
    <Text style={styles.title}>{rival.pilotName}</Text>
    <Text style={styles.body}>{rival.holobotId.toUpperCase()} / {rival.rank.toUpperCase()}</Text>
    {!issue ? <Text style={styles.body}>{preview ? "Your first travel-squad Holobot enters this offline duel." : CITY_LIVE_DUEL_HOLD}</Text> : <Text style={styles.title}>{battle?.status === "completed" ? "DUEL COMPLETE" : "DUEL ENDED"}</Text>}
    {pending ? <ActivityIndicator size="large" color={theme.colors.accent} /> : null}
    {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
    {__DEV__ && preview && !issue && process.env.EXPO_PUBLIC_HOLOCITY_RECEIPT_QA === "1" ? <Pressable accessibilityRole="button" accessibilityLabel="Play offline host receipt" onPress={() => setHostPreview(true)} style={styles.primary}><Text style={styles.primaryText}>OFFLINE ACE / WOLF RECEIPT · NO REWARDS</Text></Pressable> : null}
    {preview && !issue && !issueAttempted ? <Pressable accessibilityRole="button" onPress={() => void start()} style={styles.primary}><Text style={styles.primaryText}>START RIVAL DUEL</Text></Pressable> : null}
    {issue && !pending && !receipt && battle?.status === "completed" && !settlementAttempted.current ? <Text style={styles.body}>Confirming the match · {waitSeconds}s</Text> : null}
    {issue && message && settlementAttempted.current && !pending ? <Pressable accessibilityRole="button" onPress={() => void settle(settlementOutcome.current === true)} style={styles.primary}><Text style={styles.primaryText}>RETRY HOST CONFIRMATION</Text></Pressable> : null}
    {(!issue || battle?.status === "abandoned") && !pending ? <Pressable accessibilityRole="button" onPress={onClose} style={styles.leave}><Text style={styles.leaveText}>RETURN TO CITY</Text></Pressable> : null}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.carbon }, center: { paddingHorizontal: 26, alignItems: "center", justifyContent: "center", gap: 20 },
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 16 }, label: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1.2 },
  title: { ...theme.type.header, color: theme.colors.text, textAlign: "center" }, body: { ...theme.type.body, color: theme.colors.muted, textAlign: "center" }, message: { ...theme.type.body, color: theme.colors.warning, textAlign: "center" },
  ring: { width: 144, height: 144, borderRadius: 72, borderWidth: 3, alignItems: "center", justifyContent: "center", overflow: "hidden" }, portrait: { width: 140, height: 140, resizeMode: "contain" },
  primary: { minHeight: 48, paddingHorizontal: 24, backgroundColor: theme.colors.accent, borderRadius: theme.radius.sm, justifyContent: "center", alignItems: "center" }, primaryText: { ...theme.type.label, color: theme.colors.carbon }, leave: { minHeight: 48, minWidth: 64, justifyContent: "center", alignItems: "center", paddingHorizontal: 14 }, leaveText: { ...theme.type.caption, color: theme.colors.accent },
});
