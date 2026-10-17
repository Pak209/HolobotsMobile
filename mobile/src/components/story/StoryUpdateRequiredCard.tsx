import { Pressable, StyleSheet, Text, View } from "react-native";

import { ArenaControlFrame } from "@/components/arena/ArenaTierFrames";
import { GameSurfaceFrame } from "@/components/ui/GameSurfaceFrame";

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
        <GameSurfaceFrame accent="#f0bf14" fill="#07080a" strong />
        <View style={styles.content}>
          <Text style={styles.title}>STORY MODE NEEDS AN UPDATE</Text>
          <Text style={styles.copy}>
            {`The overworld you loaded speaks protocol v${webProtocolVersion} but this app speaks v${appProtocolVersion}.`}
          </Text>
          <Text style={styles.copyMuted}>Update the app (or the overworld build) and come back to the hangar.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.button}>
            <ArenaControlFrame accent="#f0bf14" />
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
    color: "#f0bf14",
    fontSize: 14,
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
    color: "#fef1e0",
    fontSize: 15,
    lineHeight: 21,
    marginTop: 12,
    textAlign: "center",
  },
  copyMuted: {
    color: "#ddd2b5",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    textAlign: "center",
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "#050606",
    justifyContent: "center",
    paddingHorizontal: 20,
    zIndex: 40,
  },
  title: {
    color: "#f0bf14",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 2,
    textAlign: "center",
  },
});
