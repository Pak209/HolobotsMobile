import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme';
import { resolveBotId } from '../../../assets/bots';
import { BotStage, type BotMetrics, type BotStageHandle } from './bots/BotStage';
export type { BotMetrics } from './bots/BotStage';
export type HolobotViewerHandle = { play(clipName: string): boolean };
export type HolobotViewerProps = { botId: string; style?: StyleProp<ViewStyle>; active?: boolean; onMetrics?: (metrics: BotMetrics) => void; showMetrics?: boolean; onReady?: () => void };
export const HolobotViewer = forwardRef<HolobotViewerHandle, HolobotViewerProps>(function HolobotViewer({ botId, ...props }, ref) {
  const stage = useRef<BotStageHandle>(null);
  const id = resolveBotId(botId);
  useImperativeHandle(ref, () => ({ play: clip => stage.current?.play('bot', clip) ?? false }), []);
  if (!id) return <View style={[styles.unavailable, props.style]}><Text style={styles.label}>3D model unavailable · {botId.toUpperCase()}</Text></View>;
  return <BotStage ref={stage} bots={[{ id, side: 'bot' }]} {...props} />;
});
export default HolobotViewer;
const styles = StyleSheet.create({ unavailable: { height: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.carbon, borderRadius: 14 }, label: { color: theme.colors.subtle, fontSize: 12 } });
