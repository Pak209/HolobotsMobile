import { describe, expect, it, vi } from 'vitest';
import { TravelSquadSession, readTravelSquad, type SquadCommand } from '../travelSquadClient';
const squad = (revision=1, holobotIds=['ace']) => ({ schemaVersion: 'travel-squad-1' as const, revision, holobotIds });
const reply = (requestId='', revision=1, ids=['ace']) => ({ schemaVersion: 'travel-squad-1', requestId, travelSquad: squad(revision, ids) });
describe('server travel squad', () => {
  it('never predicts a swap; only matching host result changes membership', async () => {
    let resolve!: (v: unknown) => void;
    const invoke=vi.fn().mockResolvedValueOnce(reply()).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    const publish=vi.fn(); const s=new TravelSquadSession(invoke,vi.fn(),publish,()=> 'one');await s.refresh();
    const pending=s.choose(0,'kuma');expect(s.state.squad?.holobotIds).toEqual(['ace']);expect(s.state.busy).toBe(true);
    resolve(reply('one',2,['kuma']));await pending;expect(s.state.squad?.holobotIds).toEqual(['kuma']);expect(publish).toHaveBeenLastCalledWith(squad(2,['kuma']));
  });
  it('retries the exact intent after an unknown transport outcome', async () => {
    const invoke=vi.fn().mockResolvedValueOnce(reply()).mockRejectedValueOnce({code:'functions/deadline-exceeded'}).mockResolvedValueOnce(reply('stable',2,['kuma']));
    const s=new TravelSquadSession(invoke,vi.fn(),vi.fn(),()=> 'stable');await s.refresh();await s.choose(0,'kuma');
    expect(s.state.retry).toBe(true);await s.choose(0,'hare');expect(invoke).toHaveBeenCalledTimes(2);await s.retry();
    expect(invoke.mock.calls[2][0]).toEqual(invoke.mock.calls[1][0]);expect(s.state.retry).toBe(false);expect(s.state.squad?.holobotIds).toEqual(['kuma']);
  });
  it('refreshes conflict without automatically overwriting the other device', async () => {
    const invoke=vi.fn().mockResolvedValueOnce(reply()).mockRejectedValueOnce({details:{rejectionCode:'stale_revision'}}).mockResolvedValueOnce(reply('',5,['shadow']));
    const s=new TravelSquadSession(invoke,vi.fn());await s.refresh();await s.choose(0,'kuma');
    expect(invoke.mock.calls.map(x=>(x[0] as SquadCommand).operation)).toEqual(['refresh','setSlot','refresh']);expect(s.state.squad?.holobotIds).toEqual(['shadow']);expect(s.state.retry).toBe(false);
  });
  it('requires a successful refresh after a conflict refresh fails', async () => {
    const invoke=vi.fn().mockResolvedValueOnce(reply()).mockRejectedValueOnce({details:{rejectionCode:'stale_revision'}}).mockRejectedValueOnce({code:'unavailable'});
    const s=new TravelSquadSession(invoke,vi.fn());await s.refresh();await s.choose(0,'kuma');await s.choose(0,'hare');
    expect(s.state.squad).toBeNull();expect(invoke).toHaveBeenCalledTimes(3);
  });
  it('rejects wrong response identity without applying an unrelated snapshot', async () => {
    const invoke=vi.fn().mockResolvedValueOnce(reply()).mockResolvedValueOnce(reply('foreign',9,['kuma']));
    const s=new TravelSquadSession(invoke,vi.fn(),vi.fn(),()=> 'one');await s.refresh();await s.choose(0,'kuma');expect(s.state.squad?.holobotIds).toEqual(['ace']);expect(s.state.retry).toBe(true);
  });
  it('does not regress a newer host snapshot', async () => {
    const s=new TravelSquadSession(vi.fn().mockResolvedValue(reply('',2,['ace'])),vi.fn());s.accept(squad(3,['kuma']));await s.refresh();expect(s.state.squad?.holobotIds).toEqual(['kuma']);
  });
  it('drops late account/session responses after disposal', async () => {
    let resolve!:(v:unknown)=>void;const changed=vi.fn(),publish=vi.fn();const s=new TravelSquadSession(()=>new Promise(r=>{resolve=r;}),changed,publish);
    const task=s.refresh();s.dispose();const count=changed.mock.calls.length;resolve(reply());await task;expect(changed).toHaveBeenCalledTimes(count);expect(publish).not.toHaveBeenCalled();
  });
  it('does not locally grant on server ownership rejection', async () => {
    const invoke=vi.fn().mockResolvedValueOnce(reply()).mockRejectedValueOnce({details:{rejectionCode:'not_allowed'}});
    const s=new TravelSquadSession(invoke,vi.fn());await s.refresh();await s.choose(0,'wolf');expect(s.state.squad?.holobotIds).toEqual(['ace']);expect(s.state.retry).toBe(false);
  });
  it('accepts no holes or unbounded slot indices', async () => {
    const invoke=vi.fn().mockResolvedValue(reply());const s=new TravelSquadSession(invoke,vi.fn());await s.refresh();await s.choose(2,'wolf');await s.choose(-1,'wolf');expect(invoke).toHaveBeenCalledTimes(1);
  });
  it.each([squad(-1),squad(1,['ace','ace']),squad(1,['ACE']),squad(1,['ace','kuma','hare','wolf']),squad(2147483648)])('rejects malformed authority snapshots', value => {expect(()=>readTravelSquad(value)).toThrow();});
});
