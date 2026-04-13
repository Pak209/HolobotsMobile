import { Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

import { Svg, Path } from "@/components/FigmaSvg";
import { useAuth } from "@/contexts/AuthContext";
import type { RootTabs } from "../../App";

export function HomeCogButton() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabs>>();
  const { logout } = useAuth();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go to home dashboard"
      onPress={() => navigation.navigate("Home")}
      onLongPress={logout}
      style={styles.button}
    >
      <View style={styles.inner}>
        <Svg width="28" height="28" viewBox="0 0 24 24">
          <Path d="M9 21v-6a2 2 0 0 1 2-2h1.6" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="m20 11l-8-8l-9 9h2v7a2 2 0 0 0 2 2h4.159" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M16 18a2 2 0 1 0 4 0a2 2 0 1 0-4 0" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M18 14.5V16" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="M18 20v1.5" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="m21.032 16.25-1.299.75" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="m16.269 19 1.299.75" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="m16.269 16.25 1.299.75" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d="m21.032 19-1.299.75" stroke="#f5c40d" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    right: 18,
    top: 72,
    zIndex: 20,
  },
  inner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#050606",
    borderWidth: 2,
    borderColor: "#f0bf14",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
});
