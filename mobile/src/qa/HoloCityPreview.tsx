import { previewInitialScreen, ARENA_CAPTURE_ROUTES } from "./previewRoutes";
import { ArenaAdmittedRoundPreview, ArenaAdmittedResultPreview, ArenaAdmittedKnownBadPreview } from "./ArenaAdmittedPreview";
import { ArenaHostLevelsPreview, ArenaHostLevelsKnownBadPreview } from "./ArenaHostLevelsPreview";
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { previewScreenFromUrl } from "./previewDeepLink";

import { OfflinePreviewAuthProvider } from "@/contexts/AuthContext";
import { HomeScreen } from "@/screens/HomeScreen";
import { CityHubScreen } from "@/screens/CityHubScreen";
import { DuelPlaybackScreen } from "@/screens/DuelPlaybackScreen";
import { cityHubFixtures, CITY_GATHERING_FIXTURE } from "@/lib/cityHubFixtures";
import { CityRivalBattle, CityRivalCombatPreview } from "@/components/city/CityRivalBattle";
import { InventoryScreen } from "@/screens/InventoryScreen";
import { FitnessScreen } from "@/screens/FitnessScreen";
import { MarketplaceScreen } from "@/screens/MarketplaceScreen";
import { ArenaScreen } from "@/screens/ArenaScreen";
import { GachaScreen } from "@/screens/GachaScreen";
import { LeaderboardScreen } from "@/screens/LeaderboardScreen";
import { TrainingScreen } from "@/screens/TrainingScreen";
import { QuestsScreen } from "@/screens/QuestsScreen";
import { LoginScreen } from "@/screens/LoginScreen";
import { OverworldScreen } from "@/screens/OverworldScreen";
import { WebSectionScreen } from "@/screens/WebSectionScreen";
import { HolobotPickerModal } from "@/components/HolobotPickerModal";
import { HolobotStatsModal } from "@/components/HolobotStatsModal";
import { DashboardSettingsModal } from "@/components/DashboardSettingsModal";
import { HolobotViewer } from "@/components/HolobotViewer";
import { BOT_ASSETS } from "../../assets/bots";
import { mergeHolobotRoster } from "@/config/holobots";
import { previewProfile, previewLeaderboard } from "./previewProfile";
import { DUEL_PREVIEW_RECEIPT } from "./duelFixture";
import hostDuelFixture from "./fixtures/duel-receipt-1.json";

const Tab = createBottomTabNavigator();
const noop = () => {};

function RosterPreview() {
  return <HolobotPickerModal visible roster={mergeHolobotRoster(previewProfile.holobots)} selectedIndex={0} onClose={noop} onSelect={noop} />;
}
function DetailPreview() {
  return <HolobotStatsModal visible holobot={mergeHolobotRoster(previewProfile.holobots)[0]} ownedHolobot={previewProfile.holobots[0]}
    availableSyncPoints={1250} blueprintCount={12} onClose={noop} onMint={noop} onRankUpgrade={noop} onUpgrade={noop} onUpgradeSync={noop} onEquipSyncAbility={noop} />;
}
function SettingsPreview() { return <DashboardSettingsModal visible onClose={noop} />; }
function WebPreview() { return <WebSectionScreen uri="https://offline-preview.invalid" />; }
function LeaderboardPreview() { return <LeaderboardScreen previewEntries={previewLeaderboard} />; }
function HomePreview() {
  const [rivalPreview] = useState(() => ({ status: { tier: 2, tierLabel: "Champion", rivalWins: 24, winsToNextTier: 6 }, cooldowns: [{ pilotId: "fixture-citizen", endsAtMs: Date.now() + 300000 }] }));
  return <HomeScreen rivalPreview={rivalPreview} />;
}
function DuelPreview() { return <DuelPlaybackScreen fixture receipt={DUEL_PREVIEW_RECEIPT} onClose={noop} showMetrics />; }
const hostDuelEnvelope = { issue: { duel: { mode: "resolver", player: hostDuelFixture.input.player, opponent: hostDuelFixture.input.opponent } }, duelReceipt: hostDuelFixture.receipt };
function HostDuelPreview() { return <DuelPlaybackScreen fixture receipt={hostDuelEnvelope} onClose={noop} />; }
const hostDuelCaptureScreens = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [
  `HostDuelRound${i + 1}`, function HostRoundPreview() { return <DuelPlaybackScreen fixture receipt={hostDuelEnvelope} onClose={noop} captureRound={i + 1} />; },
]));
function ReceiptPreview() { return <DuelPlaybackScreen fixture receipt={{ issue: { battleId: "offline-result-only", playerCombatants: [{ holobotId: "ace" }], encounter: { opponentSquad: [{ holobotId: "wolf" }] } }, settlement: DUEL_PREVIEW_RECEIPT.settlement }} onClose={noop} />; }
const duelCaptureScreens = Object.fromEntries([1, 2, 3].map(round => [`DuelRound${round}`, function RoundPreview() {
  return <DuelPlaybackScreen fixture receipt={DUEL_PREVIEW_RECEIPT} onClose={noop} showMetrics captureRound={round} />;
}]));
function CityBattlePreview() { return <CityRivalCombatPreview onClose={noop} />; }
function RivalEntryPreview() { return <CityRivalBattle uid="offline" rival={CITY_GATHERING_FIXTURE.roster[0]} preview onClose={noop} />; }
const botScreens = Object.fromEntries(Object.keys(BOT_ASSETS).map(botId => [
  `Bot${botId.toUpperCase()}`,
  function BotPreview() {
    return <View style={{ flex: 1, paddingTop: 90, backgroundColor: "#101318" }}>
      <Text style={{ color: "#62DDE8", textAlign: "center", fontSize: 24, fontFamily: "HoloDisplay" }}>{botId.toUpperCase()} · NATIVE 3D</Text>
      <HolobotViewer botId={botId} showMetrics style={{ height: 520, margin: 16 }} />
      <Text style={{ color: "#A9BDC8", textAlign: "center", margin: 16 }}>Offline bundled asset · Looping idle · iOS simulator</Text>
    </View>;
  },
]));
const cityScreens = Object.fromEntries(Object.entries(cityHubFixtures).map(([name, fixture]) => [
  `City${name[0].toUpperCase()}${name.slice(1)}`,
  function CityPreview() { return <CityHubScreen fixture={fixture} />; },
]));
function CityPreview() { return <CityHubScreen fixture={cityHubFixtures.night} />; }

