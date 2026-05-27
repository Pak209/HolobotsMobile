import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  ImageBackground,
} from 'react-native';
import { FighterDisplay } from './FighterDisplay';
import { ActionCardHand } from './ActionCardHand';
import type { BattleState, ActionCard, BattleAction } from '../../types/arena';
import type { ArenaCardAvailability } from '../../features/arena/arenaCards';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const battlefieldImage = require("../../../assets/game/BattleField.png");

interface BattleArenaViewProps {
  battle: BattleState;
  playerCards: ActionCard[];
  playableCardIds: string[];
  cardAvailability: Record<string, ArenaCardAvailability>;
  selectedCardId: string | null;
  lastAction: BattleAction | null;
  isAnimating: boolean;
  onCardSelect: (cardId: string | null) => void;
  onCardPlay: (cardId: string) => void;
}

export function BattleArenaView({
  battle,
  playerCards,
  playableCardIds,
  cardAvailability,
  selectedCardId,
  lastAction,
  isAnimating,
  onCardSelect,
  onCardPlay,
}: BattleArenaViewProps) {
  const canActNow = playableCardIds.length > 0;

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
        <ImageBackground
          source={battlefieldImage}
          style={styles.battlefield}
          imageStyle={styles.battlefieldImage}
          resizeMode="contain"
        >
          <Image
            source={typeof battle.opponent.avatar === 'string' ? { uri: battle.opponent.avatar } : battle.opponent.avatar}
            style={[styles.battleHolobot, styles.opponentHolobot]}
            resizeMode="contain"
          />
          <Image
            source={typeof battle.player.avatar === 'string' ? { uri: battle.player.avatar } : battle.player.avatar}
            style={[styles.battleHolobot, styles.playerHolobot]}
            resizeMode="contain"
          />
        </ImageBackground>

        {/* Last Action Display */}
        {lastAction && (
          <View style={styles.actionDisplay}>
            <Text style={styles.actionText}>
              {lastAction.card.name}
            </Text>
            {(lastAction.actualDamage ?? lastAction.damageDealt) > 0 && (
              <Text style={[
                styles.damageText,
                lastAction.wasCountered && styles.counterText,
              ]}>
                {lastAction.wasCountered ? 'COUNTERED!' : `-${lastAction.actualDamage ?? lastAction.damageDealt} HP`}
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
          <View pointerEvents="none" style={styles.animationOverlay}>
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
        {/* Card Hand */}
        <ActionCardHand
          cards={playerCards}
          playableCardIds={playableCardIds}
          cardAvailability={cardAvailability}
          selectedCardId={selectedCardId}
          onCardSelect={onCardSelect}
          onCardPlay={onCardPlay}
          disabled={false}
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
    minHeight: 260,
  },
  battlefield: {
    width: SCREEN_WIDTH - 24,
    aspectRatio: 1672 / 941,
    justifyContent: 'center',
    position: 'relative',
  },
  battlefieldImage: {
    opacity: 0.95,
  },
  battleHolobot: {
    position: 'absolute',
    width: '36%',
    height: '72%',
  },
  opponentHolobot: {
    right: '9%',
    top: '8%',
    transform: [{ scaleX: -1 }],
  },
  playerHolobot: {
    bottom: '6%',
    left: '8%',
  },
  actionDisplay: {
    alignItems: 'center',
    backgroundColor: 'rgba(5, 6, 6, 0.82)',
    borderColor: 'rgba(245, 196, 13, 0.65)',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    position: 'absolute',
    top: 8,
    zIndex: 3,
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
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
  },
  animatingText: {
    fontSize: 48,
  },
  controlsSection: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
});
