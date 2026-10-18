import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ArenaBenchCards } from '@/components/arena/ArenaBenchCards';
import { ArenaMatchFlow, arenaHostRejection } from '@/lib/arenaMatchFlow';
import { readArena3v3Reply, type Arena3v3Reply, type Arena3v3Swap } from '@/lib/arenaMatch3v3';
import { fixtureBenchHost, fixtureSwap, legacyLocalTeam, legacyStaSplicedReply, memoryIntents, type ARENA_BENCH_PREVIEW_ROUTES } from './arenaBenchFixtures';

/** Offline 3v3 bench witness. A hand-authored PROPOSAL fixture (HolobotsMobile #134) runs through the real reader
 * and the real ArenaMatchFlow.swap. No host implements 3v3, nothing is charged, and no account is used.
 * On-screen copy says "City", never "host" (DECISIONS #71; PLACEHOLDER until Lex). */
function Frame({ title, tone = '#62DDE8', children }: { title: string; tone?: string; children: ReactNode }) {
    return <ScrollView style={{ flex: 1, backgroundColor: '#101318' }} contentContainerStyle={{ paddingTop: 54, paddingBottom: 24, gap: 10 }}>
    <Text style={{ color: '#62DDE8', textAlign: 'center', fontSize: 11, letterSpacing: 1 }}>QA / OFFLINE PROPOSAL FIXTURE / NO CITY CALL / NO CHARGE</Text>
    <Text style={{ color: tone, textAlign: 'center', fontSize: 15, letterSpacing: 1, paddingHorizontal: 16 }}>{title}</Text>
    {children}
  </ScrollView>;
}
const Line = ({ children, tone = '#A9BDC8' }: { children: ReactNode; tone?: string }) => <Text style={{ color: tone, fontSize: 12, paddingHorizontal: 16, textAlign: 'center' }}>{children}</Text>;

/** KNOWN BAD first: legacy local teamBattle regen raises bench STA on the client clock. Spliced into a real City
 * projection, the strict reader refuses it, so no bench card is drawn from it. */
function KnownBad() {
    const { before, after } = legacyLocalTeam();
    let refusal = 'ACCEPTED (gate broken)';
    try { readArena3v3Reply(legacyStaSplicedReply()); } catch (e) { refusal = e instanceof Error ? e.message : String(e); }
    return <Frame title="KNOWN BAD · LEGACY LOCAL 3V3 (teamBattle)" tone="#FF603D">
    {after.player.slots.map((slot, i) => <Line key={i} tone="#FF603D">{`${slot.fighter.name}  LOCAL STA ${before.player.slots[i].fighter.stamina} → ${slot.fighter.stamina}  ${i === after.player.activeIndex ? '(active)' : '(bench, client regen)'}`}</Line>)}
    <Line tone="#FFCB6C">{`local STA spliced into a City reply → 3v3 reader: ${refusal}`}</Line>
    <Line tone="#FFCB6C">NO BENCH CARDS DRAWN FROM LOCAL STATE</Line>
  </Frame>;
}
/** A host cell: resume to one fixture projection, optionally ask the host for one swap, then draw only host data. */
function HostCell({ title, resumeAt, swap }: { title: string; resumeAt: string; swap?: Arena3v3Swap }) {
    const [reply, setReply] = useState<Arena3v3Reply | null>(null), [before, setBefore] = useState<Arena3v3Reply | null>(null);
    const [answer, setAnswer] = useState(''), [busy, setBusy] = useState(false), [flow, setFlow] = useState<ArenaMatchFlow | null>(null);
    useEffect(() => {
        let live = true;
        const intents = memoryIntents(swap ?? null);
        const f = new ArenaMatchFlow(fixtureBenchHost(resumeAt), { get: async () => null, set: async () => { } }, () => live, intents);
        setFlow(f);
        void (async () => {
            const first = await f.resumeTeam();
            if (!live) return;
            setReply(first);
            if (!swap) return;
            setBefore(first);
            try { const r = await f.swap(swap.holobotId); if (live) { setReply(r); setAnswer(`CITY ACCEPTED swap → ${swap.holobotId.toUpperCase()} · turn ${r.intent!.appliedTurn} → ${r.match!.battle.turn}`); } }
            catch (e) { if (live) { setReply(f.teamReply); setAnswer(`CITY REFUSED ${arenaHostRejection(e) ?? String(e)} · NOTHING CHANGED · intent ${intents.peek() ? 'kept' : 'cleared'}`); } }
        })().catch(e => { if (live) setAnswer(`UNAVAILABLE ${e instanceof Error ? e.message : String(e)}`); });
        return () => { live = false; f.close(); };
    }, [resumeAt, swap]);
    const ask = async (holobotId: string) => {
        if (!flow || busy) return;
        setBusy(true);
        try { const r = await flow.swap(holobotId); setReply(r); setAnswer(`CITY ACCEPTED swap → ${holobotId.toUpperCase()}`); }
        catch (e) { setReply(flow.teamReply); setAnswer(`CITY REFUSED ${arenaHostRejection(e) ?? String(e)} · NOTHING CHANGED`); }
        finally { setBusy(false); }
    };
    const match = reply?.match;
    return <Frame title={title}>
    {before?.match && swap ? <Line>{`ASKED THE CITY: swap → ${swap.holobotId.toUpperCase()} at turn ${swap.turn}`}</Line> : null}
    {match ? <ArenaBenchCards match={match} onSwap={match.state === 'active' ? ask : undefined} busy={busy}/> : <Line>QA fixture loading</Line>}
    {answer ? <Line tone="#FFCB6C">{answer}</Line> : null}
    {match ? <Line>{`ONE ENTRY CHARGE · ${match.entryReceipt.amount} ${match.entryReceipt.method === 'pass' ? 'PASS' : 'HOLOS'} · NO PER-FIGHTER CHARGE`}</Line> : null}
  </Frame>;
}
type RouteName = (typeof ARENA_BENCH_PREVIEW_ROUTES)[number];
export const arenaBenchPreviewScreens: Record<RouteName, ComponentType> = {
    ArenaBenchKnownBad: () => <KnownBad/>,
    ArenaBenchCommand: () => <HostCell title="COMMAND · KUMA ACTIVE · ACE BENCHED AT CITY HP" resumeAt="swap-1-voluntary"/>,
    ArenaBenchRefused: () => <HostCell title="KNOWN BAD INTENT · SWAP TO KO'D KUMA" resumeAt="report-2-active-ko" swap={fixtureSwap('refused-swap-to-ko')}/>,
    ArenaBenchSendIn: () => <HostCell title="KO FORCES SEND-IN · CITY ACCEPTS SHADOW" resumeAt="report-2-active-ko" swap={fixtureSwap('swap-2-forced-send-in')}/>,
    ArenaBenchSettled: () => <HostCell title="SETTLED · CITY HP WRITTEN FOR ALL THREE" resumeAt="settle"/>,
};
