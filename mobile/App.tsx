import { useEffect } from "react";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Asset } from "expo-asset";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "./src/contexts/AuthContext";
import { ArenaScreen } from "./src/screens/ArenaScreen";
import { AppLoadingScreen } from "./src/components/AppLoadingScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { FitnessScreen } from "./src/screens/FitnessScreen";
import { InventoryScreen } from "./src/screens/InventoryScreen";
import { LeaderboardScreen } from "./src/screens/LeaderboardScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { MarketplaceScreen } from "./src/screens/MarketplaceScreen";
import { GachaScreen } from "./src/screens/GachaScreen";
import { QuestsScreen } from "./src/screens/QuestsScreen";
import { TrainingScreen } from "./src/screens/TrainingScreen";
import { fitnessAssetList } from "./src/config/figmaAssets";

export type RootTabs = {
  Arena: undefined;
  Home: undefined;
  Fitness: undefined;
  Gacha: undefined;
  Inventory: undefined;
  Leaderboard: undefined;
  Marketplace: undefined;
  Quests: undefined;
  Training: undefined;
};

const Tab = createBottomTabNavigator<RootTabs>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#f5c40d",
    card: "#050606",
    text: "#fef1e0",
    border: "#d9a300",
    primary: "#f5c40d",
  },
};

function AuthedApp() {
  const { bootLoading, profile, profileLoading, sessionLocked, user } = useAuth();

  if (bootLoading || (user && profileLoading && !profile)) {
    return <AppLoadingScreen />;
  }

  if (!user || sessionLocked) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="dark" />
      <Tab.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            display: "none",
          },
          tabBarActiveTintColor: "#f5c40d",
          tabBarInactiveTintColor: "#d7d0bd",
        }}
      >
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Fitness" component={FitnessScreen} />
        <Tab.Screen name="Marketplace" component={MarketplaceScreen} />
        <Tab.Screen name="Inventory" component={InventoryScreen} />
        <Tab.Screen name="Arena" component={ArenaScreen} />
        <Tab.Screen name="Gacha" component={GachaScreen} />
        <Tab.Screen name="Leaderboard" component={LeaderboardScreen} />
        <Tab.Screen name="Training" component={TrainingScreen} />
        <Tab.Screen name="Quests" component={QuestsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  useEffect(() => {
    void Asset.loadAsync(fitnessAssetList);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <AuthedApp />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
