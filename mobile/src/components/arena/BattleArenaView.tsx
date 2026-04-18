import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { FighterDisplay } from './FighterDisplay';
import { ActionCardHand } from './ActionCardHand';
import type { BattleState, ActionCard, BattleAction } from '../../types/arena';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface BattleArenaViewProps {
  battle: BattleState;
  playerCards: ActionCard[];
  playableCardIds: string[];
  selectedCardId: string | null;
  lastAction: BattleAction | null;
  isAnimating: boolean;
  onCardSelect: (cardId: string | null) => void;
  onCardPlay: (cardId: string) => void;
  onDefenseToggle: () => void;
}

export function BattleArenaView({
  battle,
  playerCards,
  playableCardIds,
  selectedCardId,
  lastAction,
  isAnimating,
  onCardSelect,
  onCardPlay,
  onDefenseToggle,
}: BattleArenaViewProps) {
  const canActNow = playableCardIds.length > 0 && !isAnimating;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.turnText}>LIVE BATTLE</Text>
        <View style={styles.turnIndicator}>
          <Text style={styles.turnIndicatorText}>LIVE</Text>
        </View>
      </View>

      {/* Opponent Display */}
      <View style={styles.fighterSection}>
        <FighterDisplay
          fighter={battle.opponent}
          position="top"
          isActive={!canActNow}
        />
      </View>

      {/* Battle Center */}
      <View style={styles.battleCenter}>
        {/* Last Action Display */}
        {lastAction && (
          <View style={styles.actionDisplay}>
            <Text style={styles.actionText}>
              {lastAction.card.name}
            </Text>
            {lastAction.damageDealt > 0 && (
              <Text style={[
                styles.damageText,
                lastAction.wasCountered && styles.counterText,
              ]}>
                {lastAction.wasCountered ? 'COUNTERED!' : `-${lastAction.damageDealt} HP`}
              </Text>
            )}
            {lastAction.perfectDefense && (
              <Text style={styles.perfectText}>PERFECT!</Text>
            )}
          </View>
        )}

        {/* VS Divider */}
        <View style={styles.vsDivider}>
          <View style={styles.vsLine} />
          <View style={styles.vsCircle}>
            <Text style={styles.vsText}>VS</Text>
          </View>
          <View style={styles.vsLine} />
        </View>

        {/* Animation placeholder */}
        {isAnimating && (
          <View style={styles.animationOverlay}>
            <Text style={styles.animatingText}>⚡</Text>
          </View>
        )}
      </View>

      {/* Player Display */}
      <View style={styles.fighterSection}>
        <FighterDisplay
          fighter={battle.player}
          position="bottom"
          isActive={canActNow}
        />
      </View>

      {/* Controls */}
      <View style={styles.controlsSection}>
        {/* Defense Toggle */}
        <TouchableOpacity
          style={[
            styles.defenseButton,
            battle.player.isInDefenseMode && styles.defenseButtonActive,
          ]}
          onPress={onDefenseToggle}
          disabled={isAnimating}
        >
          <Text style={styles.defenseButtonText}>
            🛡️ {battle.player.isInDefenseMode ? 'DEFENDING' : 'DEFENSE'}
          </Text>
        </TouchableOpacity>

        {/* Card Hand */}
        <ActionCardHand
          cards={playerCards}
          playableCardIds={playableCardIds}
          selectedCardId={selectedCardId}
          onCardSelect={onCardSelect}
          onCardPlay={onCardPlay}
          disabled={isAnimating}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050606',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 196, 13, 0.2)',
  },
  turnText: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
  turnIndicator: {
    backgroundColor: '#f5c40d',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  turnIndicatorText: {
    color: '#050606',
    fontSize: 11,
    fontWeight: 'bold',
  },
  fighterSection: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  battleCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  actionDisplay: {
    alignItems: 'center',
    marginBottom: 16,
  },
  actionText: {
    color: '#fef1e0',
    fontSize: 18,
    fontWeight: 'bold',
  },
  damageText: {
    color: '#ef4444',
    fontSize: 24,
    fontWeight: 'bold',
  },
  counterText: {
    color: '#f59e0b',
  },
  perfectText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
  },
  vsDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: SCREEN_WIDTH - 32,
  },
  vsLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(245, 196, 13, 0.3)',
  },
  vsCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(245, 196, 13, 0.15)',
    borderWidth: 2,
    borderColor: '#f5c40d',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 16,
  },
  vsText: {
    color: '#f5c40d',
    fontSize: 16,
    fontWeight: 'bold',
  },
  animationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  animatingText: {
    fontSize: 48,
  },
  controlsSection: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  defenseButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    borderWidth: 1,
    borderColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  defenseButtonActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.5)',
    borderColor: '#60a5fa',
  },
  defenseButtonText: {
    color: '#93c5fd',
    fontSize: 14,
    fontWeight: '600',
  },
});
