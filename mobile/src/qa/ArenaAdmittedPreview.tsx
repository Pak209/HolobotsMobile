import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { BattleArenaView } from '@/components/arena/BattleArenaView';
import { BattleResultsModal } from '@/components/arena/BattleResultsModal';
import { ArenaMatchFlow, arenaReceiptResult, type ArenaReply } from '@/lib/arenaMatchFlow';
import { arenaHostBattle } from '@/lib/arenaHostBattle';
import fixture from './fixtures/arena-admitted-lifecycle.json';
const noop = () => { };
function Preview({ result = false, knownBad = false }: {
    result?: boolean; knownBad?: boolean;
}) {
    const [reply, setReply] = useState<ArenaReply | null>(null);
    useEffect(() => {
        let live = true;
        const flow = new ArenaMatchFlow(async (request) => fixture.steps.find(s => s.request.operation === request.operation)!.reply, { get: async () => null, set: async () => { } }, () => live);
        void flow.resume().then(() => flow.issue({ requestId: 'admitted_fixture_01', tierId: 'rookie', paymentMethod: 'tokens', holobotId: 'ace', opponentName: 'HARE' })).then(() => flow.start()).then(async (r) => result ? flow.settle({ playerFinalHealth: 30, opponentFinalHealth: 0, combosCompleted: 0, perfectDefenses: 0 }) : r).then(r => { if (live)
            setReply(r); });
        return () => { live = false; flow.close(); };
    }, [result]);
    if (!reply?.match)
        return <Text>QA fixture loading</Text>;
    const prepared = arenaHostBattle({ ...reply.match, state: 'active' }, 'offline-fixture');
    const receipt = result ? arenaReceiptResult(reply) : null;
    return <View style={{ flex: 1, backgroundColor: '#101820' }}><Text style={{ paddingTop: 45, textAlign: 'center', color: '#62DDE8' }}>QA / SIMULATED / NO REWARDS</Text>{knownBad ? <Text style={{ textAlign: 'center', color: '#ffca79' }}>KNOWN BAD: OLD CARD HAS NO HOST LEVELS</Text> : null}
  <BattleArenaView embedded battle={prepared.battle} hostMatchReply={knownBad ? undefined : reply} hostMatchId={knownBad ? undefined : reply.matchId!} roundProgress={{ currentRound: 1, totalRounds: 1 }} playerCards={prepared.playerMoves} playableCardIds={prepared.playerMoves.map(m => m.id)} cardAvailability={{}} lastAction={null} isAnimating={false} onCardPlay={noop} onSignaturePlay={noop}/>
  {receipt ? <BattleResultsModal visible didWin={receipt.didWin} receipt={{ kind: 'qa-standin' }} context={`ACE LV ${reply.match.entrant.level} / HARE LV ${reply.match.opponent.level} · HOST FIXTURE RECEIPT`} hideRematch onRematch={noop} onExit={noop}/> : null}
 </View>;
}
export function ArenaAdmittedRoundPreview() { return <Preview />; }
export function ArenaAdmittedResultPreview() { return <Preview result/>; }

export function ArenaAdmittedKnownBadPreview(){return <Preview knownBad/>;}
