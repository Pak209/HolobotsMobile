import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { DuelPlaybackScreen } from "@/screens/DuelPlaybackScreen";
import type { BotStagePerf, PerfArmResult } from "@/components/bots/BotStage";
import { PERF_SWEEP_ARMS } from "@/lib/bots/stagePerf";

const noop = () => {};

/** Dev-only scripted cost sweep on the offline host-duel route, held on round 1.
 * Each arm remounts the GL context with one knob set, warms 1 s, then logs 5 s of completed frames.
 * Presentation measurement only: no account, host, rewards or outcome logic.
 */
export function DuelPerfSweepPreview({ receipt }: { receipt: unknown }) {
  const [index, setIndex] = useState(0);
  const [last, setLast] = useState("");
  const results = useRef<PerfArmResult[]>([]);
  const arm = PERF_SWEEP_ARMS[index];
  const onArmDone = useCallback((result: PerfArmResult) => {
    if (results.current.some(previous => previous.arm === result.arm)) return;
    results.current.push(result);
    setLast(`${result.arm} ${result.summary.fps} fps`);
    if (results.current.length === PERF_SWEEP_ARMS.length) {
      console.info("[HolobotViewer:perfSweep] " + JSON.stringify({ complete: true, arms: results.current.map(({ arm: id, drawWidth, drawHeight, defaultFramebufferSamples, reactRendersPerSecond, summary }) => ({ arm: id, fps: summary.fps, fps1s: summary.fps1s, frameMs: summary.frameMs, barrierMs: summary.barrierMs, drawWidth, drawHeight, defaultFramebufferSamples, drawCalls: summary.drawCalls, triangles: summary.triangles, glCallsPerFrame: summary.glCallsPerFrame, reactRendersPerSecond })) }));
    }
    setIndex(value => value + 1);
  }, []);
  const perf = useMemo<BotStagePerf | undefined>(() => arm ? { arm: arm.id, knobs: arm.knobs, onArmDone } : undefined, [arm, onArmDone]);
  if (!__DEV__) return null;
  return <View style={styles.root}>
    <DuelPlaybackScreen fixture receipt={receipt} onClose={noop} perf={perf} holdCues={arm ? arm.cues === "hold" : true} />
    <View pointerEvents="none" style={styles.banner}>
      <Text style={styles.text}>{arm ? `PERF SWEEP ${index + 1}/${PERF_SWEEP_ARMS.length} · ${arm.id}` : "PERF SWEEP COMPLETE"}{last ? ` · last ${last}` : ""}</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: { position: "absolute", top: "21%", left: 12, right: 12, alignItems: "center" },
  text: { color: "#62DDE8", fontSize: 11, letterSpacing: 1, backgroundColor: "#101318CC", paddingHorizontal: 8, paddingVertical: 4 },
});
