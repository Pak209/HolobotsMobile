import { theme } from "@/lite/theme";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ArenaControlFrame } from "@/lite/components/arena/ArenaTierFrames";
import { GameSurfaceFrame } from "@/lite/components/ui/GameSurfaceFrame";

type StoryUpdateRequiredCardProps = {
  appProtocolVersion: number;
  webProtocolVersion: number;
  onBack: () => void;
};

/** Friendly protocol-mismatch screen (contract §A.5 / §E) — never a broken map. */
export function StoryUpdateRequiredCard({ appProtocolVersion, webProtocolVersion, onBack }: StoryUpdateRequiredCardProps) {
  return (
    <View style={styles.layer}>
      <View style={styles.card}>
        <GameSurfaceFrame accent={theme.colors.accent} fill={theme.plates.navy} strong />
        <View style={styles.content}>
          <Text style={styles.title}>STORY MODE NEEDS AN UPDATE</Text>
          <Text style={styles.copy}>
            {`The overworld you loaded speaks protocol v${webProtocolVersion} but this app speaks v${appProtocolVersion}.`}
          </Text>
          <Text style={styles.copyMuted}>Update the app (or the overworld build) and come back to the hangar.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.button}>
            <ArenaControlFrame accent={theme.colors.accent} />
            <Text style={styles.buttonText}>BACK</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    alignSelf: "center",
    height: 48,
    justifyContent: "center",
    marginTop: 20,
    width: 160,
  },
  buttonText: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.body.fontSize,
    fontWeight: "800",
    letterSpacing: 2,
  },
  card: {
    minHeight: 220,
    position: "relative",
    width: "100%",
  },
  content: {
    padding: 24,
  },
  copy: {
    color: theme.colors.text,
    fontFamily: "HoloBody",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 12,
    textAlign: "center",
  },
  copyMuted: {
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    textAlign: "center",
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: theme.colors.carbon,
    justifyContent: "center",
    paddingHorizontal: 20,
    zIndex: 40,
  },
  title: {
    color: theme.colors.accent,
    fontFamily: "HoloDisplay",
    fontSize: theme.type.label.fontSize,
    fontWeight: "800",
    letterSpacing: 2,
    textAlign: "center",
  },
});
