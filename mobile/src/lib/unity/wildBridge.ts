/** Session-bound transport only. Every gameplay ruling comes from the authenticated callable. */
export const WILD_BRIDGE_VERSION = 'wild-bridge-1';
export type Command = { operation: 'refresh' } | { operation: 'worldState'; encounterId: string } |
  { operation: 'offerToy' | 'capture'; intent: Record<string, unknown> };
export interface NativeWildPort {
  subscribe(receive: (json: string) => void): () => void;
  send(json: string): void;
}
export interface WildBridgeOptions {
  sessionId: string;
  port: NativeWildPort;
  invoke(command: Command): Promise<unknown>;
  isSignedIn(): boolean;
  timeoutMs?: number;
}
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export function parseRequest(raw: string, sessionId: string) {
  if (raw.length > 8192) throw new Error('invalid_request');
  const r = JSON.parse(raw);
  if (!r || r.schemaVersion !== WILD_BRIDGE_VERSION || r.sessionId !== sessionId || !id(r.requestId)) throw new Error('invalid_request');
  let command: Command;
  switch (r.operation) {
    case 'refresh': command = { operation: 'refresh' }; break;
    case 'worldState':
      if (!id(r.encounterId)) throw new Error('invalid_request');
      command = { operation: 'worldState', encounterId: r.encounterId }; break;
    case 'offerToy': case 'capture': {
      const i = r.intent;
      const toy = r.operation === 'offerToy';
      if (!i || i.schemaVersion !== (toy ? 'capture-world-1' : 'acquisition-1') ||
          !id(i.requestId) || i.requestId !== r.requestId || !id(i.encounterId) || !id(toy ? i.itemId : i.toyId)) throw new Error('invalid_request');
      if (!toy && (typeof i.observedHealth01 !== 'number' || !Number.isFinite(i.observedHealth01) || i.observedHealth01 < 0 || i.observedHealth01 > 1)) throw new Error('invalid_request');
      // Copy only contracted observations; never forward authority-like extra fields.
      command = { operation: r.operation, intent: { schemaVersion: i.schemaVersion, requestId: i.requestId,
        encounterId: i.encounterId, ...(toy ? { itemId: i.itemId } : { toyId: i.toyId, observedHealth01: i.observedHealth01 }) } };
      break;
    }
    default: throw new Error('invalid_request');
  }
  return { requestId: r.requestId as string, command };
}
function rejection(error: unknown): string {
  const e = error as { details?: { rejectionCode?: string }; code?: string };
  const code = e?.details?.rejectionCode ?? e?.code?.replace(/^functions\//, '');
  return ['invalid_request', 'not_allowed', 'unavailable', 'sequence_conflict', 'unauthenticated', 'deadline-exceeded'].includes(code ?? '') ? code! : 'unavailable';
}
export function connectWildBridge(options: WildBridgeOptions): () => void {
  if (!id(options.sessionId)) throw new Error('invalid session');
  let disposed = false, queued = 0;
  let tail = Promise.resolve();
  const send = (requestId: string, fields: object) => {
    if (!disposed) options.port.send(JSON.stringify({ schemaVersion: WILD_BRIDGE_VERSION, sessionId: options.sessionId, requestId, ...fields }));
  };
  const unsubscribe = options.port.subscribe(raw => {
    if (disposed) return;
    let request: ReturnType<typeof parseRequest>;
    try { request = parseRequest(raw, options.sessionId); } catch { return; } // foreign/malformed sessions receive nothing
    if (queued >= 16) { send(request.requestId, { ok: false, errorCode: 'unavailable' }); return; }
    queued++;
    tail = tail.then(async () => {
      if (disposed) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!options.isSignedIn()) throw { code: 'unauthenticated' };
        const result = await Promise.race([options.invoke(request.command), new Promise((_, reject) => {
          timer = setTimeout(() => reject({ code: 'deadline-exceeded' }), options.timeoutMs ?? 15000);
        })]);
        // Auth changes must dispose this session; also fail closed if logout happened mid-flight.
        if (!options.isSignedIn()) throw { code: 'unauthenticated' };
        send(request.requestId, { ok: true, result });
      } catch (error) { send(request.requestId, { ok: false, errorCode: rejection(error) }); }
      finally { if (timer) clearTimeout(timer); }
    }).catch(() => { /* a torn-down native port must not poison later promises */ }).finally(() => { queued--; });
  });
  return () => { if (disposed) return; disposed = true; unsubscribe(); };
}
