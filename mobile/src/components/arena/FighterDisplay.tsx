import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import type { ArenaFighter, StaminaState } from '../../types/arena';

interface FighterDisplayProps {
  fighter: ArenaFighter;
  position: 'top' | 'bottom';
  isActive: boolean;
}

export function FighterDisplay({ fighter, position, isActive }: FighterDisplayProps) {
  const hpPercent = (fighter.currentHP / fighter.maxHP) * 100;
  const staminaPercent = (fighter.stamina / fighter.maxStamina) * 100;
  const specialPercent = fighter.specialMeter;

  const getStaminaColor = (state: StaminaState): string => {
    switch (state) {
      case 'fresh': return '#22c55e';
      case 'working': return '#eab308';
      case 'gassed': return '#f97316';
      case 'exhausted': return '#ef4444';
    }
  };

  const getHpColor = (percent: number): string => {
    if (percent > 60) return '#22c55e';
    if (percent > 30) return '#eab308';
    return '#ef4444';
  };

  return (
    <View style={[
      styles.container,
      position === 'top' ? styles.topContainer : styles.bottomContainer,
      isActive && styles.activeContainer,
    ]}>
      {/* Avatar */}
      <View style={styles.avatarContainer}>
        <View style={[
          styles.avatarBorder,
          { borderColor: isActive ? '#f5c40d' : '#3d3d3d' }
        ]}>
          {fighter.avatar ? (
            <Image
              source={typeof fighter.avatar === 'string' ? { uri: fighter.avatar } : fighter.avatar}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>{fighter.name.charAt(0)}</Text>
            </View>
          )}
        </View>
        {fighter.isInDefenseMode && (
          <View style={styles.defenseBadge}>
            <Text style={styles.defenseBadgeText}>🛡️</Text>
          </View>
        )}
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        {/* Name & HP Text */}
        <View style={styles.nameRow}>
          <Text style={styles.fighterName}>{fighter.name}</Text>
          <Text style={styles.hpText}>
            {fighter.currentHP}/{fighter.maxHP}
          </Text>
        </View>

        {/* HP Bar */}
        <View style={styles.barContainer}>
          <Svg height="12" width="100%">
            <Defs>
              <LinearGradient id="hpGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <Stop offset="0%" stopColor={getHpColor(hpPercent)} stopOpacity="1" />
                <Stop offset="100%" stopColor={getHpColor(hpPercent)} stopOpacity="0.7" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="12" rx="6" fill="#1a1a1a" />
            <Rect
              x="0"
              y="0"
              width={`${hpPercent}%`}
              height="12"
              rx="6"
              fill="url(#hpGradient)"
            />
          </Svg>
        </View>

        {/* Stamina & Special Row */}
        <View style={styles.subBarsRow}>
          {/* Stamina */}
          <View style={styles.subBarContainer}>
            <Text style={[styles.subBarLabel, { color: getStaminaColor(fighter.staminaState) }]}>
              ⚡ {fighter.stamina}/{fighter.maxStamina}
            </Text>
            <View style={styles.miniBar}>
              <View
                style={[
                  styles.miniBarFill,
                  {
                    width: `${staminaPercent}%`,
                    backgroundColor: getStaminaColor(fighter.staminaState),
                  },
                ]}
              />
            </View>
          </View>

          {/* Special Meter */}
          <View style={styles.subBarContainer}>
            <Text style={[styles.subBarLabel, { color: specialPercent >= 100 ? '#a855f7' : '#6b7280' }]}>
              ✨ {specialPercent}%
            </Text>
            <View style={styles.miniBar}>
              <View
                style={[
                  styles.miniBarFill,
                  {
                    width: `${specialPercent}%`,
                    backgroundColor: specialPercent >= 100 ? '#a855f7' : '#6b7280',
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Combo Counter */}
        {fighter.comboCounter > 0 && (
          <View style={styles.comboContainer}>
            <Text style={styles.comboText}>
              {fighter.comboCounter}x COMBO!
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    gap: 12,
  },
  topContainer: {
    borderWidth: 1,
    borderColor: '#ef4444',
    borderLeftWidth: 4,
  },
  bottomContainer: {
    borderWidth: 1,
    borderColor: '#22c55e',
    borderLeftWidth: 4,
  },
  activeContainer: {
    borderColor: '#f5c40d',
    shadowColor: '#f5c40d',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatarBorder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    overflow: 'hidden',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    backgroundColor: '#2d2d2d',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#f5c40d',
    fontSize: 24,
    fontWeight: 'bold',
  },
  defenseBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  defenseBadgeText: {
    fontSize: 12,
  },
  statsContainer: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fighterName: {
    color: '#fef1e0',
    fontSize: 16,
    fontWeight: '600',
  },
  hpText: {
    color: '#9ca3af',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  barContainer: {
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
  },
  subBarsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  subBarContainer: {
    flex: 1,
  },
  subBarLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  miniBar: {
    height: 6,
    backgroundColor: '#1a1a1a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  comboContainer: {
    position: 'absolute',
    top: -8,
    right: 0,
    backgroundColor: '#f5c40d',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  comboText: {
    color: '#050606',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
