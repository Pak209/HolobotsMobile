import { theme } from "@/lite/theme";
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Dimensions,
} from 'react-native';
import { ARENA_RESULT_BUTTON, presentArenaResult, type ArenaResultReceipt } from './arenaResultPresenter';
import { ArenaControlFrame } from './ArenaTierFrames';
import { GameDialogFrame, GameSurfaceFrame } from '../ui/GameSurfaceFrame';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export type RunTotals = {
  exp: number;
  syncPoints: number;
  holos: number;
  blueprints: Record<string, number>;
  rounds: number;
};

interface BattleResultsModalProps {
  visible: boolean;
  didWin: boolean;
  /** Host receipt (rows = exactly what it carries) or the QA stand-in (no rows). */
  receipt: ArenaResultReceipt;
  /** Accumulated rewards across the tier run; shown after round 1. */
  runTotals?: RunTotals | null;
  continueLabel?: string;
  /** Match line prepended/appended to the presenter's subtitle. */
  context?: string;
  /** When there is no rematch path (3v3), show a single primary EXIT. */
  hideRematch?: boolean;
  onRematch: () => void;
  onExit: () => void;
}

export function BattleResultsModal({
  visible,
  didWin,
  receipt,
  runTotals,
  continueLabel,
  context,
  hideRematch,
  onRematch,
  onExit,
}: BattleResultsModalProps) {
  const view = presentArenaResult({ didWin, receipt, context });
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <GameDialogFrame accent={didWin ? theme.colors.accent : "#ef2b23"} fill={theme.colors.carbon} />
          <View style={[
            styles.resultHeader,
            didWin ? styles.victoryHeader : styles.defeatHeader,
          ]}>
            <View style={styles.headerRail}>
              <View style={[styles.headerRailFill, didWin ? styles.headerRailVictory : styles.headerRailDefeat]} />
            </View>
            <Text style={styles.resultEyebrow}>ARENA RESULT</Text>
            <Text style={[
              styles.resultText,
              didWin ? styles.victoryText : styles.defeatText,
            ]}>
              {didWin ? 'VICTORY!' : 'DEFEAT'}
            </Text>
          </View>

          <View style={styles.rewardsSection}>
            <Text style={styles.subtitle}>{view.subtitle}</Text>
            {view.rowsTitle ? (
              <Text style={styles.rewardsTitle}>{view.rowsTitle}</Text>
            ) : null}

            {view.rows.length > 0 ? (
              <View style={styles.rewardsList}>
                {view.rows.map((row) => (
                  <View key={row.key} style={styles.rewardItem}>
                    <GameSurfaceFrame accent={row.frameAccent} />
                    <Text style={styles.rewardIcon}>{row.icon}</Text>
                    <Text style={styles.rewardLabel}>{row.label}</Text>
                    <Text style={[styles.rewardValue, valueTone[row.tone]]}>{row.value}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {receipt.kind === 'host' && runTotals && runTotals.rounds > 1 ? (
              <View style={styles.runTotals}>
                <Text style={styles.runTotalsTitle}>
                  {`RUN TOTAL • ${runTotals.rounds} ROUNDS`}
                </Text>
                <Text style={styles.runTotalsLine}>
                  {`EXP +${runTotals.exp} • SP +${runTotals.syncPoints}${runTotals.holos > 0 ? ` • HOLOS +${runTotals.holos}` : ''}`}
                </Text>
                {Object.entries(runTotals.blueprints).map(([holobotKey, amount]) => (
                  <Text key={holobotKey} style={styles.runTotalsLine}>
                    {`${holobotKey.toUpperCase()} BLUEPRINT +${amount}`}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>

          <View style={styles.buttonsContainer}>
            {!hideRematch ? (
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.plate}
                onPress={onRematch}
              >
                <ArenaControlFrame accent={theme.colors.accent} selected />
                <Text style={styles.primaryLabel}>{continueLabel || 'REMATCH'}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              accessibilityRole="button"
              style={styles.plate}
              onPress={onExit}
            >
              <ArenaControlFrame accent={hideRematch ? theme.colors.accent : theme.colors.border} selected={hideRematch} />
              <Text style={hideRematch ? styles.primaryLabel : styles.secondaryLabel}>
                EXIT ARENA
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  ...ARENA_RESULT_BUTTON,
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    width: SCREEN_WIDTH - 48,
    maxWidth: 380,
    paddingHorizontal: 4,
    paddingVertical: 5,
    position: 'relative',
  },
  resultHeader: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 17,
    alignItems: 'center',
    gap: 6,
    position: 'relative',
  },
  victoryHeader: {
  },
  defeatHeader: {
  },
  headerRail: {
    backgroundColor: '#17191d',
    bottom: 0,
    height: 3,
    left: 24,
    overflow: 'hidden',
    position: 'absolute',
    right: 24,
  },
  headerRailFill: {
    height: '100%',
    width: '62%',
  },
  headerRailVictory: {
    backgroundColor: theme.colors.accent,
  },
  headerRailDefeat: {
    backgroundColor: '#ef2b23',
  },
  resultEyebrow: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: '900',
    letterSpacing: 2,
  },
  resultText: {
    fontFamily: "HoloDisplay",
    fontSize: theme.type.display.fontSize,
    fontWeight: '900',
    letterSpacing: 2,
  },
  victoryText: {
    color: theme.colors.text,
  },
  defeatText: {
    color: theme.colors.danger,
  },
  runTotals: {
    borderColor: theme.colors.accent,
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 10,
  },
  runTotalsLine: {
    color: '#d8dbe2',
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
    textAlign: 'center',
  },
  runTotalsTitle: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  rewardsSection: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 6,
  },
  subtitle: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 10,
    textAlign: 'center',
  },
  rewardsTitle: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.4,
    marginBottom: 12,
    textAlign: 'center',
  },
  rewardsList: {
    gap: 8,
  },
  rewardItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 43,
    paddingHorizontal: 14,
    paddingVertical: 9,
    position: 'relative',
  },
  rewardIcon: {
    color: theme.colors.accent,
    fontFamily: "HoloBody",
    fontSize: theme.type.caption.fontSize,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginRight: 12,
    minWidth: 32,
  },
  rewardLabel: {
    flex: 1,
    color: theme.colors.muted,
    fontFamily: "HoloBody",
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  rewardValue: {
    color: theme.colors.text,
    fontFamily: "HoloDisplay",
    fontSize: 17,
    fontWeight: '900',
  },
  rareValue: {
    color: theme.colors.accent,
  },
  positiveValue: {
    color: theme.colors.accent,
  },
  negativeValue: {
    color: theme.colors.danger,
  },
  buttonsContainer: {
    padding: 18,
    gap: 10,
  },
});

const valueTone = {
  plain: null,
  rare: styles.rareValue,
  positive: styles.positiveValue,
  negative: styles.negativeValue,
} as const;
