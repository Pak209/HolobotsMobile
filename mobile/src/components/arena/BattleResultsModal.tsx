import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Dimensions,
} from 'react-native';
import type { BattleRewards } from '../../types/arena';
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
  rewards: BattleRewards;
  /** Accumulated rewards across the tier run; shown after round 1. */
  runTotals?: RunTotals | null;
  continueLabel?: string;
  subtitle?: string;
  /** When there is no rematch path (3v3), show a single primary EXIT. */
  hideRematch?: boolean;
  onRematch: () => void;
  onExit: () => void;
}

export function BattleResultsModal({
  visible,
  didWin,
  rewards,
  runTotals,
  continueLabel,
  subtitle,
  hideRematch,
  onRematch,
  onExit,
}: BattleResultsModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <GameDialogFrame accent={didWin ? "#f0bf14" : "#ef2b23"} fill="#050606" />
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
            {subtitle ? (
              <Text style={styles.subtitle}>{subtitle}</Text>
            ) : null}
            <Text style={styles.rewardsTitle}>
              {didWin ? 'REWARDS' : 'CONSOLATION'}
            </Text>

            <View style={styles.rewardsList}>
              <View style={styles.rewardItem}>
                <GameSurfaceFrame accent="#596273" />
                <Text style={styles.rewardIcon}>EXP</Text>
                <Text style={styles.rewardLabel}>EXP</Text>
                <Text style={styles.rewardValue}>+{rewards.exp}</Text>
              </View>

              <View style={styles.rewardItem}>
                <GameSurfaceFrame accent="#f0bf14" />
                <Text style={styles.rewardIcon}>SP</Text>
                <Text style={styles.rewardLabel}>Sync Points</Text>
                <Text style={styles.rewardValue}>+{rewards.syncPoints}</Text>
              </View>

              {typeof rewards.holos === "number" && rewards.holos > 0 ? (
                <View style={[styles.rewardItem, styles.rareReward]}>
                  <GameSurfaceFrame accent="#00d9ff" />
                  <Text style={styles.rewardIcon}>H</Text>
                  <Text style={styles.rewardLabel}>HOLOS</Text>
                  <Text style={[styles.rewardValue, styles.rareValue]}>
                    +{rewards.holos}
                  </Text>
                </View>
              ) : null}

              {rewards.blueprintRewards?.map((reward) => (
                <View key={reward.holobotKey} style={[styles.rewardItem, styles.rareReward]}>
                  <GameSurfaceFrame accent="#00d9ff" />
                  <Text style={styles.rewardIcon}>BP</Text>
                  <Text style={styles.rewardLabel}>{`${reward.holobotKey.toUpperCase()} BLUEPRINT`}</Text>
                  <Text style={[styles.rewardValue, styles.rareValue]}>+{reward.amount}</Text>
                </View>
              ))}

              {rewards.eloChange !== undefined && (
                <View style={styles.rewardItem}>
                  <GameSurfaceFrame accent={rewards.eloChange >= 0 ? "#f0bf14" : "#ef4444"} />
                  <Text style={styles.rewardIcon}>RT</Text>
                  <Text style={styles.rewardLabel}>Rating</Text>
                  <Text style={[
                    styles.rewardValue,
                    rewards.eloChange >= 0 ? styles.positiveValue : styles.negativeValue,
                  ]}>
                    {rewards.eloChange >= 0 ? '+' : ''}{rewards.eloChange}
                  </Text>
                </View>
              )}
            </View>

            {runTotals && runTotals.rounds > 1 ? (
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
                style={[styles.button, styles.rematchButton]}
                onPress={onRematch}
              >
                <ArenaControlFrame accent="#f0bf14" selected />
                <Text style={styles.rematchButtonText}>{continueLabel || 'REMATCH'}</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.button, hideRematch ? styles.rematchButton : styles.exitButton]}
              onPress={onExit}
            >
              <ArenaControlFrame accent={hideRematch ? "#f0bf14" : "#596273"} selected={hideRematch} />
              <Text style={hideRematch ? styles.rematchButtonText : styles.exitButtonText}>
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
    backgroundColor: '#f0bf14',
  },
  headerRailDefeat: {
    backgroundColor: '#ef2b23',
  },
  resultEyebrow: {
    color: '#f0bf14',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 2,
  },
  resultText: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 2,
  },
  victoryText: {
    color: '#fef1e0',
  },
  defeatText: {
    color: '#ef4444',
  },
  runTotals: {
    borderColor: '#f0bf14',
    borderTopWidth: 1,
    marginTop: 14,
    paddingTop: 10,
  },
  runTotalsLine: {
    color: '#d8dbe2',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
    textAlign: 'center',
  },
  runTotalsTitle: {
    color: '#f0bf14',
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
    color: '#f5c40d',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 10,
    textAlign: 'center',
  },
  rewardsTitle: {
    color: '#f0bf14',
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
  rareReward: {
  },
  rewardIcon: {
    color: '#f0bf14',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.7,
    marginRight: 12,
    minWidth: 32,
  },
  rewardLabel: {
    flex: 1,
    color: '#ddd2b5',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  rewardValue: {
    color: '#fef1e0',
    fontSize: 17,
    fontWeight: '900',
  },
  rareValue: {
    color: '#00d9ff',
  },
  positiveValue: {
    color: '#f0bf14',
  },
  negativeValue: {
    color: '#ef4444',
  },
  buttonsContainer: {
    padding: 18,
    gap: 10,
  },
  button: {
    justifyContent: 'center',
    minHeight: 48,
    alignItems: 'center',
    position: 'relative',
  },
  rematchButton: {
  },
  rematchButtonText: {
    color: '#050606',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  exitButton: {
  },
  exitButtonText: {
    color: '#ddd2b5',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
});