const screens: Record<string, React.ComponentType<any>> = {
  Home: HomePreview, Inventory: InventoryScreen, Roster: RosterPreview, Detail: DetailPreview,
  Fitness: FitnessScreen, Marketplace: MarketplaceScreen, Arena: ArenaScreen, Gacha: GachaScreen,
  Training: TrainingScreen, Quests: QuestsScreen, Login: LoginScreen, Overworld: OverworldScreen,
  WebSection: WebPreview, Settings: SettingsPreview, Leaderboard: LeaderboardPreview,
  ...botScreens,
  CityHub: CityPreview,
  ...cityScreens,
  HostDuel: HostDuelPreview, ...hostDuelCaptureScreens,
  Duel: DuelPreview, DuelReceipt: ReceiptPreview, ...duelCaptureScreens,
  ArenaHostLevels: ArenaHostLevelsPreview,
  ArenaAdmittedRound: ArenaAdmittedRoundPreview,
  ArenaAdmittedKnownBad: ArenaAdmittedKnownBadPreview,
  ArenaAdmittedResult: ArenaAdmittedResultPreview, ArenaHostLevelsKnownBad: ArenaHostLevelsKnownBadPreview,
  CityBattle: CityBattlePreview, RivalEntry: RivalEntryPreview,
};

/** Opt-in __DEV__ harness only; no account provider is mounted. */
export function HoloCityPreviewApp() {
  const [screen, setScreen] = useState(() => previewInitialScreen(process.env.EXPO_PUBLIC_HOLOCITY_PREVIEW_SCREEN, screens));
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const open = (url: string | null) => {
      const name = previewScreenFromUrl(url, screens);
      if (name) { setScreen(name); setRevision(value => value + 1); }
    };
    void Linking.getInitialURL().then(open);
    const subscription = Linking.addEventListener("url", event => open(event.url));
    return () => subscription.remove();
  }, []);
  if (!__DEV__) return null;
  const next = () => {
    const names = Object.keys(screens);
    setScreen(names[(names.indexOf(screen) + 1) % names.length]);
    setRevision(value => value + 1);
  };
  return <OfflinePreviewAuthProvider profile={previewProfile}>
    <StatusBar style="light" />
    <View style={styles.root}>
      <NavigationContainer key={`${screen}:${revision}`} theme={DarkTheme}>
        <Tab.Navigator initialRouteName={screen} screenOptions={{ headerShown: false, tabBarStyle: { display: "none" }, lazy: true }}>
          {Object.entries(screens).map(([name, component]) => <Tab.Screen key={name} name={name} component={component} />)}
        </Tab.Navigator>
      </NavigationContainer>
      <View style={styles.captureRoutes}>
        {ARENA_CAPTURE_ROUTES.map(({ name, label }) => <Pressable key={name}
          accessibilityRole="button" accessibilityLabel={`QA capture ${label}`}
          style={styles.captureButton} onPress={() => { setScreen(name); setRevision(value => value + 1); }}>
          <Text style={styles.labelText}>{label}</Text>
        </Pressable>)}
      </View>
      <Pressable style={styles.label} onPress={next} accessibilityLabel="Next offline preview screen">
        <Text style={styles.labelText}>OFFLINE FIXTURE · {screen} · NEXT →</Text>
      </Pressable>
    </View>
  </OfflinePreviewAuthProvider>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#101318" },
  captureRoutes: { flexDirection: "row", justifyContent: "space-around", backgroundColor: "#101318" },
  captureButton: { padding: 12, minHeight: 44 },
  label: { padding: 8, paddingBottom: 22, backgroundColor: "#101318", alignItems: "center" },
  labelText: { color: "#62DDE8", fontSize: 10, letterSpacing: 1 },
});
