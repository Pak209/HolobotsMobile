import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

type CompactSectionHeaderProps = {
  eyebrow: string;
  meta: string;
  title: string;
};

export function CompactSectionHeader({
  eyebrow,
  meta,
  title,
}: CompactSectionHeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>{eyebrow.toUpperCase()}</Text>
      <View style={styles.headerMain}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        <Text numberOfLines={1} style={styles.meta}>{meta}</Text>
      </View>
    </View>
  );
}

type AngularPageTabsProps<T extends string> = {
  activeTab: T;
  onChange: (tab: T) => void;
  tabs: readonly T[];
};

function TabFrame({ active }: { active: boolean }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg height="100%" preserveAspectRatio="none" viewBox="0 0 100 42" width="100%">
        <Path
          d="M8 1 H92 L99 8 V34 L92 41 H8 L1 34 V8 Z"
          fill={active ? "#050606" : "#e6b90f"}
          stroke={active ? "#fff0a0" : "#8b6d07"}
          strokeWidth={active ? 1.5 : 1}
        />
        <Path
          d="M12 5 H35 M65 37 H88 M3 13 V25 M97 17 V29"
          fill="none"
          stroke={active ? "#f5c40d" : "#5f4904"}
          strokeOpacity={active ? 0.9 : 0.5}
          strokeWidth={1}
        />
        {active ? <Path d="M42 1 H58 L50 8 Z" fill="#f5c40d" /> : null}
      </Svg>
    </View>
  );
}

export function AngularPageTabs<T extends string>({
  activeTab,
  onChange,
  tabs,
}: AngularPageTabsProps<T>) {
  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => {
        const active = tab === activeTab;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={tab}
            onPress={() => onChange(tab)}
            style={({ pressed }) => [
              styles.tab,
              pressed ? styles.tabPressed : null,
            ]}
          >
            <TabFrame active={active} />
            <Text
              adjustsFontSizeToFit
              minimumFontScale={0.68}
              numberOfLines={1}
              style={[styles.tabText, active ? styles.tabTextActive : null]}
            >
              {tab.toUpperCase()}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: "#f5c40d",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  header: {
    backgroundColor: "#050606",
    borderBottomColor: "#f5c40d",
    borderBottomWidth: 3,
    paddingBottom: 9,
    paddingHorizontal: 22,
    paddingTop: 62,
  },
  headerMain: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 12,
    marginTop: 3,
    paddingRight: 84,
  },
  meta: {
    color: "#bdb59f",
    flex: 1,
    fontSize: 10,
    fontWeight: "700",
  },
  tab: {
    alignItems: "center",
    flex: 1,
    height: 42,
    justifyContent: "center",
    minWidth: 0,
    position: "relative",
  },
  tabPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
  tabText: {
    color: "#4a3802",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.15,
    paddingHorizontal: 5,
    textAlign: "center",
    zIndex: 1,
  },
  tabTextActive: {
    color: "#fff4d9",
  },
  tabs: {
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  title: {
    color: "#fff1df",
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.35,
  },
});
