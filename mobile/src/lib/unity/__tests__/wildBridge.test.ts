import { describe, it, expect, vi } from 'vitest';
import { connectWildBridge, parseRequest } from '../wildBridge';
const request = (extra = {}) => JSON.stringify({ schemaVersion: 'wild-bridge-1', sessionId: 'session-1', requestId: 'request-1', operation: 'refresh', ...extra });
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
function setup(invoke = vi.fn(async () => ({ encounters: [], worldStates: [], withdrawnEncounterIds: [] })), signedIn = () => true) {
  let receive!: (json: string) => void;
  const send = vi.fn(); const unsubscribe = vi.fn();
  const dispose = connectWildBridge({ sessionId: 'session-1', invoke, isSignedIn: signedIn, timeoutMs: 20,
    port: { send, subscribe: callback => { receive = callback; return unsubscribe; } } });
  return { receive, send, invoke, dispose, unsubscribe };
}
describe('wild bridge authority and lifecycle', () => {
  it('forwards host reply without calculating outcome', async () => {
    const s = setup(); s.receive(request()); await flush();
    expect(s.invoke).toHaveBeenCalledWith({ operation: 'refresh' });
    expect(JSON.parse(s.send.mock.calls[0][0])).toMatchObject({ ok: true, requestId: 'request-1' });
  });
  it('drops foreign sessions and oversized messages', async () => {
    const s = setup(); s.receive(request({ sessionId: 'other' })); s.receive('x'.repeat(8193)); await flush(); expect(s.invoke).not.toHaveBeenCalled();
  });
  it('rejects forged item/capture data and strips claimed outcome', () => {
    const intent = { schemaVersion: 'acquisition-0', requestId: 'request-1', encounterId: 'hare-1', toyId: 'light', observedHealth01: .3, captured: true };
    const parsed = parseRequest(request({ operation: 'capture', intent }), 'session-1');
    expect((parsed.command as any).intent.captured).toBeUndefined();
    expect(() => parseRequest(request({ operation: 'capture', intent: { ...intent, requestId: 'mismatch' } }), 'session-1')).toThrow();
    expect(() => parseRequest(request({ operation: 'capture', intent: { ...intent, observedHealth01: 2 } }), 'session-1')).toThrow();
  });
  it('fails closed while signed out', async () => {
    const s = setup(undefined, () => false); s.receive(request()); await flush(); expect(s.invoke).not.toHaveBeenCalled();
    expect(JSON.parse(s.send.mock.calls[0][0]).errorCode).toBe('unauthenticated');
  });
  it('disposal suppresses late replies', async () => {
    let finish!: (r: any) => void; const s = setup(vi.fn(() => new Promise(resolve => finish = resolve)));
    s.receive(request()); await flush(); s.dispose(); finish({}); await flush(); expect(s.send).not.toHaveBeenCalled(); expect(s.unsubscribe).toHaveBeenCalledOnce();
  });
  it('serializes requests and preserves server rejection codes', async () => {
    const invoke = vi.fn().mockRejectedValue({ details: { rejectionCode: 'sequence_conflict' } }); const s = setup(invoke);
    s.receive(request()); s.receive(request({ requestId: 'request-2' })); await flush();
    expect(invoke).toHaveBeenCalledTimes(2); expect(JSON.parse(s.send.mock.calls[0][0]).errorCode).toBe('sequence_conflict');
  });
  it('times out without manufacturing a successful capture', async () => {
    const s = setup(vi.fn(() => new Promise(() => {}))); s.receive(request()); await new Promise(resolve => setTimeout(resolve, 30));
    expect(JSON.parse(s.send.mock.calls[0][0])).toMatchObject({ ok: false, errorCode: 'deadline-exceeded' }); s.dispose();
  });
});
