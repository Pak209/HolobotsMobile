/** Server-only travel squad. Never writes profile documents or predicts membership. */
export type TravelSquad = { schemaVersion: 'travel-squad-1'; revision: number; holobotIds: string[] };
export type SquadIntent = { schemaVersion: 'travel-squad-1'; requestId: string; expectedRevision: number; slotIndex: number; holobotId: string };
export type SquadCommand = { operation: 'refresh' } | { operation: 'setSlot'; intent: SquadIntent };
export type SquadReply = { schemaVersion: 'travel-squad-1'; requestId: string; travelSquad: TravelSquad };
export type SquadState = { squad: TravelSquad | null; busy: boolean; retry: boolean; message: string };
const validId = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{0,127}$/.test(v);
export function readTravelSquad(raw: unknown): TravelSquad {
  const r = raw as TravelSquad;
  if (!r || r.schemaVersion !== 'travel-squad-1' || !Number.isInteger(r.revision) || r.revision < 0 || r.revision > 2147483647 ||
      !Array.isArray(r.holobotIds) || r.holobotIds.length > 3 || !r.holobotIds.every(validId) || new Set(r.holobotIds).size !== r.holobotIds.length) throw new Error('invalid_reply');
  return { schemaVersion: 'travel-squad-1', revision: r.revision, holobotIds: [...r.holobotIds] };
}
function errorCode(e: unknown): string {
  const x = e as { details?: { rejectionCode?: string }; code?: string; message?: string };
  return x?.details?.rejectionCode ?? x?.code?.replace(/^functions\//, '') ?? x?.message ?? 'unavailable';
}
export class TravelSquadSession {
  state: SquadState = { squad: null, busy: false, retry: false, message: '' };
  private pending: SquadIntent | null = null;
  private disposed = false;
  constructor(private invoke: (command: SquadCommand) => Promise<unknown>, private changed: (state: SquadState) => void,
    private publish: (squad: TravelSquad) => void = () => {}, private requestId = () => `squad_${Date.now()}_${Math.random().toString(36).slice(2)}`) {}
  private notify() { if (!this.disposed) this.changed({ ...this.state, squad: this.state.squad ? readTravelSquad(this.state.squad) : null }); }
  accept(snapshot: unknown) {
    if (this.disposed) return;
    const squad = readTravelSquad(snapshot);
    if (this.state.squad && squad.revision < this.state.squad.revision) return;
    this.state.squad = squad; this.notify();
  }
  private apply(raw: unknown, id: string) {
    const reply = raw as SquadReply;
    if (!reply || reply.schemaVersion !== 'travel-squad-1' || reply.requestId !== id) throw new Error('invalid_reply');
    const squad = readTravelSquad(reply.travelSquad);
    this.accept(squad);
    if (!this.disposed && this.state.squad) this.publish(readTravelSquad(this.state.squad));
  }
  async refresh() {
    if (this.disposed || this.state.busy) return;
    this.state.busy = true; this.state.message = ''; this.notify();
    try { const result = await this.invoke({ operation: 'refresh' }); if (!this.disposed) this.apply(result, ''); }
    catch { if (!this.disposed) this.state.message = 'Travel squad unavailable. Check your connection and try again.'; }
    finally { if (!this.disposed) { this.state.busy = false; this.notify(); } }
  }
  async choose(slotIndex: number, holobotId: string) {
    if (this.disposed || this.state.busy || this.pending || !this.state.squad) return;
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 2 || slotIndex > this.state.squad.holobotIds.length || !validId(holobotId)) return;
    this.pending = { schemaVersion: 'travel-squad-1', requestId: this.requestId(), expectedRevision: this.state.squad.revision, slotIndex, holobotId };
    await this.send();
  }
  async retry() { if (!this.disposed && !this.state.busy && this.pending) await this.send(); }
  private async send() {
    const intent = this.pending!; this.state.busy = true; this.state.retry = false; this.state.message = 'Updating travel squad…'; this.notify();
    try {
      const result = await this.invoke({ operation: 'setSlot', intent: { ...intent } });
      if (this.disposed) return;
      this.apply(result, intent.requestId); this.pending = null; this.state.message = 'Travel squad confirmed.';
    } catch (error) {
      if (this.disposed) return;
      const code = errorCode(error);
      if (code === 'stale_revision') {
        this.pending = null; this.state.message = 'Your squad changed elsewhere. Review it and choose again.';
        try { const result = await this.invoke({ operation: 'refresh' }); if (!this.disposed) this.apply(result, ''); }
        catch { if (!this.disposed) { this.state.squad = null; this.state.message = 'Your squad changed elsewhere. Refresh before choosing again.'; } }
      } else if (['not_allowed', 'invalid_request', 'sequence_conflict', 'unauthenticated', 'permission-denied'].includes(code)) {
        this.pending = null; this.state.message = 'The server could not apply that choice. Refresh and choose an owned Holobot.';
      } else { this.state.retry = true; this.state.message = 'Confirmation not received. Retry the same change safely.'; }
    } finally { if (!this.disposed) { this.state.busy = false; this.notify(); } }
  }
  dispose() { this.disposed = true; }
}
