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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface BattleResultsModalProps {
  visible: boolean;
  didWin: boolean;
  rewards: BattleRewards;
  continueLabel?: string;
  subtitle?: string;
  onRematch: () => void;
  onExit: () => void;
}

export function BattleResultsModal({
  visible,
  didWin,
  rewards,
  continueLabel,
  subtitle,
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
          <View style={[
            styles.resultHeader,
            didWin ? styles.victoryHeader : styles.defeatHeader,
          ]}>
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
                <Text style={styles.rewardIcon}>EXP</Text>
                <Text style={styles.rewardLabel}>EXP</Text>
                <Text style={styles.rewardValue}>+{rewards.exp}</Text>
              </View>

              <View style={styles.rewardItem}>
                <Text style={styles.rewardIcon}>SP</Text>
                <Text style={styles.rewardLabel}>Sync Points</Text>
                <Text style={styles.rewardValue}>+{rewards.syncPoints}</Text>
              </View>

              {rewards.arenaTokens > 0 && (
                <View style={styles.rewardItem}>
                  <Text style={styles.rewardIcon}>AT</Text>
                  <Text style={styles.rewardLabel}>Arena Tokens</Text>
                  <Text style={styles.rewardValue}>+{rewards.arenaTokens}</Text>
                </View>
              )}

              {rewards.holos && rewards.holos > 0 && (
                <View style={[styles.rewardItem, styles.rareReward]}>
                  <Text style={styles.rewardIcon}>H</Text>
                  <Text style={styles.rewardLabel}>HOLOS</Text>
                  <Text style={[styles.rewardValue, styles.rareValue]}>
                    +{rewards.holos}
                  </Text>
                </View>
              )}

              {rewards.eloChange !== undefined && (
                <View style={styles.rewardItem}>
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
          </View>

          <View style={styles.buttonsContainer}>
            <TouchableOpacity
              style={[styles.button, styles.rematchButton]}
              onPress={onRematch}
            >
              <Text style={styles.rematchButtonText}>{continueLabel || 'REMATCH'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.exitButton]}
              onPress={onExit}
            >
              <Text style={styles.exitButtonText}>EXIT ARENA</Text>
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
    backgroundColor: '#050606',
    borderRadius: 0,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#f0bf14',
  },
  resultHeader: {
    backgroundColor: '#090909',
    borderBottomWidth: 3,
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 6,
  },
  victoryHeader: {
    borderBottomColor: '#f0bf14',
  },
  defeatHeader: {
    borderBottomColor: '#ef2b23',
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
    backgroundColor: '#0b0d10',
    borderColor: '#25291c',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rareReward: {
    backgroundColor: '#071016',
    borderWidth: 1,
    borderColor: '#00d9ff',
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
    paddingVertical: 14,
    alignItems: 'center',
  },
  rematchButton: {
    backgroundColor: '#f5c40d',
  },
  rematchButtonText: {
    color: '#050606',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1,
  },
  exitButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#343434',
  },
  exitButtonText: {
    color: '#ddd2b5',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
});
