import { isLiteEnabled, isLitePreviewEnabled } from "./src/config/liteFeature";
import { useRef } from "react";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "./src/contexts/AuthContext";
import { ArenaScreen } from "./src/lite/screens/ArenaScreen";
import { AppLoadingScreen } from "./src/lite/components/AppLoadingScreen";
import { WatchRewardsSyncModal } from "./src/lite/components/WatchRewardsSyncModal";
import { HomeScreen } from "./src/lite/screens/HomeScreen";
import { CityHubScreen } from "./src/lite/screens/CityHubScreen";
import { CityMarketplaceScreen } from "./src/lite/screens/CityMarketplaceScreen";
import { FitnessScreen } from "./src/lite/screens/FitnessScreen";
import { InventoryScreen } from "./src/lite/screens/InventoryScreen";
import { LeaderboardScreen } from "./src/lite/screens/LeaderboardScreen";
import { LoginScreen } from "./src/lite/screens/LoginScreen";
import { MarketplaceScreen } from "./src/lite/screens/MarketplaceScreen";
import { GachaScreen } from "./src/lite/screens/GachaScreen";
import { OverworldScreen } from "./src/lite/screens/OverworldScreen";
import { QuestsScreen } from "./src/lite/screens/QuestsScreen";
import { TrainingScreen } from "./src/lite/screens/TrainingScreen";
import { useWatchBridge } from "./src/hooks/useWatchBridge";
import { theme } from "./src/lite/theme";

export type RootTabs = {
  CityHub: undefined;
  /** `from` decides where the market's back button returns (Home's MARKET or the city's Vendor). */
  CityMarket: { from?: "Home" | "CityHub" } | undefined;
  Arena: undefined;
  Home: undefined;
  Fitness: undefined;
  Gacha: undefined;
  Inventory: undefined;
  Leaderboard: undefined;
  Marketplace: undefined;
  Overworld: undefined;
  Quests: undefined;
  Training: undefined;
};

const Tab = createBottomTabNavigator<RootTabs>();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.colors.carbon,
    card: theme.plates.navy,
    text: theme.colors.text,
    border: theme.colors.border,
    primary: theme.colors.accent,
  },
};

function AuthedApp() {
  const { bootLoading, profile, profileError, profileLoading, sessionLocked, user } = useAuth();
  // Lite #142 starts the profile read in the same AuthContext update as the sign-in. Main's shared AuthContext keeps its
  // original order (the original app's first render after sign-in must not change), so it sets the user one render
  // before the read starts. Track which account's read has started, so no render shows Home (or its CAN'T LOAD roster)
  // before that read begins.
  const profileReadFor = useRef<string | null>(null);
  if (!user) profileReadFor.current = null;
  else if (profileLoading || profile || profileError) profileReadFor.current = user.uid;
  const profileReadPending = !!user && profileReadFor.current !== user.uid;
  const watchRewardsSync = useWatchBridge(
    user?.uid,
    (profile?.holobots || []).map((holobot) => holobot.name),
  );

  // Only a first profile read covers the app; a retry after an error stays on Home (LOADING ROSTER…).
  if (bootLoading || (user && profileLoading && !profile && !profileError)) {
    return <AppLoadingScreen />;
  }

  if (profileReadPending) {
    return <AppLoadingScreen />;
  }

  if (!user || sessionLocked) {
    return <LoginScreen />;
  }

  return (
    <>
      <NavigationContainer theme={navTheme}>
        <StatusBar style="light" />
        <Tab.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerShown: false,
            freezeOnBlur: true,
            tabBarStyle: {
              display: "none",
            },
            tabBarActiveTintColor: theme.colors.accent,
            tabBarInactiveTintColor: theme.colors.muted,
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} />
          <Tab.Screen name="CityHub" component={CityHubScreen} />
          <Tab.Screen name="CityMarket" component={CityMarketplaceScreen} />
          <Tab.Screen name="Fitness" component={FitnessScreen} />
          <Tab.Screen name="Marketplace" component={MarketplaceScreen} />
          <Tab.Screen name="Inventory" component={InventoryScreen} />
          <Tab.Screen name="Arena" component={ArenaScreen} />
          <Tab.Screen name="Gacha" component={GachaScreen} />
          <Tab.Screen name="Leaderboard" component={LeaderboardScreen} />
          <Tab.Screen name="Training" component={TrainingScreen} />
          <Tab.Screen name="Quests" component={QuestsScreen} />
          <Tab.Screen name="Overworld" component={OverworldScreen} />
        </Tab.Navigator>
      </NavigationContainer>
      <WatchRewardsSyncModal
        error={watchRewardsSync.error}
        onClose={watchRewardsSync.dismissPendingRewardsPrompt}
        onSync={() => void watchRewardsSync.processPendingWatchWorkouts()}
        pendingCount={watchRewardsSync.pendingCount}
        processing={watchRewardsSync.processing}
        rewards={watchRewardsSync.pendingTotals}
        visible={watchRewardsSync.visible}
      />
    </>
  );
}

function EnabledLiteApp() {
  const [fontsReady, fontError] = useFonts({
    HoloDisplay: require("./assets/fonts/Rajdhani-Medium.ttf"),
    HoloBody: require("./assets/fonts/Saira-Regular.ttf"),
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {!fontsReady && !fontError ? <AppLoadingScreen fontsPending /> : isLitePreviewEnabled() ? (
          <OfflinePreview />
        ) : (
          <AuthProvider>
            <AuthedApp />
          </AuthProvider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function OfflinePreview() {
  const Preview = require("./src/lite/qa/HoloCityPreview").HoloCityPreviewApp;
  return <Preview />;
}

export default function LiteApp() { return isLiteEnabled() ? <EnabledLiteApp /> : null; }
