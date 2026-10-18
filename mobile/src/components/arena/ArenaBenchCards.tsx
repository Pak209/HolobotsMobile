import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import { getHolobotFullImageSource } from '@/config/holobots';
import { ARENA_3V3_COPY, arenaBenchCards, arenaBenchPhaseLine, arenaBuddySlot, type Arena3v3Match, type ArenaBenchCard } from '@/lib/arenaMatch3v3';

/** 3v3 bench: a BUDDY strip, then the active slot plus two bench slots, drawn ONLY from a host arena-match-3v3-1
 * projection. Host HP and the host level badge only: no STA, no bench recovery, no local HP arithmetic. A swap button
 * only asks the host (onSwap); the cards change when a new host reply arrives, never before. All copy is
 * ARENA_3V3_COPY (PLACEHOLDER until Lex). */
export function ArenaBenchCards({ match, onSwap, busy = false }: { match: Arena3v3Match; onSwap?: (holobotId: string) => void; busy?: boolean }) {
    const [active, ...bench] = arenaBenchCards(match), buddy = arenaBuddySlot(match);
    const canAsk = !!onSwap && match.state === 'active' && (match.battle.phase === 'command' || match.battle.phase === 'send_in');
    return <View style={styles.root} accessibilityLabel={ARENA_3V3_COPY.benchLabel}>
    <Text style={styles.phase}>{arenaBenchPhaseLine(match)}</Text>
    <View style={styles.buddy} accessibilityLabel={`${buddy.label}: ${buddy.line}`}>
      <Text style={styles.buddyLabel}>{buddy.label}</Text>
      <View style={styles.buddySlot}/>
      <Text numberOfLines={1} style={styles.buddyLine}>{buddy.line}</Text>
    </View>
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
      <Text numberOfLines={1} style={styles.name}>{card.name}</Text>
      <Text style={[styles.role, { color: accent }]}>{card.label}</Text>
      <View style={styles.hpTrack}><View style={[styles.hpFill, { flex: card.currentHealth, backgroundColor: ko ? theme.colors.danger : theme.colors.success }]}/><View style={{ flex: card.maxHealth - card.currentHealth }}/></View>
      <Text style={styles.hp}>{`HP ${card.hpLabel}`}</Text>
      {onSwap ? <Pressable disabled={busy} onPress={onSwap} accessibilityRole="button" accessibilityLabel={ARENA_3V3_COPY.askLabel(card.name)} style={[styles.swap, busy && styles.swapBusy]}>
          <Text style={styles.swapText}>{busy ? ARENA_3V3_COPY.asking : ARENA_3V3_COPY.swapIn}</Text>
        </Pressable> : null}
    </View>
    {/* DECISIONS #71: the host LV badge is a lower-left corner tab on every fighter card. */}
    <View style={[styles.levelTab, { borderColor: accent }]}><Text style={styles.level}>{card.levelBadge}</Text></View>
  </View>;
}
const styles = StyleSheet.create({
    root: { gap: theme.space.sm, paddingHorizontal: theme.space.lg },
    phase: { ...theme.type.micro, color: theme.colors.cursor, letterSpacing: 1, textAlign: 'center' },
    buddy: { alignItems: 'center', backgroundColor: theme.plates.keycap, borderColor: theme.colors.border, borderStyle: 'dashed', borderWidth: 1, flexDirection: 'row', gap: theme.space.sm, minHeight: 36, paddingHorizontal: theme.space.sm },
    buddyLabel: { ...theme.type.micro, color: theme.colors.purple, letterSpacing: 1 },
    buddySlot: { borderColor: theme.colors.subtle, borderStyle: 'dashed', borderWidth: 1, height: 24, width: 24 },
    buddyLine: { ...theme.type.micro, color: theme.colors.subtle, flex: 1, letterSpacing: 1 },
    benchRow: { flexDirection: 'row', gap: theme.space.sm },
    card: { backgroundColor: theme.plates.navy, borderWidth: 1, flexDirection: 'row', gap: theme.space.sm, padding: theme.space.sm, paddingBottom: 26 },
    cardWide: { alignItems: 'center' },
    cardBench: { flex: 1, minWidth: 0 },
    cardKo: { opacity: 0.55 },
    art: { height: 44, width: 36 },
    artWide: { height: 72, width: 60 },
    body: { flex: 1, gap: 3, minWidth: 0 },
    name: { ...theme.type.label, color: theme.colors.text },
    levelTab: { backgroundColor: theme.colors.carbon, borderRightWidth: 1, borderTopWidth: 1, bottom: 0, left: 0, paddingHorizontal: 6, paddingVertical: 2, position: 'absolute' },
    level: { ...theme.type.micro, color: theme.colors.text, fontSize: 12 },
    role: { ...theme.type.micro, letterSpacing: 1 },
    hpTrack: { backgroundColor: theme.colors.graphite, flexDirection: 'row', height: 6 },
    hpFill: { height: 6 },
    hp: { ...theme.type.caption, color: theme.colors.muted },
    swap: { alignItems: 'center', borderColor: theme.colors.accent, borderWidth: 1, justifyContent: 'center', marginTop: 2, minHeight: 32 },
    swapBusy: { borderColor: theme.colors.disabled },
    swapText: { ...theme.type.micro, color: theme.colors.accent, letterSpacing: 1 },
});
