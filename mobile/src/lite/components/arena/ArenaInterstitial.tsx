import type { ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/lite/theme';
import { getHolobotFullImageSource } from '@/config/holobots';
import { levelBadge } from '@/lite/lib/bots/hostFighterLevel';
import type { ArenaSnapshot } from '@/lite/lib/arenaMatchFlow';
import { GameDialogFrame } from '../ui/GameSurfaceFrame';
import { ArenaControlFrame } from './ArenaTierFrames';

export type ArenaInterstitialAction = { label: string; onPress: () => void; tone?: 'primary' | 'secondary' | 'danger'; disabled?: boolean };

/** L1: every non-fight Arena state (admitted, confirming, not confirmed, error, earlier entry) in ONE framed card with
 * player copy from lib/arenaCopy.ts. No raw codes, no inline hexes; the caller supplies safe-area padding. */
export function ArenaInterstitial({ eyebrow, title, body, notice, waiting = false, tone = 'accent', children, actions }: {
    eyebrow: string;
    title: string;
    body?: string;
    /** A highlighted one-liner, e.g. the payoutCapped notice before START. */
    notice?: string | null;
    waiting?: boolean;
    tone?: 'accent' | 'warning' | 'danger';
    children?: ReactNode;
    actions: ArenaInterstitialAction[];
}) {
    const accent = tone === 'danger' ? theme.colors.danger : tone === 'warning' ? theme.colors.cursor : theme.colors.accent;
    return <View style={styles.card} accessibilityRole="summary">
    <GameDialogFrame accent={accent} fill={theme.plates.navy}/>
    <Text style={[styles.eyebrow, { color: accent }]}>{eyebrow}</Text>
    <Text style={styles.title}>{title}</Text>
    {body ? <Text style={styles.body}>{body}</Text> : null}
    {children}
    {notice ? <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View> : null}
    {waiting ? <ActivityIndicator style={styles.spinner} color={accent}/> : null}
    <View style={styles.actions}>
      {actions.map(a => <Pressable key={a.label} accessibilityRole="button" accessibilityState={{ disabled: !!a.disabled }} disabled={a.disabled} onPress={a.onPress} style={[styles.button, a.disabled && styles.buttonDisabled]}>
          <ArenaControlFrame accent={a.tone === 'danger' ? theme.colors.danger : a.tone === 'secondary' ? theme.colors.border : theme.colors.accent} selected={a.tone !== 'secondary' && a.tone !== 'danger'}/>
          <Text style={[styles.buttonLabel, a.tone === 'secondary' && styles.secondaryLabel, a.tone === 'danger' && styles.dangerLabel]}>{a.label}</Text>
        </Pressable>)}
    </View>
  </View>;
}

/** An admitted fighter from the City's issued snapshot. DECISIONS #71: the LV badge is a lower-left corner tab, and it
 * is drawn only when the snapshot carries a valid level (no tab when absent). */
export function ArenaFighterCard({ snapshot, side }: { snapshot: ArenaSnapshot; side: 'entrant' | 'opponent' }) {
    const accent = side === 'entrant' ? theme.colors.accent : theme.colors.danger;
    const lv = levelBadge(snapshot.level);
    const hp = snapshot.currentHealth ?? snapshot.maxHealth;
    return <View style={[styles.fighter, { borderColor: accent }]} accessibilityLabel={`${snapshot.displayName}${lv ? ` ${lv}` : ''}, HP ${Math.round(hp)} of ${Math.round(snapshot.maxHealth)}`}>
    <Image source={getHolobotFullImageSource(snapshot.holobotId)} style={styles.art} resizeMode="contain"/>
    <Text numberOfLines={1} style={styles.name}>{snapshot.displayName}</Text>
    <Text style={styles.hp}>{`HP ${Math.round(hp)} / ${Math.round(snapshot.maxHealth)}`}</Text>
    {lv ? <View style={[styles.levelTab, { borderColor: accent }]}><Text style={styles.level}>{lv}</Text></View> : null}
  </View>;
}

const styles = StyleSheet.create({
    card: { alignSelf: 'center', maxWidth: 400, paddingHorizontal: theme.space.xl, paddingVertical: theme.space.xl, position: 'relative', width: '100%' },
    eyebrow: { ...theme.type.micro, letterSpacing: 2, textAlign: 'center' },
    title: { ...theme.type.header, color: theme.colors.text, marginTop: theme.space.sm, textAlign: 'center' },
    body: { ...theme.type.body, color: theme.colors.muted, marginTop: theme.space.md, textAlign: 'center' },
    notice: { borderColor: theme.colors.cursor, borderWidth: 1, marginTop: theme.space.lg, paddingHorizontal: theme.space.md, paddingVertical: theme.space.sm },
    noticeText: { ...theme.type.caption, color: theme.colors.cursor, textAlign: 'center' },
    spinner: { marginTop: theme.space.lg },
    actions: { gap: theme.space.md, marginTop: theme.space.xl },
    button: { alignItems: 'center', justifyContent: 'center', minHeight: theme.touchTarget, paddingHorizontal: theme.space.lg, position: 'relative' },
    buttonDisabled: { opacity: 0.45 },
    buttonLabel: { ...theme.type.label, color: theme.colors.accent, letterSpacing: 1 },
    secondaryLabel: { ...theme.type.body, color: theme.colors.muted, letterSpacing: 0.7 },
    dangerLabel: { ...theme.type.body, color: theme.colors.danger, letterSpacing: 0.7 },
    fighter: { alignItems: 'center', backgroundColor: theme.plates.keycap, borderWidth: 1, flex: 1, minWidth: 0, paddingBottom: 30, paddingHorizontal: theme.space.sm, paddingTop: theme.space.sm, position: 'relative' },
    art: { height: 88, width: '100%' },
    name: { ...theme.type.label, color: theme.colors.text, marginTop: theme.space.xs },
    hp: { ...theme.type.caption, color: theme.colors.muted },
    levelTab: { backgroundColor: theme.colors.carbon, borderRightWidth: 1, borderTopWidth: 1, bottom: 0, left: 0, paddingHorizontal: 6, paddingVertical: 2, position: 'absolute' },
    level: { ...theme.type.micro, color: theme.colors.text, fontSize: 12 },
});
