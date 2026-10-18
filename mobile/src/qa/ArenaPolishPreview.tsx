import { useMemo, type ComponentType } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ArenaScreen } from '@/screens/ArenaScreen';
import { ArenaMatchFlow, type ArenaIssue, type ArenaPendingSettle, type ArenaReply } from '@/lib/arenaMatchFlow';
import { theme } from '@/theme';
import { ARENA_ISSUED, ARENA_SETTLED, ARENA_SETTLE_REPORT, ARENA_STARTED, arenaPayoutCappedIssue, arenaRefundReply, arenaWithheldReply, tooFast } from './arenaPolishFixtures';

/**
 * Offline QA routes for lite-arena-polish-1 (holobotsmobile://qa/ArenaPolish…). Each cell mounts the REAL ArenaScreen on
 * a recorded-reply transport (no callable, no account, nothing charged): the screen's own phase logic picks what shows.
 * Cell order puts the known-bad control first, as the gate sheet expects.
 */
type Cell = { title: string; caption: string; resume: () => ArenaReply; settle?: () => never | ArenaReply; pendingSettle?: boolean; payoutCapped?: boolean };
const CELLS: Record<string, Cell> = {
    ArenaPolishAdmitted: { title: 'ADMITTED', caption: 'Issued match, framed interstitial, City fighter cards with the LV corner tab.', resume: () => ARENA_ISSUED },
    ArenaPolishCapped: { title: 'PAYOUT CAPPED', caption: 'Recorded issue reply with payoutCapped true: notice before START.', resume: () => arenaPayoutCappedIssue(), payoutCapped: true },
    // Relaunch with a stored settle; the City keeps answering too_fast with a long hint, so the resend stays armed.
    ArenaPolishConfirming: { title: 'PENDING CONFIRM', caption: 'Stored win resent after relaunch; too_fast is shown as "confirming", never raw.', resume: () => ARENA_STARTED, settle: () => { throw tooFast(600_000); }, pendingSettle: true },
    // Hint 1 ms: the bounded budget is spent almost at once and the screen hands over TRY AGAIN.
    ArenaPolishStalled: { title: 'NOT CONFIRMED', caption: 'Budget spent (5 resends): manual TRY AGAIN; the result stays saved.', resume: () => ARENA_STARTED, settle: () => { throw tooFast(1); }, pendingSettle: true },
    ArenaPolishWithheld: { title: 'WITHHELD RECEIPT', caption: 'host #143 payoutWithheld daily_cap: all-zero receipt with its honest reason.', resume: () => arenaWithheldReply('daily_cap') },
    ArenaPolishRefund: { title: 'REFUND CLOSURE', caption: 'Cancelled before start: the City receipt names the refund (F7).', resume: () => arenaRefundReply() },
    ArenaPolishPaid: { title: 'PAID RECEIPT', caption: 'Recorded paid settle: CITY RECEIPT rows with the bundled reward glyphs (L4, L18).', resume: () => ARENA_SETTLED },
};

function cellFlow(cell: Cell) {
    let issue: ArenaIssue | null = null, ack: string | null = null;
    let settle: ArenaPendingSettle | null = cell.pendingSettle ? { matchId: ARENA_STARTED.matchId!, report: ARENA_SETTLE_REPORT } : null;
    return new ArenaMatchFlow(async (request) => {
        if (request.operation === 'resume') return cell.resume();
        if (request.operation === 'settle' && cell.settle) return cell.settle();
        throw Object.assign(Error('unavailable'), { code: 'functions/unavailable', details: { rejectionCode: 'unavailable' } });
    }, { get: async () => issue, set: async v => { issue = v; } }, () => true, undefined, {
        settles: { get: async () => settle, set: async v => { settle = v; } },
        acks: { get: async () => ack, set: async v => { ack = v; } },
    });
}
function Banner({ title, caption }: { title: string; caption: string }) {
    return <View pointerEvents="none" style={styles.banner}><Text style={styles.bannerTitle}>{`QA / OFFLINE / RECORDED REPLIES · ${title}`}</Text><Text style={styles.bannerCaption}>{caption}</Text></View>;
}
/** KNOWN BAD control: the pre-fix screen printed the raw rejection and the forbidden word (c187921 ArenaScreen.tsx:120). */
function ArenaPolishKnownBad() {
    return <View style={styles.root}>
    <Banner title="KNOWN BAD (PRE-FIX)" caption="Old ArenaScreen: raw too_fast, unframed, says HOST. Must never ship."/>
    <View style={styles.bad}><Text style={styles.badError}>too_fast</Text><Text style={styles.badLink}>RESUME HOST MATCH</Text><Text style={styles.badLink}>RETRY SAME ADMISSION</Text></View>
  </View>;
}
export const arenaPolishPreviewScreens: Record<string, ComponentType> = {
    ArenaPolishKnownBad,
    ...Object.fromEntries(Object.entries(CELLS).map(([name, cell]) => [name, function ArenaPolishCell() {
        const flow = useMemo(() => cellFlow(cell), []);
        return <View style={styles.root}><ArenaScreen preview={{ flow, uid: 'offline-fixture', payoutCapped: cell.payoutCapped }}/><Banner title={cell.title} caption={cell.caption}/></View>;
    }])),
};
const styles = StyleSheet.create({
    root: { backgroundColor: theme.colors.carbon, flex: 1 },
    banner: { backgroundColor: theme.plates.overlay, bottom: 0, left: 0, paddingHorizontal: theme.space.md, paddingVertical: theme.space.xs, position: 'absolute', right: 0 },
    bannerTitle: { ...theme.type.micro, color: theme.colors.accent, textAlign: 'center' },
    bannerCaption: { ...theme.type.micro, color: theme.colors.muted, textAlign: 'center' },
    bad: { paddingHorizontal: theme.space.lg, paddingTop: 120 },
    badError: { ...theme.type.body, color: theme.colors.cursor },
    badLink: { ...theme.type.body, color: theme.colors.accent },
});
