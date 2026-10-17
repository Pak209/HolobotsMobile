import { hostTierLabel } from "@/components/dashboard/holobotPresentation";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { HolobotViewer } from "@/components/HolobotViewer";
import { GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";
import { getExpProgress, type HolobotRosterEntry } from "@/config/holobots";
import { slotAccent, theme } from "@/theme";

type Props = {
  holobot: HolobotRosterEntry;
  slot?: number;
  selected?: boolean;
  live?: boolean;
  compact?: boolean;
  blueprintCount?: number;
  onPress?: () => void;
  actionLabel?: string;
};

/** Canonical roster pattern: the ring and plate stripe rotate through the Unity roster accents. */
export function HolobotRosterCard({ holobot, slot = 0, selected = false, live = false, compact = false, blueprintCount = 0, onPress, actionLabel }: Props) {
  const accent = slotAccent(false, slot);
  const tier = hostTierLabel(holobot.hostRank);
  const progress = Math.max(0, Math.min(1, holobot.owned ? getExpProgress(holobot) : blueprintCount / 5));
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={actionLabel || `${holobot.name}, ${holobot.owned ? `level ${holobot.level}` : "unminted"}. Open details`}
      accessibilityState={{ selected }} style={({ pressed }) => [styles.card, compact && styles.compact, pressed && styles.pressed]}>
      <GameSurfaceFrame accent={selected ? accent : theme.colors.border} fill={theme.plates.navy} strong={selected} />
      <View style={[styles.stripe, { backgroundColor: accent }]} />
      <View style={[styles.visual, compact && styles.visualCompact]} pointerEvents="none">
        {live && holobot.owned ? <HolobotViewer botId={holobot.key} active={live} style={StyleSheet.absoluteFill} /> :
          <Image source={holobot.imageSource} style={styles.image} resizeMode="contain" />}
        <View style={[styles.ring, { borderColor: accent }]} />
        <Text style={[styles.slot, { color: accent }]}>NO. {String(slot + 1).padStart(2, "0")}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name}>{holobot.name}</Text>
          {selected && <Text style={[styles.tag, { color: accent }]}>ACTIVE</Text>}
        </View>
        <Text style={styles.meta}>{holobot.owned ? `LV ${holobot.level}` : "BLUEPRINT LINK"}</Text>
        {tier && <Text style={styles.tier}>{tier}</Text>}
        <View style={styles.progressRow}>
          <Text style={styles.caption}>{holobot.owned ? "EXPERIENCE" : "BLUEPRINTS"}</Text>
          <Text style={styles.progressText}>{holobot.owned ? `${holobot.experience} / ${holobot.nextLevelExp}` : `${blueprintCount} / 5`}</Text>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: accent }]} /></View>
        {!compact && <View style={styles.stats}>
          {[['ATK', holobot.stats.attack], ['DEF', holobot.stats.defense], ['SPD', holobot.stats.speed]].map(([label, value]) =>
            <View key={label} style={styles.stat}><Text style={styles.caption}>{label}</Text><Text style={styles.statValue}>{value}</Text></View>)}
        </View>}
        <Text style={[styles.action, { color: accent }]}>{actionLabel || (holobot.owned ? "OPEN HOLOBOT  ›" : "VIEW BLUEPRINTS  ›")}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 188, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, position: "relative", overflow: "hidden" },
  compact: { minHeight: 136, padding: 12, gap: 10 },
  pressed: { opacity: 0.8 },
  stripe: { position: "absolute", left: 3, top: 20, bottom: 20, width: 3 },
  visual: { width: "36%", height: 180, position: "relative", justifyContent: "center", alignItems: "center" },
  visualCompact: { width: "30%", height: 118 },
  image: { width: "100%", height: "94%" },
  ring: { width: "88%", height: 16, borderWidth: 1.5, borderRadius: 100, position: "absolute", bottom: 8, opacity: 0.6 },
  slot: { ...theme.type.micro, position: "absolute", top: 0, left: 0, letterSpacing: 1 },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  name: { ...theme.type.header, color: theme.colors.text, flexShrink: 1 },
  tag: { ...theme.type.micro, letterSpacing: 1 },
  meta: { ...theme.type.caption, color: theme.colors.muted, marginTop: 2, textTransform: "uppercase" },
  tier: { ...theme.type.caption, color: theme.colors.cursor, marginTop: 3 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", gap: 6, marginTop: 12 },
  caption: { ...theme.type.micro, color: theme.colors.muted, letterSpacing: 0.7 },
  progressText: { ...theme.type.micro, color: theme.colors.text },
  track: { height: 4, backgroundColor: theme.colors.graphite, marginTop: 5 },
  fill: { height: "100%" },
  stats: { flexDirection: "row", gap: 20, marginTop: 12 },
  stat: { gap: 2 },
  statValue: { ...theme.type.value, color: theme.colors.text },
  action: { ...theme.type.micro, marginTop: 12, letterSpacing: 0.8 },
});
