import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import { getHolobotFullImageSource } from '@/config/holobots';
import { arenaBenchCards, arenaBenchPhaseLine, type Arena3v3Match, type ArenaBenchCard } from '@/lib/arenaMatch3v3';

/** 3v3 bench: active slot plus two bench slots, drawn ONLY from a host arena-match-3v3-1 projection.
 * Host HP and the host level badge only: no STA, no bench recovery, no local HP arithmetic. A swap button only
 * asks the host (onSwap); the cards change when a new host reply arrives, never before. */
export function ArenaBenchCards({ match, onSwap, busy = false }: { match: Arena3v3Match; onSwap?: (holobotId: string) => void; busy?: boolean }) {
    const [active, ...bench] = arenaBenchCards(match);
    const canAsk = !!onSwap && (match.battle.phase === 'command' || match.battle.phase === 'send_in');
    return <View style={styles.root} accessibilityLabel="3v3 bench, host vitals">
    <Text style={styles.phase}>{arenaBenchPhaseLine(match)}</Text>
    <Card card={active} wide/>
    <View style={styles.benchRow}>
      {bench.map(card => <Card key={card.slot} card={card} onSwap={canAsk && card.role === 'BENCH' ? () => onSwap!(card.holobotId) : undefined} busy={busy}/>)}
    </View>
  </View>;
}
function Card({ card, wide = false, onSwap, busy = false }: { card: ArenaBenchCard; wide?: boolean; onSwap?: () => void; busy?: boolean }) {
    const ko = card.role === 'KO', accent = ko ? theme.colors.danger : card.role === 'ACTIVE' ? theme.colors.accent : theme.colors.border;
    return <View style={[styles.card, wide ? styles.cardWide : styles.cardBench, { borderColor: accent }, ko && styles.cardKo]} accessibilityLabel={`${card.name} ${card.levelBadge} ${card.role} HP ${card.hpLabel}`}>
    <Image source={getHolobotFullImageSource(card.holobotId)} style={wide ? styles.artWide : styles.art} resizeMode="contain"/>
    <View style={styles.body}>
      <View style={styles.titleRow}>
        <Text numberOfLines={1} style={styles.name}>{card.name}</Text>
        <Text style={styles.level}>{card.levelBadge}</Text>
      </View>
      <Text style={[styles.role, { color: accent }]}>{card.role === 'ACTIVE' ? 'ACTIVE' : ko ? 'KO' : `BENCH ${card.slot}`}</Text>
      <View style={styles.hpTrack}><View style={[styles.hpFill, { flex: card.currentHealth, backgroundColor: ko ? theme.colors.danger : theme.colors.success }]}/><View style={{ flex: card.maxHealth - card.currentHealth }}/></View>
      <Text style={styles.hp}>{`HP ${card.hpLabel}`}</Text>
      {onSwap ? <Pressable disabled={busy} onPress={onSwap} accessibilityRole="button" accessibilityLabel={`Ask host to swap in ${card.name}`} style={[styles.swap, busy && styles.swapBusy]}>
          <Text style={styles.swapText}>{busy ? 'ASKING HOST…' : 'SWAP IN'}</Text>
        </Pressable> : null}
    </View>
  </View>;
}
const styles = StyleSheet.create({
    root: { gap: theme.space.sm, paddingHorizontal: theme.space.lg },
    phase: { ...theme.type.micro, color: theme.colors.cursor, letterSpacing: 1, textAlign: 'center' },
    benchRow: { flexDirection: 'row', gap: theme.space.sm },
    card: { backgroundColor: theme.plates.navy, borderWidth: 1, flexDirection: 'row', gap: theme.space.sm, padding: theme.space.sm },
    cardWide: { alignItems: 'center' },
    cardBench: { flex: 1, minWidth: 0 },
    cardKo: { opacity: 0.55 },
    art: { height: 44, width: 36 },
    artWide: { height: 72, width: 60 },
    body: { flex: 1, gap: 3, minWidth: 0 },
    titleRow: { alignItems: 'center', flexDirection: 'row', gap: 4 },
    name: { ...theme.type.label, color: theme.colors.text, flexShrink: 1 },
    level: { ...theme.type.micro, backgroundColor: theme.colors.carbon, color: theme.colors.text, fontSize: 12, paddingHorizontal: 4, paddingVertical: 1 },
    role: { ...theme.type.micro, letterSpacing: 1 },
    hpTrack: { backgroundColor: theme.colors.graphite, flexDirection: 'row', height: 6 },
    hpFill: { height: 6 },
    hp: { ...theme.type.caption, color: theme.colors.muted },
    swap: { alignItems: 'center', borderColor: theme.colors.accent, borderWidth: 1, justifyContent: 'center', marginTop: 2, minHeight: 32 },
    swapBusy: { borderColor: theme.colors.disabled },
    swapText: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1 },
});
