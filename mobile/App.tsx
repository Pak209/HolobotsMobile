import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "./src/contexts/AuthContext";
import { ArenaScreen } from "./src/screens/ArenaScreen";
import { AppLoadingScreen } from "./src/components/AppLoadingScreen";
import { WatchRewardsSyncModal } from "./src/components/WatchRewardsSyncModal";
import { HomeScreen } from "./src/screens/HomeScreen";
import { CityHubScreen } from "./src/screens/CityHubScreen";
import { CityMarketplaceScreen } from "./src/screens/CityMarketplaceScreen";
import { FitnessScreen } from "./src/screens/FitnessScreen";
import { InventoryScreen } from "./src/screens/InventoryScreen";
import { LeaderboardScreen } from "./src/screens/LeaderboardScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MarketplaceScreen } from "./src/screens/MarketplaceScreen";
import { GachaScreen } from "./src/screens/GachaScreen";
import { OverworldScreen } from "./src/screens/OverworldScreen";
import { QuestsScreen } from "./src/screens/QuestsScreen";
import { TrainingScreen } from "./src/screens/TrainingScreen";
import { useWatchBridge } from "./src/hooks/useWatchBridge";
import { theme } from "./src/theme";

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
  const { bootLoading, profile, profileLoading, sessionLocked, user } = useAuth();
  const watchRewardsSync = useWatchBridge(
    user?.uid,
    (profile?.holobots || []).map((holobot) => holobot.name),
  );

  if (bootLoading || (user && profileLoading && !profile)) {
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

export default function App() {
  const [fontsReady, fontError] = useFonts({
    HoloDisplay: require("./assets/fonts/Rajdhani-Medium.ttf"),
    HoloBody: require("./assets/fonts/Saira-Regular.ttf"),
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {!fontsReady && !fontError ? <AppLoadingScreen /> : __DEV__ && process.env.EXPO_PUBLIC_HOLOCITY_PREVIEW === "1" ? (
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
  const Preview = require("./src/qa/HoloCityPreview").HoloCityPreviewApp;
  return <Preview />;
}
