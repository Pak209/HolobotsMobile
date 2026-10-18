export type Move = 'strike' | 'heavy' | 'finisher';
export type Action = Move | 'move' | 'guard_down' | 'guard_up' | 'disengage' | 'deploy' | 'select_target';
export interface MoveRule {
    damage: number;
    staminaCost: number;
    syncCost: number;
    syncGain: number;
    windupTicks: number;
    recoveryTicks: number;
    rangeMm: number;
    hitChanceBps: number;
    variance: number;
    interruptTicks: number;
    cancelAfterTicks: number;
}
export interface FighterRule {
    id: string;
    side: 0 | 1;
    cpu: boolean;
    deployed: boolean;
    hp: number;
    stamina: number;
    sync: number;
    maxHp: number;
    maxStamina: number;
    maxSync: number;
    x: number;
    z: number;
    radiusMm: number;
    speedMmPerTick: number;
    regenPerTick: number;
    disengageRegenPerTick: number;
    moves: Record<Move, MoveRule>;
}
/** Host-authored immutable admission, never accepted from a live client. No balance defaults. */
export interface RulesSnapshot {
    simVersion: 'duel-sim-1' | 'duel-sim-2';
    tickHz: 30;
    maxTicks: number;
    arenaHalfSizeMm: number;
    heldTicks: number;
    guardDamageBps: number;
    guardWindowTicks: number;
    cpuEveryTicks: number;
    timeout: 'draw' | 'remaining_hp';
    fighters: FighterRule[];
    /** Required only for the offline movement v2 core. Keys are fighter instance IDs. */
    movement?: Record<string, MovementRule>;
}
export interface Command {
    seq: number;
    tick: number;
    actor: string;
    action: Action;
    target?: string;
    x?: number;
    z?: number;
}
/** Assembled core input only. Append/session/time validation belongs to the future endpoint. */
export interface InputLog {
    schemaVersion: 'duel-inputs-1';
    events: Command[];
}
export interface PendingAttack {
    move: Move;
    target: string;
    startTick: number;
    contactTick: number;
}
export interface FighterState {
    id: string;
    side: number;
    deployed: boolean;
    hp: number;
    stamina: number;
    sync: number;
    x: number;
    z: number;
    facingX: number;
    facingZ: number;
    moveX: number;
    moveZ: number;
    moveUntil: number;
    guardUntil: number;
    guardStarted: number;
    disengaged: boolean;
    readyTick: number;
    stunnedUntil: number;
    target: string | null;
    attack: PendingAttack | null;
    movement?: MovementState;
}
export interface SimState {
    simVersion: 'duel-sim-1' | 'duel-sim-2';
    rulesHash: string;
    seed: string;
    tick: number;
    winner: number | null;
    reason: 'running' | 'ko' | 'timeout';
    fighters: FighterState[];
}
export interface SimEvent {
    tick: number;
    actor: string;
    action: string;
    target: string | null;
    damage: number;
    hit: boolean;
    reason: string;
}
export interface TickResult {
    tick: number;
    hash: string;
    events: SimEvent[];
}
export interface SimResult {
    initialHash: string;
    inputHash: string;
    ticks: TickResult[];
    finalState: SimState;
    finalHash: string;
}

export interface MovementRule { speedMmPerSecond: number; preferredRangeMm: number; }
export interface MovementState {
    queued: {move: Move; target: string} | null;
    dashReadyTick: number;
    dashTicks: number;
    dashX: number;
    dashZ: number;
    runRemainder: number;
}
