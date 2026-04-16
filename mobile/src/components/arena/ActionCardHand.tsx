import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import type { ActionCard, CardType } from '../../types/arena';

interface ActionCardHandProps {
  cards: ActionCard[];
  playableCardIds: string[];
  selectedCardId: string | null;
  onCardSelect: (cardId: string) => void;
  onCardPlay: (cardId: string) => void;
  disabled: boolean;
}

export function ActionCardHand({
  cards,
  playableCardIds,
  selectedCardId: _selectedCardId,
  onCardSelect: _onCardSelect,
  onCardPlay,
  disabled,
}: ActionCardHandProps) {
  const getCardTypeColor = (type: CardType): { bg: string; border: string; text: string } => {
    switch (type) {
      case 'strike':
        return { bg: '#7f1d1d', border: '#ef4444', text: '#fca5a5' };
      case 'defense':
        return { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' };
      case 'combo':
        return { bg: '#4c1d95', border: '#8b5cf6', text: '#c4b5fd' };
      case 'finisher':
        return { bg: '#713f12', border: '#f59e0b', text: '#fcd34d' };
    }
  };

  const getCardIcon = (type: CardType): string => {
    switch (type) {
      case 'strike': return '⚔️';
      case 'defense': return '🛡️';
      case 'combo': return '💥';
      case 'finisher': return '⭐';
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>YOUR CARDS</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cardsContainer}
      >
        {cards.map((card) => {
          const isPlayable = playableCardIds.includes(card.id);
          const colors = getCardTypeColor(card.type);

          return (
            <TouchableOpacity
              key={card.id}
              disabled={disabled || !isPlayable}
              onPress={() => onCardPlay(card.id)}
              style={[
                styles.card,
                {
                  backgroundColor: colors.bg,
                  borderColor: colors.border,
                  opacity: isPlayable ? 1 : 0.4,
                },
              ]}
            >
              {/* Card Type Badge */}
              <View style={[styles.typeBadge, { backgroundColor: colors.border }]}>
                <Text style={styles.typeIcon}>{getCardIcon(card.type)}</Text>
              </View>

              {/* Stamina Cost */}
              <View style={styles.costBadge}>
                <Text style={styles.costText}>{card.staminaCost}</Text>
              </View>

              {/* Card Content */}
              <View style={styles.cardContent}>
                <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={2}>
                  {card.name}
                </Text>

                {card.baseDamage > 0 && (
                  <View style={styles.damageContainer}>
                    <Text style={styles.damageValue}>{card.baseDamage}</Text>
                    <Text style={styles.damageLabel}>DMG</Text>
                  </View>
                )}
              </View>

              {isPlayable && !disabled ? (
                <View style={styles.tapToPlay}>
                  <Text style={styles.tapToPlayText}>PLAY</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Card type legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>⚔️</Text>
          <Text style={styles.legendText}>Strike</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>🛡️</Text>
          <Text style={styles.legendText}>Defense</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>💥</Text>
          <Text style={styles.legendText}>Combo</Text>
        </View>
        <View style={styles.legendItem}>
          <Text style={styles.legendIcon}>⭐</Text>
          <Text style={styles.legendText}>Finisher</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
  },
  title: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: 8,
    marginLeft: 4,
  },
  cardsContainer: {
    paddingHorizontal: 4,
    gap: 10,
  },
  card: {
    width: 90,
    height: 130,
    borderRadius: 10,
    borderWidth: 2,
    padding: 8,
    position: 'relative',
  },
  selectedCard: {
    transform: [{ scale: 1.05 }, { translateY: -8 }],
    shadowColor: '#f5c40d',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 12,
  },
  typeBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeIcon: {
    fontSize: 12,
  },
  costBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f5c40d',
  },
  costText: {
    color: '#f5c40d',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 20,
  },
  cardName: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  damageContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  damageValue: {
    color: '#ef4444',
    fontSize: 20,
    fontWeight: 'bold',
  },
  damageLabel: {
    color: '#9ca3af',
    fontSize: 8,
  },
  tapToPlay: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    backgroundColor: '#f5c40d',
    borderRadius: 4,
    paddingVertical: 2,
  },
  tapToPlayText: {
    color: '#050606',
    fontSize: 8,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendIcon: {
    fontSize: 10,
  },
  legendText: {
    color: '#6b7280',
    fontSize: 10,
  },
});
